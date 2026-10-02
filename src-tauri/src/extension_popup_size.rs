//! Chrome opens an extension popup at the size of its content (at least 25x25 and
//! at most 800x600); a manifest names no size. Nebula's popup window used a fixed
//! 420x560, so a popup smaller than that sat in a white window.
//!
//! The page is measured with a fixed read-only script (the bottom-right edge of
//! what it renders, not the viewport it is given) and the window follows it. The
//! measurement is debounced, stops once the user resizes the window, and never
//! reads anything from the page but two numbers.
use serde_json::Value;

/// Chrome's limits: 25x25 and 800x600. A popup has no frame, so nothing keeps it
/// from being that small.
pub(crate) const MIN_SIZE: (f64, f64) = (25.0, 25.0);
pub(crate) const MAX_SIZE: (f64, f64) = (800.0, 600.0);
const TOLERANCE: f64 = 2.0;

/// Right and bottom edge of everything the page renders. Elements that fill the
/// viewport report the viewport, so a fluid page keeps its size and a page with
/// its own width or height defines it. Fixed and sticky elements are bound to the
/// viewport and would only echo it.
pub(crate) const MEASURE_SCRIPT: &str = r#"(() => {
  const body = document.body;
  if (!body || document.readyState === 'loading') return null;
  let right = 0;
  let bottom = 0;
  let seen = 0;
  // An element only adds to the page's size where it can be seen: what an ancestor
  // with an overflow other than visible (an outer <svg>, a clipped panel) cuts off
  // does not count. Decorative shapes that overflow their box would otherwise make
  // the size depend on an animation's current frame.
  const clipOf = new Map();
  clipOf.set(body, null);
  const intersect = (a, b) => !a ? b : !b ? a : {
    left: Math.max(a.left, b.left), top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom),
  };
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node && seen < 4000; node = walker.nextNode(), seen++) {
    const style = getComputedStyle(node);
    const parentClip = clipOf.get(node.parentElement) || null;
    const rect = node.getBoundingClientRect();
    const box = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    const clipsChildren = style.overflowX !== 'visible' || style.overflowY !== 'visible';
    clipOf.set(node, clipsChildren ? intersect(parentClip, box) : parentClip);
    if (style.display === 'none' || style.visibility === 'hidden' || style.position === 'fixed' || style.position === 'sticky') continue;
    if (rect.width <= 0 || rect.height <= 0) continue;
    const seenBox = intersect(parentClip, box);
    if (seenBox.right <= seenBox.left || seenBox.bottom <= seenBox.top) continue;
    right = Math.max(right, seenBox.right + window.scrollX);
    bottom = Math.max(bottom, seenBox.bottom + window.scrollY);
  }
  // What the page really scrolls, beyond the boxes of its elements: text that does
  // not fit its box, a pseudo-element, anything a stylesheet pushed out. It is only
  // counted once it is more than rounding noise, and only when the page does
  // overflow, so a page that fits is never kept from shrinking by its own viewport.
  const root = document.documentElement;
  if (root.scrollWidth - root.clientWidth > 1.5) right = Math.max(right, root.scrollWidth);
  if (root.scrollHeight - root.clientHeight > 1.5) bottom = Math.max(bottom, root.scrollHeight);
  // Rounded down: a window a fraction of a device pixel taller than the page
  // shows the page's white canvas as a thin line along its bottom edge.
  return right > 0 && bottom > 0 ? { width: Math.floor(right), height: Math.floor(bottom) } : null;
})()"#;

pub(crate) type Bounds = ((f64, f64), (f64, f64));

pub(crate) fn clamp(measured: (f64, f64), (min, max): Bounds) -> (f64, f64) {
    (
        measured.0.clamp(min.0, max.0),
        measured.1.clamp(min.1, max.1),
    )
}

fn differs(a: (f64, f64), b: (f64, f64)) -> bool {
    (a.0 - b.0).abs() > TOLERANCE || (a.1 - b.1).abs() > TOLERANCE
}

/// While the page fits within the limits, its scroll bars are hidden. The window is
/// rounded down to whole device pixels so it is never larger than the page, which
/// can leave a fraction of a pixel of overflow: without this, that fraction shows
/// as a vertical bar, whose width then overflows the other axis and adds a
/// horizontal bar. Once the page really exceeds the limit, scrolling is needed and
/// the bars are shown.
pub(crate) fn scrollbars_hidden(measured: (f64, f64), (_, max): Bounds) -> bool {
    measured.0 <= max.0 && measured.1 <= max.1
}

