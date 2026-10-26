//! `fleet workspace new|name` and `fleet spawn --worktree`: a fresh git worktree per new
//! session, named after the work once it has answered — see [`crate::core::workspace`].

use std::path::Path;
use std::sync::atomic::AtomicBool;

use colored::Colorize;
use serde::Serialize;

use crate::cli::commands::{self, SpawnOpts, host_label, naming_config};
use crate::cli::render::home_rel;
use crate::core::discovery::{self, Session};
use crate::core::naming;
use crate::core::title::{self, RenameOpts, RenameOutcome};
use crate::core::workspace::{self, BranchRename, Record, Settings};
use crate::error::{Error, Result};

fn settings() -> Settings {
    let s = Settings::load();
    for p in &s.problems {
        eprintln!("{} {p}", "warning:".yellow());
    }
    s
}

fn repo_dir(dir: Option<&str>) -> String {
    dir.map(crate::core::tools::expand_tilde)
        .unwrap_or_else(|| {
            std::env::current_dir()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|_| ".".into())
        })
}

/// `fleet workspace new [--dir <repo>] [--handle <h>] [--json]`: make the worktree (no
/// session). → the record.
pub fn new(dir: Option<&str>, handle: Option<&str>, json: bool) -> Result<Record> {
    let s = settings();
    let dir = repo_dir(dir);
    let dry = crate::core::hosts::dry_run();
    let rec = workspace::create(&s, Path::new(&dir), handle, dry)?;
    if json {
        println!("{}", serde_json::to_string_pretty(&rec)?);
    } else if dry {
        println!(
            "dry-run: would fetch {} and make {} on {} (from {})",
            rec.base,
            home_rel(&rec.path),
            rec.branch,
            rec.base
        );
    } else {
        println!(
            "{} {} on {} (from {})",
            "made".green(),
            home_rel(&rec.path),
            rec.branch.cyan(),
            rec.base
        );
    }
    Ok(rec)
}

/// `fleet spawn [prompt] --dir <repo> --worktree [--handle <h>]`: a workspace, then a session
/// in it named after the handle (unless `--name` says otherwise).
pub fn spawn(prompt: Option<String>, handle: Option<String>, mut opts: SpawnOpts) -> Result<()> {
    let s = settings();
    let dir = repo_dir(opts.dir.as_deref());
    let dry = crate::core::hosts::dry_run();
    let rec = workspace::create(&s, Path::new(&dir), handle.as_deref(), dry)?;
    if dry {
        println!(
            "dry-run: would fetch {} and make {} on {}, then spawn {} there{}",
            rec.base,
            home_rel(&rec.path),
            rec.branch,
            opts.name.as_deref().unwrap_or(&rec.handle),
            prompt
                .as_deref()
                .filter(|p| !p.trim().is_empty())
                .map(|p| format!(" — \"{p}\""))
                .unwrap_or_default()
        );
        return Ok(());
    }
    println!(
        "{} {} on {} (from {})",
        "made".green(),
        home_rel(&rec.path),
        rec.branch.cyan(),
        rec.base
    );
    opts.dir = Some(rec.path.clone());
    if opts.name.is_none() {
        opts.name = Some(rec.handle.clone());
    }
    commands::spawn(prompt, None, opts)
}

/// What `fleet workspace name --json` prints — one object, whatever happened.
#[derive(Serialize)]
pub struct NameReport {
    pub ok: bool,
    /// `named` (title sent), `kept` (someone had named the session: its title stays),
    /// `held` (waiting on a prompt — nothing typed; retry), `no-prompt` (no first prompt
    /// yet; retry), `already-named`.
    pub result: &'static str,
    pub session_id: Option<String>,
    pub pid: i64,
    pub host: String,
    pub handle: String,
    pub slug: Option<String>,
    pub title: Option<String>,
    /// Where the slug came from: `llm`, `cached`, `heuristic`, `record` (an earlier run).
    pub source: Option<&'static str>,
    pub branch: Option<BranchRename>,
    pub message: String,
}

