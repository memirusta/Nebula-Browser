#[cfg(target_os = "windows")]
mod imp {
    use std::cell::RefCell;
    use std::collections::{HashMap, HashSet};
    use std::sync::{LazyLock, Mutex};

    use serde::Deserialize;
    use tauri::{AppHandle, Manager};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2IsDocumentPlayingAudioChangedEventHandler,
        ICoreWebView2NavigationStartingEventHandler, ICoreWebView2WebMessageReceivedEventArgs,
        ICoreWebView2WebMessageReceivedEventHandler, ICoreWebView2_8,
    };
    use webview2_com::{
        AddScriptToExecuteOnDocumentCreatedCompletedHandler, ExecuteScriptCompletedHandler,
        IsDocumentPlayingAudioChangedEventHandler, NavigationStartingEventHandler,
        WebMessageReceivedEventHandler,
    };
    use windows::Foundation::{TypedEventHandler, Uri};
    use windows_core::{Interface, BOOL, HSTRING, PCWSTR, PWSTR};

    use crate::media_session_bindings::{
        MediaPlaybackStatus, MediaPlaybackType, RandomAccessStreamReference,
        SystemMediaTransportControls, SystemMediaTransportControlsButton,
        SystemMediaTransportControlsButtonPressedEventArgs,
    };

    const MEDIA_BRIDGE_SCRIPT: &str = r#"
