use std::collections::VecDeque;
use std::io::Write;
use std::sync::{LazyLock, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

const NOTIFICATION_EVENT: &str = "nebula-notification-broker";
const MAX_REPLAY_EVENTS: usize = 200;
const MAX_DIAGNOSTICS: usize = 200;
const MAX_RECENT_MARKERS: usize = 512;
const MAX_DIAGNOSTIC_LOG_BYTES: u64 = 1024 * 1024;
const RECENT_EVENT_WINDOW_MS: u64 = 2_500;
const RECENT_EVENT_RETENTION_MS: u64 = 10_000;
const CONTENT_ADAPTER_DELAY_MS: u64 = 300;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum NotificationSource {
    Webview2,
    ContentAdapter,
    TitleFallback,
}

#[derive(Clone, Debug)]
pub struct NotificationCandidate {
    pub tab_label: String,
    pub origin: String,
    pub title: String,
    pub body: String,
    pub icon_url: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerNotification {
    pub id: String,
    pub sequence: u64,
    pub source: NotificationSource,
    pub tab_label: String,
    pub origin: String,
    pub title: String,
    pub body: String,
    pub icon_url: String,
    pub timestamp_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationDiagnostic {
    pub timestamp_ms: u64,
    pub sequence: Option<u64>,
    pub source: Option<NotificationSource>,
    pub stage: String,
    pub decision: String,
    pub reason: String,
    pub tab_label: String,
    pub origin: String,
    pub error: String,
}

#[derive(Clone, Debug)]
struct AcceptedMarker {
    source: NotificationSource,
    tab_label: String,
    origin: String,
    fingerprint: String,
    timestamp_ms: u64,
}

struct BrokerState {
    session_id: String,
    next_sequence: u64,
    replay: VecDeque<BrokerNotification>,
    diagnostics: VecDeque<NotificationDiagnostic>,
    recent: VecDeque<AcceptedMarker>,
}

impl Default for BrokerState {
    fn default() -> Self {
        Self {
            session_id: format!("{}-{}", std::process::id(), timestamp_ms()),
            next_sequence: 1,
            replay: VecDeque::new(),
            diagnostics: VecDeque::new(),
            recent: VecDeque::new(),
        }
    }
}

static BROKER: LazyLock<Mutex<BrokerState>> = LazyLock::new(|| Mutex::new(BrokerState::default()));
static DIAGNOSTIC_APP: OnceLock<AppHandle> = OnceLock::new();
static DIAGNOSTIC_LOG: Mutex<()> = Mutex::new(());

fn timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn truncate(value: &str, max_chars: usize) -> String {
    value.trim().chars().take(max_chars).collect()
}

fn normalized_origin(value: &str) -> Option<String> {
    let parsed = url::Url::parse(value).ok()?;
    matches!(parsed.scheme(), "http" | "https").then(|| parsed.origin().ascii_serialization())
}

fn diagnostic_origin(value: &str) -> String {
    if value.trim().is_empty() {
        String::new()
    } else {
        normalized_origin(value).unwrap_or_else(|| "<invalid-origin>".to_string())
    }
}

fn diagnostic_error(value: &str) -> String {
    truncate(&crate::redact_inline_log_secrets(value), 1_000)
}

fn persist_diagnostic(app: &AppHandle, diagnostic: &NotificationDiagnostic) -> Result<(), String> {
    let _guard = DIAGNOSTIC_LOG
        .lock()
        .map_err(|_| "notification broker log lock was poisoned".to_string())?;
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&log_dir).map_err(|error| error.to_string())?;
    let path = log_dir.join("notification-broker.jsonl");
    if path
        .metadata()
        .map(|metadata| metadata.len() >= MAX_DIAGNOSTIC_LOG_BYTES)
        .unwrap_or(false)
    {
        let rotated = log_dir.join("notification-broker.jsonl.1");
        let _ = std::fs::remove_file(&rotated);
        std::fs::rename(&path, rotated).map_err(|error| error.to_string())?;
    }
    let serialized = serde_json::to_string(diagnostic).map_err(|error| error.to_string())?;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    writeln!(file, "{serialized}").map_err(|error| error.to_string())
}

fn notification_fingerprint(title: &str, body: &str) -> String {
    [title, body]
        .into_iter()
        .map(|value| {
            value
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .to_ascii_lowercase()
        })
        .collect::<Vec<_>>()
        .join("\0")
}

#[allow(clippy::too_many_arguments)]
fn record_diagnostic(
    source: Option<NotificationSource>,
    stage: &str,
    decision: &str,
    reason: &str,
    tab_label: &str,
    origin: &str,
    sequence: Option<u64>,
    error: &str,
) {
    let diagnostic = NotificationDiagnostic {
        timestamp_ms: timestamp_ms(),
        sequence,
        source,
        stage: stage.to_string(),
        decision: decision.to_string(),
        reason: reason.to_string(),
        tab_label: truncate(tab_label, 240),
        origin: diagnostic_origin(origin),
        error: diagnostic_error(error),
    };
    match BROKER.lock() {
        Ok(mut broker) => {
            broker.diagnostics.push_back(diagnostic.clone());
            while broker.diagnostics.len() > MAX_DIAGNOSTICS {
                broker.diagnostics.pop_front();
            }
        }
        Err(error) => eprintln!("notification broker diagnostic lock failed: {error}"),
    }
    if let Some(app) = DIAGNOSTIC_APP.get() {
        if let Err(error) = persist_diagnostic(app, &diagnostic) {
            eprintln!("notification broker diagnostic log failed: {error}");
        }
    }
}

fn permission_decision(
    source: NotificationSource,
    tab_label: &str,
    origin: &str,
) -> (bool, bool, &'static str) {
    let policy = crate::webview_privacy::notification_delivery_policy(tab_label, origin);
    permission_decision_for_policy(source, policy)
}

fn permission_decision_for_policy(
    source: NotificationSource,
    policy: crate::webview_privacy::NotificationDeliveryPolicy,
) -> (bool, bool, &'static str) {
    if !policy.enabled {
        return (false, policy.show_content, "notifications-disabled");
    }
    if policy.explicitly_blocked {
        return (false, policy.show_content, "origin-blocked");
    }
    if source != NotificationSource::Webview2 && !policy.explicitly_allowed {
        return (false, policy.show_content, "fallback-origin-not-allowed");
    }
    (true, policy.show_content, "allowed")
}

pub fn permission_allows(source: NotificationSource, tab_label: &str, origin: &str) -> bool {
    permission_decision(source, tab_label, origin).0
}

fn dedupe_reason(
    state: &BrokerState,
    source: NotificationSource,
    tab_label: &str,
    origin: &str,
    fingerprint: &str,
    now_ms: u64,
) -> Option<&'static str> {
    let matches_recent = |marker: &&AcceptedMarker| {
        marker.tab_label == tab_label
            && marker.origin == origin
            && now_ms.saturating_sub(marker.timestamp_ms) <= RECENT_EVENT_WINDOW_MS
    };
    match source {
        NotificationSource::Webview2 => None,
        NotificationSource::ContentAdapter => state
            .recent
            .iter()
            .filter(|marker| matches_recent(marker))
            .any(|marker| {
                marker.source == NotificationSource::Webview2 && marker.fingerprint == fingerprint
            })
            .then_some("recent-webview2-authority"),
        NotificationSource::TitleFallback => state
            .recent
            .iter()
            .filter(|marker| matches_recent(marker))
            .any(|marker| marker.source != NotificationSource::TitleFallback)
            .then_some("recent-higher-authority-source"),
    }
}

fn notification_host(origin: &str) -> String {
    url::Url::parse(origin)
        .ok()
        .and_then(|url| url.host_str().map(str::to_ascii_lowercase))
        .unwrap_or_else(|| origin.to_string())
}

fn favicon_url(origin: &str) -> Option<String> {
    let host = notification_host(origin);
    if host.is_empty() {
        return None;
    }
    let mut url = url::Url::parse("https://www.google.com/s2/favicons").ok()?;
    url.query_pairs_mut()
        .append_pair("domain", &host)
        .append_pair("sz", "64");
    Some(url.to_string())
}

fn push_replay(state: &mut BrokerState, event: BrokerNotification) {
    state.replay.push_back(event);
    while state.replay.len() > MAX_REPLAY_EVENTS {
        state.replay.pop_front();
    }
}

fn broker_event_id(state: &BrokerState, sequence: u64) -> String {
    format!("site-broker-{}-{sequence}", state.session_id)
}

fn process_candidate(
    app: &AppHandle,
    source: NotificationSource,
    candidate: NotificationCandidate,
) {
    if !candidate.tab_label.starts_with("nebula-tab-") || candidate.tab_label.chars().count() > 240
    {
        record_diagnostic(
            Some(source),
            "candidate",
            "rejected",
            "invalid-tab-label",
            &candidate.tab_label,
            &candidate.origin,
            None,
            "",
        );
        return;
    }
    let Some(origin) = normalized_origin(&candidate.origin) else {
        record_diagnostic(
            Some(source),
            "candidate",
            "rejected",
            "invalid-origin",
            &candidate.tab_label,
            &candidate.origin,
            None,
            "",
        );
        return;
    };
    let now_ms = timestamp_ms();
    let fingerprint = notification_fingerprint(&candidate.title, &candidate.body);
    let (allowed, show_content, permission_reason) =
        permission_decision(source, &candidate.tab_label, &origin);
    record_diagnostic(
        Some(source),
        "permission",
        if allowed { "allowed" } else { "blocked" },
        permission_reason,
        &candidate.tab_label,
        &origin,
        None,
        "",
    );
    if !allowed {
        return;
    }

    let host = notification_host(&origin);
    let fallback_body = crate::tab_error_page::notification_activity_body();
    let title = if show_content {
        let candidate_title = truncate(&candidate.title, 300);
        if candidate_title.is_empty() {
            host.clone()
        } else {
            candidate_title
        }
    } else {
        host.clone()
    };
    let body = if show_content {
        let candidate_body = truncate(&candidate.body, 2_000);
        if candidate_body.is_empty() {
            fallback_body.clone()
        } else {
            candidate_body
        }
    } else {
        fallback_body
    };
    let icon_url = if show_content {
        truncate(&candidate.icon_url, 2_048)
    } else {
        String::new()
    };

    let event = match BROKER.lock() {
        Ok(mut broker) => {
            while broker.recent.front().is_some_and(|marker| {
                now_ms.saturating_sub(marker.timestamp_ms) > RECENT_EVENT_RETENTION_MS
            }) {
                broker.recent.pop_front();
            }
            if let Some(reason) = dedupe_reason(
                &broker,
                source,
                &candidate.tab_label,
                &origin,
                &fingerprint,
                now_ms,
            ) {
                drop(broker);
                record_diagnostic(
                    Some(source),
                    "dedupe",
                    "suppressed",
                    reason,
                    &candidate.tab_label,
                    &origin,
                    None,
                    "",
                );
                return;
            }

            let sequence = broker.next_sequence;
            broker.next_sequence = broker.next_sequence.saturating_add(1);
            let event = BrokerNotification {
                id: broker_event_id(&broker, sequence),
                sequence,
                source,
                tab_label: candidate.tab_label.clone(),
                origin: origin.clone(),
                title,
                body,
                icon_url,
                timestamp_ms: now_ms,
            };
            broker.recent.push_back(AcceptedMarker {
                source,
                tab_label: candidate.tab_label.clone(),
                origin: origin.clone(),
                fingerprint,
                timestamp_ms: now_ms,
            });
            while broker.recent.len() > MAX_RECENT_MARKERS {
                broker.recent.pop_front();
            }
            push_replay(&mut broker, event.clone());
            event
        }
        Err(error) => {
            eprintln!("notification broker state lock failed: {error}");
            return;
        }
    };

    let center_result = app.emit(NOTIFICATION_EVENT, event.clone());
    record_diagnostic(
        Some(source),
        "notification-center",
        if center_result.is_ok() {
            "delivered"
        } else {
            "failed"
        },
        if center_result.is_ok() {
            "event-emitted"
        } else {
            "event-error"
        },
        &event.tab_label,
        &event.origin,
        Some(event.sequence),
        &center_result
            .err()
            .map(|error| error.to_string())
            .unwrap_or_default(),
    );

    let toast_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let is_whatsapp = notification_host(&event.origin) == "web.whatsapp.com";
        let toast_title = if is_whatsapp {
            "WhatsApp".to_string()
        } else {
            event.title.clone()
        };
        let toast_body = if is_whatsapp && event.title != "web.whatsapp.com" {
            [event.title.as_str(), event.body.as_str()]
                .into_iter()
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
                .join("\n")
        } else {
            event.body.clone()
        };
        let result = crate::native_notification::show(
            &toast_app,
            &toast_title,
            &toast_body,
            Some(event.tab_label.clone()),
            Some(event.origin.clone()),
            None,
            favicon_url(&event.origin),
        )
        .await;
        record_diagnostic(
            Some(event.source),
            "windows-toast",
            if result.is_ok() {
                "delivered"
            } else {
                "failed"
            },
            if result.is_ok() {
                "toast-shown"
            } else {
                "toast-error"
            },
            &event.tab_label,
            &event.origin,
            Some(event.sequence),
            &result.err().unwrap_or_default(),
        );
    });
}

