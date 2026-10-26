//! Workspaces: a fresh git worktree for one new session — Orca's "New workspace".
//!
//! `fleet spawn --worktree --dir <repo>` (and the web's New session → "New worktree") makes
//! a worktree of `<repo>` at `<root>/<repo name>/<handle>` on a new branch
//! `<prefix>/<handle>` that starts at the remote's default branch (fetched first), and starts
//! the agent there. `<handle>` is a whimsical word ([`crate::core::words`]) no folder, branch,
//! tmux session or Claude session is called yet; it names the folder and, at first, the
//! session.
//!
//! Once the session's first prompt is answered, [`plan_branch_rename`] / [`rename_branch`]
//! move the branch to `<prefix>/<slug>` (a task-shaped slug from the naming model) and the
//! session title becomes the matching title (`fleet workspace name`, run by the web server's
//! workspace namer). The handle stays: it is the folder name and a label on the rows.
//!
//! What fleet made is recorded next to the worktree's git metadata, in
//! `<repo>/.git/worktrees/<id>/fleet-workspace.json` ([`Record`]) — git ignores the file
//! there and `git worktree remove` deletes it with the worktree, so no state outlives the
//! workspace. `fleet list` reads it (files only, no git) to put `workspace` on a row.
//!
//! Config (`workspaces` in config.json, per machine, read leniently):
//!
//! ```json
//! "workspaces": { "root": "~/fleet/workspaces", "branchPrefix": null }
//! ```
//!
//! `root` (env `FLEET_WORKSPACES_ROOT` overrides it) is where worktrees go; `branchPrefix`
//! is the branch's first segment — `null`/absent = your GitHub login (`gh api user`), else a
//! slug of `git config user.name`, else none; `""` = no prefix.
//!
//! Nothing in here prints.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::core::discovery::Session;
use crate::core::worktree::{self, git_run};
use crate::core::{naming, repos, tools, words};
use crate::error::{Error, Result};

pub const DEFAULT_ROOT: &str = "~/fleet/workspaces";
/// The record's file name inside the worktree's git admin dir.
pub const RECORD_FILE: &str = "fleet-workspace.json";
/// Trunk names tried, in order, when the remote has no `HEAD` symref.
pub const FALLBACK_BRANCHES: [&str; 3] = ["main", "master", "develop"];
const FETCH_TIMEOUT: Duration = Duration::from_secs(180);
const LS_REMOTE_TIMEOUT: Duration = Duration::from_secs(30);
const GH_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_HANDLE: usize = 40;

// ---------- config ----------

/// The `workspaces` config section, parsed.
#[derive(Debug, Clone, PartialEq)]
pub struct Settings {
    /// Where new worktrees go (`~` allowed): `<root>/<repo>/<handle>`.
    pub root: String,
    /// `None`: work it out ([`resolve_prefix`]); `Some("")`: no prefix; `Some(p)`: `p`.
    pub branch_prefix: Option<String>,
    /// What was wrong with the section; the bad parts fall back to defaults.
    pub problems: Vec<String>,
}

impl Settings {
    /// `v` is the `workspaces` value; `env_root` is `FLEET_WORKSPACES_ROOT`.
    pub fn from_value(v: &Value, env_root: Option<&str>) -> Settings {
        let mut problems = Vec::new();
        let configured = match v.get("root").filter(|x| !x.is_null()) {
            None => DEFAULT_ROOT.to_string(),
            Some(x) => match x.as_str().map(str::trim).filter(|s| !s.is_empty()) {
                Some(s) => s.to_string(),
                None => {
                    problems.push(format!("workspaces.root: {x} is not a path"));
                    DEFAULT_ROOT.to_string()
                }
            },
        };
        let root = env_root
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or(configured);
        let branch_prefix = match v.get("branchPrefix").filter(|x| !x.is_null()) {
            None => None,
            Some(Value::String(s)) if s.trim().is_empty() => Some(String::new()),
            Some(Value::String(s)) => match clean_prefix(s) {
                Some(p) => Some(p),
                None => {
                    problems.push(format!(
                        "workspaces.branchPrefix: {s:?} is not a branch name"
                    ));
                    None
                }
            },
            Some(x) => {
                problems.push(format!("workspaces.branchPrefix: {x} is not a string"));
                None
            }
        };
        Settings {
            root,
            branch_prefix,
            problems,
        }
    }

    pub fn load() -> Settings {
        let env = std::env::var("FLEET_WORKSPACES_ROOT").ok();
        Settings::from_value(
            &crate::core::config::load().raw["workspaces"],
            env.as_deref(),
        )
    }

