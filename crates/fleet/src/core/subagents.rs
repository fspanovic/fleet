//! The subagents (Agent / Task tool) a live Claude session is running right now.
//!
//! **Where they live.** Claude Code keeps a session's subagents next to its
//! transcript: `<projects>/<encoded cwd>/<session id>/subagents/agent-<id>.jsonl`
//! (the subagent's own transcript) plus `agent-<id>.meta.json`:
//! `{ agentType, description, toolUseId, spawnDepth, requestShape, model,
//! parentAgentId?, isFork?, finished?, stoppedByUser? }`.
//!
//! **What counts as running.** A subagent is running when all of these hold:
//! 1. its meta has neither `finished: true` nor `stoppedByUser: true` (newer Claude
//!    Codes write those; older ones never do, so their absence proves nothing);
//! 2. its transcript was written after the session's process started (`startedAt`
//!    in the registry) — a resumed session does not resume the old process's
//!    subagents;
//! 3. its transcript was written within the last [`STALE_AFTER_MS`] — the fallback
//!    for a subagent that died without a word (a crash, a lost notification);
//! 4. the last event about it in its parent's transcript — the session's, or the
//!    parent subagent's for a nested one (`parentAgentId`) — is not a completion.
//!    Completions: the `tool_result` of its `toolUseId` (a foreground agent), a
//!    `<task-notification>` naming it as `<task-id>` (a background agent, whatever
//!    its status: completed, failed, killed), or a `[Subagent hand-back]`
//!    `<agent-message from="<id>">`. The launch (its `tool_use`, the "Async agent
//!    launched" result) and a later `SendMessage` to it (which resumes a finished
//!    agent) count as running.
//!
//! **Cost.** Nothing is read for a session without a `subagents/` dir. With one,
//! each meta is read (a few hundred bytes) and each transcript only stat'ed. Only
//! when a candidate survives 1–3 is the parent transcript read, backwards from
//! its end in [`CHUNK`] pieces, until every candidate is decided or the scan
//! passes the oldest candidate's start (at most [`MAX_SCAN`]); the verdicts are
//! cached per `(path, size, mtime)` for long-running views (the TUI, MCP).

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// A subagent whose transcript has been quiet this long is presumed gone.
pub const STALE_AFTER_MS: i64 = 60 * 60 * 1000;
/// Backward read size of a parent transcript.
const CHUNK: u64 = 256 * 1024;
/// Never read more than this of one parent transcript per call.
const MAX_SCAN: u64 = 16 * 1024 * 1024;
/// Clock slack when comparing the parent's entry timestamps with file times.
const SLACK_MS: i64 = 60 * 1000;

/// One running subagent, as `subagents[]` in `fleet list --json`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Subagent {
    /// Claude Code's agent id (`agent-<id>.jsonl`).
    pub id: String,
    /// Its job: the Agent tool call's `description`.
    pub description: String,
    /// `general-purpose`, `Explore`, a custom agent's name…
    pub agent_type: Option<String>,
    /// The model it was asked to run (`opus`, `sonnet`, a full id…), when given.
    pub model: Option<String>,
    /// Started in the background (`requestShape: "background"`); `false` = the
    /// parent waits on it.
    pub background: bool,
    /// When it started, ms since the epoch (its transcript's creation time).
    pub started_at: Option<i64>,
    /// Its transcript's last write, ms since the epoch.
    pub last_active_at: Option<i64>,
    /// 1 = started by the session, 2 = by one of its subagents…
    pub depth: u32,
    /// The subagent that started this one (`depth` ≥ 2).
    pub parent_agent_id: Option<String>,
}

/// Running subagents of a live Claude session, oldest first.
/// `session_started_ms` is the registry's `startedAt` (the process start).
pub fn for_session(
    home: &Path,
    cwd: Option<&str>,
    session_id: &str,
    session_started_ms: Option<i64>,
) -> Vec<Subagent> {
    let Some(transcript) = crate::core::context::locate_transcript(home, cwd, session_id) else {
        return Vec::new();
    };
    running(&transcript, session_started_ms, now_ms())
}

