//! Shared `git worktree add` plumbing: `fleet pr checkout` ([`crate::core::prs::checkout`])
//! and new-session workspaces ([`crate::core::workspace`]) both make worktrees through
//! [`add`], so the git calls, their timeouts and their error lines live in one place.
//!
//! Nothing in here prints.

use std::path::Path;
use std::time::Duration;

use crate::core::repos;
use crate::error::{Error, Result};

/// Wall clock for one `git worktree add` (a big checkout writes a lot of files).
pub const ADD_TIMEOUT: Duration = Duration::from_secs(120);

/// Run `git -C dir <args>` with a deadline. → trimmed stdout; a failure is an exit-1 error
/// carrying git's `fatal:` / `error:` line.
pub fn git_run(dir: &Path, args: &[&str], timeout: Duration) -> Result<String> {
    let o = repos::output_with_timeout(repos::git_cmd(dir, args), timeout)
        .map_err(|e| Error::Other(format!("git {}: {e}", args.join(" "))))?;
    if !o.status.success() {
        let err = String::from_utf8_lossy(&o.stderr);
        let line = err
            .lines()
            .map(str::trim)
            .find(|l| l.starts_with("fatal:") || l.starts_with("error:"))
            .or_else(|| err.lines().map(str::trim).find(|l| !l.is_empty()))
            .unwrap_or("failed")
            .to_string();
        return Err(Error::exit(1, format!("git {}: {line}", args.join(" "))));
    }
    Ok(String::from_utf8_lossy(&o.stdout).trim().to_string())
}

/// Which branch a new worktree gets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Branch<'a> {
    /// A local branch that already exists: check it out.
    Existing,
    /// A new branch tracking this upstream (`origin/feat-x`): `--track -b`.
    Track(&'a str),
    /// A new branch starting at this commit-ish with no upstream (`--no-track -b`), so
    /// nothing is pushed anywhere until someone pushes it on purpose.
    From(&'a str),
}

/// The `git worktree add` arguments for `branch` at `path`.
pub fn add_args<'a>(path: &'a str, branch: &'a str, how: Branch<'a>) -> Vec<&'a str> {
    let mut args = vec!["worktree", "add", "--quiet"];
    match how {
        Branch::Existing => args.extend([path, branch]),
        Branch::Track(upstream) => args.extend(["--track", "-b", branch, path, upstream]),
        Branch::From(start) => args.extend(["--no-track", "-b", branch, path, start]),
    }
    args
}

/// `git -C repo worktree add` a worktree at `path` on `branch` (the parent directory is
/// created first). Never resets or moves an existing branch: [`Branch::Track`] /
/// [`Branch::From`] fail when the branch already exists.
pub fn add(repo: &Path, path: &Path, branch: &str, how: Branch<'_>) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let path_s = path.display().to_string();
    git_run(repo, &add_args(&path_s, branch, how), ADD_TIMEOUT)?;
    Ok(())
}

/// Does `refs/heads/<branch>` exist in `repo`?
pub fn has_local_branch(repo: &Path, branch: &str) -> bool {
    repos::git(
        repo,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("refs/heads/{branch}"),
        ],
    )
    .is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_args_per_branch_kind() {
        assert_eq!(
            add_args("/wt/a", "feat", Branch::Existing),
            ["worktree", "add", "--quiet", "/wt/a", "feat"]
        );
        assert_eq!(
            add_args("/wt/a", "feat", Branch::Track("origin/feat")),
            [
                "worktree",
                "add",
                "--quiet",
                "--track",
                "-b",
                "feat",
                "/wt/a",
                "origin/feat"
            ]
        );
        assert_eq!(
            add_args("/wt/a", "me/kelpie", Branch::From("origin/main")),
            [
                "worktree",
                "add",
                "--quiet",
                "--no-track",
                "-b",
                "me/kelpie",
                "/wt/a",
                "origin/main"
            ]
        );
    }
}