/// A window can only be a whole number of device pixels. Round down so it is never
/// larger than the content it was sized to.
pub(crate) fn align_to_device(size: (f64, f64), scale: f64) -> (f64, f64) {
    if scale <= 0.0 || !scale.is_finite() {
        return size;
    }
    (
        (size.0 * scale).floor() / scale,
        (size.1 * scale).floor() / scale,
    )
}

/// The `{ width, height }` a `Runtime.evaluate` call returned.
pub(crate) fn parse_measurement(evaluation: &Value) -> Option<(f64, f64)> {
    let value = &evaluation["result"]["value"];
    let (width, height) = (value["width"].as_f64()?, value["height"].as_f64()?);
    (width.is_finite() && height.is_finite() && width > 0.0 && height > 0.0)
        .then_some((width, height))
}

/// When to resize. A size must be seen twice in a row before it is applied, so a
/// page that is still laying out does not make the window jump, and the window is
/// left alone for good once the user has resized it.
pub(crate) struct Sizer {
    bounds: Bounds,
    last_set: Option<(f64, f64)>,
    pending: Option<(f64, f64)>,
    user_took_over: bool,
}

impl Default for Sizer {
    /// Chrome's popup limits.
    fn default() -> Self {
        Self::with_bounds((MIN_SIZE, MAX_SIZE))
    }
}

impl Sizer {
    pub(crate) fn with_bounds(bounds: Bounds) -> Self {
        Self {
            bounds,
            last_set: None,
            pending: None,
            user_took_over: false,
        }
    }

    /// `inner` is the window's current content size; `measured` the page's.
    pub(crate) fn observe(
        &mut self,
        inner: (f64, f64),
        measured: (f64, f64),
    ) -> Option<(f64, f64)> {
        if self.user_took_over {
            return None;
        }
        // Allow for the OS rounding the size to whole device pixels.
        if let Some(last) = self.last_set {
            if (inner.0 - last.0).abs() > TOLERANCE + 2.0
                || (inner.1 - last.1).abs() > TOLERANCE + 2.0
            {
                self.user_took_over = true;
                return None;
            }
        }
        let target = clamp(measured, self.bounds);
        if !differs(inner, target) {
            self.pending = None;
            return None;
        }
        if self
            .pending
            .is_some_and(|pending| !differs(pending, target))
        {
            self.last_set = Some(target);
            self.pending = None;
            return Some(target);
        }
        self.pending = Some(target);
        None
    }

    pub(crate) fn finished(&self) -> bool {
        self.user_took_over
    }
}

/// Follow `label`'s content for as long as the window lives.
#[cfg(target_os = "windows")]
pub(crate) fn watch(app: &tauri::AppHandle, label: &str, bounds: Option<Bounds>) {
    use std::time::{Duration, Instant};
    use tauri::Manager;
    // Only a window whose kind follows its content is watched.
    let Some(bounds) = bounds else { return };
    let (app, label) = (app.clone(), label.to_string());
    std::thread::spawn(move || {
        let mut sizer = Sizer::with_bounds(bounds);
        // What was last applied to the page, so the call is made only on a change.
        let mut scrollbars: Option<bool> = None;
        let started = Instant::now();
        loop {
            // Quick while the page loads, then only enough to catch later growth.
            std::thread::sleep(if started.elapsed() < Duration::from_secs(10) {
                Duration::from_millis(250)
            } else {
                Duration::from_secs(1)
            });
            let Some(window) = app.get_webview_window(&label) else {
                return;
            };
            if sizer.finished() {
                return;
            }
            let scale = window.scale_factor().unwrap_or(1.0);
            let Ok(inner) = window.inner_size() else {
                continue;
            };
            let inner = (inner.width as f64 / scale, inner.height as f64 / scale);
            let Ok(evaluation) = crate::extension_worker::cdp(
                &app,
                &label,
                None,
                "Runtime.evaluate",
                &serde_json::json!({ "expression": MEASURE_SCRIPT, "returnByValue": true }),
            ) else {
                continue;
            };
            let Some(measured) = parse_measurement(&evaluation) else {
                continue;
            };
            let hidden = scrollbars_hidden(measured, bounds);
            if scrollbars != Some(hidden) {
                let applied = crate::extension_worker::cdp(
                    &app,
                    &label,
                    None,
                    "Emulation.setScrollbarsHidden",
                    &serde_json::json!({ "hidden": hidden }),
                );
                if applied.is_ok() {
                    scrollbars = Some(hidden);
                }
            }
            if let Some((width, height)) = sizer.observe(inner, measured) {
                // Resizes the content area, which is what was measured, to a whole
                // number of device pixels.
                let (width, height) = align_to_device((width, height), scale);
                let _ =
                    window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(width, height)));
            }
        }
    });
}