/// Running subagents of the session whose transcript is `transcript`, as of `now`.
pub fn running(transcript: &Path, session_started_ms: Option<i64>, now: i64) -> Vec<Subagent> {
    let dir = transcript.with_extension("").join("subagents");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut cands: Vec<Candidate> = Vec::new();
    for e in entries.flatten() {
        let name = e.file_name();
        let Some(id) = name
            .to_str()
            .and_then(|n| n.strip_prefix("agent-"))
            .and_then(|n| n.strip_suffix(".meta.json"))
        else {
            continue;
        };
        if let Some(c) = candidate(&dir, id, session_started_ms, now) {
            cands.push(c);
        }
    }
    if cands.is_empty() {
        return Vec::new();
    }
    // Group by the transcript that would record each one's completion.
    let mut by_parent: HashMap<PathBuf, Vec<usize>> = HashMap::new();
    for (i, c) in cands.iter().enumerate() {
        let parent = c
            .agent
            .parent_agent_id
            .as_ref()
            .map(|p| dir.join(format!("agent-{p}.jsonl")))
            .filter(|p| p.is_file())
            .unwrap_or_else(|| transcript.to_path_buf());
        by_parent.entry(parent).or_default().push(i);
    }
    let mut done = vec![false; cands.len()];
    for (parent, idx) in by_parent {
        let group: Vec<&Candidate> = idx.iter().map(|&i| &cands[i]).collect();
        let verdicts = settle_cached(&parent, &group);
        for (&i, finished) in idx.iter().zip(verdicts) {
            done[i] = finished;
        }
    }
    let mut out: Vec<Subagent> = cands
        .into_iter()
        .zip(done)
        .filter(|(_, d)| !*d)
        .map(|(c, _)| c.agent)
        .collect();
    out.sort_by_key(|a| (a.started_at.unwrap_or(0), a.id.clone()));
    out
}

struct Candidate {
    agent: Subagent,
    tool_use_id: Option<String>,
}

/// A subagent that may still run: rules 1–3 of the module doc.
fn candidate(dir: &Path, id: &str, session_started: Option<i64>, now: i64) -> Option<Candidate> {
    let meta_path = dir.join(format!("agent-{id}.meta.json"));
    let meta: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&meta_path).ok()?).ok()?;
    if meta["finished"] == true || meta["stoppedByUser"] == true {
        return None;
    }
    let meta_md = std::fs::metadata(&meta_path).ok();
    let log_md = std::fs::metadata(dir.join(format!("agent-{id}.jsonl"))).ok();
    let last_active = log_md
        .as_ref()
        .or(meta_md.as_ref())
        .and_then(|m| m.modified().ok())
        .map(ms)?;
    if session_started.is_some_and(|s| last_active < s) || now - last_active > STALE_AFTER_MS {
        return None;
    }
    // Creation time, not the first entry's timestamp: a fork's transcript opens
    // with a copy of its parent's conversation, timestamps and all.
    let started = log_md
        .as_ref()
        .and_then(|m| m.created().ok())
        .or_else(|| meta_md.as_ref().and_then(|m| m.modified().ok()))
        .map(ms);
    let s = |k: &str| {
        meta[k]
            .as_str()
            .filter(|v| !v.is_empty())
            .map(str::to_string)
    };
    Some(Candidate {
        agent: Subagent {
            id: id.to_string(),
            description: s("description").unwrap_or_default(),
            agent_type: s("agentType"),
            model: s("model"),
            background: meta["requestShape"] == "background",
            started_at: started,
            last_active_at: Some(last_active),
            depth: meta["spawnDepth"].as_u64().unwrap_or(1) as u32,
            parent_agent_id: s("parentAgentId"),
        },
        tool_use_id: s("toolUseId"),
    })
}

/// What one parent-transcript entry says about a subagent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Event {
    /// It finished (or failed, or was stopped).
    Done,
    /// It was launched or resumed: no completion is older than this.
    Started,
}

type CacheKey = (u64, Option<SystemTime>);
/// Agent id -> finished?
type Verdicts = HashMap<String, bool>;
/// parent transcript -> ((size, mtime), verdicts).
static CACHE: LazyLock<Mutex<HashMap<PathBuf, (CacheKey, Verdicts)>>> =
    LazyLock::new(Default::default);

