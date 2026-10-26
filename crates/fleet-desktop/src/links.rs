//! What happens to a URL the page navigates to or opens in a new window.

use tauri::Url;

/// Schemes handed to macOS (`open`) — editor links and mail. Anything else
/// that is not the app's own origin or http(s) is dropped.
const OS_SCHEMES: &[&str] = &["vscode", "vscode-insiders", "cursor", "mailto"];

#[derive(Debug, PartialEq, Eq)]
pub enum Action {
    /// Load it in the app's window.
    Allow,
    /// Hand it to the OS: the default browser for http(s), the registered app otherwise.
    Open,
    /// `fleet://attach?host=<h>&session=<tmux session>`: open an iTerm tab attached to it.
    Attach {
        host: String,
        session: String,
    },
    /// `fleet://notify?title=<t>&body=<b>&path=/s/<host>/<id>`: a native notification;
    /// a click opens `path` in the window (the web UI's lib/notify.ts sends these).
    Notify {
        title: String,
        body: String,
        path: String,
    },
    Deny,
}

/// Longest title / body a notification takes (longer ones are cut).
const NOTIFY_TEXT_MAX: usize = 240;

/// A route of the page a notification may open: `/…`, never `//host`, no control characters.
pub fn valid_path(path: &str) -> bool {
    path.starts_with('/')
        && !path.starts_with("//")
        && path.len() <= 1024
        && !path.chars().any(char::is_control)
}

fn clip(s: String) -> String {
    match s.char_indices().nth(NOTIFY_TEXT_MAX) {
        Some((i, _)) => format!("{}…", &s[..i]),
        None => s,
    }
}

/// The app's own `fleet://` links: `attach` (a host and a session) and `notify` (a title and a path).
fn fleet_link(url: &Url) -> Action {
    let q = |k: &str| {
        url.query_pairs()
            .find(|(n, _)| n == k)
            .map(|(_, v)| v.into_owned())
            .filter(|v| !v.is_empty())
    };
    match url.host_str() {
        Some("attach") => match (q("host"), q("session")) {
            (Some(host), Some(session)) => Action::Attach { host, session },
            _ => Action::Deny,
        },
        Some("notify") => match (q("title"), q("path")) {
            (Some(title), Some(path)) if valid_path(&path) => Action::Notify {
                title: clip(title),
                body: clip(q("body").unwrap_or_default()),
                path,
            },
            _ => Action::Deny,
        },
        _ => Action::Deny,
    }
}

fn same_origin(a: &Url, b: &Url) -> bool {
    a.scheme() == b.scheme()
        && a.host() == b.host()
        && a.port_or_known_default() == b.port_or_known_default()
}

/// A navigation of the window (or of a frame in it). The app's own pages and the
/// Fleet server stay in the window; other web pages open in the browser.
pub fn navigation(url: &Url, server: &Url) -> Action {
    match url.scheme() {
        "tauri" | "about" | "blob" | "data" => Action::Allow,
        "http" | "https" if url.host_str() == Some("tauri.localhost") => Action::Allow,
        "http" | "https" if same_origin(url, server) => Action::Allow,
        "http" | "https" => Action::Open,
        s if OS_SCHEMES.contains(&s) => Action::Open,
        "fleet" => fleet_link(url),
        _ => Action::Deny,
    }
}