/// Like Chrome, a popup closes when it loses focus. Not while it has opened a sign-in
/// window of its own (its opener must survive), and not before it has had focus.
#[cfg(target_os = "windows")]
pub(crate) fn close_on_blur(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::Arc;
    use std::time::Duration;
    use tauri::Manager;
    let focused_once = Arc::new(AtomicBool::new(false));
    let generation = Arc::new(AtomicU64::new(0));
    let (app, label, target) = (app.clone(), window.label().to_string(), window.clone());
    window.on_window_event(move |event| {
        let tauri::WindowEvent::Focused(focused) = event else {
            return;
        };
        // Each focus change supersedes the one before it.
        let current = generation.fetch_add(1, Ordering::SeqCst) + 1;
        if *focused {
            focused_once.store(true, Ordering::SeqCst);
            return;
        }
        if !focused_once.load(Ordering::SeqCst) {
            return;
        }
        let (app, label, target, generation) = (
            app.clone(),
            label.clone(),
            target.clone(),
            generation.clone(),
        );
        std::thread::spawn(move || {
            // A sign-in window the popup opens is created a moment after the blur.
            std::thread::sleep(Duration::from_millis(700));
            if generation.load(Ordering::SeqCst) != current {
                return;
            }
            let prefix = format!("extension-auth-{label}-");
            if !app
                .webview_windows()
                .keys()
                .any(|name| name.starts_with(&prefix))
            {
                let _ = target.destroy();
            }
        });
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sizes_follow_chromes_popup_limits() {
        let popup = (MIN_SIZE, MAX_SIZE);
        assert_eq!(clamp((405.0, 373.0), popup), (405.0, 373.0));
        assert_eq!(clamp((1200.0, 900.0), popup), MAX_SIZE);
        assert_eq!(clamp((10.0, 10.0), popup), MIN_SIZE);
        // Other kinds follow their content within their own limits.
        let options = ((320.0, 240.0), (800.0, 680.0));
        assert_eq!(clamp((100.0, 100.0), options), (320.0, 240.0));
        assert_eq!(clamp((900.0, 900.0), options), (800.0, 680.0));
    }

    #[test]
    fn scroll_bars_are_hidden_only_while_the_page_fits() {
        let popup = (MIN_SIZE, MAX_SIZE);
        assert!(
            scrollbars_hidden((420.0, 140.6), popup),
            "a small page: a fraction of overflow is clipped"
        );
        assert!(
            scrollbars_hidden((800.0, 600.0), popup),
            "exactly at the limit still fits"
        );
        assert!(
            !scrollbars_hidden((420.0, 900.0), popup),
            "taller than the limit: scrolling is needed"
        );
        assert!(
            !scrollbars_hidden((1200.0, 300.0), popup),
            "wider than the limit: scrolling is needed"
        );
        let options = ((320.0, 240.0), (800.0, 680.0));
        assert!(scrollbars_hidden((520.0, 650.0), options));
        assert!(!scrollbars_hidden((520.0, 700.0), options));
    }

    #[test]
    fn a_window_is_never_larger_than_its_content_in_device_pixels() {
        // 372.4 css px at 125% is 465.5 device px: the window gets 465, not 466.
        let (width, height) = align_to_device((300.0, 372.0), 1.25);
        assert!((width * 1.25 - 375.0).abs() < 1e-9);
        assert!((height * 1.25 - 465.0).abs() < 1e-9);
        assert_eq!(align_to_device((300.0, 180.0), 1.0), (300.0, 180.0));
        assert_eq!(align_to_device((300.0, 180.0), 0.0), (300.0, 180.0));
        for scale in [1.0, 1.25, 1.5, 1.75, 2.0] {
            let (w, h) = align_to_device((405.7, 373.9), scale);
            assert!(w <= 405.7 && h <= 373.9, "{scale}");
            assert!((w * scale - (w * scale).round()).abs() < 1e-9);
        }
    }

    #[test]
    fn a_measurement_is_two_finite_positive_numbers() {
        let ok = json!({ "result": { "value": { "width": 405, "height": 373 } } });
        assert_eq!(parse_measurement(&ok), Some((405.0, 373.0)));
        for bad in [
            json!({ "result": { "value": null } }),
            json!({ "result": { "value": { "width": 0, "height": 10 } } }),
            json!({ "result": { "value": { "width": "9", "height": 10 } } }),
            json!({ "exceptionDetails": {} }),
        ] {
            assert_eq!(parse_measurement(&bad), None, "{bad}");
        }
    }

    #[test]
    fn a_sizer_keeps_to_the_limits_it_was_given() {
        let mut sizer = Sizer::with_bounds(((320.0, 240.0), (800.0, 680.0)));
        let inner = (520.0, 600.0);
        assert_eq!(sizer.observe(inner, (100.0, 100.0)), None);
        assert_eq!(sizer.observe(inner, (100.0, 100.0)), Some((320.0, 240.0)));
    }

    #[test]
    fn a_size_must_be_seen_twice_before_the_window_moves() {
        let mut sizer = Sizer::default();
        let inner = (420.0, 560.0);
        assert_eq!(
            sizer.observe(inner, (405.0, 373.0)),
            None,
            "first sighting only"
        );
        assert_eq!(sizer.observe(inner, (405.0, 373.0)), Some((405.0, 373.0)));
        // Settled: nothing more to do.
        assert_eq!(sizer.observe((405.0, 373.0), (405.0, 373.0)), None);
    }

    #[test]
    fn a_page_still_laying_out_does_not_make_the_window_jump() {
        let mut sizer = Sizer::default();
        let inner = (420.0, 560.0);
        assert_eq!(sizer.observe(inner, (405.0, 200.0)), None);
        assert_eq!(sizer.observe(inner, (405.0, 300.0)), None);
        assert_eq!(sizer.observe(inner, (405.0, 373.0)), None);
        assert_eq!(sizer.observe(inner, (405.0, 373.0)), Some((405.0, 373.0)));
    }

    #[test]
    fn a_page_that_already_fits_is_left_alone() {
        let mut sizer = Sizer::default();
        for _ in 0..5 {
            assert_eq!(sizer.observe((420.0, 560.0), (419.0, 559.0)), None);
        }
    }

    #[test]
    fn growth_after_the_first_size_is_followed() {
        let mut sizer = Sizer::default();
        sizer.observe((420.0, 560.0), (300.0, 200.0));
        assert_eq!(
            sizer.observe((420.0, 560.0), (300.0, 200.0)),
            Some((300.0, 200.0))
        );
        sizer.observe((300.0, 200.0), (300.0, 420.0));
        assert_eq!(
            sizer.observe((300.0, 200.0), (300.0, 420.0)),
            Some((300.0, 420.0))
        );
    }

    #[test]
    fn once_the_user_resizes_the_window_it_is_never_touched_again() {
        let mut sizer = Sizer::default();
        sizer.observe((420.0, 560.0), (300.0, 200.0));
        assert_eq!(
            sizer.observe((420.0, 560.0), (300.0, 200.0)),
            Some((300.0, 200.0))
        );
        // The window is now 500x300: not what was set.
        assert_eq!(sizer.observe((500.0, 300.0), (300.0, 200.0)), None);
        assert!(sizer.finished());
        assert_eq!(sizer.observe((500.0, 300.0), (300.0, 650.0)), None);
        assert_eq!(sizer.observe((500.0, 300.0), (300.0, 650.0)), None);
    }

    #[test]
    fn the_measuring_script_is_a_fixed_read_only_constant() {
        assert!(!MEASURE_SCRIPT.contains("${") && !MEASURE_SCRIPT.contains('`'));
        for forbidden in [
            "innerHTML",
            "textContent",
            "value",
            "fetch(",
            "eval(",
            "postMessage",
        ] {
            // `value` appears only in the inspector's reply shape, not in this script.
            assert!(!MEASURE_SCRIPT.contains(forbidden), "{forbidden}");
        }
    }
}