    pub fn root_path(&self) -> PathBuf {
        PathBuf::from(tools::expand_tilde(&self.root))
    }
}

// ---------- names ----------

/// A usable handle: 1-40 of `A-Z a-z 0-9 _ -`, starting with a letter or digit — a folder
/// name, a branch segment, a tmux session name and a Claude session name at once.
pub fn valid_handle(h: &str) -> bool {
    let mut chars = h.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphanumeric())
        && h.len() <= MAX_HANDLE
        && h.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// A branch prefix as typed (config) → one ref-safe segment, or `None` when nothing usable
/// is left: `A-Z a-z 0-9 . _ -`, no leading `.`/`-`, no `..`, no trailing `.lock`/`.`.
pub fn clean_prefix(raw: &str) -> Option<String> {
    let p = raw.trim().trim_matches('/');
    let ok = !p.is_empty()
        && p.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        && !p.starts_with(['.', '-'])
        && !p.contains("..")
        && !p.ends_with(".lock")
        && !p.ends_with('.');
    ok.then(|| p.to_string())
}

/// `<prefix>/<leaf>`, or just `<leaf>` without a prefix.
pub fn branch_name(prefix: Option<&str>, leaf: &str) -> String {
    match prefix.filter(|p| !p.is_empty()) {
        Some(p) => format!("{p}/{leaf}"),
        None => leaf.to_string(),
    }
}

/// `<root>/<repo>/<handle>`.
pub fn workspace_path(root: &Path, repo_name: &str, handle: &str) -> PathBuf {
    root.join(repo_name).join(handle)
}

/// `upload-retry-limit` → `Upload retry limit`: the title a generated slug reads as.
pub fn title_from_slug(slug: &str) -> String {
    let words: Vec<&str> = slug.split(['-', '_']).filter(|w| !w.is_empty()).collect();
    let mut out = words.join(" ");
    if let Some(first) = out.get(..1) {
        out = first.to_ascii_uppercase() + &out[1..];
    }
    out
}

/// The branch prefix to use in `repo`: the configured one, else the GitHub login, else a
/// slug of `git config user.name`, else none.
pub fn resolve_prefix(s: &Settings, repo: &Path) -> Option<String> {
    if let Some(p) = &s.branch_prefix {
        return (!p.is_empty()).then(|| p.clone());
    }
    if crate::core::discovery::is_fixture() {
        return None;
    }
    gh_login().and_then(|l| clean_prefix(&l)).or_else(|| {
        repos::git(repo, &["config", "user.name"])
            .map(|n| naming::slugify(&n, 32))
            .and_then(|n| clean_prefix(&n))
    })
}

/// `gh api user --jq .login`, when `gh` is installed and logged in.
fn gh_login() -> Option<String> {
    let mut c = std::process::Command::new(crate::core::prs::gh_bin());
    c.args(["api", "user", "--jq", ".login"])
        .stdin(std::process::Stdio::null());
    let o = repos::output_with_timeout(c, GH_TIMEOUT).ok()?;
    if !o.status.success() {
        return None;
    }
    let login = String::from_utf8_lossy(&o.stdout).trim().to_string();
    (!login.is_empty()).then_some(login)
}

// ---------- the repo ----------

/// The main checkout of the repo `dir` is in (also when `dir` is a linked worktree of it).
pub fn main_checkout(dir: &Path) -> Result<PathBuf> {
    let common = repos::git(
        dir,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )
    .ok_or_else(|| Error::exit(1, format!("{} is not inside a git repo", dir.display())))?;
    let common = PathBuf::from(common);
    if common.file_name().is_some_and(|n| n == ".git")
        && let Some(top) = common.parent()
    {
        return Ok(top.to_path_buf());
    }
    Err(Error::exit(
        1,
        format!(
            "{} is a bare repo or has its git dir elsewhere — workspaces need a normal checkout",
            dir.display()
        ),
    ))
}

/// The remote new workspaces start from: `origin`, else the only remote.
pub fn remote_of(repo: &Path) -> Result<String> {
    let out = repos::git(repo, &["remote"]).unwrap_or_default();
    let remotes: Vec<&str> = out
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    if remotes.contains(&"origin") {
        return Ok("origin".into());
    }
    match remotes[..] {
        [one] => Ok(one.to_string()),
        [] => Err(Error::exit(
            1,
            format!("{} has no remote to branch from", repo.display()),
        )),
        _ => Err(Error::exit(
            1,
            format!(
                "{} has several remotes and none is `origin` ({})",
                repo.display(),
                remotes.join(", ")
            ),
        )),
    }
}

