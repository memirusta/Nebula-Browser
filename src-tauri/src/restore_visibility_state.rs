#[derive(Default)]
pub struct RestoreVisibilityState {
    target: Option<String>,
    hidden: bool,
}

impl RestoreVisibilityState {
    /// Called after a native stack operation has made its target visible.
    pub fn set_target(&mut self, target: Option<&str>) {
        self.target = target.map(str::to_owned);
        self.hidden = false;
    }

    pub fn action(&self, minimized: bool) -> Option<(String, bool)> {
        let target = self.target.as_ref()?;
        (self.hidden != minimized).then(|| (target.clone(), !minimized))
    }

    pub fn applied(&mut self, target: &str, visible: bool) {
        if self.target.as_deref() == Some(target) {
            self.hidden = !visible;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restore_shows_the_minimized_tab_without_a_renderer_callback() {
        let mut state = RestoreVisibilityState::default();
        state.set_target(Some("site"));
        assert_eq!(state.action(true), Some(("site".into(), false)));
        state.applied("site", false);
        assert_eq!(state.action(true), None);
        assert_eq!(state.action(false), Some(("site".into(), true)));
        state.applied("site", true);
        assert_eq!(state.action(false), None);
    }

    #[test]
    fn home_overlay_and_fullscreen_cancel_the_old_restore_target() {
        let mut state = RestoreVisibilityState::default();
        state.set_target(Some("site"));
        state.applied("site", false);
        state.set_target(None);
        assert_eq!(state.action(false), None);
        assert_eq!(state.action(true), None);
    }

    #[test]
    fn tab_change_cannot_restore_an_outgoing_tab() {
        let mut state = RestoreVisibilityState::default();
        state.set_target(Some("old"));
        state.applied("old", false);
        state.set_target(Some("new"));
        state.applied("old", false);
        assert_eq!(state.action(false), None);
        assert_eq!(state.action(true), Some(("new".into(), false)));
    }

    #[test]
    fn failed_show_remains_retryable() {
        let mut state = RestoreVisibilityState::default();
        state.set_target(Some("site"));
        state.applied("site", false);
        assert_eq!(state.action(false), state.action(false));
        assert_eq!(state.action(false), Some(("site".into(), true)));
    }
}