(function () {
  if (window.top !== window || window.__nebulaMediaSessionBridgeInstalled) return;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  window.__nebulaMediaSessionBridgeInstalled = true;
  const bridge = window.chrome && window.chrome.webview;
  if (!bridge) return;

  let lastSnapshot = '';
  let lastMediaElement = null;

  function clean(value, limit) {
    return typeof value === 'string' ? value.trim().slice(0, limit) : '';
  }

  function mediaElements() {
    return Array.from(document.querySelectorAll('audio, video'));
  }

  function report(activity) {
    const elements = mediaElements();
    const mediaSession = navigator.mediaSession || null;
    const metadata = mediaSession && mediaSession.metadata;
    const playbackState = mediaSession && mediaSession.playbackState;
    const playingElement = elements.find((item) => !item.paused && !item.ended);
    if (playingElement) lastMediaElement = playingElement;
    const hasMedia = Boolean(metadata) || elements.some((item) =>
      Boolean(item.currentSrc || item.src || item.readyState > 0)
    );
    const playing = playbackState === 'playing' || Boolean(playingElement);
    const artwork = metadata && Array.isArray(metadata.artwork)
      ? metadata.artwork.find((item) => item && typeof item.src === 'string')
      : null;
    let artworkUrl = '';
    try {
      if (artwork && artwork.src) artworkUrl = new URL(artwork.src, location.href).href;
    } catch (_) {}
    const payload = {
      type: 'nebula-media-session',
      version: 1,
      hasMedia,
      playing,
      activity: activity === true,
      title: clean(metadata && metadata.title, 512),
      artist: clean(metadata && metadata.artist, 256),
      album: clean(metadata && metadata.album, 256),
      artworkUrl: clean(artworkUrl, 2048)
    };
    const serialized = JSON.stringify(payload);
    if (!activity && serialized === lastSnapshot) return;
    lastSnapshot = serialized;
    try { bridge.postMessage(serialized); } catch (_) {}
  }

  document.addEventListener('play', (event) => {
    if (event.target instanceof HTMLMediaElement) lastMediaElement = event.target;
    report(true);
  }, true);
  document.addEventListener('playing', () => report(true), true);
  document.addEventListener('pause', () => report(false), true);
  document.addEventListener('ended', () => report(false), true);
  document.addEventListener('emptied', () => report(false), true);
  window.addEventListener('__nebulaMediaCommand', (event) => {
    const command = event && event.detail;
    const elements = mediaElements();
    if (command === 'pause') {
      for (const item of elements) {
        if (!item.paused && !item.ended) item.pause();
      }
    } else if (command === 'play') {
      const target =
        (lastMediaElement && document.contains(lastMediaElement) && lastMediaElement) ||
        elements.find((item) => Boolean(item.currentSrc || item.src));
      if (target) {
        const result = target.play();
        if (result && typeof result.catch === 'function') result.catch(() => {});
      }
    }
    setTimeout(() => report(true), 0);
  });
  setInterval(() => report(false), 1000);
  queueMicrotask(() => report(false));
})();
"#;

    #[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq)]
    #[serde(rename_all = "camelCase")]
    struct MediaSnapshot {
        #[serde(rename = "type")]
        kind: String,
        version: u8,
        has_media: bool,
        playing: bool,
        #[serde(default)]
        activity: bool,
        #[serde(default)]
        title: String,
        #[serde(default)]
        artist: String,
        #[serde(default)]
        album: String,
        #[serde(default)]
        artwork_url: String,
    }

    #[derive(Clone, Debug, Default, Eq, PartialEq)]
    struct MediaTabState {
        window_label: String,
        has_media: bool,
        playing: bool,
        title: String,
        artist: String,
        album: String,
        artwork_url: String,
        activity_sequence: u64,
    }

    #[derive(Default)]
    struct MediaCoordinator {
        tabs: HashMap<String, MediaTabState>,
        active_label: Option<String>,
        next_sequence: u64,
    }

    impl MediaCoordinator {
        fn selected(&self) -> Option<(String, MediaTabState)> {
            let label = self.active_label.as_ref()?;
            self.tabs
                .get(label)
                .cloned()
                .map(|state| (label.clone(), state))
        }

        fn best_playing(&self) -> Option<String> {
            self.tabs
                .iter()
                .filter(|(_, state)| state.playing)
                .max_by_key(|(label, state)| (state.activity_sequence, *label))
                .map(|(label, _)| label.clone())
        }

        fn best_available(&self) -> Option<String> {
            self.tabs
                .iter()
                .filter(|(_, state)| state.has_media)
                .max_by_key(|(label, state)| (state.activity_sequence, *label))
                .map(|(label, _)| label.clone())
        }

        fn reconcile_active(&mut self) {
            let active_is_playing = self
                .active_label
                .as_ref()
                .and_then(|label| self.tabs.get(label))
                .is_some_and(|state| state.playing);
            if active_is_playing {
                return;
            }
            self.active_label = self.best_playing().or_else(|| {
                self.active_label
                    .as_ref()
                    .filter(|label| self.tabs.get(*label).is_some_and(|state| state.has_media))
                    .cloned()
            });
            if self.active_label.is_none() {
                self.active_label = self.best_available();
            }
        }

        fn update_snapshot(&mut self, label: &str, window_label: &str, snapshot: MediaSnapshot) {
            if !snapshot.has_media {
                self.tabs.remove(label);
                self.reconcile_active();
                return;
            }

            let was_playing = self.tabs.get(label).is_some_and(|state| state.playing);
            if snapshot.activity || (snapshot.playing && !was_playing) {
                self.next_sequence = self.next_sequence.saturating_add(1);
            }
            let sequence = if snapshot.activity || (snapshot.playing && !was_playing) {
                self.next_sequence
            } else {
                self.tabs
                    .get(label)
                    .map(|state| state.activity_sequence)
                    .unwrap_or(self.next_sequence)
            };
            self.tabs.insert(
                label.to_string(),
                MediaTabState {
                    window_label: window_label.to_string(),
                    has_media: true,
                    playing: snapshot.playing,
                    title: snapshot.title,
                    artist: snapshot.artist,
                    album: snapshot.album,
                    artwork_url: snapshot.artwork_url,
                    activity_sequence: sequence,
                },
            );
            if snapshot.activity || (snapshot.playing && !was_playing) {
                self.active_label = Some(label.to_string());
            }
            self.reconcile_active();
        }

        fn update_native_playing(&mut self, label: &str, window_label: &str, playing: bool) {
            if !playing && !self.tabs.contains_key(label) {
                return;
            }
            let state = self.tabs.entry(label.to_string()).or_default();
            state.window_label = window_label.to_string();
            let became_playing = playing && !state.playing;
            state.playing = playing;
            state.has_media |= playing;
            if became_playing {
                self.next_sequence = self.next_sequence.saturating_add(1);
                state.activity_sequence = self.next_sequence;
                self.active_label = Some(label.to_string());
            }
            self.reconcile_active();
        }

        fn remove(&mut self, label: &str) {
            self.tabs.remove(label);
            self.reconcile_active();
        }
    }

    struct HandlerTokens {
        web_message: i64,
        navigation_starting: i64,
        audio_changed: i64,
    }

    struct Handlers {
        _web_message: ICoreWebView2WebMessageReceivedEventHandler,
        _navigation_starting: ICoreWebView2NavigationStartingEventHandler,
        _audio_changed: ICoreWebView2IsDocumentPlayingAudioChangedEventHandler,
    }

    struct TransportHost {
        window_label: String,
        controls: SystemMediaTransportControls,
        button_token: i64,
    }

    static CONFIGURED_LABELS: LazyLock<Mutex<HashSet<String>>> =
        LazyLock::new(|| Mutex::new(HashSet::new()));
    static HANDLER_TOKENS: LazyLock<Mutex<HashMap<String, HandlerTokens>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    static COORDINATOR: LazyLock<Mutex<MediaCoordinator>> =
        LazyLock::new(|| Mutex::new(MediaCoordinator::default()));
    static TRANSPORT: LazyLock<Mutex<Option<TransportHost>>> = LazyLock::new(|| Mutex::new(None));
    thread_local! {
        static HANDLERS: RefCell<HashMap<String, Handlers>> = RefCell::new(HashMap::new());
    }

    unsafe fn web_message_string(args: &ICoreWebView2WebMessageReceivedEventArgs) -> String {
        let mut value = PWSTR::null();
        if args.TryGetWebMessageAsString(&mut value).is_err() || value.is_null() {
            return String::new();
        }
        let message = value.to_string().unwrap_or_default();
        windows::Win32::System::Com::CoTaskMemFree(Some(value.as_ptr().cast()));
        message
    }

    fn bounded_snapshot(mut snapshot: MediaSnapshot) -> Option<MediaSnapshot> {
        if snapshot.kind != "nebula-media-session" || snapshot.version != 1 {
            return None;
        }
        snapshot.title.truncate(512);
        snapshot.artist.truncate(256);
        snapshot.album.truncate(256);
        snapshot.artwork_url.truncate(2048);
        if !snapshot.artwork_url.is_empty() {
            let valid_artwork = url::Url::parse(&snapshot.artwork_url).is_ok_and(|url| {
                url.scheme() == "https"
                    && url.username().is_empty()
                    && url.password().is_none()
                    && url.host_str().is_some()
            });
            if !valid_artwork {
                snapshot.artwork_url.clear();
            }
        }
        Some(snapshot)
    }

    fn execute_media_command(app: &AppHandle, label: String, command: &'static str) {
        let app_for_main = app.clone();
        let _ = app.run_on_main_thread(move || {
            let Some(webview) = app_for_main.get_webview(&label) else {
                return;
            };
            let script = HSTRING::from(format!(
                "window.dispatchEvent(new CustomEvent('__nebulaMediaCommand', {{ detail: '{}' }}));",
                command
            ));
            let _ = webview.with_webview(move |inner| unsafe {
                let Ok(core) = inner.controller().CoreWebView2() else {
                    return;
                };
                let handler =
                    ExecuteScriptCompletedHandler::create(Box::new(|_result, _value| Ok(())));
                let _ = core.ExecuteScript(PCWSTR(script.as_ptr()), &handler);
            });
        });
    }

    fn selected_media() -> Option<(String, MediaTabState)> {
        COORDINATOR
            .lock()
            .ok()
            .and_then(|coordinator| coordinator.selected())
    }

    fn create_transport(app: &AppHandle, window_label: &str) -> Result<TransportHost, String> {
        let window = app
            .get_window(window_label)
            .ok_or_else(|| format!("media window '{window_label}' not found"))?;
        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        let controls =
            SystemMediaTransportControls::for_window(hwnd).map_err(|error| error.to_string())?;
        let button_app = app.clone();
        let handler = TypedEventHandler::<
            SystemMediaTransportControls,
            SystemMediaTransportControlsButtonPressedEventArgs,
        >::new(move |_, args| {
            let Some(args) = args.as_ref() else {
                return Ok(());
            };
            let command = match args.button()? {
                SystemMediaTransportControlsButton::PLAY => "play",
                SystemMediaTransportControlsButton::PAUSE => "pause",
                _ => return Ok(()),
            };
            if let Some((label, _)) = selected_media() {
                execute_media_command(&button_app, label, command);
            }
            Ok(())
        });
        let button_token = controls
            .add_button_pressed(&handler)
            .map_err(|error| error.to_string())?;
        Ok(TransportHost {
            window_label: window_label.to_string(),
            controls,
            button_token,
        })
    }

    fn clear_transport(host: &TransportHost) {
        if let Ok(updater) = host.controls.display_updater() {
            let _ = updater.clear_all();
            let _ = updater.update();
        }
        let _ = host
            .controls
            .set_playback_status(MediaPlaybackStatus::CLOSED);
        let _ = host.controls.set_enabled(false);
    }

    fn artwork_reference(value: &str) -> Option<RandomAccessStreamReference> {
        if value.is_empty() {
            return None;
        }
        let uri = Uri::CreateUri(&HSTRING::from(value)).ok()?;
        RandomAccessStreamReference::from_uri(&uri).ok()
    }

    fn update_transport_metadata(
        controls: &SystemMediaTransportControls,
        state: &MediaTabState,
    ) -> Result<(), String> {
        let updater = controls
            .display_updater()
            .map_err(|error| error.to_string())?;
        updater.clear_all().map_err(|error| error.to_string())?;
        updater
            .set_type(MediaPlaybackType::MUSIC)
            .map_err(|error| error.to_string())?;
        let properties = updater
            .music_properties()
            .map_err(|error| error.to_string())?;
        if !state.title.is_empty() {
            properties
                .set_title(&state.title)
                .map_err(|error| error.to_string())?;
        }
        if !state.artist.is_empty() {
            properties
                .set_artist(&state.artist)
                .map_err(|error| error.to_string())?;
        }
        if !state.album.is_empty() {
            properties
                .set_album(&state.album)
                .map_err(|error| error.to_string())?;
        }
        let artwork = artwork_reference(&state.artwork_url);
        updater
            .set_thumbnail(artwork.as_ref())
            .map_err(|error| error.to_string())?;
        updater.update().map_err(|error| error.to_string())
    }

    fn sync_transport(app: &AppHandle) {
        let selected = selected_media();
        let Ok(mut slot) = TRANSPORT.lock() else {
            return;
        };
        let Some((_label, state)) = selected else {
            if let Some(host) = slot.take() {
                clear_transport(&host);
                let _ = host.controls.remove_button_pressed(host.button_token);
            }
            return;
        };

        let replace = slot
            .as_ref()
            .map_or(true, |host| host.window_label != state.window_label);
        if replace {
            if let Some(host) = slot.take() {
                clear_transport(&host);
                let _ = host.controls.remove_button_pressed(host.button_token);
            }
            match create_transport(app, &state.window_label) {
                Ok(host) => *slot = Some(host),
                Err(error) => {
                    let app = app.clone();
                    tauri::async_runtime::spawn_blocking(move || {
                        let _ = crate::write_transition_log(
                            app,
                            serde_json::json!({
                                "stage": "media.session",
                                "status": "transport-error",
                                "error": error,
                            }),
                        );
                    });
                    return;
                }
            }
        }

        if let Some(host) = slot.as_ref() {
            let _ = host.controls.set_play_enabled(true);
            let _ = host.controls.set_pause_enabled(true);
            let _ = update_transport_metadata(&host.controls, &state);
            let _ = host.controls.set_playback_status(if state.playing {
                MediaPlaybackStatus::PLAYING
            } else {
                MediaPlaybackStatus::PAUSED
            });
            let _ = host.controls.set_enabled(true);
        }
    }

    fn update_native_audio(app: &AppHandle, label: &str, media: &ICoreWebView2_8) {
        let mut playing = BOOL::default();
        if unsafe { media.IsDocumentPlayingAudio(&mut playing) }.is_err() {
            return;
        }
        let Some(window_label) = app
            .get_webview(label)
            .map(|webview| webview.window().label().to_string())
        else {
            return;
        };
        if let Ok(mut coordinator) = COORDINATOR.lock() {
            coordinator.update_native_playing(label, &window_label, playing.as_bool());
        }
        sync_transport(app);
    }

    pub fn setup(app: &AppHandle, label: &str) -> Result<(), String> {
        if !label.starts_with("nebula-tab-") {
            return Ok(());
        }
        if CONFIGURED_LABELS
            .lock()
            .map_err(|error| error.to_string())?
            .contains(label)
        {
            return Ok(());
        }

        let webview = app
            .get_webview(label)
            .ok_or_else(|| format!("webview '{label}' not found"))?;
        let window_label = webview.window().label().to_string();
        let setup_app = app.clone();
        let setup_label = label.to_string();
        let setup_window_label = window_label.clone();

        webview
            .with_webview(move |inner| unsafe {
                let Ok(core) = inner.controller().CoreWebView2() else {
                    return;
                };
                let Ok(media) = core.cast::<ICoreWebView2_8>() else {
                    return;
                };

                let message_app = setup_app.clone();
                let message_label = setup_label.clone();
                let message_window_label = setup_window_label.clone();
                let web_message =
                    WebMessageReceivedEventHandler::create(Box::new(move |sender, args| {
                        let (Some(sender), Some(args)) = (sender, args) else {
                            return Ok(());
                        };
                        if crate::site_ui::validated_web_message_source(&sender, &args).is_none() {
                            return Ok(());
                        }
                        let message = web_message_string(&args);
                        if message.len() > 4096 {
                            return Ok(());
                        }
                        let Some(snapshot) = serde_json::from_str::<MediaSnapshot>(&message)
                            .ok()
                            .and_then(bounded_snapshot)
                        else {
                            return Ok(());
                        };
                        let current_window_label = message_app
                            .get_webview(&message_label)
                            .map(|webview| webview.window().label().to_string())
                            .unwrap_or_else(|| message_window_label.clone());
                        if let Ok(mut coordinator) = COORDINATOR.lock() {
                            coordinator.update_snapshot(
                                &message_label,
                                &current_window_label,
                                snapshot,
                            );
                        }
                        sync_transport(&message_app);
                        Ok(())
                    }));

                let navigation_app = setup_app.clone();
                let navigation_label = setup_label.clone();
                let navigation_starting =
                    NavigationStartingEventHandler::create(Box::new(move |_sender, _args| {
                        if let Ok(mut coordinator) = COORDINATOR.lock() {
                            coordinator.remove(&navigation_label);
                        }
                        sync_transport(&navigation_app);
                        Ok(())
                    }));

                let audio_app = setup_app.clone();
                let audio_label = setup_label.clone();
                let audio_media = media.clone();
                let audio_changed = IsDocumentPlayingAudioChangedEventHandler::create(Box::new(
                    move |_sender, _args| {
                        update_native_audio(&audio_app, &audio_label, &audio_media);
                        Ok(())
                    },
                ));

                let mut web_message_token = 0;
                if core
                    .add_WebMessageReceived(&web_message, &mut web_message_token)
                    .is_err()
                {
                    return;
                }
                let mut navigation_token = 0;
                if core
                    .add_NavigationStarting(&navigation_starting, &mut navigation_token)
                    .is_err()
                {
                    let _ = core.remove_WebMessageReceived(web_message_token);
                    return;
                }
                let mut audio_token = 0;
                if media
                    .add_IsDocumentPlayingAudioChanged(&audio_changed, &mut audio_token)
                    .is_err()
                {
                    let _ = core.remove_WebMessageReceived(web_message_token);
                    let _ = core.remove_NavigationStarting(navigation_token);
                    return;
                }

                if let Ok(mut tokens) = HANDLER_TOKENS.lock() {
                    tokens.insert(
                        setup_label.clone(),
                        HandlerTokens {
                            web_message: web_message_token,
                            navigation_starting: navigation_token,
                            audio_changed: audio_token,
                        },
                    );
                }
                HANDLERS.with(|handlers| {
                    handlers.borrow_mut().insert(
                        setup_label.clone(),
                        Handlers {
                            _web_message: web_message,
                            _navigation_starting: navigation_starting,
                            _audio_changed: audio_changed,
                        },
                    );
                });

                let script = HSTRING::from(MEDIA_BRIDGE_SCRIPT);
                let execute_handler =
                    ExecuteScriptCompletedHandler::create(Box::new(|_result, _value| Ok(())));
                let _ = core.ExecuteScript(PCWSTR(script.as_ptr()), &execute_handler);
                let document_handler = AddScriptToExecuteOnDocumentCreatedCompletedHandler::create(
                    Box::new(|_result, _id| Ok(())),
                );
                let _ = core.AddScriptToExecuteOnDocumentCreated(
                    PCWSTR(script.as_ptr()),
                    &document_handler,
                );
                update_native_audio(&setup_app, &setup_label, &media);
            })
            .map_err(|error| error.to_string())?;

        let registered = HANDLER_TOKENS
            .lock()
            .map_err(|error| error.to_string())?
            .contains_key(label);
        if !registered {
            teardown(app, label);
            return Err(format!("failed to register media session for '{label}'"));
        }
        CONFIGURED_LABELS
            .lock()
            .map_err(|error| error.to_string())?
            .insert(label.to_string());
        Ok(())
    }

    pub fn teardown(app: &AppHandle, label: &str) {
        CONFIGURED_LABELS
            .lock()
            .ok()
            .map(|mut labels| labels.remove(label));
        let tokens = HANDLER_TOKENS
            .lock()
            .ok()
            .and_then(|mut tokens| tokens.remove(label));
        if let (Some(webview), Some(tokens)) = (app.get_webview(label), tokens) {
            let _ = webview.with_webview(move |inner| unsafe {
                let Ok(core) = inner.controller().CoreWebView2() else {
                    return;
                };
                let _ = core.remove_WebMessageReceived(tokens.web_message);
                let _ = core.remove_NavigationStarting(tokens.navigation_starting);
                if let Ok(media) = core.cast::<ICoreWebView2_8>() {
                    let _ = media.remove_IsDocumentPlayingAudioChanged(tokens.audio_changed);
                }
            });
        }
        HANDLERS.with(|handlers| {
            handlers.borrow_mut().remove(label);
        });
        if let Ok(mut coordinator) = COORDINATOR.lock() {
            coordinator.remove(label);
        }
        sync_transport(app);
    }

    #[cfg(test)]
    mod tests {
        use super::{MediaCoordinator, MediaSnapshot};

        fn snapshot(playing: bool, activity: bool, title: &str) -> MediaSnapshot {
            MediaSnapshot {
                kind: "nebula-media-session".to_string(),
                version: 1,
                has_media: true,
                playing,
                activity,
                title: title.to_string(),
                ..MediaSnapshot::default()
            }
        }

        #[test]
        fn most_recently_active_playing_tab_wins_deterministically() {
            let mut coordinator = MediaCoordinator::default();
            coordinator.update_snapshot("tab-a", "main", snapshot(true, true, "A"));
            coordinator.update_snapshot("tab-b", "main", snapshot(true, true, "B"));
            assert_eq!(
                coordinator.selected().map(|(label, _)| label),
                Some("tab-b".to_string())
            );

            coordinator.update_snapshot("tab-b", "main", snapshot(false, false, "B"));
            assert_eq!(
                coordinator.selected().map(|(label, _)| label),
                Some("tab-a".to_string())
            );
        }

        #[test]
        fn navigation_removes_stale_media_and_keeps_real_metadata_only() {
            let mut coordinator = MediaCoordinator::default();
            coordinator.update_snapshot("tab-a", "main", snapshot(false, true, "Real title"));
            let selected = coordinator.selected().unwrap();
            assert_eq!(selected.1.title, "Real title");
            assert!(selected.1.artist.is_empty());

            coordinator.remove("tab-a");
            assert!(coordinator.selected().is_none());
        }
    }
}

