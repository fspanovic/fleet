//! Native notifications for the page's `fleet://notify` links (a session started
//! waiting on you): Notification Center through `UNUserNotificationCenter`, shown
//! even while Fleet is in front; a click brings the window up on that session.
//! Outside a `.app` bundle (`cargo run`) the center is unavailable, so it falls
//! back to the CLI's osascript notification (no click-through).

use std::sync::OnceLock;

use tauri::{AppHandle, Manager};

static APP: OnceLock<AppHandle> = OnceLock::new();

/// Remember the app (the click handler opens its window) and become the center's delegate.
pub fn init(app: &AppHandle) {
    let _ = APP.set(app.clone());
    #[cfg(target_os = "macos")]
    mac::init();
}

/// Post one notification; `path` (`/s/<host>/<id>`) is the route a click opens. A newer
/// notification for the same path replaces the older one.
pub fn show(title: &str, body: &str, path: &str) {
    #[cfg(target_os = "macos")]
    if mac::show(title, body, path) {
        return;
    }
    let _ = path;
    fleet::tui::notify::notify(title, body);
}

/// The script that opens `path` in the page: `location.hash = "#<path>"` (JSON-quoted).
pub fn open_script(path: &str) -> String {
    let hash = serde_json::to_string(&format!("#{path}")).expect("a string serializes");
    format!("location.hash={hash};")
}

/// A notification was clicked: show the window on that session.
fn opened(path: &str) {
    if !crate::links::valid_path(path) {
        return;
    }
    let Some(app) = APP.get() else { return };
    crate::show_main(app);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval(open_script(path));
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{Bool, NSObject, NSObjectProtocol, ProtocolObject};
    use objc2::{AnyThread, define_class, msg_send};
    use objc2_foundation::{NSBundle, NSError, NSString};
    use objc2_user_notifications::{
        UNAuthorizationOptions, UNMutableNotificationContent, UNNotification,
        UNNotificationPresentationOptions, UNNotificationRequest, UNNotificationResponse,
        UNNotificationSound, UNUserNotificationCenter, UNUserNotificationCenterDelegate,
    };

    define_class!(
        // SAFETY: NSObject has no subclassing requirements; Delegate has no Drop.
        #[unsafe(super(NSObject))]
        #[name = "FleetNotificationDelegate"]
        struct Delegate;

        unsafe impl NSObjectProtocol for Delegate {}

        unsafe impl UNUserNotificationCenterDelegate for Delegate {
            // Show it even while Fleet is the active app (the page already skips the session you are looking at).
            #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
            fn will_present(
                &self,
                _center: &UNUserNotificationCenter,
                _notification: &UNNotification,
                handler: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
            ) {
                handler.call((UNNotificationPresentationOptions::Banner
                    | UNNotificationPresentationOptions::List
                    | UNNotificationPresentationOptions::Sound,));
            }

            #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
            fn did_receive(
                &self,
                _center: &UNUserNotificationCenter,
                response: &UNNotificationResponse,
                handler: &block2::DynBlock<dyn Fn()>,
            ) {
                let path = response.notification().request().identifier().to_string();
                super::opened(&path);
                handler.call(());
            }
        }
    );

    impl Delegate {
        fn new() -> Retained<Self> {
            let this = Self::alloc().set_ivars(());
            unsafe { msg_send![super(this), init] }
        }
    }

    /// The notification center needs a real app bundle; it raises (aborting the process) without one.
    fn bundled() -> bool {
        NSBundle::mainBundle()
            .bundlePath()
            .to_string()
            .ends_with(".app")
    }

    pub fn init() {
        if !bundled() {
            return;
        }
        let delegate = Delegate::new();
        UNUserNotificationCenter::currentNotificationCenter()
            .setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        // The center holds its delegate weakly: keep it for the life of the app.
        std::mem::forget(delegate);
    }

    /// false: not available here (the caller falls back).
    pub fn show(title: &str, body: &str, path: &str) -> bool {
        if !bundled() {
            return false;
        }
        let (title, body, path) = (title.to_owned(), body.to_owned(), path.to_owned());
        let center = UNUserNotificationCenter::currentNotificationCenter();
        // Asks once (macOS remembers the answer); then posts, unless notifications are off for Fleet.
        let post = RcBlock::new(move |granted: Bool, _err: *mut NSError| {
            if !granted.as_bool() {
                return;
            }
            let content = UNMutableNotificationContent::new();
            content.setTitle(&NSString::from_str(&title));
            content.setBody(&NSString::from_str(&body));
            content.setSound(Some(&UNNotificationSound::defaultSound()));
            let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
                &NSString::from_str(&path),
                &content,
                None,
            );
            UNUserNotificationCenter::currentNotificationCenter()
                .addNotificationRequest_withCompletionHandler(&request, None);
        });
        center.requestAuthorizationWithOptions_completionHandler(
            UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
            &post,
        );
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_script_quotes_the_path() {
        assert_eq!(
            open_script("/s/laptop/abc"),
            r##"location.hash="#/s/laptop/abc";"##
        );
        assert_eq!(
            open_script("/s/a\"b/</script>"),
            r##"location.hash="#/s/a\"b/</script>";"##
        );
    }
}
