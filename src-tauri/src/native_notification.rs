#[cfg(target_os = "windows")]
mod imp {
    use serde::Serialize;
    use std::hash::{Hash, Hasher};
    use std::time::Duration;
    use tauri::{AppHandle, Emitter, Manager};
    use windows::Data::Xml::Dom::XmlDocument;
    use windows::Foundation::TypedEventHandler;
    use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};
    use windows_core::{IInspectable, HSTRING};

    const POWERSHELL_APP_ID: &str =
        "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";
    const ACTIVATED_EVENT: &str = "nebula-native-notification-activated";
    const MAX_SITE_ICON_BYTES: u64 = 1024 * 1024;

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

    fn validated_site_icon_url(value: &str) -> Option<url::Url> {
        let url = url::Url::parse(value).ok()?;
        let trusted_favicon_service = url.scheme() == "https"
            && url.host_str() == Some("www.google.com")
            && url.path() == "/s2/favicons";
        trusted_favicon_service.then_some(url)
    }

    async fn cached_site_icon_uri(app: &AppHandle, value: &str) -> Option<String> {
        let url = validated_site_icon_url(value)?;
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
            .redirect(reqwest::redirect::Policy::limited(3))
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

    async fn notification_icon_uri(app: &AppHandle, icon_url: Option<&str>) -> Option<String> {
        if let Some(icon_url) = icon_url {
            if let Some(uri) = cached_site_icon_uri(app, icon_url).await {
                return Some(uri);
            }
        }
        fallback_notification_icon_uri(app)
    }

    pub async fn show(
        app: &AppHandle,
        title: &str,
        body: &str,
        tab_label: Option<String>,
        origin: Option<String>,
        download_id: Option<String>,
        icon_url: Option<String>,
    ) -> Result<(), String> {
        let document = XmlDocument::new().map_err(|error| error.to_string())?;
        let image = notification_icon_uri(app, icon_url.as_deref())
            .await
            .map(|uri| {
                format!(
                    "<image placement=\"appLogoOverride\" hint-crop=\"circle\" src=\"{}\"/>",
                    xml_escape(&uri)
                )
            })
            .unwrap_or_default();
        document
            .LoadXml(&HSTRING::from(format!(
                "<toast><visual><binding template=\"ToastGeneric\">{}<text>{}</text><text>{}</text></binding></visual></toast>",
                image,
                xml_escape(title),
                xml_escape(body),
            )))
            .map_err(|error| error.to_string())?;
        let toast = ToastNotification::CreateToastNotification(&document)
            .map_err(|error| error.to_string())?;

        let activation_app = app.clone();
        let activated = TypedEventHandler::<ToastNotification, IInspectable>::new(move |_, _| {
            if let Some(window) = activation_app.get_window("main") {
                crate::external_open::activate_main_window(&window);
            }
            let _ = activation_app.emit(
                ACTIVATED_EVENT,
                ActivatedPayload {
                    tab_label: tab_label.clone(),
                    origin: origin.clone(),
                    download_id: download_id.clone(),
                },
            );
            Ok(())
        });
        toast
            .Activated(&activated)
            .map_err(|error| error.to_string())?;

        let notifier = ToastNotificationManager::CreateToastNotifier()
            .or_else(|_| {
                let executable = std::env::current_exe().ok();
                let is_development = executable
                    .as_deref()
                    .and_then(std::path::Path::parent)
                    .is_some_and(|directory| {
                        let directory = directory.to_string_lossy().replace('/', "\\");
                        directory.contains("\\target\\")
                            && (directory.ends_with("\\debug") || directory.ends_with("\\release"))
                    });
                let app_id = if is_development {
                    POWERSHELL_APP_ID
                } else {
                    app.config().identifier.as_str()
                };
                ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id))
            })
            .map_err(|error| error.to_string())?;

        notifier.Show(&toast).map_err(|error| error.to_string())
    }
}

#[cfg(target_os = "windows")]
pub use imp::show;

#[cfg(not(target_os = "windows"))]
pub async fn show(
    _app: &tauri::AppHandle,
    _title: &str,
    _body: &str,
    _tab_label: Option<String>,
    _origin: Option<String>,
    _download_id: Option<String>,
    _icon_url: Option<String>,
) -> Result<(), String> {
    Ok(())
}