/// The branch `git ls-remote --symref <remote> HEAD` says `HEAD` points at — only when
/// `HEAD` also resolves to a commit there (an unborn `HEAD` names a branch that is not there).
pub fn parse_symref_head(out: &str) -> Option<String> {
    let resolves = out.lines().any(|l| {
        l.split_once('\t')
            .is_some_and(|(sha, r)| r.trim() == "HEAD" && !sha.starts_with("ref:"))
    });
    if !resolves {
        return None;
    }
    out.lines().find_map(|l| {
        let rest = l.strip_prefix("ref: refs/heads/")?;
        let (branch, what) = rest.split_once(['\t', ' '])?;
        (what.trim() == "HEAD" && !branch.is_empty()).then(|| branch.to_string())
    })
}

/// The branches `git ls-remote --heads` lists (`<sha>\trefs/heads/<b>`).
pub fn parse_heads(out: &str) -> Vec<String> {
    out.lines()
        .filter_map(|l| {
            let (_, r) = l.split_once('\t')?;
            r.trim().strip_prefix("refs/heads/").map(str::to_string)
        })
        .collect()
}

/// The remote's default branch: its `HEAD` as this clone knows it (`refs/remotes/<remote>/HEAD`),
/// else as the remote says (`ls-remote --symref`), else the first of [`FALLBACK_BRANCHES`]
/// the remote has, else (offline) the first one this clone has a remote-tracking ref for.
pub fn default_branch(repo: &Path, remote: &str) -> Result<String> {
    if let Some(r) = repos::git(
        repo,
        &[
            "symbolic-ref",
            "--quiet",
            "--short",
            &format!("refs/remotes/{remote}/HEAD"),
        ],
    ) && let Some(b) = r.strip_prefix(&format!("{remote}/"))
        && !b.is_empty()
    {
        return Ok(b.to_string());
    }
    if let Ok(out) = git_run(
        repo,
        &["ls-remote", "--symref", remote, "HEAD"],
        LS_REMOTE_TIMEOUT,
    ) && let Some(b) = parse_symref_head(&out)
    {
        return Ok(b);
    }
    let mut args = vec!["ls-remote", "--heads", remote];
    args.extend(FALLBACK_BRANCHES);
    if let Ok(out) = git_run(repo, &args, LS_REMOTE_TIMEOUT) {
        let heads = parse_heads(&out);
        if let Some(b) = FALLBACK_BRANCHES
            .iter()
            .find(|b| heads.iter().any(|h| h == *b))
        {
            return Ok(b.to_string());
        }
    }
    for b in FALLBACK_BRANCHES {
        if repos::git(
            repo,
            &[
                "rev-parse",
                "--verify",
                "--quiet",
                &format!("refs/remotes/{remote}/{b}"),
            ],
        )
        .is_some()
        {
            return Ok(b.to_string());
        }
    }
    Err(Error::exit(
        1,
        format!(
            "cannot tell {remote}'s default branch in {} (no {remote}/HEAD, none of {})",
            repo.display(),
            FALLBACK_BRANCHES.join(", ")
        ),
    ))
}

/// Every word a new handle must not be: the folders under `root/*/`, and the last segment
/// of every local and remote-tracking branch of `repo`.
fn taken_handles(root: &Path, repo: &Path) -> Vec<String> {
    let mut taken = Vec::new();
    for repo_dir in std::fs::read_dir(root).into_iter().flatten().flatten() {
        for e in std::fs::read_dir(repo_dir.path())
            .into_iter()
            .flatten()
            .flatten()
        {
            taken.push(e.file_name().to_string_lossy().into_owned());
        }
    }
    if let Some(out) = repos::git(
        repo,
        &[
            "for-each-ref",
            "--format=%(refname:short)",
            "refs/heads",
            "refs/remotes",
        ],
    ) {
        for b in out.lines() {
            if let Some(last) = b.rsplit('/').next() {
                taken.push(last.to_string());
            }
        }
    }
    taken
}

// ---------- the record ----------