fn print_report(r: &NameReport, json: bool) -> Result<()> {
    if json {
        println!("{}", serde_json::to_string_pretty(r)?);
        return Ok(());
    }
    if let Some(b) = &r.branch {
        let line = format!("branch: {}", b.note);
        println!(
            "{}",
            if b.renamed {
                line.normal()
            } else {
                line.dimmed()
            }
        );
    }
    println!("{}", r.message);
    Ok(())
}

/// `fleet workspace name <target> [--json] [--force]`: for a session in a workspace fleet
/// made, generate a task-shaped slug from its first prompt (the naming model, as `fleet
/// name`), rename the branch `<prefix>/<handle>` → `<prefix>/<slug>` when that is safe
/// ([`workspace::plan_branch_rename`]), and set the session title (the same `/rename` path as
/// `fleet rename`) unless someone already named it. `--force` runs again on a named one.
pub fn name(target: &str, force: bool, json: bool) -> Result<()> {
    let s: Session = discovery::resolve(target).map_err(Error::Other)?;
    let Some(mut rec) = s
        .cwd
        .as_deref()
        .and_then(|c| workspace::find_for_cwd(Path::new(c)))
    else {
        return Err(Error::exit(
            1,
            format!(
                "{} does not run in a workspace fleet made (fleet spawn --worktree)",
                s.headline()
            ),
        ));
    };
    let mut report = NameReport {
        ok: false,
        result: "no-prompt",
        session_id: s.session_id.clone(),
        pid: s.pid,
        host: host_label(),
        handle: rec.handle.clone(),
        slug: rec.slug.clone(),
        title: rec.title.clone(),
        source: None,
        branch: None,
        message: String::new(),
    };
    if rec.named && !force {
        report.ok = true;
        report.result = "already-named";
        report.message = format!("{} is already named", rec.handle);
        return print_report(&report, json);
    }
    if s.title.as_deref().is_none_or(|t| t.trim().is_empty()) {
        report.message = format!(
            "{} has no first prompt yet — nothing to name it from",
            rec.handle
        );
        print_report(&report, json)?;
        return Err(Error::exit(3, ""));
    }

    // The slug: an earlier run's, else generated from the first prompt alone — the folder
    // and the branch both still say the handle, which is not what the work is.
    let slug = match rec.slug.clone().filter(|_| !force) {
        Some(slug) => {
            report.source = Some("record");
            slug
        }
        None => {
            let cfg = naming_config();
            let how = naming::GenOpts {
                allow_llm: cfg.enabled() && !discovery::is_fixture(),
                refresh: force,
            };
            let probe = Session {
                cwd: None,
                ..s.clone()
            };
            let got = naming::suggest(&probe, &cfg.model(), how, &AtomicBool::new(false))
                .map_err(Error::Other)?;
            report.source = Some(got.source.label());
            got.name
        }
    };
    let new_title = workspace::title_from_slug(&slug);
    rec.slug = Some(slug.clone());
    rec.title = Some(new_title.clone());
    report.slug = Some(slug.clone());
    report.title = Some(new_title.clone());

    report.branch = Some(workspace::rename_branch(&mut rec, &slug));
    workspace::write_record(&rec)?;

    // The title follows only while the session still carries the handle (or a name Claude
    // derived): a title somebody chose stays.
    let chosen = title::chosen_name(&s).filter(|n| *n != rec.handle);
    if let Some(kept) = chosen {
        rec.named = true;
        workspace::write_record(&rec)?;
        report.ok = true;
        report.result = "kept";
        report.message = format!("{kept} was named by hand — title kept");
        return print_report(&report, json);
    }
    let opts = RenameOpts {
        sync_tmux: naming_config().sync_tmux(),
        force: false,
    };
    match title::apply_rename(&s, &new_title, opts)? {
        RenameOutcome::Held(_, why) => {
            report.result = "held";
            report.message = why;
            print_report(&report, json)?;
            Err(Error::exit(3, ""))
        }
        outcome @ RenameOutcome::Sent(_) => {
            rec.named = true;
            workspace::write_record(&rec)?;
            report.ok = true;
            report.result = "named";
            report.message = match outcome.tmux_note() {
                Some(t) => format!("{} → {new_title} ({t})", rec.handle),
                None => format!("{} → {new_title}", rec.handle),
            };
            print_report(&report, json)
        }
    }
}
