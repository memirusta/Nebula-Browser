//! How a window an extension asks for should look, decided from what the extension
//! DECLARED, never from its name.
//!
//! Chrome gives an extension no setting for "frameless" or "300x300". It says what
//! it wants by the kind of window it declares, and Chrome shows each kind in a
//! fixed way. Nebula shows a window the same way:
//!
//! - toolbar popup (`action.default_popup`): a frameless box the size of its content
//! - options page opened in a tab (`options_ui.open_in_tab` or the older
//!   `options_page`): large, like a tab
//! - options page embedded (`options_ui`): a dialog that follows its content
//! - side panel (`side_panel`): docked to the right edge of its browser window
//!
//! Only a window with no declaration to go by gets the old fixed size.
use serde_json::Value;

/// A popup's content-size limits are Chrome's: at least 25x25, at most 800x600.
pub(crate) const POPUP_FOLLOW: ((f64, f64), (f64, f64)) = ((25.0, 25.0), (800.0, 600.0));
const EMBEDDED_OPTIONS_FOLLOW: ((f64, f64), (f64, f64)) = ((320.0, 240.0), (800.0, 680.0));
const FALLBACK_WORK_AREA: (f64, f64) = (1280.0, 720.0);
const DEFAULT_SIZE: (f64, f64) = (420.0, 560.0);
const SIDE_PANEL_WIDTH: f64 = 400.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Kind {
    Popup,
    SidePanel,
    Options,
    Other,
}