pub fn submit(app: &AppHandle, source: NotificationSource, candidate: NotificationCandidate) {
    let _ = DIAGNOSTIC_APP.set(app.clone());
    record_diagnostic(
        Some(source),
        "candidate",
        "received",
        "source-submitted",
        &candidate.tab_label,
        &candidate.origin,
        None,
        "",
    );
    if source == NotificationSource::ContentAdapter {
        let delayed_app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(CONTENT_ADAPTER_DELAY_MS)).await;
            process_candidate(&delayed_app, source, candidate);
        });
    } else {
        process_candidate(app, source, candidate);
    }
}

pub fn replay(app: &AppHandle, after_sequence: Option<u64>) -> Vec<BrokerNotification> {
    let _ = DIAGNOSTIC_APP.set(app.clone());
    let events: Vec<BrokerNotification> = BROKER
        .lock()
        .map(|broker| {
            broker
                .replay
                .iter()
                .filter(|event| after_sequence.map_or(true, |sequence| event.sequence > sequence))
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    record_diagnostic(
        None,
        "replay",
        "delivered",
        &format!("{}-events-replayed", events.len()),
        "",
        "",
        after_sequence,
        "",
    );
    events
}

pub fn diagnostics(limit: Option<usize>) -> Vec<NotificationDiagnostic> {
    let limit = limit.unwrap_or(50).clamp(1, MAX_DIAGNOSTICS);
    BROKER
        .lock()
        .map(|broker| {
            broker
                .diagnostics
                .iter()
                .rev()
                .take(limit)
                .cloned()
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect()
        })
        .unwrap_or_default()
}

pub fn record_click_routing(
    tab_label: Option<&str>,
    origin: Option<&str>,
    target_window_label: &str,
    delivered: bool,
    error: &str,
) {
    record_diagnostic(
        None,
        "click-routing",
        if delivered { "delivered" } else { "failed" },
        target_window_label,
        tab_label.unwrap_or_default(),
        origin.unwrap_or_default(),
        None,
        error,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn marker(source: NotificationSource, at: u64) -> AcceptedMarker {
        AcceptedMarker {
            source,
            tab_label: "nebula-tab-main-chat".to_string(),
            origin: "https://chat.example".to_string(),
            fingerprint: notification_fingerprint("Chat", "Message"),
            timestamp_ms: at,
        }
    }

    fn event(sequence: u64) -> BrokerNotification {
        BrokerNotification {
            id: format!("site-broker-{sequence}"),
            sequence,
            source: NotificationSource::Webview2,
            tab_label: "nebula-tab-main-chat".to_string(),
            origin: "https://chat.example".to_string(),
            title: "Chat".to_string(),
            body: "Message".to_string(),
            icon_url: String::new(),
            timestamp_ms: sequence,
        }
    }

    #[test]
    fn identical_authoritative_events_are_never_text_deduped() {
        let state = BrokerState::default();
        assert_eq!(
            dedupe_reason(
                &state,
                NotificationSource::Webview2,
                "nebula-tab-main-chat",
                "https://chat.example",
                &notification_fingerprint("Chat", "Message"),
                1_000,
            ),
            None
        );
    }

    #[test]
    fn content_adapter_yields_to_recent_webview2_authority() {
        let mut state = BrokerState::default();
        state
            .recent
            .push_back(marker(NotificationSource::Webview2, 1_000));
        assert_eq!(
            dedupe_reason(
                &state,
                NotificationSource::ContentAdapter,
                "nebula-tab-main-chat",
                "https://chat.example",
                &notification_fingerprint("Chat", "Message"),
                1_200,
            ),
            Some("recent-webview2-authority")
        );
    }

    #[test]
    fn distinct_content_adapter_message_is_not_suppressed_by_an_older_native_event() {
        let mut state = BrokerState::default();
        state
            .recent
            .push_back(marker(NotificationSource::Webview2, 1_000));
        assert_eq!(
            dedupe_reason(
                &state,
                NotificationSource::ContentAdapter,
                "nebula-tab-main-chat",
                "https://chat.example",
                &notification_fingerprint("Chat", "Different message"),
                1_200,
            ),
            None
        );
    }

    #[test]
    fn title_fallback_yields_to_any_recent_higher_authority_source() {
        let mut state = BrokerState::default();
        state
            .recent
            .push_back(marker(NotificationSource::ContentAdapter, 1_000));
        assert_eq!(
            dedupe_reason(
                &state,
                NotificationSource::TitleFallback,
                "nebula-tab-main-chat",
                "https://chat.example",
                &notification_fingerprint("Chat", "Message"),
                1_300,
            ),
            Some("recent-higher-authority-source")
        );
    }

    #[test]
    fn replay_buffer_keeps_only_the_latest_two_hundred_events() {
        let mut state = BrokerState::default();
        for sequence in 1..=205 {
            push_replay(&mut state, event(sequence));
        }
        assert_eq!(state.replay.len(), MAX_REPLAY_EVENTS);
        assert_eq!(state.replay.front().map(|event| event.sequence), Some(6));
        assert_eq!(state.replay.back().map(|event| event.sequence), Some(205));
    }

    #[test]
    fn webview2_uses_the_browser_permission_result_for_default_origins() {
        let decision = permission_decision_for_policy(
            NotificationSource::Webview2,
            crate::webview_privacy::NotificationDeliveryPolicy {
                enabled: true,
                explicitly_allowed: false,
                explicitly_blocked: false,
                show_content: true,
            },
        );
        assert_eq!(decision, (true, true, "allowed"));
    }

    #[test]
    fn fallback_sources_require_an_explicit_origin_allow() {
        let policy = crate::webview_privacy::NotificationDeliveryPolicy {
            enabled: true,
            explicitly_allowed: false,
            explicitly_blocked: false,
            show_content: false,
        };
        assert_eq!(
            permission_decision_for_policy(NotificationSource::ContentAdapter, policy),
            (false, false, "fallback-origin-not-allowed")
        );
        assert_eq!(
            permission_decision_for_policy(NotificationSource::TitleFallback, policy),
            (false, false, "fallback-origin-not-allowed")
        );
    }

    #[test]
    fn explicit_allow_enables_fallback_sources() {
        let decision = permission_decision_for_policy(
            NotificationSource::ContentAdapter,
            crate::webview_privacy::NotificationDeliveryPolicy {
                enabled: true,
                explicitly_allowed: true,
                explicitly_blocked: false,
                show_content: true,
            },
        );
        assert_eq!(decision, (true, true, "allowed"));
    }

    #[test]
    fn explicit_block_wins_for_every_source() {
        let policy = crate::webview_privacy::NotificationDeliveryPolicy {
            enabled: true,
            explicitly_allowed: true,
            explicitly_blocked: true,
            show_content: true,
        };
        for source in [
            NotificationSource::Webview2,
            NotificationSource::ContentAdapter,
            NotificationSource::TitleFallback,
        ] {
            assert_eq!(
                permission_decision_for_policy(source, policy),
                (false, true, "origin-blocked")
            );
        }
    }

    #[test]
    fn diagnostics_store_only_the_origin_without_paths_or_queries() {
        assert_eq!(
            diagnostic_origin("https://chat.example/private?token=secret"),
            "https://chat.example"
        );
        assert_eq!(diagnostic_origin("not a url"), "<invalid-origin>");
        assert_eq!(
            diagnostic_error("request failed: access_token=secret&status=500"),
            "request failed: access_token=[redacted]&status=500"
        );
    }

    #[test]
    fn persisted_notification_ids_are_scoped_to_the_broker_session() {
        let first = BrokerState {
            session_id: "process-a".to_string(),
            ..BrokerState::default()
        };
        let second = BrokerState {
            session_id: "process-b".to_string(),
            ..BrokerState::default()
        };
        assert_eq!(broker_event_id(&first, 1), "site-broker-process-a-1");
        assert_eq!(broker_event_id(&second, 1), "site-broker-process-b-1");
        assert_ne!(broker_event_id(&first, 1), broker_event_id(&second, 1));
    }
}
