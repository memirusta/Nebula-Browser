//! One place that decides whether an extension may open a window, and how big.
//!
//! An extension that was never reviewed can ask for windows no sensible one would:
//! sixteen at once without a click, one the size of the screen, or an address a
//! browser keeps to itself. Measured in WebView2 (see
//! `native_extension_window_abuse`): a script in an extension page opened sixteen
//! windows with no user action, one of them nearly the size of the display. The
//! rules below are generic: they do not know which extension is asking.
//!
//! What the engine already refuses is not repeated here: `file:`, `chrome:`,
//! `javascript:` and `data:` addresses and a request for full screen never become
//! windows, and a service worker's `chrome.windows.create` opens nothing.
use std::collections::VecDeque;
use std::sync::{LazyLock, Mutex};

/// A sign-in or consent window, perhaps a second step. Never more.
pub(crate) const MAX_WINDOWS_PER_OWNER: usize = 3;
pub(crate) const MAX_WINDOWS_TOTAL: usize = 8;
pub(crate) const DEFAULT_SIZE: (f64, f64) = (720.0, 760.0);
/// Small enough that a 300x300 request is honoured as asked.
pub(crate) const MIN_SIZE: (f64, f64) = (160.0, 120.0);
pub(crate) const MAX_SIZE: (f64, f64) = (1600.0, 1200.0);
/// Share of the monitor's work area a window may take; the rest keeps the
/// browser visible and reachable.
const SCREEN_SHARE: f64 = 0.9;
const FALLBACK_WORK_AREA: (f64, f64) = (1280.0, 720.0);

pub(crate) struct Request {
    /// The page was acting on a click or key press (transient user activation).
    pub user_initiated: bool,
    /// The address is one an extension window may show (see `website_url`).
    pub url_allowed: bool,
    /// What `window.open` asked for, in logical pixels, if it asked.
    pub requested_size: Option<(f64, f64)>,
    pub owner_windows: usize,
    pub total_windows: usize,
    /// Logical size of the monitor's work area the window would open on.
    pub work_area: Option<(f64, f64)>,
    /// Asked for by an extension's background code (its service worker), not by a
    /// page of the extension that Nebula shows.
    pub background: bool,
    /// The user did something with an extension in the last `ACTION_WINDOW`.
    pub recent_user_action: bool,
}