/// A `target="_blank"` link or `window.open`: never a second app window.
pub fn new_window(url: &Url) -> Action {
    match url.scheme() {
        "http" | "https" => Action::Open,
        s if OS_SCHEMES.contains(&s) => Action::Open,
        _ => Action::Deny,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn server_origin_stays_in_the_window() {
        let server = u("http://127.0.0.1:7777/");
        assert_eq!(
            navigation(&u("http://127.0.0.1:7777/#/s/laptop/abc"), &server),
            Action::Allow
        );
        assert_eq!(
            navigation(&u("http://127.0.0.1:7777/api/x"), &server),
            Action::Allow
        );
        assert_eq!(
            navigation(&u("tauri://localhost/index.html"), &server),
            Action::Allow
        );
        assert_eq!(navigation(&u("about:blank"), &server), Action::Allow);
    }

    #[test]
    fn other_origins_go_to_the_browser() {
        let server = u("http://127.0.0.1:7777/");
        assert_eq!(
            navigation(&u("http://127.0.0.1:7778/"), &server),
            Action::Open
        );
        assert_eq!(
            navigation(&u("https://127.0.0.1:7777/"), &server),
            Action::Open
        );
        assert_eq!(
            navigation(&u("https://github.com/owner/repo/pull/1"), &server),
            Action::Open
        );
    }

    #[test]
    fn editor_links_go_to_the_os_and_the_rest_is_dropped() {
        let server = u("http://127.0.0.1:7777/");
        assert_eq!(navigation(&u("vscode://file/tmp/x"), &server), Action::Open);
        assert_eq!(navigation(&u("cursor://file/tmp/x"), &server), Action::Open);
        assert_eq!(navigation(&u("file:///etc/passwd"), &server), Action::Deny);
        assert_eq!(navigation(&u("javascript:alert(1)"), &server), Action::Deny);
        assert_eq!(
            navigation(&u("x-apple-systempreferences:foo"), &server),
            Action::Deny
        );
    }

    #[test]
    fn new_windows_open_outside() {
        assert_eq!(new_window(&u("http://127.0.0.1:7777/api/x")), Action::Open);
        assert_eq!(new_window(&u("https://example.com/")), Action::Open);
        assert_eq!(new_window(&u("vscode://file/tmp")), Action::Open);
        assert_eq!(new_window(&u("file:///tmp")), Action::Deny);
    }

    #[test]
    fn fleet_attach_links_carry_host_and_session() {
        let server = u("http://127.0.0.1:7777/");
        assert_eq!(
            navigation(&u("fleet://attach?host=workstation&session=a%20b"), &server),
            Action::Attach {
                host: "workstation".into(),
                session: "a b".into()
            }
        );
        let deny = [
            "fleet://attach?host=workstation",
            "fleet://attach?host=&session=x",
            "fleet://run?host=h&session=x",
        ];
        for d in deny {
            assert_eq!(navigation(&u(d), &server), Action::Deny, "{d}");
        }
        assert_eq!(
            new_window(&u("fleet://attach?host=h&session=x")),
            Action::Deny
        );
    }

    #[test]
    fn fleet_notify_links_carry_title_body_and_path() {
        let server = u("http://127.0.0.1:7777/");
        assert_eq!(
            navigation(
                &u(
                    "fleet://notify?title=lapwing+needs+you&body=permission&path=%2Fs%2Fworkstation%2Fabc"
                ),
                &server
            ),
            Action::Notify {
                title: "lapwing needs you".into(),
                body: "permission".into(),
                path: "/s/workstation/abc".into()
            }
        );
        assert_eq!(
            navigation(&u("fleet://notify?title=t&path=%2Fs%2Fh%2F1"), &server),
            Action::Notify {
                title: "t".into(),
                body: String::new(),
                path: "/s/h/1".into()
            }
        );
        let deny = [
            "fleet://notify?title=t",
            "fleet://notify?path=%2Fs%2Fh%2F1",
            "fleet://notify?title=t&path=s%2Fh%2F1",
            "fleet://notify?title=t&path=%2F%2Fevil.example",
            "fleet://notify?title=t&path=%2Fs%0A",
        ];
        for d in deny {
            assert_eq!(navigation(&u(d), &server), Action::Deny, "{d}");
        }
        assert_eq!(
            new_window(&u("fleet://notify?title=t&path=%2F")),
            Action::Deny
        );
    }

    #[test]
    fn long_notification_text_is_cut() {
        let server = u("http://127.0.0.1:7777/");
        let long = "x".repeat(500);
        let Action::Notify { title, .. } = navigation(
            &u(&format!("fleet://notify?title={long}&path=%2F")),
            &server,
        ) else {
            panic!("not a notify link")
        };
        assert_eq!(title.chars().count(), NOTIFY_TEXT_MAX + 1);
        assert!(title.ends_with('…'));
    }
}