/// What fleet made for one workspace, kept in the worktree's git admin dir ([`RECORD_FILE`]).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub version: u32,
    /// The whimsical word: folder name and the session's first name.
    pub handle: String,
    /// The worktree (absolute).
    pub path: String,
    /// The main checkout it belongs to (absolute).
    pub repo: String,
    /// The remote it branched from.
    pub remote: String,
    /// What it branched from: `<remote>/<default branch>`.
    pub base: String,
    /// The branch prefix used (`null`: none).
    pub prefix: Option<String>,
    /// The branch fleet created: `<prefix>/<handle>`.
    pub created_branch: String,
    /// The branch now, as fleet left it (`<prefix>/<slug>` after the rename).
    pub branch: String,
    /// Milliseconds since the epoch.
    pub created_at: i64,
    /// The generated slug, once there is one.
    #[serde(default)]
    pub slug: Option<String>,
    /// The generated title, once there is one.
    #[serde(default)]
    pub title: Option<String>,
    /// The naming step is done: the title was set (or left alone because someone had
    /// already named the session).
    #[serde(default)]
    pub named: bool,
}

/// `workspace` on a `fleet list --json` row: the session runs in a worktree fleet made.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkspaceRef {
    pub handle: String,
    /// The branch as fleet left it.
    pub branch: String,
    /// The worktree.
    pub path: String,
    /// Its main checkout.
    pub repo: String,
    /// `<remote>/<default branch>` it started from.
    pub base: String,
    /// The naming step after the first answer is done.
    pub named: bool,
}

impl Record {
    pub fn as_ref(&self) -> WorkspaceRef {
        WorkspaceRef {
            handle: self.handle.clone(),
            branch: self.branch.clone(),
            path: self.path.clone(),
            repo: self.repo.clone(),
            base: self.base.clone(),
            named: self.named,
        }
    }
}

/// The git admin dir of the linked worktree whose top is `top`, from its `.git` file
/// (`gitdir: <path>`). `None` for a main checkout (`.git` is a directory) or no git at all.
pub fn admin_dir(top: &Path) -> Option<PathBuf> {
    let dot = top.join(".git");
    if !dot.is_file() {
        return None;
    }
    let text = std::fs::read_to_string(&dot).ok()?;
    let p = text.lines().find_map(|l| l.strip_prefix("gitdir:"))?.trim();
    let p = Path::new(p);
    Some(if p.is_absolute() {
        p.to_path_buf()
    } else {
        top.join(p)
    })
}

/// The top of the linked worktree `cwd` is in (the nearest ancestor with a `.git` file).
/// `None` inside a main checkout or outside git.
pub fn worktree_top(cwd: &Path) -> Option<PathBuf> {
    for dir in cwd.ancestors() {
        let dot = dir.join(".git");
        if dot.is_file() {
            return Some(dir.to_path_buf());
        }
        if dot.exists() {
            return None;
        }
    }
    None
}

