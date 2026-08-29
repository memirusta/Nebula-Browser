use std::collections::{HashMap, VecDeque};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::io::Write;
use std::sync::{LazyLock, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

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
const WEBVIEW2_ENRICHMENT_DELAY_MS: u64 = 500;
const INSTAGRAM_DOM_FALLBACK_DELAY_MS: u64 = 700;
const SENDER_AVATAR_TTL: Duration = Duration::from_secs(30 * 60);
const MAX_SENDER_AVATARS: usize = 256;
const SENDER_MESSAGE_TTL: Duration = Duration::from_secs(10);
const MAX_SENDER_MESSAGES: usize = 128;
const TOAST_THREAD_WINDOW_MS: u64 = 2 * 60 * 1_000;
const MAX_TOAST_THREADS: usize = 128;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum NotificationSource {
    Webview2,
    ContentAdapter,
    TitleFallback,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContentAdapterKind {
    Dom,
    ServiceWorkerSnapshot,
}

#[derive(Clone, Debug)]
pub struct NotificationCandidate {
    pub tab_label: String,
    pub origin: String,
    pub title: String,
    pub body: String,
    pub icon_url: String,
    pub adapter_kind: Option<ContentAdapterKind>,
    pub notification_tag: String,
    pub notification_type: String,
    pub sender_name_hint: String,
    pub event_kind_hint: String,
    pub target_url: String,
    pub notification_data: Option<serde_json::Value>,
    pub timestamp_ms: Option<u64>,
    pub show_native_toast: bool,
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
    pub site_name: String,
    pub sender_name: String,
    pub event_kind: String,
    pub icon_url: String,
    pub notification_tag: String,
    pub notification_type: String,
    pub target_url: String,
    pub notification_data: Option<serde_json::Value>,
    pub timestamp_ms: u64,
    #[serde(skip)]
    show_native_toast: bool,
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
    adapter_kind: Option<ContentAdapterKind>,
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
static WHATSAPP_REPLY_HINTS: LazyLock<Mutex<HashMap<(String, String, String, String), Instant>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static BROKER: LazyLock<Mutex<BrokerState>> = LazyLock::new(|| Mutex::new(BrokerState::default()));
static SENDER_AVATARS: LazyLock<Mutex<HashMap<(String, String, String), SenderAvatar>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static SENDER_MESSAGES: LazyLock<Mutex<HashMap<(String, String, String), SenderMessage>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static TOAST_THREADS: LazyLock<Mutex<HashMap<String, ToastThread>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static DIAGNOSTIC_APP: OnceLock<AppHandle> = OnceLock::new();
static DIAGNOSTIC_LOG: Mutex<()> = Mutex::new(());

struct SenderAvatar {
    icon_url: String,
    observed_at: Instant,
}

struct SenderMessage {
    body: String,
    observed_at: Instant,
}

struct ToastThread {
    tab_label: String,
    count: u32,
    last_seen_ms: u64,
    generation: u64,
    presented: bool,
}
fn whatsapp_message_key(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

pub fn remember_whatsapp_reply_hint(tab_label: &str, origin: &str, sender_name: &str, body: &str) {
    let Some(origin) = whatsapp_origin(origin) else {
        return;
    };

    let sender = sender_identity_key(sender_name);
    let body = whatsapp_message_key(body);

    if tab_label.is_empty() || sender.is_empty() || body.is_empty() {
        return;
    }

    if let Ok(mut hints) = WHATSAPP_REPLY_HINTS.lock() {
        let now = Instant::now();

        hints.retain(|_, observed_at| now.duration_since(*observed_at) <= Duration::from_secs(3));

        hints.insert((tab_label.to_string(), origin, sender, body), now);
    }
}

fn take_whatsapp_reply_hint(tab_label: &str, origin: &str, sender_name: &str, body: &str) -> bool {
    let sender = sender_identity_key(sender_name);
    let body = whatsapp_message_key(body);

    let Ok(mut hints) = WHATSAPP_REPLY_HINTS.lock() else {
        return false;
    };

    let now = Instant::now();

    hints.retain(|_, observed_at| now.duration_since(*observed_at) <= Duration::from_secs(3));

    hints
        .remove(&(tab_label.to_string(), origin.to_string(), sender, body))
        .is_some()
}
fn timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn truncate(value: &str, max_chars: usize) -> String {
    value.trim().chars().take(max_chars).collect()
}

fn sender_identity_key(value: &str) -> String {
    value
        .chars()
        .flat_map(char::to_lowercase)
        .filter(|character| character.is_alphanumeric())
        .take(80)
        .collect()
}

fn trusted_sender_avatar(origin: &str, icon_url: &str) -> Option<(String, String)> {
    let origin = normalized_origin(origin)?;
    let origin_url = url::Url::parse(&origin).ok()?;
    let origin_host = origin_url.host_str()?.to_ascii_lowercase();
    if origin_url.scheme() != "https"
        || !(origin_host == "instagram.com" || origin_host.ends_with(".instagram.com"))
    {
        return None;
    }

    let icon_url = url::Url::parse(icon_url).ok()?;
    let icon_host = icon_url.host_str()?.to_ascii_lowercase();
    let trusted_host = [
        "instagram.com",
        "cdninstagram.com",
        "fbcdn.net",
        "facebook.com",
    ]
    .iter()
    .any(|domain| icon_host == *domain || icon_host.ends_with(&format!(".{domain}")));
    (icon_url.scheme() == "https" && trusted_host)
        .then(|| (origin, truncate(icon_url.as_str(), 2_048)))
}

pub fn remember_sender_avatar(tab_label: &str, origin: &str, sender_name: &str, icon_url: &str) {
    let sender_key = sender_identity_key(sender_name);
    let Some((origin, icon_url)) = trusted_sender_avatar(origin, icon_url) else {
        return;
    };
    if tab_label.is_empty() || tab_label.chars().count() > 160 || sender_key.is_empty() {
        return;
    }

    if let Ok(mut avatars) = SENDER_AVATARS.lock() {
        let now = Instant::now();
        avatars.retain(|_, avatar| now.duration_since(avatar.observed_at) <= SENDER_AVATAR_TTL);
        if avatars.len() >= MAX_SENDER_AVATARS {
            if let Some(oldest_key) = avatars
                .iter()
                .min_by_key(|(_, avatar)| avatar.observed_at)
                .map(|(key, _)| key.clone())
            {
                avatars.remove(&oldest_key);
            }
        }
        avatars.insert(
            (tab_label.to_string(), origin, sender_key),
            SenderAvatar {
                icon_url,
                observed_at: now,
            },
        );
    }
}

fn sender_avatar_hint(tab_label: &str, origin: &str, sender_name: &str) -> Option<String> {
    let sender_key = sender_identity_key(sender_name);
    if sender_key.is_empty() {
        return None;
    }
    let mut avatars = SENDER_AVATARS.lock().ok()?;
    let now = Instant::now();
    avatars.retain(|_, avatar| now.duration_since(avatar.observed_at) <= SENDER_AVATAR_TTL);
    avatars
        .get(&(tab_label.to_string(), origin.to_string(), sender_key))
        .map(|avatar| avatar.icon_url.clone())
}

fn instagram_origin(origin: &str) -> Option<String> {
    let origin = normalized_origin(origin)?;
    let parsed = url::Url::parse(&origin).ok()?;
    let host = parsed.host_str()?.to_ascii_lowercase();
    (parsed.scheme() == "https" && (host == "instagram.com" || host.ends_with(".instagram.com")))
        .then_some(origin)
}

fn whatsapp_origin(origin: &str) -> Option<String> {
    let origin = normalized_origin(origin)?;
    let parsed = url::Url::parse(&origin).ok()?;
    let host = parsed.host_str()?.to_ascii_lowercase();

    (parsed.scheme() == "https" && (host == "web.whatsapp.com" || host.ends_with(".whatsapp.com")))
        .then_some(origin)
}

pub fn remember_sender_message(tab_label: &str, origin: &str, sender_name: &str, body: &str) {
    let sender_key = sender_identity_key(sender_name);
    let Some(origin) = instagram_origin(origin) else {
        return;
    };
    let body = truncate(body, 500);
    if tab_label.is_empty()
        || tab_label.chars().count() > 160
        || sender_key.is_empty()
        || body.is_empty()
    {
        return;
    }

    if let Ok(mut messages) = SENDER_MESSAGES.lock() {
        let now = Instant::now();
        messages.retain(|_, message| now.duration_since(message.observed_at) <= SENDER_MESSAGE_TTL);
        if messages.len() >= MAX_SENDER_MESSAGES {
            if let Some(oldest_key) = messages
                .iter()
                .min_by_key(|(_, message)| message.observed_at)
                .map(|(key, _)| key.clone())
            {
                messages.remove(&oldest_key);
            }
        }
        messages.insert(
            (tab_label.to_string(), origin, sender_key),
            SenderMessage {
                body,
                observed_at: now,
            },
        );
    }
}

fn sender_message_hint(tab_label: &str, origin: &str, sender_name: &str) -> Option<String> {
    let sender_key = sender_identity_key(sender_name);
    if sender_key.is_empty() {
        return None;
    }
    let mut messages = SENDER_MESSAGES.lock().ok()?;
    let now = Instant::now();
    messages.retain(|_, message| now.duration_since(message.observed_at) <= SENDER_MESSAGE_TTL);
    messages
        .get(&(tab_label.to_string(), origin.to_string(), sender_key))
        .map(|message| message.body.clone())
}

fn toast_thread_tag(tab_label: &str, origin: &str, sender_name: &str) -> String {
    let mut hasher = DefaultHasher::new();
    tab_label.hash(&mut hasher);
    origin.hash(&mut hasher);
    sender_identity_key(sender_name).hash(&mut hasher);
    format!("conversation-{:016x}", hasher.finish())
}

fn update_toast_thread(
    tab_label: &str,
    origin: &str,
    sender_name: &str,
    event_kind: &str,
    timestamp_ms: u64,
) -> (Option<String>, Option<u64>, u32) {
    if sender_name.is_empty() || !matches!(event_kind, "message" | "reply") {
        return (None, None, 0);
    }
    let tag = toast_thread_tag(tab_label, origin, sender_name);
    let Ok(mut threads) = TOAST_THREADS.lock() else {
        return (None, None, 0);
    };
    threads.retain(|_, thread| {
        timestamp_ms.saturating_sub(thread.last_seen_ms) <= TOAST_THREAD_WINDOW_MS
    });
    if threads.len() >= MAX_TOAST_THREADS && !threads.contains_key(&tag) {
        if let Some(oldest_tag) = threads
            .iter()
            .min_by_key(|(_, thread)| thread.last_seen_ms)
            .map(|(tag, _)| tag.clone())
        {
            threads.remove(&oldest_tag);
        }
    }
    let thread = threads.entry(tag.clone()).or_insert(ToastThread {
        tab_label: tab_label.to_string(),
        count: 0,
        last_seen_ms: timestamp_ms,
        generation: 0,
        presented: false,
    });
    if timestamp_ms.saturating_sub(thread.last_seen_ms) > TOAST_THREAD_WINDOW_MS {
        thread.count = 0;
    }
    thread.count = thread.count.saturating_add(1);
    thread.last_seen_ms = timestamp_ms;
    thread.generation = thread.generation.saturating_add(1);
    (
        Some(tag),
        Some(thread.generation),
        thread.count.saturating_sub(1),
    )
}

pub fn reset_toast_thread(tag: &str) {
    if let Ok(mut threads) = TOAST_THREADS.lock() {
        threads.remove(tag);
    }
}

pub fn reset_toast_threads_for_tab(tab_label: &str) {
    if let Ok(mut threads) = TOAST_THREADS.lock() {
        threads.retain(|_, thread| thread.tab_label != tab_label);
    }
}

pub fn restart_toast_thread(tag: &str, generation: u64) {
    if let Ok(mut threads) = TOAST_THREADS.lock() {
        if let Some(thread) = threads
            .get_mut(tag)
            .filter(|thread| thread.generation == generation)
        {
            // Windows no longer has the toast (it was read, dismissed, or
            // expired). The message being shown now becomes the first message
            // of a fresh visible thread; the next one can update it in place.
            thread.count = 1;
            thread.last_seen_ms = timestamp_ms();
            thread.presented = false;
        }
    }
}

pub fn toast_thread_is_presented(tag: &str, generation: u64) -> bool {
    TOAST_THREADS
        .lock()
        .ok()
        .and_then(|threads| {
            threads
                .get(tag)
                .filter(|thread| thread.generation == generation)
                .map(|thread| thread.presented)
        })
        .unwrap_or(false)
}

pub fn mark_toast_thread_presented(tag: &str, generation: u64) {
    if let Ok(mut threads) = TOAST_THREADS.lock() {
        if let Some(thread) = threads
            .get_mut(tag)
            .filter(|thread| thread.generation == generation)
        {
            thread.presented = true;
        }
    }
}

pub fn toast_generation_is_current(tag: &str, generation: u64) -> bool {
    TOAST_THREADS
        .lock()
        .ok()
        .and_then(|threads| {
            threads
                .get(tag)
                .map(|thread| thread.generation == generation)
        })
        .unwrap_or(false)
}

fn normalized_origin(value: &str) -> Option<String> {
    let parsed = url::Url::parse(value).ok()?;
    matches!(parsed.scheme(), "http" | "https").then(|| parsed.origin().ascii_serialization())
}

fn normalized_target_url(origin: &str, value: &str) -> String {
    let Ok(origin_url) = url::Url::parse(origin) else {
        return String::new();
    };
    let Ok(target) = url::Url::parse(value) else {
        return String::new();
    };
    if target.scheme() != "https" {
        return String::new();
    }

    let origin_host = origin_url
        .host_str()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let target_host = target.host_str().unwrap_or_default().to_ascii_lowercase();
    let same_origin = target.origin() == origin_url.origin();
    let instagram_target = (origin_host == "instagram.com"
        || origin_host.ends_with(".instagram.com"))
        && (target_host == "instagram.com" || target_host.ends_with(".instagram.com"));
    if same_origin || instagram_target {
        truncate(target.as_str(), 2_048)
    } else {
        String::new()
    }
}

fn bounded_notification_data(value: Option<serde_json::Value>) -> Option<serde_json::Value> {
    value.filter(|data| {
        !data.is_null()
            && serde_json::to_vec(data).is_ok_and(|serialized| serialized.len() <= 8 * 1024)
    })
}

fn notification_metadata(
    show_content: bool,
    origin: &str,
    candidate: &NotificationCandidate,
) -> (String, String, String, Option<serde_json::Value>) {
    if !show_content {
        return (String::new(), String::new(), String::new(), None);
    }

    (
        truncate(&candidate.notification_tag, 300),
        truncate(&candidate.notification_type, 120),
        normalized_target_url(origin, &candidate.target_url),
        bounded_notification_data(candidate.notification_data.clone()),
    )
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

pub fn permission_allows_rich_content(
    source: NotificationSource,
    tab_label: &str,
    origin: &str,
) -> bool {
    let (allowed, show_content, _) = permission_decision(source, tab_label, origin);
    allowed && show_content
}

fn dedupe_reason(
    state: &BrokerState,
    source: NotificationSource,
    adapter_kind: Option<ContentAdapterKind>,
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
        NotificationSource::ContentAdapter => {
            let matching: Vec<_> = state
                .recent
                .iter()
                .filter(|marker| matches_recent(marker))
                .collect();
            if matching.iter().any(|marker| {
                marker.source == NotificationSource::Webview2
                    && (marker.fingerprint == fingerprint
                        || (adapter_kind == Some(ContentAdapterKind::Dom)
                            && instagram_origin(origin).is_some()))
            }) {
                Some("recent-webview2-authority")
            } else if adapter_kind == Some(ContentAdapterKind::Dom)
                && matching.iter().any(|marker| {
                    marker.source == NotificationSource::ContentAdapter
                        && marker.adapter_kind == Some(ContentAdapterKind::ServiceWorkerSnapshot)
                })
            {
                Some("recent-service-worker-snapshot-authority")
            } else if matching.iter().any(|marker| {
                marker.source == NotificationSource::ContentAdapter
                    && marker.fingerprint == fingerprint
            }) {
                Some("recent-content-adapter-duplicate")
            } else {
                None
            }
        }
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

#[derive(Debug, PartialEq, Eq)]
struct NotificationPresentation {
    site_name: String,
    sender_name: String,
    event_kind: String,
}

fn notification_site_name(origin: &str) -> String {
    let host = notification_host(origin);
    if host == "instagram.com" || host.ends_with(".instagram.com") {
        "Instagram".to_string()
    } else if host == "web.whatsapp.com" || host.ends_with(".whatsapp.com") {
        "WhatsApp".to_string()
    } else if host == "messenger.com" || host.ends_with(".messenger.com") {
        "Messenger".to_string()
    } else if host == "facebook.com" || host.ends_with(".facebook.com") {
        "Facebook".to_string()
    } else if host == "x.com" || host.ends_with(".x.com") || host.ends_with(".twitter.com") {
        "X".to_string()
    } else if host == "mail.google.com" {
        "Gmail".to_string()
    } else if host == "youtube.com" || host.ends_with(".youtube.com") {
        "YouTube".to_string()
    } else if host == "discord.com" || host.ends_with(".discord.com") {
        "Discord".to_string()
    } else if host == "linkedin.com" || host.ends_with(".linkedin.com") {
        "LinkedIn".to_string()
    } else if host == "reddit.com" || host.ends_with(".reddit.com") {
        "Reddit".to_string()
    } else if host == "tiktok.com" || host.ends_with(".tiktok.com") {
        "TikTok".to_string()
    } else {
        host.strip_prefix("www.").unwrap_or(&host).to_string()
    }
}

fn normalized_metadata_key(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn find_metadata_string(
    value: &serde_json::Value,
    accepted_keys: &[&str],
    depth: usize,
) -> Option<String> {
    if depth > 4 {
        return None;
    }
    match value {
        serde_json::Value::Object(values) => {
            for (key, value) in values {
                if accepted_keys.contains(&normalized_metadata_key(key).as_str()) {
                    if let Some(value) = value.as_str() {
                        let value = truncate(value, 120);
                        if !value.is_empty() {
                            return Some(value);
                        }
                    }
                }
            }
            values
                .values()
                .find_map(|value| find_metadata_string(value, accepted_keys, depth + 1))
        }
        serde_json::Value::Array(values) => values
            .iter()
            .find_map(|value| find_metadata_string(value, accepted_keys, depth + 1)),
        _ => None,
    }
}

fn collect_metadata_messages(
    value: &serde_json::Value,
    depth: usize,
    candidates: &mut Vec<(u16, String)>,
) {
    if depth > 6 {
        return;
    }
    const MESSAGE_KEYS: &[&str] = &[
        "message",
        "messagetext",
        "text",
        "content",
        "replytext",
        "replymessage",
        "itemtext",
        "preview",
        "previewtext",
        "messagepreview",
        "directmessage",
    ];
    match value {
        serde_json::Value::Object(values) => {
            for (key, value) in values {
                let normalized_key = normalized_metadata_key(key);
                if MESSAGE_KEYS.contains(&normalized_key.as_str()) {
                    if let Some(value) = value.as_str() {
                        let value = truncate(value, 500);
                        if !value.is_empty()
                            && !value.starts_with("http://")
                            && !value.starts_with("https://")
                            && !value.starts_with('{')
                            && !value.starts_with('[')
                        {
                            let key_score = match normalized_key.as_str() {
                                "replytext" | "replymessage" => 100,
                                "itemtext" | "directmessage" => 90,
                                "messagetext" => 80,
                                "content" | "text" => 70,
                                "preview" | "previewtext" | "messagepreview" => 50,
                                _ => 10,
                            };
                            candidates.push((key_score + depth.min(6) as u16 * 5, value));
                        }
                    }
                }
            }
            for value in values.values() {
                collect_metadata_messages(value, depth + 1, candidates);
            }
        }
        serde_json::Value::Array(values) => {
            for value in values {
                collect_metadata_messages(value, depth + 1, candidates);
            }
        }
        serde_json::Value::String(value) => {
            let value = value.trim();
            if value.len() <= 8_192 && (value.starts_with('{') || value.starts_with('[')) {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(value) {
                    collect_metadata_messages(&parsed, depth + 1, candidates);
                }
            }
        }
        _ => {}
    }
}

fn find_metadata_message(
    value: &serde_json::Value,
    notification_body: &str,
    sender_name: &str,
) -> Option<String> {
    let mut candidates = Vec::new();
    collect_metadata_messages(value, 0, &mut candidates);
    let body = notification_body.trim();
    let body_without_sender = (!sender_name.is_empty())
        .then(|| body.strip_prefix(sender_name).map(str::trim))
        .flatten()
        .unwrap_or(body);
    candidates
        .into_iter()
        .filter(|(_, candidate)| {
            !candidate.eq_ignore_ascii_case(body)
                && !candidate.eq_ignore_ascii_case(body_without_sender)
                && !matches!(
                    candidate.to_ascii_lowercase().as_str(),
                    "replied to you" | "replied to your message" | "yanıtladı" | "yanitladı"
                )
        })
        .max_by_key(|(score, _)| *score)
        .map(|(_, candidate)| candidate)
}

fn reply_display_body(body: &str, sender_name: &str, content_hint: Option<String>) -> String {
    let mut summary = body.trim();
    if !sender_name.is_empty() {
        summary = summary
            .strip_prefix(sender_name)
            .map(str::trim)
            .unwrap_or(summary);
    }

    let (summary, inline_content) = summary
        .split_once(':')
        .filter(|(prefix, content)| {
            !content.trim().is_empty()
                && ["replied", "reply", "yanıt", "yanit", "cevap"]
                    .iter()
                    .any(|keyword| prefix.to_lowercase().contains(keyword))
        })
        .map(|(prefix, content)| (prefix.trim(), Some(content.trim().to_string())))
        .unwrap_or((summary, None));
    let content = inline_content.or(content_hint).filter(|content| {
        let content = content.trim();
        !content.is_empty()
            && !content.eq_ignore_ascii_case(body.trim())
            && !content.eq_ignore_ascii_case(summary.trim())
    });
    match content {
        Some(content) => format!("{summary}\n{}", truncate(&content, 500)),
        None => summary.to_string(),
    }
}

fn sender_prefix(body: &str) -> Option<String> {
    let (prefix, _) = body.split_once(':')?;
    let prefix = truncate(prefix, 80);
    (!prefix.is_empty()
        && prefix.chars().any(char::is_alphabetic)
        && !prefix.contains("//")
        && !prefix.contains('\n'))
    .then_some(prefix)
}

fn notification_event_kind(notification_type: &str, body: &str) -> String {
    let notification_type = notification_type.to_lowercase();
    let body = body.to_lowercase();
    if ["replied", "reply", "yanıt", "yanit", "cevap"]
        .iter()
        .any(|keyword| body.contains(keyword))
    {
        "reply"
    } else if notification_type.contains("reaction") || notification_type.ends_with("_like") {
        "reaction"
    } else if notification_type.contains("mention") {
        "mention"
    } else if notification_type == "message" || notification_type.starts_with("direct_v2") {
        "message"
    } else if notification_type.contains("live_broadcast") {
        "live"
    } else if notification_type.contains("rtc") || notification_type.contains("call") {
        "call"
    } else if notification_type == "post" {
        "post"
    } else {
        "notification"
    }
    .to_string()
}

fn valid_event_kind_hint(value: &str) -> Option<String> {
    matches!(
        value,
        "message" | "reply" | "reaction" | "mention" | "live" | "call" | "post"
    )
    .then(|| value.to_string())
}

fn notification_presentation(
    show_content: bool,
    origin: &str,
    title: &str,
    body: &str,
    notification_type: &str,
    notification_data: Option<&serde_json::Value>,
) -> NotificationPresentation {
    let site_name = notification_site_name(origin);
    if !show_content {
        return NotificationPresentation {
            site_name,
            sender_name: String::new(),
            event_kind: String::new(),
        };
    }

    let metadata_sender = notification_data.and_then(|data| {
        find_metadata_string(
            data,
            &[
                "sendername",
                "senderusername",
                "username",
                "actorname",
                "fromname",
                "displayname",
                "profilename",
            ],
            0,
        )
    });
    let title = truncate(title, 120);
    let title_is_site = title.eq_ignore_ascii_case(&site_name)
        || title.eq_ignore_ascii_case(&notification_host(origin))
        || matches!(
            title.to_ascii_lowercase().as_str(),
            "notification" | "bildirim"
        );
    let sender_name = metadata_sender
        .or_else(|| (!title.is_empty() && !title_is_site).then_some(title))
        .or_else(|| sender_prefix(body))
        .unwrap_or_default();

    let mut event_kind = notification_event_kind(notification_type, body);

    if event_kind == "notification"
        && whatsapp_origin(origin).is_some()
        && !sender_name.is_empty()
        && !body.trim().is_empty()
    {
        event_kind = "message".to_string();
    }

    NotificationPresentation {
        site_name,
        sender_name,
        event_kind,
    }
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
    let received_at_ms = timestamp_ms();
    let event_timestamp_ms = candidate
        .timestamp_ms
        .filter(|timestamp| {
            *timestamp <= received_at_ms.saturating_add(5 * 60 * 1_000)
                && received_at_ms.saturating_sub(*timestamp) <= 7 * 24 * 60 * 60 * 1_000
        })
        .unwrap_or(received_at_ms);
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
    let mut body = if show_content {
        let candidate_body = truncate(&candidate.body, 2_000);
        if candidate_body.is_empty() {
            fallback_body.clone()
        } else {
            candidate_body
        }
    } else {
        fallback_body
    };
    let mut icon_url = if show_content {
        truncate(&candidate.icon_url, 2_048)
    } else {
        String::new()
    };
    let (notification_tag, notification_type, target_url, notification_data) =
        notification_metadata(show_content, &origin, &candidate);
    let mut presentation = notification_presentation(
        show_content,
        &origin,
        &title,
        &body,
        &notification_type,
        notification_data.as_ref(),
    );
    if show_content {
        let sender_name_hint = truncate(&candidate.sender_name_hint, 120);
        if !sender_name_hint.is_empty() {
            presentation.sender_name = sender_name_hint;
        }

        if let Some(event_kind_hint) = valid_event_kind_hint(&candidate.event_kind_hint) {
            presentation.event_kind = event_kind_hint;
        }

        let whatsapp_reply_hint = source == NotificationSource::Webview2
            && whatsapp_origin(&origin).is_some()
            && take_whatsapp_reply_hint(
                &candidate.tab_label,
                &origin,
                &presentation.sender_name,
                &body,
            );

        if whatsapp_reply_hint {
            let reply_text = body.clone();

            presentation.event_kind = "reply".to_string();

            body = reply_display_body(
                &format!("{} replied to you", presentation.sender_name),
                &presentation.sender_name,
                Some(reply_text),
            );
        }

        if let Some(sender_avatar) =
            sender_avatar_hint(&candidate.tab_label, &origin, &presentation.sender_name)
        {
            // Instagram commonly supplies its generic app icon even when the
            // sender avatar is already visible in the live conversation DOM.
            // A short-lived, same-tab avatar hint is more specific.
            icon_url = sender_avatar;
        }

        if presentation.event_kind == "reply" && !whatsapp_reply_hint {
            let content_hint = notification_data
                .as_ref()
                .and_then(|data| find_metadata_message(data, &body, &presentation.sender_name))
                .or_else(|| {
                    sender_message_hint(&candidate.tab_label, &origin, &presentation.sender_name)
                });

            body = reply_display_body(&body, &presentation.sender_name, content_hint);
        }
    }

    let event = match BROKER.lock() {
        Ok(mut broker) => {
            while broker.recent.front().is_some_and(|marker| {
                received_at_ms.saturating_sub(marker.timestamp_ms) > RECENT_EVENT_RETENTION_MS
            }) {
                broker.recent.pop_front();
            }
            if let Some(reason) = dedupe_reason(
                &broker,
                source,
                candidate.adapter_kind,
                &candidate.tab_label,
                &origin,
                &fingerprint,
                received_at_ms,
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
                site_name: presentation.site_name,
                sender_name: presentation.sender_name,
                event_kind: presentation.event_kind,
                icon_url,
                notification_tag,
                notification_type,
                target_url,
                notification_data,
                timestamp_ms: event_timestamp_ms,
                show_native_toast: candidate.show_native_toast,
            };
            broker.recent.push_back(AcceptedMarker {
                source,
                adapter_kind: candidate.adapter_kind,
                tab_label: candidate.tab_label.clone(),
                origin: origin.clone(),
                fingerprint,
                timestamp_ms: received_at_ms,
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

    if !event.show_native_toast {
        record_diagnostic(
            Some(event.source),
            "windows-toast",
            "skipped",
            "persistent-notification-upgraded-in-place",
            &event.tab_label,
            &event.origin,
            Some(event.sequence),
            "",
        );
        return;
    }

    let (toast_tag, toast_generation, additional_message_count) = update_toast_thread(
        &event.tab_label,
        &event.origin,
        &event.sender_name,
        &event.event_kind,
        received_at_ms,
    );

    let toast_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = crate::native_notification::show(
            &toast_app,
            &event.title,
            &event.body,
            Some(event.site_name.clone()),
            (!event.sender_name.is_empty()).then(|| event.sender_name.clone()),
            (!event.event_kind.is_empty()).then(|| event.event_kind.clone()),
            Some(event.tab_label.clone()),
            Some(event.origin.clone()),
            None,
            (!event.icon_url.is_empty())
                .then(|| event.icon_url.clone())
                .or_else(|| favicon_url(&event.origin)),
            toast_tag,
            toast_generation,
            additional_message_count,
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
    let is_instagram = instagram_origin(&candidate.origin).is_some();
    let is_whatsapp = whatsapp_origin(&candidate.origin).is_some();

    let delay_ms = if source == NotificationSource::ContentAdapter
        && candidate.adapter_kind != Some(ContentAdapterKind::ServiceWorkerSnapshot)
    {
        if is_instagram {
            Some(INSTAGRAM_DOM_FALLBACK_DELAY_MS)
        } else if is_whatsapp {
            // WhatsApp DOM carries sender/message/reply semantics.
            // Let it become authoritative before the native WebView2 event.
            None
        } else {
            Some(CONTENT_ADAPTER_DELAY_MS)
        }
    } else if source == NotificationSource::Webview2 {
        if is_instagram {
            Some(WEBVIEW2_ENRICHMENT_DELAY_MS)
        } else if is_whatsapp {
            // Give the rich DOM observer a short head start.
            Some(400)
        } else {
            None
        }
    } else {
        None
    };
    if let Some(delay_ms) = delay_ms {
        let delayed_app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
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
            adapter_kind: None,
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
            site_name: "chat.example".to_string(),
            sender_name: String::new(),
            event_kind: "notification".to_string(),
            icon_url: String::new(),
            notification_tag: String::new(),
            notification_type: String::new(),
            target_url: String::new(),
            notification_data: None,
            timestamp_ms: sequence,
            show_native_toast: true,
        }
    }

    #[test]
    fn identical_authoritative_events_are_never_text_deduped() {
        let state = BrokerState::default();
        assert_eq!(
            dedupe_reason(
                &state,
                NotificationSource::Webview2,
                None,
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
                Some(ContentAdapterKind::Dom),
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
                Some(ContentAdapterKind::Dom),
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
                None,
                "nebula-tab-main-chat",
                "https://chat.example",
                &notification_fingerprint("Chat", "Message"),
                1_300,
            ),
            Some("recent-higher-authority-source")
        );
    }

    #[test]
    fn dom_adapter_yields_to_a_recent_persistent_notification_snapshot() {
        let mut state = BrokerState::default();
        let mut persistent = marker(NotificationSource::ContentAdapter, 1_000);
        persistent.adapter_kind = Some(ContentAdapterKind::ServiceWorkerSnapshot);
        state.recent.push_back(persistent);
        assert_eq!(
            dedupe_reason(
                &state,
                NotificationSource::ContentAdapter,
                Some(ContentAdapterKind::Dom),
                "nebula-tab-main-chat",
                "https://chat.example",
                &notification_fingerprint("Conversation", "A richer DOM message"),
                1_300,
            ),
            Some("recent-service-worker-snapshot-authority")
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
    fn persistent_notification_targets_stay_on_the_trusted_site_family() {
        assert_eq!(
            normalized_target_url(
                "https://www.instagram.com",
                "https://call.instagram.com/?ig_thread_id=123"
            ),
            "https://call.instagram.com/?ig_thread_id=123"
        );
        assert!(normalized_target_url(
            "https://www.instagram.com",
            "https://attacker.example/direct/t/123"
        )
        .is_empty());
        assert!(normalized_target_url(
            "https://www.instagram.com",
            "http://www.instagram.com/direct/t/123"
        )
        .is_empty());
    }

    #[test]
    fn persistent_notification_data_is_size_bounded() {
        assert!(bounded_notification_data(Some(serde_json::json!({
            "notifType": "direct_v2_text"
        })))
        .is_some());
        assert!(bounded_notification_data(Some(serde_json::json!({
            "details": "x".repeat(9 * 1024)
        })))
        .is_none());
    }

    #[test]
    fn hidden_notification_content_redacts_persistent_metadata() {
        let candidate = NotificationCandidate {
            tab_label: "nebula-tab-instagram".to_string(),
            origin: "https://www.instagram.com".to_string(),
            title: "Instagram".to_string(),
            body: "Private message".to_string(),
            icon_url: "https://instagram.com/avatar.jpg".to_string(),
            adapter_kind: Some(ContentAdapterKind::ServiceWorkerSnapshot),
            notification_tag: "private-tag".to_string(),
            notification_type: "direct_v2_text".to_string(),
            sender_name_hint: "Private sender".to_string(),
            event_kind_hint: "message".to_string(),
            target_url: "https://www.instagram.com/direct/t/123".to_string(),
            notification_data: Some(serde_json::json!({ "secret": "private" })),
            timestamp_ms: Some(1_000),
            show_native_toast: false,
        };

        assert_eq!(
            notification_metadata(false, &candidate.origin, &candidate),
            (String::new(), String::new(), String::new(), None)
        );
        assert_eq!(
            notification_presentation(
                false,
                &candidate.origin,
                &candidate.title,
                &candidate.body,
                &candidate.notification_type,
                candidate.notification_data.as_ref(),
            ),
            NotificationPresentation {
                site_name: "Instagram".to_string(),
                sender_name: String::new(),
                event_kind: String::new(),
            }
        );
    }

    #[test]
    fn instagram_presentation_extracts_sender_and_reply_semantics() {
        let data = serde_json::json!({
            "notifType": "direct_v2_text",
            "details": { "sender_name": "Nebula Friend" }
        });
        assert_eq!(
            notification_presentation(
                true,
                "https://www.instagram.com",
                "Instagram",
                "Nebula Friend replied to your story: Tam olarak bu mesaj",
                "direct_v2_text",
                Some(&data),
            ),
            NotificationPresentation {
                site_name: "Instagram".to_string(),
                sender_name: "Nebula Friend".to_string(),
                event_kind: "reply".to_string(),
            }
        );
    }

    #[test]
    fn generic_message_presentation_uses_a_non_site_title_as_sender() {
        assert_eq!(
            notification_presentation(
                true,
                "https://web.whatsapp.com",
                "Ada",
                "Toplantı on dakika sonra.",
                "message",
                None,
            ),
            NotificationPresentation {
                site_name: "WhatsApp".to_string(),
                sender_name: "Ada".to_string(),
                event_kind: "message".to_string(),
            }
        );
    }

    #[test]
    fn instagram_sender_avatar_matches_a_decorated_display_name() {
        let tab_label = "nebula-tab-avatar-test";
        let origin = "https://www.instagram.com";
        let icon_url = "https://scontent.cdninstagram.com/v/avatar.jpg";
        remember_sender_avatar(tab_label, origin, "sincap67", icon_url);

        assert_eq!(
            sender_avatar_hint(tab_label, origin, "Sincap67 🐿").as_deref(),
            Some(icon_url)
        );
    }

    #[test]
    fn sender_avatar_rejects_an_untrusted_image_host() {
        let tab_label = "nebula-tab-untrusted-avatar-test";
        let origin = "https://www.instagram.com";
        remember_sender_avatar(
            tab_label,
            origin,
            "sincap67",
            "https://attacker.example/avatar.jpg",
        );

        assert!(sender_avatar_hint(tab_label, origin, "sincap67").is_none());
    }

    #[test]
    fn reply_body_puts_the_real_message_on_the_next_line() {
        assert_eq!(
            reply_display_body(
                "Sincap67 🐿 replied to you",
                "Sincap67 🐿",
                Some("Reply içindeki gerçek mesaj".to_string()),
            ),
            "replied to you\nReply içindeki gerçek mesaj"
        );
    }

    #[test]
    fn repeated_conversation_toasts_increment_one_visible_thread() {
        let (first_tag, first_generation, first_additional) = update_toast_thread(
            "nebula-tab-toast-thread-test",
            "https://www.instagram.com",
            "Sincap67 🐿",
            "message",
            10_000,
        );
        let (second_tag, second_generation, second_additional) = update_toast_thread(
            "nebula-tab-toast-thread-test",
            "https://www.instagram.com",
            "Sincap67 🐿",
            "reply",
            11_000,
        );

        assert_eq!(first_tag, second_tag);
        assert_eq!(first_additional, 0);
        assert_eq!(second_additional, 1);
        assert_ne!(first_generation, second_generation);
        assert!(toast_generation_is_current(
            second_tag.as_deref().unwrap_or_default(),
            second_generation.unwrap_or_default(),
        ));
    }

    #[test]
    fn read_conversation_resets_the_visible_message_counter() {
        let tab_label = "nebula-tab-toast-reset-test";
        let origin = "https://www.instagram.com";
        let sender = "Sincap67 🐿";
        let (_, _, first_additional) =
            update_toast_thread(tab_label, origin, sender, "message", 20_000);
        let (_, _, second_additional) =
            update_toast_thread(tab_label, origin, sender, "message", 21_000);
        reset_toast_threads_for_tab(tab_label);
        let (_, _, after_read_additional) =
            update_toast_thread(tab_label, origin, sender, "message", 22_000);

        assert_eq!(first_additional, 0);
        assert_eq!(second_additional, 1);
        assert_eq!(after_read_additional, 0);
    }

    #[test]
    fn reply_content_is_found_inside_encoded_nested_notification_data() {
        let data = serde_json::json!({
            "message": "Sincap67 🐿 replied to you",
            "details": "{\"payload\":{\"reply_text\":\"Reply içindeki gerçek mesaj\"}}"
        });

        assert_eq!(
            find_metadata_message(&data, "Sincap67 🐿 replied to you", "Sincap67 🐿").as_deref(),
            Some("Reply içindeki gerçek mesaj")
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