/// [`settle`], reusing earlier verdicts while the parent transcript is unchanged.
fn settle_cached(parent: &Path, cands: &[&Candidate]) -> Vec<bool> {
    let key = std::fs::metadata(parent)
        .ok()
        .map(|m| (m.len(), m.modified().ok()));
    if let Some(key) = key
        && let Ok(cache) = CACHE.lock()
        && let Some((k, known)) = cache.get(parent)
        && *k == key
        && let Some(hit) = cands
            .iter()
            .map(|c| known.get(&c.agent.id).copied())
            .collect::<Option<Vec<bool>>>()
    {
        return hit;
    }
    let verdicts = settle(parent, cands);
    if let Some(key) = key
        && let Ok(mut cache) = CACHE.lock()
    {
        let known = cands
            .iter()
            .map(|c| c.agent.id.clone())
            .zip(verdicts.iter().copied())
            .collect();
        cache.insert(parent.to_path_buf(), (key, known));
    }
    verdicts
}

/// Has each candidate finished, judging by the newest event about it in
/// `parent`? Reads backwards from the end; a candidate with no event (or an
/// unreadable parent) is still running.
fn settle(parent: &Path, cands: &[&Candidate]) -> Vec<bool> {
    let mut verdict: Vec<Option<Event>> = vec![None; cands.len()];
    let floor = cands
        .iter()
        .filter_map(|c| c.agent.started_at)
        .min()
        .map(|t| t - SLACK_MS);
    let Ok(mut file) = File::open(parent) else {
        return vec![false; cands.len()];
    };
    let size = file.metadata().map(|m| m.len()).unwrap_or(0);
    let mut end = size;
    // Bytes of a line cut by the previous (later) chunk's start.
    let mut carry: Vec<u8> = Vec::new();
    while end > 0 && size - end < MAX_SCAN {
        let start = end.saturating_sub(CHUNK);
        let mut buf = vec![0u8; (end - start) as usize];
        if file.seek(SeekFrom::Start(start)).is_err() || file.read_exact(&mut buf).is_err() {
            break;
        }
        buf.extend_from_slice(&carry);
        // Unless this is the file's start, the first line may be cut: keep it for the next round.
        let cut = if start == 0 {
            0
        } else {
            buf.iter()
                .position(|&b| b == b'\n')
                .map_or(buf.len(), |i| i + 1)
        };
        carry = buf[..cut].to_vec();
        let text = String::from_utf8_lossy(&buf[cut..]);
        for line in text.lines().rev() {
            for (i, c) in cands.iter().enumerate() {
                if verdict[i].is_none() {
                    verdict[i] = event(line, c);
                }
            }
            if verdict.iter().all(Option::is_some) {
                return verdict.iter().map(|v| *v == Some(Event::Done)).collect();
            }
        }
        // Everything older than the oldest candidate's start is about other agents.
        if let Some(floor) = floor
            && text.lines().find_map(entry_time).is_some_and(|t| t < floor)
        {
            break;
        }
        end = start;
    }
    verdict.iter().map(|v| *v == Some(Event::Done)).collect()
}

/// The entry's own (top-level) `timestamp`, ms since the epoch.
fn entry_time(line: &str) -> Option<i64> {
    #[derive(Deserialize)]
    struct Stamp {
        timestamp: Option<String>,
    }
    let ts = serde_json::from_str::<Stamp>(line).ok()?.timestamp?;
    chrono::DateTime::parse_from_rfc3339(&ts)
        .ok()
        .map(|t| t.timestamp_millis())
}

