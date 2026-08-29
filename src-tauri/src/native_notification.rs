#[cfg(target_os = "windows")]
mod imp {
    use serde::Serialize;
    use std::hash::{Hash, Hasher};
    use std::time::Duration;
    use tauri::{AppHandle, Emitter, Manager};
    use windows::Data::Xml::Dom::XmlDocument;
    use windows::Foundation::TypedEventHandler;
    use windows::UI::Notifications::{
        NotificationData, NotificationUpdateResult, ToastNotification, ToastNotificationManager,
        ToastNotifier,
    };
    use windows_core::{IInspectable, HSTRING};

    const POWERSHELL_APP_ID: &str =
        "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";
    const ACTIVATED_EVENT: &str = "nebula-native-notification-activated";
    const MAX_SITE_ICON_BYTES: u64 = 1024 * 1024;
    const CONVERSATION_TOAST_GROUP: &str = "nebula-conversation";

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct ActivatedPayload {
        tab_label: Option<String>,
        origin: Option<String>,
        download_id: Option<String>,
    }

    fn xml_escape(value: &str) -> String {
        value
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
            .replace('\'', "&apos;")
    }

    fn file_uri(path: std::path::PathBuf) -> Option<String> {
        url::Url::from_file_path(path)
            .ok()
            .map(|url| url.to_string())
    }

    fn fallback_notification_icon_uri(app: &AppHandle) -> Option<String> {
        const ICON_BYTES: &[u8] = include_bytes!("../icons/128x128.png");
        let icon_dir = app.path().app_cache_dir().ok()?.join("notifications");
        std::fs::create_dir_all(&icon_dir).ok()?;
        let icon_path = icon_dir.join("nebula-notification.png");
        let needs_write = std::fs::metadata(&icon_path)
            .map(|metadata| metadata.len() != ICON_BYTES.len() as u64)
            .unwrap_or(true);
        if needs_write {
            std::fs::write(&icon_path, ICON_BYTES).ok()?;
        }
        file_uri(icon_path)
    }

    fn host_matches(host: &str, domain: &str) -> bool {
        host == domain || host.ends_with(&format!(".{domain}"))
    }

    fn validated_site_icon_url(value: &str, origin: Option<&str>) -> Option<url::Url> {
        let url = url::Url::parse(value).ok()?;
        let host = url.host_str()?.to_ascii_lowercase();
        let trusted_favicon_service =
            url.scheme() == "https" && host == "www.google.com" && url.path() == "/s2/favicons";
        let origin_host = origin
            .and_then(|origin| url::Url::parse(origin).ok())
            .and_then(|origin| origin.host_str().map(str::to_ascii_lowercase))
            .unwrap_or_default();
        let trusted_instagram_profile = host_matches(&origin_host, "instagram.com")
            && [
                "instagram.com",
                "cdninstagram.com",
                "fbcdn.net",
                "facebook.com",
            ]
            .iter()
            .any(|domain| host_matches(&host, domain));
        let trusted_whatsapp_profile = host_matches(&origin_host, "whatsapp.com")
            && ["whatsapp.net", "fbcdn.net"]
                .iter()
                .any(|domain| host_matches(&host, domain));
        (url.scheme() == "https"
            && (trusted_favicon_service || trusted_instagram_profile || trusted_whatsapp_profile))
            .then_some(url)
    }

