#[tauri::command]
pub fn open_default_browser_settings() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::core::w;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        let result = unsafe {
            ShellExecuteW(
                None,
                w!("open"),
                w!("ms-settings:defaultapps?registeredAppUser=Nebula"),
                None,
                None,
                SW_SHOWNORMAL,
            )
        };

        if result.0 as isize <= 32 {
            return Err(format!(
                "failed to open Windows Default Apps settings: {}",
                result.0 as isize
            ));
        }

        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("default browser settings are only available on Windows".to_string())
    }
}