/// What `line` (one parent-transcript entry) says about `c`, if anything.
fn event(line: &str, c: &Candidate) -> Option<Event> {
    let id = c.agent.id.as_str();
    let tool = c.tool_use_id.as_deref().filter(|t| !t.is_empty());
    // Cheap substring checks before any parsing: most lines are about something else.
    let names_it = line.contains(id) || tool.is_some_and(|t| line.contains(t));
    // `api-request*` entries mirror what was sent to the model; they are not events.
    if !names_it || line.starts_with("{\"type\":\"api-request") {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    match v["type"].as_str()? {
        "queue-operation" => v["content"].as_str().and_then(|t| completion_text(t, id)),
        "user" => {
            let content = &v["message"]["content"];
            if let Some(t) = content.as_str() {
                return completion_text(t, id);
            }
            for item in content.as_array()? {
                match item["type"].as_str() {
                    Some("text") => {
                        if let Some(e) = item["text"].as_str().and_then(|t| completion_text(t, id))
                        {
                            return Some(e);
                        }
                    }
                    Some("tool_result")
                        if tool.is_some() && item["tool_use_id"].as_str() == tool =>
                    {
                        return Some(if async_launch(&v, item) {
                            Event::Started
                        } else {
                            Event::Done
                        });
                    }
                    _ => {}
                }
            }
            None
        }
        "assistant" => {
            for item in v["message"]["content"].as_array()? {
                if item["type"] != "tool_use" {
                    continue;
                }
                let launch = tool.is_some() && item["id"].as_str() == tool;
                let resume = item["name"] == "SendMessage" && item["input"]["to"] == id;
                if launch || resume {
                    return Some(Event::Started);
                }
            }
            None
        }
        _ => None,
    }
}

/// A background agent's completion notice or hand-back, naming agent `id`.
fn completion_text(text: &str, id: &str) -> Option<Event> {
    let notified =
        text.contains("<task-notification>") && text.contains(&format!("<task-id>{id}</task-id>"));
    let handed_back = text.contains("[Subagent hand-back]")
        && text.contains(&format!("<agent-message from=\"{id}\""));
    (notified || handed_back).then_some(Event::Done)
}

/// The immediate answer to a background launch, not its result.
fn async_launch(entry: &serde_json::Value, item: &serde_json::Value) -> bool {
    if entry["toolUseResult"]["status"] == "async_launched" {
        return true;
    }
    let first_text = match &item["content"] {
        serde_json::Value::String(s) => Some(s.as_str()),
        serde_json::Value::Array(a) => a.iter().find_map(|x| x["text"].as_str()),
        _ => None,
    };
    first_text.is_some_and(|t| t.trim_start().starts_with("Async agent launched"))
}

fn ms(t: SystemTime) -> i64 {
    t.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn now_ms() -> i64 {
    ms(SystemTime::now())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A session transcript + its subagents dir inside a temp "projects" dir.
    struct Fx {
        _dir: tempfile::TempDir,
        transcript: PathBuf,
        agents: PathBuf,
    }

    fn fx() -> Fx {
        let dir = tempfile::tempdir().unwrap();
        let proj = dir.path().join("projects").join("-tmp-project");
        let agents = proj.join("sid-1").join("subagents");
        std::fs::create_dir_all(&agents).unwrap();
        let transcript = proj.join("sid-1.jsonl");
        std::fs::write(&transcript, "").unwrap();
        Fx {
            _dir: dir,
            transcript,
            agents,
        }
    }

    impl Fx {
        fn agent(&self, id: &str, meta: serde_json::Value) {
            std::fs::write(
                self.agents.join(format!("agent-{id}.meta.json")),
                meta.to_string(),
            )
            .unwrap();
            let line = json!({"isSidechain": true, "agentId": id, "type": "user",
                "message": {"role": "user", "content": "go"}, "timestamp": iso(now_ms())});
            std::fs::write(
                self.agents.join(format!("agent-{id}.jsonl")),
                format!("{line}\n"),
            )
            .unwrap();
        }

        fn parent(&self, entries: &[serde_json::Value]) {
            let mut text = String::new();
            for e in entries {
                text.push_str(&e.to_string());
                text.push('\n');
            }
            std::fs::write(&self.transcript, text).unwrap();
        }

        fn running_ids(&self) -> Vec<String> {
            running(&self.transcript, None, now_ms())
                .into_iter()
                .map(|a| a.id)
                .collect()
        }
    }

    fn iso(ms: i64) -> String {
        chrono::DateTime::from_timestamp_millis(ms)
            .unwrap()
            .to_rfc3339()
    }

    fn meta(desc: &str, tool: &str) -> serde_json::Value {
        json!({"agentType": "general-purpose", "description": desc, "toolUseId": tool,
            "spawnDepth": 1, "requestShape": "background", "requestNonInteractive": true,
            "model": "opus"})
    }

    fn launch(tool: &str) -> serde_json::Value {
        json!({"type": "assistant", "isSidechain": false, "timestamp": iso(now_ms()),
            "message": {"role": "assistant", "content": [
                {"type": "tool_use", "id": tool, "name": "Agent", "input": {"description": "x"}}]}})
    }

    fn async_result(tool: &str, id: &str) -> serde_json::Value {
        json!({"type": "user", "isSidechain": false, "timestamp": iso(now_ms()),
            "message": {"role": "user", "content": [{"tool_use_id": tool, "type": "tool_result",
                "content": [{"type": "text", "text": format!("Async agent launched successfully.\nagentId: {id}")}]}]},
            "toolUseResult": {"isAsync": true, "status": "async_launched", "agentId": id}})
    }

    fn notification(tool: &str, id: &str) -> serde_json::Value {
        let text = format!(
            "<task-notification>\n<task-id>{id}</task-id>\n<tool-use-id>{tool}</tool-use-id>\n<status>completed</status>\n</task-notification>"
        );
        json!({"type": "queue-operation", "operation": "enqueue", "timestamp": iso(now_ms()), "content": text})
    }

    #[test]
    fn a_launched_background_agent_runs_until_its_notification() {
        let f = fx();
        f.agent("a1", meta("Fix the login bug", "toolu_1"));
        f.parent(&[launch("toolu_1"), async_result("toolu_1", "a1")]);
        let got = running(&f.transcript, None, now_ms());
        assert_eq!(got.len(), 1);
        let a = &got[0];
        assert_eq!(a.id, "a1");
        assert_eq!(a.description, "Fix the login bug");
        assert_eq!(a.agent_type.as_deref(), Some("general-purpose"));
        assert_eq!(a.model.as_deref(), Some("opus"));
        assert!(a.background);
        assert_eq!(a.depth, 1);
        assert!(a.started_at.is_some() && a.last_active_at.is_some());

        f.parent(&[
            launch("toolu_1"),
            async_result("toolu_1", "a1"),
            notification("toolu_1", "a1"),
        ]);
        assert!(f.running_ids().is_empty());
    }

    #[test]
    fn a_foreground_agent_is_done_at_its_tool_result() {
        let f = fx();
        let mut m = meta("Explore the API", "toolu_2");
        m["requestShape"] = json!("foreground");
        f.agent("a2", m);
        f.parent(&[launch("toolu_2")]);
        let got = running(&f.transcript, None, now_ms());
        assert_eq!(got.len(), 1);
        assert!(!got[0].background);
        let result = json!({"type": "user", "timestamp": iso(now_ms()), "message": {"role": "user",
            "content": [{"tool_use_id": "toolu_2", "type": "tool_result", "content": [{"type": "text", "text": "Found it."}]}]}});
        f.parent(&[launch("toolu_2"), result]);
        assert!(f.running_ids().is_empty());
    }

    #[test]
    fn meta_flags_and_hand_backs_finish_an_agent() {
        let f = fx();
        let mut m = meta("flagged", "toolu_3");
        m["finished"] = json!(true);
        f.agent("a3", m);
        let mut m = meta("stopped", "toolu_4");
        m["stoppedByUser"] = json!(true);
        f.agent("a4", m);
        f.agent("a5", meta("handed back", "toolu_5"));
        let hand_back = json!({"type": "user", "timestamp": iso(now_ms()), "message": {"role": "user",
            "content": "Another Claude session sent a message:\n<agent-message from=\"a5\">\n[Subagent hand-back] Done."}});
        f.parent(&[
            launch("toolu_3"),
            launch("toolu_4"),
            launch("toolu_5"),
            hand_back,
        ]);
        assert!(f.running_ids().is_empty());
    }

    #[test]
    fn send_message_after_a_completion_resumes_the_agent() {
        let f = fx();
        f.agent("a6", meta("Review the PR", "toolu_6"));
        let resume = json!({"type": "assistant", "timestamp": iso(now_ms()), "message": {"role": "assistant",
            "content": [{"type": "tool_use", "id": "toolu_x", "name": "SendMessage", "input": {"to": "a6", "message": "again"}}]}});
        f.parent(&[launch("toolu_6"), notification("toolu_6", "a6"), resume]);
        assert_eq!(f.running_ids(), ["a6"]);
    }

    #[test]
    fn stale_and_orphaned_agents_are_not_running() {
        let f = fx();
        f.agent("a7", meta("Long gone", "toolu_7"));
        f.parent(&[launch("toolu_7")]);
        let later = now_ms() + STALE_AFTER_MS + 1000;
        assert!(running(&f.transcript, None, later).is_empty());
        // The session's process started after the agent last wrote: a resumed session.
        let restarted = now_ms() + 5000;
        assert!(running(&f.transcript, Some(restarted), now_ms()).is_empty());
        assert_eq!(
            running(&f.transcript, Some(now_ms() - 5000), now_ms()).len(),
            1
        );
    }

    #[test]
    fn a_nested_agent_is_judged_by_its_parent_agents_transcript() {
        let f = fx();
        f.agent("p1", meta("Parent agent", "toolu_p"));
        let mut m = meta("Child agent", "toolu_c");
        m["spawnDepth"] = json!(2);
        m["parentAgentId"] = json!("p1");
        f.agent("c1", m);
        f.parent(&[launch("toolu_p"), async_result("toolu_p", "p1")]);
        let got = running(&f.transcript, None, now_ms());
        assert_eq!(got.len(), 2);
        let child = got.iter().find(|a| a.id == "c1").unwrap();
        assert_eq!(child.depth, 2);
        assert_eq!(child.parent_agent_id.as_deref(), Some("p1"));
        // The child's notification lands in the parent agent's transcript.
        let mut log = std::fs::read_to_string(f.agents.join("agent-p1.jsonl")).unwrap();
        log.push_str(&notification("toolu_c", "c1").to_string());
        log.push('\n');
        std::fs::write(f.agents.join("agent-p1.jsonl"), log).unwrap();
        assert_eq!(f.running_ids(), ["p1"]);
    }

    #[test]
    fn mentions_in_prose_or_api_mirrors_are_not_events() {
        let f = fx();
        f.agent("a8", meta("Keep going", "toolu_8"));
        let prose = json!({"type": "assistant", "timestamp": iso(now_ms()), "message": {"role": "assistant",
            "content": [{"type": "text", "text": "agent a8 tool_result <task-id>a8</task-id>"}]}});
        let mirror = "{\"type\":\"api-request-blob\",\"message\":{\"content\":\"<task-notification>\\n<task-id>a8</task-id>\"}}";
        let text = format!(
            "{}\n{}\n{}\n{}\n",
            launch("toolu_8"),
            async_result("toolu_8", "a8"),
            prose,
            mirror
        );
        std::fs::write(&f.transcript, text).unwrap();
        assert_eq!(f.running_ids(), ["a8"]);
    }

    #[test]
    fn a_long_parent_is_read_backwards_across_chunks() {
        let f = fx();
        f.agent("a9", meta("Chunked", "toolu_9"));
        let filler = json!({"type": "user", "timestamp": iso(now_ms()), "message": {"role": "user", "content": "x".repeat(4000)}});
        let mut text = format!("{}\n{}\n", launch("toolu_9"), async_result("toolu_9", "a9"));
        text.push_str(&notification("toolu_9", "a9").to_string());
        text.push('\n');
        // ~600 KiB after the completion: the notification sits in an earlier chunk.
        for _ in 0..150 {
            text.push_str(&filler.to_string());
            text.push('\n');
        }
        std::fs::write(&f.transcript, text).unwrap();
        assert!(f.running_ids().is_empty());
    }

    #[test]
    fn no_subagents_dir_means_none() {
        let dir = tempfile::tempdir().unwrap();
        let t = dir.path().join("sid-2.jsonl");
        std::fs::write(&t, "").unwrap();
        assert!(running(&t, None, now_ms()).is_empty());
    }
}