fn canonical(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

/// The record of the workspace whose top is `top` — only when it really is that worktree's
/// (its `path` resolves to `top`).
pub fn read_record(top: &Path) -> Option<Record> {
    let file = admin_dir(top)?.join(RECORD_FILE);
    let rec: Record = serde_json::from_str(&std::fs::read_to_string(file).ok()?).ok()?;
    (canonical(Path::new(&rec.path)) == canonical(top)).then_some(rec)
}

/// The workspace `cwd` is in, if fleet made it. Files only — no git call.
pub fn find_for_cwd(cwd: &Path) -> Option<Record> {
    read_record(&worktree_top(cwd)?)
}

/// Save `rec` into its worktree's admin dir (temp file + rename).
pub fn write_record(rec: &Record) -> Result<()> {
    let top = Path::new(&rec.path);
    let dir = admin_dir(top)
        .ok_or_else(|| Error::Other(format!("{} is not a linked git worktree", top.display())))?;
    let path = dir.join(RECORD_FILE);
    let tmp = dir.join(format!("{RECORD_FILE}.{}.tmp", std::process::id()));
    std::fs::write(&tmp, serde_json::to_string_pretty(rec)? + "\n")?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

/// Put `workspace` on every row whose cwd is in a workspace fleet made (read-only).
pub fn stamp_workspaces(rows: &mut [Session]) {
    for r in rows {
        r.workspace = r
            .cwd
            .as_deref()
            .filter(|c| !c.is_empty())
            .and_then(|c| find_for_cwd(Path::new(c)))
            .map(|rec| rec.as_ref());
    }
}

// ---------- creating one ----------

/// Make a workspace of the repo `dir` is in: pick (or check) the handle, fetch the remote's
/// default branch, `git worktree add --no-track -b <prefix>/<handle> <root>/<repo>/<handle>
/// <remote>/<default>`, then write the [`Record`]. `dry_run`: decide everything, change
/// nothing (no fetch either).
pub fn create(s: &Settings, dir: &Path, handle: Option<&str>, dry_run: bool) -> Result<Record> {
    let repo = main_checkout(dir)?;
    let repo_name = repo
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| Error::Other(format!("{} has no folder name", repo.display())))?;
    let remote = remote_of(&repo)?;
    let default = default_branch(&repo, &remote)?;
    let prefix = resolve_prefix(s, &repo);
    let root = s.root_path();
    let taken = taken_handles(&root, &repo);
    let handle = match handle.map(str::trim).filter(|h| !h.is_empty()) {
        Some(h) => {
            if !valid_handle(h) {
                return Err(Error::exit(
                    2,
                    format!("handle {h:?}: use 1-{MAX_HANDLE} letters, digits, - or _"),
                ));
            }
            h.to_string()
        }
        None => words::fresh_avoiding(&taken),
    };
    let path = workspace_path(&root, &repo_name, &handle);
    let branch = branch_name(prefix.as_deref(), &handle);
    if path.exists() {
        return Err(Error::exit(1, format!("{} already exists", path.display())));
    }
    if worktree::has_local_branch(&repo, &branch) {
        return Err(Error::exit(
            1,
            format!("branch {branch} already exists in {}", repo.display()),
        ));
    }
    let base = format!("{remote}/{default}");
    let rec = Record {
        version: 1,
        handle,
        path: path.display().to_string(),
        repo: repo.display().to_string(),
        remote: remote.clone(),
        base: base.clone(),
        prefix,
        created_branch: branch.clone(),
        branch: branch.clone(),
        created_at: chrono::Utc::now().timestamp_millis(),
        slug: None,
        title: None,
        named: false,
    };
    if dry_run {
        return Ok(rec);
    }
    let spec = format!("+refs/heads/{default}:refs/remotes/{remote}/{default}");
    git_run(&repo, &["fetch", "--quiet", &remote, &spec], FETCH_TIMEOUT)?;
    worktree::add(&repo, &path, &branch, worktree::Branch::From(&base))?;
    write_record(&rec)?;
    Ok(rec)
}

// ---------- renaming the branch ----------

/// What the branch-rename guard looks at, gathered by [`branch_facts`].
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BranchFacts {
    /// The branch the worktree is on (`None`: detached).
    pub current: Option<String>,
    /// Its upstream, when one is set (`branch.<b>.remote`).
    pub upstream: bool,
    /// A remote-tracking ref of the current branch exists (`refs/remotes/*/<current>`).
    pub current_on_remote: bool,
    /// The target exists locally or as a remote-tracking ref.
    pub target_exists: bool,
    /// The target is a valid branch name (`git check-ref-format --branch`).
    pub target_valid: bool,
}

/// The guard: rename `<prefix>/<handle>` → `<prefix>/<slug>` only when the worktree is still
/// on the branch fleet created for this session, that branch was never pushed (no upstream,
/// no remote-tracking ref), and the target is a free, valid name. → the target, or why not.
pub fn plan_branch_rename(
    rec: &Record,
    slug: &str,
    f: &BranchFacts,
) -> std::result::Result<String, String> {
    let target = branch_name(rec.prefix.as_deref(), slug);
    let Some(current) = f.current.as_deref() else {
        return Err("the worktree is not on a branch".into());
    };
    if current == target {
        return Err(format!("already on {target}"));
    }
    if current != rec.created_branch {
        return Err(format!(
            "on {current}, not the branch fleet created ({}) — left alone",
            rec.created_branch
        ));
    }
    if f.upstream || f.current_on_remote {
        return Err(format!("{current} was pushed — left alone"));
    }
    if !f.target_valid {
        return Err(format!("{target} is not a valid branch name"));
    }
    if f.target_exists {
        return Err(format!("{target} already exists — left on {current}"));
    }
    Ok(target)
}

/// Read the [`BranchFacts`] of the worktree at `top` for renaming to `target`.
pub fn branch_facts(top: &Path, target: &str) -> BranchFacts {
    let current =
        repos::git(top, &["symbolic-ref", "--quiet", "--short", "HEAD"]).filter(|b| !b.is_empty());
    let remote_refs = repos::git(
        top,
        &["for-each-ref", "--format=%(refname:short)", "refs/remotes"],
    )
    .unwrap_or_default();
    let on_remote = |b: &str| {
        remote_refs
            .lines()
            .any(|r| r.split_once('/').is_some_and(|(_, rest)| rest == b))
    };
    let upstream = current.as_deref().is_some_and(|b| {
        repos::git(top, &["config", "--get", &format!("branch.{b}.remote")]).is_some()
    });
    BranchFacts {
        current_on_remote: current.as_deref().is_some_and(on_remote),
        current,
        upstream,
        target_exists: worktree::has_local_branch(top, target) || on_remote(target),
        target_valid: repos::git(top, &["check-ref-format", "--branch", target]).is_some(),
    }
}

/// What [`rename_branch`] did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BranchRename {
    pub from: Option<String>,
    pub to: Option<String>,
    pub renamed: bool,
    pub note: String,
}