#[derive(Debug, PartialEq)]
pub(crate) enum Decision {
    Allow { size: (f64, f64) },
    Deny(&'static str),
}

pub(crate) fn decide(request: &Request) -> Decision {
    if !request.url_allowed {
        return Decision::Deny("address is not allowed in an extension window");
    }
    if !request.user_initiated {
        return Decision::Deny("not started by a click or key press");
    }
    // Background code has no click to point to, so the window must follow something
    // the user did a moment ago (opening an extension, clicking its icon): a sign-in
    // window after pressing Log in. Never one out of the blue.
    if request.background && !request.recent_user_action {
        return Decision::Deny("opened by background code with no recent action of yours");
    }
    if request.owner_windows >= MAX_WINDOWS_PER_OWNER {
        return Decision::Deny("too many windows from this extension page");
    }
    if request.total_windows >= MAX_WINDOWS_TOTAL {
        return Decision::Deny("too many extension windows are open");
    }
    Decision::Allow {
        size: allowed_size(request.requested_size, request.work_area),
    }
}

/// The requested size, kept within what is useful and what fits the screen.
pub(crate) fn allowed_size(
    requested: Option<(f64, f64)>,
    work_area: Option<(f64, f64)>,
) -> (f64, f64) {
    let area = work_area
        .filter(|(w, h)| w.is_finite() && h.is_finite() && *w > 0.0 && *h > 0.0)
        .unwrap_or(FALLBACK_WORK_AREA);
    let largest = (
        (area.0 * SCREEN_SHARE).min(MAX_SIZE.0),
        (area.1 * SCREEN_SHARE).min(MAX_SIZE.1),
    );
    let (width, height) = requested
        .filter(|(w, h)| w.is_finite() && h.is_finite())
        .unwrap_or(DEFAULT_SIZE);
    // A work area smaller than the minimum is still honoured.
    (
        width.max(MIN_SIZE.0).min(largest.0),
        height.max(MIN_SIZE.1).min(largest.1),
    )
}

/// How long after the user's last action with an extension its background code may
/// still open a window.
pub(crate) const ACTION_WINDOW: std::time::Duration = std::time::Duration::from_secs(60);

static LAST_ACTION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

/// Called whenever the user acts on an extension (opens it, clicks its icon).
pub(crate) fn note_user_action() {
    LAST_ACTION.store(now_millis(), std::sync::atomic::Ordering::SeqCst);
}

pub(crate) fn recent_user_action() -> bool {
    let last = LAST_ACTION.load(std::sync::atomic::Ordering::SeqCst);
    last != 0 && now_millis().saturating_sub(last) <= ACTION_WINDOW.as_millis() as u64
}

#[cfg(test)]
pub(crate) fn forget_user_action() {
    LAST_ACTION.store(0, std::sync::atomic::Ordering::SeqCst);
}

const REMEMBERED_DENIALS: usize = 32;

static DENIALS: LazyLock<Mutex<VecDeque<String>>> = LazyLock::new(|| Mutex::new(VecDeque::new()));

/// Remember a refusal so it can be inspected; nothing is shown to the page.
pub(crate) fn record_denial(owner: &str, reason: &str) {
    eprintln!("Extension window refused for {owner}: {reason}");
    crate::extension_trace::note(&format!("window refused for {owner}: {reason}"));
    if let Ok(mut denials) = DENIALS.lock() {
        if denials.len() == REMEMBERED_DENIALS {
            denials.pop_front();
        }
        denials.push_back(format!("{owner}: {reason}"));
    }
}

#[cfg(test)]
pub(crate) fn recent_denials() -> Vec<String> {
    DENIALS
        .lock()
        .map(|denials| denials.iter().cloned().collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok() -> Request {
        Request {
            user_initiated: true,
            url_allowed: true,
            requested_size: Some((500.0, 600.0)),
            owner_windows: 0,
            total_windows: 0,
            work_area: Some((1920.0, 1080.0)),
            background: false,
            recent_user_action: false,
        }
    }

    #[test]
    fn a_clicked_ordinary_window_is_allowed_as_asked() {
        assert_eq!(
            decide(&ok()),
            Decision::Allow {
                size: (500.0, 600.0)
            }
        );
    }

    #[test]
    fn a_window_without_a_user_action_is_refused() {
        let request = Request {
            user_initiated: false,
            ..ok()
        };
        assert!(matches!(decide(&request), Decision::Deny(_)));
    }

    #[test]
    fn a_forbidden_address_is_refused_before_anything_else() {
        let request = Request {
            url_allowed: false,
            user_initiated: false,
            ..ok()
        };
        assert_eq!(
            decide(&request),
            Decision::Deny("address is not allowed in an extension window")
        );
    }

    #[test]
    fn one_extension_page_cannot_flood_the_screen() {
        for open in 0..MAX_WINDOWS_PER_OWNER {
            let request = Request {
                owner_windows: open,
                ..ok()
            };
            assert!(matches!(decide(&request), Decision::Allow { .. }), "{open}");
        }
        let request = Request {
            owner_windows: MAX_WINDOWS_PER_OWNER,
            ..ok()
        };
        assert!(matches!(decide(&request), Decision::Deny(_)));
    }

    #[test]
    fn background_code_may_open_a_window_only_just_after_something_the_user_did() {
        let silent = Request {
            background: true,
            recent_user_action: false,
            ..ok()
        };
        assert_eq!(
            decide(&silent),
            Decision::Deny("opened by background code with no recent action of yours")
        );
        let after_a_click = Request {
            background: true,
            recent_user_action: true,
            ..ok()
        };
        assert!(matches!(decide(&after_a_click), Decision::Allow { .. }));
        // A page that Nebula shows is judged by its own click, not by this rule.
        let page = Request {
            background: false,
            recent_user_action: false,
            ..ok()
        };
        assert!(matches!(decide(&page), Decision::Allow { .. }));
    }

    #[test]
    fn background_windows_still_obey_every_other_limit() {
        let flooding = Request {
            background: true,
            recent_user_action: true,
            owner_windows: MAX_WINDOWS_PER_OWNER,
            ..ok()
        };
        assert!(matches!(decide(&flooding), Decision::Deny(_)));
        let forbidden = Request {
            background: true,
            recent_user_action: true,
            url_allowed: false,
            ..ok()
        };
        assert!(matches!(decide(&forbidden), Decision::Deny(_)));
    }

    #[test]
    fn a_user_action_counts_for_a_minute_and_not_before_it_happened() {
        forget_user_action();
        assert!(!recent_user_action(), "no action yet");
        note_user_action();
        assert!(recent_user_action());
        // Moving the clock back is not possible here; check the arithmetic instead.
        assert_eq!(ACTION_WINDOW.as_secs(), 60);
        forget_user_action();
        assert!(!recent_user_action());
    }

    #[test]
    fn all_extensions_together_are_capped_too() {
        let request = Request {
            total_windows: MAX_WINDOWS_TOTAL,
            ..ok()
        };
        assert!(matches!(decide(&request), Decision::Deny(_)));
    }

    #[test]
    fn a_window_never_covers_the_screen() {
        // 5000x5000 on a 1920x1080 work area: at most 90% of it.
        assert_eq!(
            allowed_size(Some((5000.0, 5000.0)), Some((1920.0, 1080.0))),
            (1600.0, 972.0)
        );
        assert_eq!(
            allowed_size(Some((5000.0, 5000.0)), Some((1280.0, 720.0))),
            (1152.0, 648.0)
        );
        // A huge monitor is still capped by the absolute maximum.
        assert_eq!(
            allowed_size(Some((9000.0, 9000.0)), Some((7680.0, 4320.0))),
            MAX_SIZE
        );
    }

    #[test]
    fn a_window_is_never_uselessly_small() {
        assert_eq!(
            allowed_size(Some((1.0, 1.0)), Some((1920.0, 1080.0))),
            MIN_SIZE
        );
        assert_eq!(allowed_size(Some((-50.0, 0.0)), None), MIN_SIZE);
    }

    #[test]
    fn missing_or_nonsense_inputs_fall_back_to_safe_values() {
        assert_eq!(allowed_size(None, Some((1920.0, 1080.0))), DEFAULT_SIZE);
        assert_eq!(
            allowed_size(Some((f64::NAN, 400.0)), Some((1920.0, 1080.0))),
            DEFAULT_SIZE
        );
        // No usable work area: assume a small laptop screen (1280x720 -> 90% is 1152x648).
        for area in [None, Some((0.0, 0.0)), Some((f64::INFINITY, 900.0))] {
            assert_eq!(allowed_size(None, area), (720.0, 648.0), "{area:?}");
        }
    }

    #[test]
    fn refusals_are_remembered_for_inspection() {
        record_denial(
            "extension-ui-x-options",
            "not started by a click or key press",
        );
        assert!(recent_denials()
            .iter()
            .any(|line| line.contains("extension-ui-x-options")));
    }
}