    async fn cached_site_icon_uri(
        app: &AppHandle,
        value: &str,
        origin: Option<&str>,
    ) -> Option<String> {
        let url = validated_site_icon_url(value, origin)?;
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        url.as_str().hash(&mut hasher);

        let icon_dir = app.path().app_cache_dir().ok()?.join("notifications");
        std::fs::create_dir_all(&icon_dir).ok()?;
        let icon_path = icon_dir.join(format!("site-{:016x}.png", hasher.finish()));
        if std::fs::metadata(&icon_path)
            .is_ok_and(|metadata| metadata.len() > 0 && metadata.len() <= MAX_SITE_ICON_BYTES)
        {
            return file_uri(icon_path);
        }

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(3))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .ok()?;
        let response = client.get(url).send().await.ok()?;
        if !response.status().is_success()
            || response
                .content_length()
                .is_some_and(|length| length > MAX_SITE_ICON_BYTES)
            || !response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .is_some_and(|value| value.to_ascii_lowercase().starts_with("image/"))
        {
            return None;
        }
        let bytes = response.bytes().await.ok()?;
        if bytes.is_empty() || bytes.len() as u64 > MAX_SITE_ICON_BYTES {
            return None;
        }
        std::fs::write(&icon_path, &bytes).ok()?;
        file_uri(icon_path)
    }

    async fn notification_icon_uri(
        app: &AppHandle,
        icon_url: Option<&str>,
        origin: Option<&str>,
    ) -> Option<String> {
        if let Some(icon_url) = icon_url {
            if let Some(uri) = cached_site_icon_uri(app, icon_url, origin).await {
                return Some(uri);
            }
        }
        fallback_notification_icon_uri(app)
    }

    fn event_kind_label(kind: Option<&str>) -> Option<&'static str> {
        let turkish = crate::tab_error_page::current_ui_locale() == "tr";
        match (kind.unwrap_or_default(), turkish) {
            ("message", true) => Some("Mesaj"),
            ("message", false) => Some("Message"),
            ("reply", true) => Some("Yanıt"),
            ("reply", false) => Some("Reply"),
            ("reaction", true) => Some("Tepki"),
            ("reaction", false) => Some("Reaction"),
            ("mention", true) => Some("Bahsetme"),
            ("mention", false) => Some("Mention"),
            ("live", true) => Some("Canlı yayın"),
            ("live", false) => Some("Live"),
            ("call", true) => Some("Arama"),
            ("call", false) => Some("Call"),
            ("post", true) => Some("Gönderi"),
            ("post", false) => Some("Post"),
            ("download", true) => Some("İndirme tamamlandı"),
            ("download", false) => Some("Download complete"),
            _ => None,
        }
    }

    fn additional_messages_label(count: u32) -> String {
        if crate::tab_error_page::current_ui_locale() == "tr" {
            format!("+{count} mesaj")
        } else if count == 1 {
            "+1 message".to_string()
        } else {
            format!("+{count} messages")
        }
    }

    fn notification_data(
        heading: &str,
        body: &str,
        footer: &str,
        additional_message_count: u32,
        generation: Option<u64>,
    ) -> Result<NotificationData, String> {
        let data = NotificationData::new().map_err(|error| error.to_string())?;
        let values = data.Values().map_err(|error| error.to_string())?;
        let counter = if additional_message_count > 0 {
            additional_messages_label(additional_message_count)
        } else {
            String::default()
        };
        for (key, value) in [
            ("nebulaHeading", heading),
            ("nebulaBody", body),
            ("nebulaCounter", counter.as_str()),
            ("nebulaFooter", footer),
        ] {
            values
                .Insert(&HSTRING::from(key), &HSTRING::from(value))
                .map_err(|error| error.to_string())?;
        }
        data.SetSequenceNumber(generation.unwrap_or(0).min(u32::MAX as u64) as u32)
            .map_err(|error| error.to_string())?;
        Ok(data)
    }

    fn update_with_notifier(
        notifier: &ToastNotifier,
        data: &NotificationData,
        tag: &HSTRING,
        group: &HSTRING,
    ) -> windows_core::Result<NotificationUpdateResult> {
        notifier.UpdateWithTagAndGroup(data, tag, group)
    }

    #[derive(Clone, Copy, PartialEq, Eq)]
    enum ToastUpdateOutcome {
        Updated,
        NotFound,
        Failed,
    }

    fn update_existing_conversation_toast(
        app: &AppHandle,
        data: &NotificationData,
        tag: &str,
    ) -> ToastUpdateOutcome {
        let tag = HSTRING::from(tag);
        let group = HSTRING::from(CONVERSATION_TOAST_GROUP);
        let notifiers = [
            ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(
                app.config().identifier.as_str(),
            )),
            ToastNotificationManager::CreateToastNotifier(),
            ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(POWERSHELL_APP_ID)),
        ];
        let mut saw_failure = false;
        for notifier in notifiers {
            let Ok(notifier) = notifier else {
                saw_failure = true;
                continue;
            };
            match update_with_notifier(&notifier, data, &tag, &group) {
                Ok(result) if result == NotificationUpdateResult::Succeeded => {
                    return ToastUpdateOutcome::Updated;
                }
                Ok(result) if result == NotificationUpdateResult::NotificationNotFound => {}
                Ok(_) | Err(_) => saw_failure = true,
            }
        }
        if saw_failure {
            ToastUpdateOutcome::Failed
        } else {
            ToastUpdateOutcome::NotFound
        }
    }
    #[allow(clippy::too_many_arguments)]
    pub async fn show(
        app: &AppHandle,
        title: &str,
        body: &str,
        site_name: Option<String>,
        sender_name: Option<String>,
        event_kind: Option<String>,
        tab_label: Option<String>,
        origin: Option<String>,
        download_id: Option<String>,
        icon_url: Option<String>,
        toast_tag: Option<String>,
        toast_generation: Option<u64>,
        additional_message_count: u32,
    ) -> Result<(), String> {
        let heading = sender_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(title);
        let site_name = site_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("Nebula");
        let footer_text = [
            (site_name != "Nebula").then_some(site_name),
            event_kind_label(event_kind.as_deref()),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" • ");
        if let (Some(tag), Some(generation)) = (toast_tag.as_deref(), toast_generation) {
            if !crate::notification_broker::toast_generation_is_current(tag, generation) {
                return Ok(());
            }
        }

        let mut data = notification_data(
            heading,
            body,
            &footer_text,
            additional_message_count,
            toast_generation,
        )?;
        let mut suppress_fallback_popup = false;
        if additional_message_count > 0 {
            if let (Some(tag), Some(generation)) = (toast_tag.as_deref(), toast_generation) {
                match update_existing_conversation_toast(app, &data, tag) {
                    ToastUpdateOutcome::Updated => {
                        // NotificationData updates the already-visible banner
                        // and Action Center entry without another popup.
                        return Ok(());
                    }
                    ToastUpdateOutcome::NotFound
                        if crate::notification_broker::toast_thread_is_presented(
                            tag, generation,
                        ) =>
                    {
                        // A previously displayed toast disappeared because it
                        // was read, dismissed, or expired. Start over visibly.
                        crate::notification_broker::restart_toast_thread(tag, generation);
                        data = notification_data(heading, body, &footer_text, 0, toast_generation)?;
                    }
                    ToastUpdateOutcome::Failed => {
                        // Even if Windows refuses a data update, replacing the
                        // tagged entry must not create a stack of banners.
                        suppress_fallback_popup = true;
                    }
                    ToastUpdateOutcome::NotFound => {}
                }
                // Otherwise the first async toast is still preparing its icon.
                // This newer generation will replace it and keep the real +N.
            }
        }

        let document = XmlDocument::new().map_err(|error| error.to_string())?;
        let image = notification_icon_uri(app, icon_url.as_deref(), origin.as_deref())
            .await
            .map(|uri| {
                format!(
                    "<image placement=\"appLogoOverride\" hint-crop=\"circle\" src=\"{}\"/>",
                    xml_escape(&uri)
                )
            })
            .unwrap_or_default();
        if let (Some(tag), Some(generation)) = (toast_tag.as_deref(), toast_generation) {
            if !crate::notification_broker::toast_generation_is_current(tag, generation) {
                return Ok(());
            }
        }
        let footer = if !footer_text.is_empty() {
            "<text placement=\"attribution\">{nebulaFooter}</text>"
        } else {
            ""
        };
        document
            .LoadXml(&HSTRING::from(format!(
                "<toast><visual><binding template=\"ToastGeneric\">{}<text hint-maxLines=\"1\">{{nebulaHeading}}</text><text>{{nebulaBody}}</text><text>{{nebulaCounter}}</text>{}</binding></visual></toast>",
                image,
                footer,
            )))
            .map_err(|error| error.to_string())?;
        let toast = ToastNotification::CreateToastNotification(&document)
            .map_err(|error| error.to_string())?;
        toast.SetData(&data).map_err(|error| error.to_string())?;
        if let Some(tag) = toast_tag.as_deref() {
            toast
                .SetTag(&HSTRING::from(tag))
                .map_err(|error| error.to_string())?;
            toast
                .SetGroup(&HSTRING::from(CONVERSATION_TOAST_GROUP))
                .map_err(|error| error.to_string())?;
        }
        if suppress_fallback_popup {
            toast
                .SetSuppressPopup(true)
                .map_err(|error| error.to_string())?;
        }

        let activation_app = app.clone();
        let activation_toast_tag = toast_tag.clone();
        let activated = TypedEventHandler::<ToastNotification, IInspectable>::new(move |_, _| {
            if let Some(tag) = activation_toast_tag.as_deref() {
                crate::notification_broker::reset_toast_thread(tag);
            }
            let target_label = tab_label
                .as_deref()
                .and_then(|label| activation_app.get_webview(label))
                .map(|webview| webview.window().label().to_string())
                .unwrap_or_else(crate::browser_workspace::most_recent_window_label);
            if let Some(window) = activation_app.get_window(&target_label) {
                crate::external_open::activate_main_window(&window);
            }
            let result = activation_app.emit_to(
                target_label.clone(),
                ACTIVATED_EVENT,
                ActivatedPayload {
                    tab_label: tab_label.clone(),
                    origin: origin.clone(),
                    download_id: download_id.clone(),
                },
            );
            crate::notification_broker::record_click_routing(
                tab_label.as_deref(),
                origin.as_deref(),
                &target_label,
                result.is_ok(),
                &result
                    .err()
                    .map(|error| error.to_string())
                    .unwrap_or_default(),
            );
            Ok(())
        });
        toast
            .Activated(&activated)
            .map_err(|error| error.to_string())?;

        // Prefer Nebula's registered Start Menu identity even for a directly
        // launched release binary. This keeps the shell header branded as
        // Nebula instead of inheriting the emergency PowerShell fallback.
        if let Ok(notifier) = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(
            app.config().identifier.as_str(),
        )) {
            if notifier.Show(&toast).is_ok() {
                if let (Some(tag), Some(generation)) = (toast_tag.as_deref(), toast_generation) {
                    crate::notification_broker::mark_toast_thread_presented(tag, generation);
                }
                return Ok(());
            }
        }

        let notifier = ToastNotificationManager::CreateToastNotifier()
            .or_else(|_| {
                ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(
                    POWERSHELL_APP_ID,
                ))
            })
            .map_err(|error| error.to_string())?;
        notifier.Show(&toast).map_err(|error| error.to_string())?;
        if let (Some(tag), Some(generation)) = (toast_tag.as_deref(), toast_generation) {
            crate::notification_broker::mark_toast_thread_presented(tag, generation);
        }
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::validated_site_icon_url;

        #[test]
        fn instagram_profile_images_are_limited_to_the_trusted_cdn_family() {
            assert!(validated_site_icon_url(
                "https://scontent.cdninstagram.com/profile.jpg",
                Some("https://www.instagram.com"),
            )
            .is_some());
            assert!(validated_site_icon_url(
                "https://scontent.cdninstagram.com/profile.jpg",
                Some("https://attacker.example"),
            )
            .is_none());
            assert!(validated_site_icon_url(
                "https://attacker.example/profile.jpg",
                Some("https://www.instagram.com"),
            )
            .is_none());
        }

        #[test]
        fn generic_site_icons_still_use_the_bounded_google_favicon_endpoint() {
            assert!(validated_site_icon_url(
                "https://www.google.com/s2/favicons?domain=example.com&sz=64",
                Some("https://example.com"),
            )
            .is_some());
            assert!(validated_site_icon_url(
                "https://www.google.com/redirect?target=example.com",
                Some("https://example.com"),
            )
            .is_none());
        }
    }
}

#[cfg(target_os = "windows")]
pub use imp::show;

#[cfg(not(target_os = "windows"))]
pub async fn show(
    _app: &tauri::AppHandle,
    _title: &str,
    _body: &str,
    _site_name: Option<String>,
    _sender_name: Option<String>,
    _event_kind: Option<String>,
    _tab_label: Option<String>,
    _origin: Option<String>,
    _download_id: Option<String>,
    _icon_url: Option<String>,
    _toast_tag: Option<String>,
    _toast_generation: Option<u64>,
    _additional_message_count: u32,
) -> Result<(), String> {
    Ok(())
}