/// Rename the workspace's branch to `<prefix>/<slug>` when [`plan_branch_rename`] allows it,
/// and keep `rec.branch` in step. Never touches a branch fleet did not create for it.
pub fn rename_branch(rec: &mut Record, slug: &str) -> BranchRename {
    let top = PathBuf::from(&rec.path);
    let target = branch_name(rec.prefix.as_deref(), slug);
    let facts = branch_facts(&top, &target);
    let from = facts.current.clone();
    match plan_branch_rename(rec, slug, &facts) {
        Err(note) => BranchRename {
            from,
            to: None,
            renamed: false,
            note,
        },
        Ok(to) => {
            let current = from.clone().unwrap_or_default();
            match git_run(
                &top,
                &["branch", "-m", &current, &to],
                Duration::from_secs(30),
            ) {
                Ok(_) => {
                    rec.branch = to.clone();
                    BranchRename {
                        note: format!("{current} → {to}"),
                        from,
                        to: Some(to),
                        renamed: true,
                    }
                }
                Err(e) => BranchRename {
                    from,
                    to: None,
                    renamed: false,
                    note: e.to_string(),
                },
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn git(dir: &Path, args: &[&str]) -> String {
        let o = std::process::Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@example.com")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@example.com")
            .output()
            .unwrap();
        assert!(
            o.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&o.stderr)
        );
        String::from_utf8_lossy(&o.stdout).trim().to_string()
    }

    /// A bare `origin` with one commit on `trunk` (its HEAD), and a clone of it at `root/app`.
    fn origin_and_clone(trunk: &str) -> (tempfile::TempDir, PathBuf, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        let origin = root.join("origin.git");
        std::fs::create_dir_all(&origin).unwrap();
        git(
            &origin,
            &["init", "-q", "--bare", &format!("--initial-branch={trunk}")],
        );
        let seed = root.join("seed");
        std::fs::create_dir_all(&seed).unwrap();
        git(&seed, &["init", "-q", &format!("--initial-branch={trunk}")]);
        std::fs::write(seed.join("a.txt"), "a").unwrap();
        git(&seed, &["add", "."]);
        git(&seed, &["commit", "-q", "-m", "first"]);
        git(
            &seed,
            &["remote", "add", "origin", origin.to_str().unwrap()],
        );
        git(&seed, &["push", "-q", "origin", trunk]);
        let clone = root.join("app");
        git(
            &root,
            &[
                "clone",
                "-q",
                origin.to_str().unwrap(),
                clone.to_str().unwrap(),
            ],
        );
        (tmp, root, clone)
    }

    fn settings(root: &Path, prefix: &str) -> Settings {
        Settings::from_value(
            &json!({ "root": root.to_str().unwrap(), "branchPrefix": prefix }),
            None,
        )
    }

    #[test]
    fn settings_defaults_env_and_problems() {
        let s = Settings::from_value(&Value::Null, None);
        assert_eq!(s.root, DEFAULT_ROOT);
        assert_eq!(s.branch_prefix, None);
        assert!(s.problems.is_empty());
        let s = Settings::from_value(
            &json!({ "root": "~/ws", "branchPrefix": "" }),
            Some("/tmp/x"),
        );
        assert_eq!(s.root, "/tmp/x");
        assert_eq!(s.branch_prefix, Some(String::new()));
        let s = Settings::from_value(&json!({ "root": 3, "branchPrefix": "a b" }), None);
        assert_eq!(s.root, DEFAULT_ROOT);
        assert_eq!(s.branch_prefix, None);
        assert_eq!(s.problems.len(), 2);
    }

    #[test]
    fn handle_branch_path_and_title_derivation() {
        assert!(valid_handle("kelpie"));
        assert!(valid_handle("kelpie-2"));
        assert!(!valid_handle("-kelpie"));
        assert!(!valid_handle("a/b"));
        assert!(!valid_handle(""));
        assert!(!valid_handle(&"a".repeat(41)));
        assert_eq!(branch_name(Some("someone"), "kelpie"), "someone/kelpie");
        assert_eq!(branch_name(Some(""), "kelpie"), "kelpie");
        assert_eq!(branch_name(None, "kelpie"), "kelpie");
        assert_eq!(
            workspace_path(Path::new("/ws"), "app", "kelpie"),
            PathBuf::from("/ws/app/kelpie")
        );
        assert_eq!(clean_prefix(" someone/ "), Some("someone".into()));
        assert_eq!(clean_prefix("jane.doe"), Some("jane.doe".into()));
        assert_eq!(clean_prefix("a b"), None);
        assert_eq!(clean_prefix("x.lock"), None);
        assert_eq!(clean_prefix(".x"), None);
        assert_eq!(title_from_slug("upload-retry-limit"), "Upload retry limit");
        assert_eq!(
            title_from_slug("task-20392237-status"),
            "Task 20392237 status"
        );
        assert_eq!(title_from_slug(""), "");
    }

    #[test]
    fn parses_ls_remote_output() {
        let out = "ref: refs/heads/develop\tHEAD\n0123abcd\tHEAD\n";
        assert_eq!(parse_symref_head(out), Some("develop".into()));
        assert_eq!(parse_symref_head("0123\tHEAD\n"), None);
        assert_eq!(parse_symref_head("ref: refs/heads/nope\tHEAD\n"), None);
        let heads = "aaa\trefs/heads/master\nbbb\trefs/heads/x/main\n";
        assert_eq!(parse_heads(heads), ["master", "x/main"]);
    }

    #[test]
    fn default_branch_from_origin_head_symref_and_fallbacks() {
        let (_tmp, _root, clone) = origin_and_clone("trunk");
        // A fresh clone knows origin/HEAD.
        assert_eq!(default_branch(&clone, "origin").unwrap(), "trunk");
        // Without the local symref: asked from the remote.
        git(&clone, &["remote", "set-head", "origin", "--delete"]);
        assert_eq!(default_branch(&clone, "origin").unwrap(), "trunk");
        assert_eq!(remote_of(&clone).unwrap(), "origin");
    }

    #[test]
    fn default_branch_falls_back_to_a_known_trunk_name() {
        let (_tmp, root, clone) = origin_and_clone("develop");
        git(&clone, &["remote", "set-head", "origin", "--delete"]);
        // A remote whose HEAD points at a branch that does not exist: no symref answer.
        let origin = root.join("origin.git");
        git(&origin, &["symbolic-ref", "HEAD", "refs/heads/nope"]);
        assert_eq!(default_branch(&clone, "origin").unwrap(), "develop");
        // Offline (the remote is gone): the remote-tracking ref this clone has.
        std::fs::remove_dir_all(&origin).unwrap();
        assert_eq!(default_branch(&clone, "origin").unwrap(), "develop");
    }

    #[test]
    fn create_makes_a_worktree_on_a_new_untracked_branch_and_records_it() {
        let (tmp, root, clone) = origin_and_clone("main");
        let ws_root = root.join("ws");
        let s = settings(&ws_root, "someone");

        let plan = create(&s, &clone, Some("kelpie"), true).unwrap();
        assert!(!Path::new(&plan.path).exists(), "dry run makes nothing");

        let rec = create(&s, &clone, Some("kelpie"), false).unwrap();
        assert_eq!(rec.path, ws_root.join("app/kelpie").display().to_string());
        assert_eq!(rec.branch, "someone/kelpie");
        assert_eq!(rec.created_branch, "someone/kelpie");
        assert_eq!(rec.base, "origin/main");
        assert_eq!(rec.repo, clone.display().to_string());
        let top = PathBuf::from(&rec.path);
        assert_eq!(
            git(&top, &["symbolic-ref", "--short", "HEAD"]),
            "someone/kelpie"
        );
        // No upstream: nothing gets pushed to main by accident.
        assert!(repos::git(&top, &["config", "--get", "branch.someone/kelpie.remote"]).is_none());
        // The record is found from the worktree and from a subdirectory of it.
        std::fs::create_dir_all(top.join("sub")).unwrap();
        assert_eq!(find_for_cwd(&top.join("sub")), Some(rec.clone()));
        // ...but not from the main checkout.
        assert_eq!(find_for_cwd(&clone), None);
        // Created from inside the worktree: same repo, a taken handle is refused.
        assert!(create(&s, &top, Some("kelpie"), false).is_err());
        // A new handle avoids every folder under the root and every branch leaf.
        git(&clone, &["branch", "someone/otter", "main"]);
        let taken = taken_handles(&ws_root, &clone);
        assert!(taken.contains(&"kelpie".to_string()), "{taken:?}");
        assert!(taken.contains(&"otter".to_string()), "{taken:?}");
        for seed in 0..50 {
            let w = words::pick(&taken, seed);
            assert!(w != "kelpie" && w != "otter" && valid_handle(&w));
        }
        drop(tmp);
    }

    #[test]
    fn stamp_puts_workspace_on_rows_in_one() {
        let (_tmp, root, clone) = origin_and_clone("main");
        let rec = create(
            &settings(&root.join("ws"), ""),
            &clone,
            Some("otter"),
            false,
        )
        .unwrap();
        assert_eq!(rec.branch, "otter");
        let mut rows = vec![
            Session {
                cwd: Some(rec.path.clone()),
                ..Default::default()
            },
            Session {
                cwd: Some(clone.display().to_string()),
                ..Default::default()
            },
        ];
        stamp_workspaces(&mut rows);
        assert_eq!(rows[0].workspace.as_ref().unwrap().handle, "otter");
        assert!(!rows[0].workspace.as_ref().unwrap().named);
        assert!(rows[1].workspace.is_none());
    }

    fn rec_on(branch: &str) -> Record {
        Record {
            version: 1,
            handle: "kelpie".into(),
            path: "/ws/app/kelpie".into(),
            repo: "/code/app".into(),
            remote: "origin".into(),
            base: "origin/main".into(),
            prefix: Some("someone".into()),
            created_branch: "someone/kelpie".into(),
            branch: branch.into(),
            created_at: 0,
            slug: None,
            title: None,
            named: false,
        }
    }

    #[test]
    fn branch_rename_guard() {
        let rec = rec_on("someone/kelpie");
        let ok = BranchFacts {
            current: Some("someone/kelpie".into()),
            target_valid: true,
            ..Default::default()
        };
        assert_eq!(
            plan_branch_rename(&rec, "fix-login", &ok),
            Ok("someone/fix-login".into())
        );
        let no = |f: BranchFacts| plan_branch_rename(&rec, "fix-login", &f).unwrap_err();
        assert!(
            no(BranchFacts {
                current: None,
                ..ok.clone()
            })
            .contains("not on a branch")
        );
        assert!(
            no(BranchFacts {
                current: Some("someone/other".into()),
                ..ok.clone()
            })
            .contains("not the branch fleet created")
        );
        assert!(
            no(BranchFacts {
                upstream: true,
                ..ok.clone()
            })
            .contains("pushed")
        );
        assert!(
            no(BranchFacts {
                current_on_remote: true,
                ..ok.clone()
            })
            .contains("pushed")
        );
        assert!(
            no(BranchFacts {
                target_exists: true,
                ..ok.clone()
            })
            .contains("already exists")
        );
        assert!(
            no(BranchFacts {
                target_valid: false,
                ..ok.clone()
            })
            .contains("not a valid")
        );
        assert!(
            no(BranchFacts {
                current: Some("someone/fix-login".into()),
                ..ok
            })
            .contains("already on")
        );
    }

    #[test]
    fn rename_branch_renames_only_an_unpushed_fleet_branch() {
        let (_tmp, root, clone) = origin_and_clone("main");
        let s = settings(&root.join("ws"), "someone");
        let mut rec = create(&s, &clone, Some("kelpie"), false).unwrap();
        let top = PathBuf::from(&rec.path);

        // The target is taken: left alone.
        git(&clone, &["branch", "someone/fix-login", "main"]);
        let r = rename_branch(&mut rec, "fix-login");
        assert!(!r.renamed, "{r:?}");
        git(&clone, &["branch", "-D", "someone/fix-login"]);

        let r = rename_branch(&mut rec, "fix-login");
        assert!(r.renamed, "{r:?}");
        assert_eq!(rec.branch, "someone/fix-login");
        assert_eq!(
            git(&top, &["symbolic-ref", "--short", "HEAD"]),
            "someone/fix-login"
        );
        // Again: it is no longer the branch fleet created.
        assert!(!rename_branch(&mut rec, "other-thing").renamed);

        // A pushed branch is never renamed.
        let mut pushed = create(&s, &clone, Some("otter"), false).unwrap();
        git(
            Path::new(&pushed.path),
            &["push", "-q", "origin", "someone/otter"],
        );
        let r = rename_branch(&mut pushed, "new-name");
        assert!(!r.renamed && r.note.contains("pushed"), "{r:?}");
    }
}