/// The kind is part of the window's label (`extension-ui-<id>-<kind>`).
pub(crate) fn kind_of(label: &str) -> Kind {
    if !label.starts_with("extension-ui-") {
        Kind::Other
    } else if label.ends_with("-side-panel") {
        Kind::SidePanel
    } else if label.ends_with("-popup") {
        Kind::Popup
    } else if label.ends_with("-options") {
        Kind::Options
    } else {
        Kind::Other
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct Hints {
    /// The options page is meant to fill a tab rather than sit in a dialog.
    pub options_in_tab: bool,
}

pub(crate) fn hints(manifest: &Value) -> Hints {
    let declared_tab = manifest
        .pointer("/options_ui/open_in_tab")
        .and_then(Value::as_bool);
    Hints {
        options_in_tab: declared_tab == Some(true)
            // The older `options_page` always opens in a tab.
            || (manifest.get("options_ui").is_none() && manifest.get("options_page").is_some()),
    }
}

/// The browser window the extension window belongs to, outer rectangle in logical
/// pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Profile {
    /// Content size to open at.
    pub size: (f64, f64),
    /// Top-left corner, when there is a browser window to place it against.
    pub position: Option<(f64, f64)>,
    pub decorations: bool,
    pub resizable: bool,
    pub min_size: (f64, f64),
    /// Limits within which the window follows what its page renders.
    pub follow_content: Option<((f64, f64), (f64, f64))>,
}

pub(crate) fn profile(
    kind: Kind,
    hints: Hints,
    owner: Option<Rect>,
    work_area: Option<(f64, f64)>,
) -> Profile {
    let area = work_area
        .filter(|(w, h)| w.is_finite() && h.is_finite() && *w > 0.0 && *h > 0.0)
        .unwrap_or(FALLBACK_WORK_AREA);
    // Windows start inside the screen even if the browser window is partly off it.
    let place = |x: f64, y: f64| (x.max(0.0), y.max(0.0));
    let centered = |size: (f64, f64)| {
        owner.map(|o| {
            place(
                o.x + (o.width - size.0) / 2.0,
                o.y + (o.height - size.1) / 2.0,
            )
        })
    };
    match kind {
        Kind::Popup => Profile {
            size: DEFAULT_SIZE,
            // Near the top, under the browser's toolbar, as a toolbar popup is.
            position: owner.map(|o| place(o.x + (o.width - DEFAULT_SIZE.0) / 2.0, o.y + 72.0)),
            decorations: false,
            resizable: false,
            min_size: POPUP_FOLLOW.0,
            follow_content: Some(POPUP_FOLLOW),
        },
        Kind::SidePanel => {
            let width = SIDE_PANEL_WIDTH.min(area.0 * 0.5);
            let height = owner
                .map(|o| (o.height - 80.0).max(400.0))
                .unwrap_or(DEFAULT_SIZE.1)
                .min(area.1 * 0.9);
            Profile {
                size: (width, height),
                // Against the right edge of its browser window, below its top bar.
                position: owner.map(|o| place(o.x + o.width - width - 12.0, o.y + 56.0)),
                decorations: true,
                resizable: true,
                min_size: (320.0, 240.0),
                follow_content: None,
            }
        }
        Kind::Options if hints.options_in_tab => {
            let size = ((area.0 * 0.75).min(1000.0), (area.1 * 0.8).min(760.0));
            Profile {
                size,
                position: centered(size),
                decorations: true,
                resizable: true,
                min_size: (480.0, 320.0),
                follow_content: None,
            }
        }
        Kind::Options => {
            let size = (520.0_f64.min(area.0 * 0.9), 600.0_f64.min(area.1 * 0.9));
            Profile {
                size,
                position: centered(size),
                decorations: true,
                resizable: true,
                min_size: (320.0, 240.0),
                follow_content: Some(EMBEDDED_OPTIONS_FOLLOW),
            }
        }
        Kind::Other => Profile {
            size: DEFAULT_SIZE,
            position: None,
            decorations: true,
            resizable: true,
            min_size: (320.0, 240.0),
            follow_content: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const OWNER: Rect = Rect {
        x: 100.0,
        y: 100.0,
        width: 1200.0,
        height: 800.0,
    };
    const AREA: Option<(f64, f64)> = Some((1920.0, 1080.0));

    #[test]
    fn the_kind_comes_from_the_label() {
        assert_eq!(kind_of("extension-ui-abc-popup"), Kind::Popup);
        assert_eq!(kind_of("extension-ui-abc-side-panel"), Kind::SidePanel);
        assert_eq!(kind_of("extension-ui-abc-options"), Kind::Options);
        assert_eq!(kind_of("extension-ui-abc-other"), Kind::Other);
        assert_eq!(kind_of("nebula-tab-popup"), Kind::Other);
    }

    #[test]
    fn options_hints_follow_the_manifest() {
        assert!(!hints(&json!({ "options_ui": { "page": "o.html" } })).options_in_tab);
        assert!(
            !hints(&json!({ "options_ui": { "page": "o.html", "open_in_tab": false } }))
                .options_in_tab
        );
        assert!(
            hints(&json!({ "options_ui": { "page": "o.html", "open_in_tab": true } }))
                .options_in_tab
        );
        // The older key always means a tab.
        assert!(hints(&json!({ "options_page": "o.html" })).options_in_tab);
        // `options_ui` wins over a leftover `options_page`.
        assert!(
            !hints(&json!({ "options_ui": { "page": "o.html" }, "options_page": "x.html" }))
                .options_in_tab
        );
        assert!(!hints(&json!({})).options_in_tab);
    }

    #[test]
    fn a_popup_is_a_frameless_box_that_follows_its_content() {
        let p = profile(Kind::Popup, Hints::default(), Some(OWNER), AREA);
        assert!(!p.decorations && !p.resizable);
        assert_eq!(p.follow_content, Some(POPUP_FOLLOW));
        assert_eq!(p.min_size, (25.0, 25.0));
        // Horizontally centred on its browser window, near the top.
        assert_eq!(p.position, Some((100.0 + (1200.0 - 420.0) / 2.0, 172.0)));
    }

    #[test]
    fn a_side_panel_is_docked_to_the_right_edge_of_its_browser_window() {
        let p = profile(Kind::SidePanel, Hints::default(), Some(OWNER), AREA);
        assert_eq!(p.size, (400.0, 720.0));
        assert_eq!(p.position, Some((100.0 + 1200.0 - 400.0 - 12.0, 156.0)));
        assert!(p.decorations && p.resizable);
        assert_eq!(
            p.follow_content, None,
            "a panel fills its height, it does not shrink to content"
        );
    }

    #[test]
    fn a_side_panel_fits_a_short_browser_window_and_a_small_screen() {
        let short = Rect {
            height: 300.0,
            ..OWNER
        };
        assert_eq!(
            profile(Kind::SidePanel, Hints::default(), Some(short), AREA)
                .size
                .1,
            400.0
        );
        let p = profile(
            Kind::SidePanel,
            Hints::default(),
            Some(OWNER),
            Some((600.0, 500.0)),
        );
        assert_eq!(p.size, (300.0, 450.0));
    }

    #[test]
    fn an_options_page_meant_for_a_tab_opens_large() {
        let p = profile(
            Kind::Options,
            Hints {
                options_in_tab: true,
            },
            Some(OWNER),
            AREA,
        );
        assert_eq!(p.size, (1000.0, 760.0));
        assert_eq!(p.follow_content, None);
        // Centred on its browser window.
        assert_eq!(p.position, Some((100.0 + 100.0, 100.0 + 20.0)));
        let small = profile(
            Kind::Options,
            Hints {
                options_in_tab: true,
            },
            Some(OWNER),
            Some((800.0, 600.0)),
        );
        assert_eq!(
            small.size,
            (600.0, 480.0),
            "never larger than the screen allows"
        );
    }

    #[test]
    fn an_embedded_options_page_follows_its_content() {
        let p = profile(Kind::Options, Hints::default(), Some(OWNER), AREA);
        assert_eq!(p.size, (520.0, 600.0));
        assert_eq!(p.follow_content, Some(((320.0, 240.0), (800.0, 680.0))));
        assert!(p.decorations && p.resizable);
    }

    #[test]
    fn a_window_with_nothing_declared_keeps_the_old_default() {
        let p = profile(Kind::Other, Hints::default(), Some(OWNER), AREA);
        assert_eq!(p.size, (420.0, 560.0));
        assert!(p.decorations && p.resizable && p.position.is_none() && p.follow_content.is_none());
    }

    #[test]
    fn nothing_is_placed_off_the_screen() {
        let off = Rect {
            x: -900.0,
            y: -400.0,
            ..OWNER
        };
        for kind in [Kind::Popup, Kind::SidePanel, Kind::Options] {
            let (x, y) = profile(kind, Hints::default(), Some(off), AREA)
                .position
                .unwrap();
            assert!(x >= 0.0 && y >= 0.0, "{kind:?}");
        }
    }

    #[test]
    fn without_a_browser_window_the_position_is_left_to_the_system() {
        for kind in [Kind::Popup, Kind::SidePanel, Kind::Options, Kind::Other] {
            assert_eq!(
                profile(kind, Hints::default(), None, AREA).position,
                None,
                "{kind:?}"
            );
        }
    }
}
