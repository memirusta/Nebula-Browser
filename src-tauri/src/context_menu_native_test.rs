use super::*;
use std::{
    sync::mpsc,
    time::Duration,
};
use tauri::AppHandle;
use windows_core::HSTRING;

fn cdp(app: &AppHandle, method: &str, params: serde_json::Value) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    let method = HSTRING::from(method);
    let params = HSTRING::from(params.to_string());
    app.get_webview("context-menu-test")
        .ok_or("Missing test webview")?
        .with_webview(move |inner| unsafe {
            let failure = tx.clone();
            let handler = webview2_com::CallDevToolsProtocolMethodCompletedHandler::create(
                Box::new(move |result, _| {
                    let _ = tx.send(result.map_err(|e| e.to_string()));
                    Ok(())
                }),
            );
            if let Err(error) = inner
                .controller()
                .CoreWebView2()
                .and_then(|core| core.CallDevToolsProtocolMethod(&method, &params, &handler))
            {
                let _ = failure.send(Err(error.to_string()));
            }
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|e| e.to_string())?
}

#[test]
#[ignore = "Uses an isolated hidden WebView2 profile; requires a Windows desktop session"]
fn password_context_menu_uses_nebula_commands() {
    use std::io::{Read, Write};
    let directory = tempfile::tempdir().unwrap();
    let profile = directory.path().join("profile");
    let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let page_url = format!("http://{}/", server.local_addr().unwrap());
    std::thread::spawn(move || {
        let (mut connection, _) = server.accept().unwrap();
        connection
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let _ = connection.read(&mut [0; 4096]);
        let body = "<html><body><form><input name='username' autocomplete='username'><input name='password' type='password' autocomplete='current-password' style='position:fixed;left:0;top:0;width:300px;height:100px'></form></body></html>";
        write!(connection, "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
    });
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = "com.nebula.context-menu-test".into();
    let (result_tx, result_rx) = mpsc::channel();
    let app = tauri::Builder::default().any_thread().setup(move |app| {
        let window = tauri::WebviewWindowBuilder::new(app, "context-menu-test", tauri::WebviewUrl::External("about:blank".parse().unwrap()))
            .visible(false).skip_taskbar(true).data_directory(profile).build()?;
        let (menu_tx, menu_rx) = mpsc::channel();
        window.with_webview(move |inner| unsafe {
            let core = inner.controller().CoreWebView2().unwrap();
            let settings = core.Settings().unwrap();
            let settings4: webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings4 = settings.cast().unwrap();
            settings4.SetIsPasswordAutosaveEnabled(false).unwrap();
            settings4.SetIsGeneralAutofillEnabled(false).unwrap();
            settings.SetAreDefaultContextMenusEnabled(true).unwrap();
            let handler = ContextMenuRequestedEventHandler::create(Box::new(move |_, args| {
                let args = args.unwrap();
                args.SetHandled(true)?;
                let items = collection_payload(&args.MenuItems()?, 0)?;
                let _ = menu_tx.send(items);
                Ok(())
            }));
            let mut token = 0;
            core.cast::<ICoreWebView2_11>().unwrap().add_ContextMenuRequested(&handler, &mut token).unwrap();
        })?;
        let handle = app.handle().clone();
        std::thread::spawn(move || {
            let result = (|| -> Result<(), String> {
                cdp(&handle, "Page.navigate", serde_json::json!({"url":page_url}))?;
                std::thread::sleep(Duration::from_millis(500));
                cdp(&handle, "Runtime.evaluate", serde_json::json!({"expression": "document.querySelector('input[type=password]').focus()"}))?;
                cdp(&handle, "Input.dispatchMouseEvent", serde_json::json!({"type":"mousePressed", "x":50,"y":50,"button":"right","clickCount":1}))?;
                cdp(&handle, "Input.dispatchMouseEvent", serde_json::json!({"type":"mouseReleased", "x":50,"y":50,"button":"right","clickCount":1}))?;
                let items = menu_rx.recv_timeout(Duration::from_secs(10)).map_err(|e| e.to_string())?;
                let import = items.iter().find(|item| item.name == "nebula-import-passwords")
                    .ok_or("Password import was not routed to Nebula")?;
                if import.command_id != NEBULA_PASSWORD_SETTINGS_COMMAND_ID {
                    return Err("Import still executes an Edge command".into());
                }
                if !items.iter().any(|item| item.name == "paste" && item.command_id > 0) {
                    return Err("Native editing commands were lost".into());
                }
                println!("Real password menu routes import to Nebula and preserves native paste");
                Ok(())
            })();
            let _ = result_tx.send(result);
            handle.exit(0);
        });
        Ok(())
    }).build(context).unwrap();
    app.run_return(|_, _| {});
    result_rx
        .recv_timeout(Duration::from_secs(5))
        .unwrap()
        .unwrap();
}
