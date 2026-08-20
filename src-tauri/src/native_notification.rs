#[cfg(target_os = "windows")]
mod imp {
    use serde::Serialize;
    use tauri::{AppHandle, Emitter, Manager};
    use windows::Data::Xml::Dom::XmlDocument;
    use windows::Foundation::TypedEventHandler;
    use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};
    use windows_core::{IInspectable, HSTRING};

    const POWERSHELL_APP_ID: &str =
        "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";
    const ACTIVATED_EVENT: &str = "nebula-native-notification-activated";

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

    fn notification_icon_uri(app: &AppHandle) -> Option<String> {
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
        url::Url::from_file_path(icon_path)
            .ok()
            .map(|url| url.to_string())
    }

    pub fn show(
        app: &AppHandle,
        title: &str,
        body: &str,
        tab_label: Option<String>,
        origin: Option<String>,
        download_id: Option<String>,
    ) -> Result<(), String> {
        let document = XmlDocument::new().map_err(|error| error.to_string())?;
        let image = notification_icon_uri(app)
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
pub fn show(
    _app: &tauri::AppHandle,
    _title: &str,
    _body: &str,
    _tab_label: Option<String>,
    _origin: Option<String>,
    _download_id: Option<String>,
) -> Result<(), String> {
    Ok(())
}