#[cfg(target_os = "windows")]
pub use imp::{setup, teardown};

#[cfg(target_os = "windows")]
pub fn configure_webview_environment() {
    const KEY: &str = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";
    const FEATURE: &str = "HardwareMediaKeyHandling";

    let mut arguments = std::env::var(KEY).unwrap_or_default();
    let already_disabled = arguments.split_whitespace().any(|argument| {
        argument
            .strip_prefix("--disable-features=")
            .is_some_and(|features| features.split(',').any(|feature| feature == FEATURE))
    });
    if already_disabled {
        return;
    }
    if !arguments.is_empty() {
        arguments.push(' ');
    }
    arguments.push_str("--disable-features=HardwareMediaKeyHandling");
    std::env::set_var(KEY, arguments);
}

#[cfg(target_os = "windows")]
pub fn initialize_process_identity() -> Result<(), String> {
    use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
    use windows_core::PCWSTR;

    let app_id: Vec<u16> = "com.nebula.browser\0".encode_utf16().collect();
    unsafe { SetCurrentProcessExplicitAppUserModelID(PCWSTR(app_id.as_ptr())) }
        .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "windows"))]
pub fn setup(_app: &tauri::AppHandle, _label: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn teardown(_app: &tauri::AppHandle, _label: &str) {}

#[cfg(not(target_os = "windows"))]
pub fn configure_webview_environment() {}

#[cfg(not(target_os = "windows"))]
pub fn initialize_process_identity() -> Result<(), String> {
    Ok(())
}
