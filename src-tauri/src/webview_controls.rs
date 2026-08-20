use tauri::{AppHandle, Manager};

#[cfg(target_os = "windows")]
static PRINT_PREVIEW_LOCK: std::sync::LazyLock<tokio::sync::Mutex<()>> =
    std::sync::LazyLock::new(|| tokio::sync::Mutex::new(()));

#[cfg(target_os = "windows")]
fn with_webview_result<F, R>(app: &AppHandle, label: &str, f: F) -> Result<R, String>
where
    F: FnOnce(tauri::webview::PlatformWebview) -> Result<R, String> + Send + 'static,
    R: Send + 'static,
{
    use std::sync::mpsc::sync_channel;

    if !label.starts_with("nebula-tab-") {
        return Err("webview control is limited to browser tabs".to_string());
    }

    let webview = app
        .get_webview(label)
        .ok_or_else(|| format!("webview '{label}' not found"))?;

    let (tx, rx) = sync_channel(1);

    webview
        .with_webview(move |inner| {
            let _ = tx.send(f(inner));
        })
        .map_err(|error| error.to_string())?;

    rx.recv_timeout(std::time::Duration::from_secs(2))
        .map_err(|_| format!("timed out in webview control '{label}'"))?
}

#[tauri::command]
pub fn webview_reload(app: AppHandle, label: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        with_webview_result(&app, &label, |inner| unsafe {
            let core = inner
                .controller()
                .CoreWebView2()
                .map_err(|error| error.to_string())?;
            core.Reload().map_err(|error| error.to_string())
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, label);
        Ok(())
    }
}

#[tauri::command]
pub fn webview_go_forward(app: AppHandle, label: String) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        with_webview_result(&app, &label, |inner| unsafe {
            let core = inner
                .controller()
                .CoreWebView2()
                .map_err(|error| error.to_string())?;
            let mut can_go_forward = windows_core::BOOL::default();
            core.CanGoForward(std::ptr::addr_of_mut!(can_go_forward))
                .map_err(|error| error.to_string())?;
            if can_go_forward.as_bool() {
                core.GoForward().map_err(|error| error.to_string())?;
                Ok(true)
            } else {
                Ok(false)
            }
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, label);
        Ok(false)
    }
}

#[tauri::command]
pub fn webview_zoom(app: AppHandle, label: String, action: String) -> Result<f64, String> {
    #[cfg(target_os = "windows")]
    {
        let zoom_action = action.clone();
        with_webview_result(&app, &label, move |inner| unsafe {
            let controller = inner.controller();
            let mut factor = 0.0f64;
            controller
                .ZoomFactor(&mut factor)
                .map_err(|error| error.to_string())?;
            factor = match zoom_action.as_str() {
                "in" => (factor + 0.1).min(5.0),
                "out" => (factor - 0.1).max(0.25),
                "reset" => 1.0,
                _ => return Err(format!("unknown zoom action '{zoom_action}'")),
            };
            controller
                .SetZoomFactor(factor)
                .map_err(|error| error.to_string())?;
            Ok(factor)
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, label, action);
        Ok(1.0)
    }
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewPrinterInfo {
    name: String,
    is_default: bool,
}

#[tauri::command]
pub fn webview_list_printers() -> Result<Vec<WebviewPrinterInfo>, String> {
    #[cfg(target_os = "windows")]
    {
        use std::{
            mem::{size_of, size_of_val},
            ptr, slice,
        };

        const PRINTER_ENUM_LOCAL: u32 = 0x0000_0002;
        const PRINTER_ENUM_CONNECTIONS: u32 = 0x0000_0004;

        #[repr(C)]
        struct PrinterInfo4W {
            printer_name: *mut u16,
            server_name: *mut u16,
            attributes: u32,
        }

        #[link(name = "winspool")]
        extern "system" {
            fn EnumPrintersW(
                flags: u32,
                name: *mut u16,
                level: u32,
                printer_enum: *mut u8,
                buffer_size: u32,
                bytes_needed: *mut u32,
                printers_returned: *mut u32,
            ) -> i32;

            fn GetDefaultPrinterW(buffer: *mut u16, chars: *mut u32) -> i32;
        }

        unsafe fn wide_ptr_to_string(value: *const u16) -> String {
            if value.is_null() {
                return String::new();
            }

            let mut len = 0usize;

            while *value.add(len) != 0 {
                len += 1;
            }

            String::from_utf16_lossy(slice::from_raw_parts(value, len))
        }

        unsafe fn default_printer_name() -> Option<String> {
            let mut chars = 0u32;

            let _ = GetDefaultPrinterW(ptr::null_mut(), &mut chars);

            if chars == 0 {
                return None;
            }

            let mut buffer = vec![0u16; chars as usize];

            if GetDefaultPrinterW(buffer.as_mut_ptr(), &mut chars) == 0 {
                return None;
            }

            let len = buffer
                .iter()
                .position(|value| *value == 0)
                .unwrap_or(buffer.len());

            let name = String::from_utf16_lossy(&buffer[..len]);

            let name = name.trim();

            if name.is_empty() {
                None
            } else {
                Some(name.to_string())
            }
        }

        unsafe {
            let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;

            let mut bytes_needed = 0u32;
            let mut printers_returned = 0u32;

            let _ = EnumPrintersW(
                flags,
                ptr::null_mut(),
                4,
                ptr::null_mut(),
                0,
                &mut bytes_needed,
                &mut printers_returned,
            );

            if bytes_needed == 0 {
                return Ok(Vec::new());
            }

            let word_size = size_of::<usize>();
            let word_count = (bytes_needed as usize).div_ceil(word_size);

            let mut buffer = vec![0usize; word_count];

            let buffer_bytes = size_of_val(buffer.as_slice());

            let buffer_bytes_u32 = u32::try_from(buffer_bytes)
                .map_err(|_| "Printer enumeration buffer is too large.".to_string())?;

            if EnumPrintersW(
                flags,
                ptr::null_mut(),
                4,
                buffer.as_mut_ptr() as *mut u8,
                buffer_bytes_u32,
                &mut bytes_needed,
                &mut printers_returned,
            ) == 0
            {
                return Err(std::io::Error::last_os_error().to_string());
            }

            let entries = slice::from_raw_parts(
                buffer.as_ptr() as *const PrinterInfo4W,
                printers_returned as usize,
            );

            let default_name = default_printer_name();

            let mut printers = Vec::<WebviewPrinterInfo>::new();

            for entry in entries {
                let name = wide_ptr_to_string(entry.printer_name);

                let name = name.trim();

                if name.is_empty() {
                    continue;
                }

                let is_default = default_name
                    .as_ref()
                    .map(|default| default.eq_ignore_ascii_case(name))
                    .unwrap_or(false);

                printers.push(WebviewPrinterInfo {
                    name: name.to_string(),
                    is_default,
                });
            }

            printers.sort_by(|left, right| {
                right
                    .is_default
                    .cmp(&left.is_default)
                    .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            });

            printers.dedup_by(|left, right| left.name.eq_ignore_ascii_case(&right.name));

            Ok(printers)
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(Vec::new())
    }
}
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewPrintOptions {
    #[serde(default)]
    printer_name: String,
    #[serde(default)]
    page_ranges: String,
    #[serde(default)]
    landscape: bool,
    #[serde(default = "default_print_copies")]
    copies: i32,
    #[serde(default = "default_print_scale")]
    scale: f64,
    #[serde(default)]
    backgrounds: bool,
    #[serde(default)]
    headers_and_footers: bool,
    #[serde(default)]
    selection_only: bool,
    #[serde(default = "default_print_paper_size")]
    paper_size: String,
    #[serde(default = "default_print_margins")]
    margins: String,
}

fn default_print_copies() -> i32 {
    1
}

fn default_print_scale() -> f64 {
    1.0
}

fn default_print_paper_size() -> String {
    "a4".to_string()
}

fn default_print_margins() -> String {
    "default".to_string()
}

#[tauri::command]
pub fn webview_set_zoom(app: AppHandle, label: String, factor: f64) -> Result<f64, String> {
    #[cfg(target_os = "windows")]
    {
        let factor = factor.clamp(0.25, 5.0);
        with_webview_result(&app, &label, move |inner| unsafe {
            inner
                .controller()
                .SetZoomFactor(factor)
                .map_err(|error| error.to_string())?;
            Ok(factor)
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, label);
        Ok(factor.clamp(0.25, 5.0))
    }
}

#[cfg(target_os = "windows")]
unsafe fn create_webview_print_settings(
    core: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2,
    options: &WebviewPrintOptions,
) -> Result<webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2PrintSettings, String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2PrintSettings2, ICoreWebView2_2,
        COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE, COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
    };
    use windows_core::{Interface, HSTRING};

    let core2: ICoreWebView2_2 = core.cast().map_err(|error| error.to_string())?;
    let environment = core2.Environment().map_err(|error| error.to_string())?;
    let print_environment: ICoreWebView2Environment6 =
        environment.cast().map_err(|error| error.to_string())?;
    let settings = print_environment
        .CreatePrintSettings()
        .map_err(|error| error.to_string())?;

    settings
        .SetOrientation(if options.landscape {
            COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE
        } else {
            COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT
        })
        .map_err(|error| error.to_string())?;
    settings
        .SetScaleFactor(options.scale.clamp(0.1, 2.0))
        .map_err(|error| error.to_string())?;

    let (page_width, page_height) = match options.paper_size.as_str() {
        "letter" => (8.5, 11.0),
        _ => (8.267_716_535_4, 11.692_913_385_8),
    };
    let (page_width, page_height) = if options.landscape {
        (page_height, page_width)
    } else {
        (page_width, page_height)
    };
    settings
        .SetPageWidth(page_width)
        .map_err(|error| error.to_string())?;
    settings
        .SetPageHeight(page_height)
        .map_err(|error| error.to_string())?;

    let margin = match options.margins.as_str() {
        "none" => 0.0,
        "minimum" => 0.25,
        _ => 0.4,
    };
    settings
        .SetMarginTop(margin)
        .map_err(|error| error.to_string())?;
    settings
        .SetMarginBottom(margin)
        .map_err(|error| error.to_string())?;
    settings
        .SetMarginLeft(margin)
        .map_err(|error| error.to_string())?;
    settings
        .SetMarginRight(margin)
        .map_err(|error| error.to_string())?;
    settings
        .SetShouldPrintBackgrounds(options.backgrounds)
        .map_err(|error| error.to_string())?;
    settings
        .SetShouldPrintHeaderAndFooter(options.headers_and_footers)
        .map_err(|error| error.to_string())?;
    settings
        .SetShouldPrintSelectionOnly(options.selection_only)
        .map_err(|error| error.to_string())?;

    let settings2: ICoreWebView2PrintSettings2 =
        settings.cast().map_err(|error| error.to_string())?;
    settings2
        .SetPrinterName(&HSTRING::from(options.printer_name.trim()))
        .map_err(|error| error.to_string())?;
    let ranges = options.page_ranges.trim();
    if !ranges.is_empty() {
        settings2
            .SetPageRanges(&HSTRING::from(ranges))
            .map_err(|error| error.to_string())?;
    }
    settings2
        .SetCopies(options.copies.clamp(1, 99))
        .map_err(|error| error.to_string())?;

    Ok(settings)
}

#[tauri::command]
pub fn webview_print(
    app: AppHandle,
    label: String,
    options: WebviewPrintOptions,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2Environment6, ICoreWebView2PrintSettings2, ICoreWebView2_16,
            ICoreWebView2_2, COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE,
            COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
        };
        use webview2_com::PrintCompletedHandler;
        use windows_core::{Interface, HSTRING};

        let _callback_label = label.clone();

        with_webview_result(&app, &label, move |inner| unsafe {
            let core = inner
                .controller()
                .CoreWebView2()
                .map_err(|error| error.to_string())?;

            let core2: ICoreWebView2_2 = core.cast().map_err(|error| error.to_string())?;
            let environment = core2.Environment().map_err(|error| error.to_string())?;
            let print_environment: ICoreWebView2Environment6 =
                environment.cast().map_err(|error| error.to_string())?;
            let settings = print_environment
                .CreatePrintSettings()
                .map_err(|error| error.to_string())?;

            settings
                .SetOrientation(if options.landscape {
                    COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE
                } else {
                    COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT
                })
                .map_err(|error| error.to_string())?;

            settings
                .SetScaleFactor(options.scale.clamp(0.1, 2.0))
                .map_err(|error| error.to_string())?;

            let (page_width, page_height) = match options.paper_size.as_str() {
                "letter" => (8.5, 11.0),
                _ => (8.267_716_535_4, 11.692_913_385_8),
            };
            let (page_width, page_height) = if options.landscape {
                (page_height, page_width)
            } else {
                (page_width, page_height)
            };
            settings
                .SetPageWidth(page_width)
                .map_err(|error| error.to_string())?;
            settings
                .SetPageHeight(page_height)
                .map_err(|error| error.to_string())?;

            let margin = match options.margins.as_str() {
                "none" => 0.0,
                "minimum" => 0.25,
                _ => 0.4,
            };
            settings
                .SetMarginTop(margin)
                .map_err(|error| error.to_string())?;
            settings
                .SetMarginBottom(margin)
                .map_err(|error| error.to_string())?;
            settings
                .SetMarginLeft(margin)
                .map_err(|error| error.to_string())?;
            settings
                .SetMarginRight(margin)
                .map_err(|error| error.to_string())?;

            settings
                .SetShouldPrintBackgrounds(options.backgrounds)
                .map_err(|error| error.to_string())?;

            settings
                .SetShouldPrintHeaderAndFooter(options.headers_and_footers)
                .map_err(|error| error.to_string())?;

            settings
                .SetShouldPrintSelectionOnly(options.selection_only)
                .map_err(|error| error.to_string())?;

            let settings2: ICoreWebView2PrintSettings2 =
                settings.cast().map_err(|error| error.to_string())?;

            settings2
                .SetPrinterName(&HSTRING::from(options.printer_name.trim()))
                .map_err(|error| error.to_string())?;

            let ranges = options.page_ranges.trim();
            if !ranges.is_empty() {
                settings2
                    .SetPageRanges(&HSTRING::from(ranges))
                    .map_err(|error| error.to_string())?;
            }

            settings2
                .SetCopies(options.copies.clamp(1, 99))
                .map_err(|error| error.to_string())?;

            let print: ICoreWebView2_16 = core.cast().map_err(|error| error.to_string())?;

            let handler = PrintCompletedHandler::create(Box::new(move |result, _status| {
                if let Err(_error) = result {
                    #[cfg(debug_assertions)]
                    eprintln!("[nebula print] {_callback_label}: {_error}");
                }
                Ok(())
            }));

            print
                .Print(&settings, &handler)
                .map_err(|error| error.to_string())
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, label, options);
        Ok(())
    }
}

#[cfg(target_os = "windows")]
unsafe fn read_pdf_stream(
    stream: &windows::Win32::System::Com::IStream,
) -> Result<Vec<u8>, String> {
    use windows::Win32::System::Com::{STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET};

    const MAX_PREVIEW_BYTES: usize = 64 * 1024 * 1024;
    let mut stat = STATSTG::default();
    stream
        .Stat(&mut stat, STATFLAG_NONAME)
        .map_err(|error| error.to_string())?;
    let size =
        usize::try_from(stat.cbSize).map_err(|_| "print preview is too large".to_string())?;
    if size == 0 || size > MAX_PREVIEW_BYTES {
        return Err("print preview is empty or exceeds 64 MB".to_string());
    }

    stream
        .Seek(0, STREAM_SEEK_SET, None)
        .map_err(|error| error.to_string())?;
    let mut bytes = vec![0u8; size];
    let mut offset = 0usize;
    while offset < bytes.len() {
        let chunk_size = (bytes.len() - offset).min(u32::MAX as usize) as u32;
        let mut read = 0u32;
        stream
            .Read(
                bytes[offset..].as_mut_ptr().cast(),
                chunk_size,
                Some(&mut read),
            )
            .ok()
            .map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        offset += read as usize;
    }
    bytes.truncate(offset);
    if bytes.starts_with(b"%PDF-") {
        Ok(bytes)
    } else {
        Err("WebView2 returned invalid PDF preview data".to_string())
    }
}

fn disable_pdf_link_annotations(bytes: &mut [u8]) -> usize {
    const SUBTYPE: &[u8] = b"/Subtype";
    const LINK: &[u8] = b"/Link";
    const INERT_SUBTYPE: &[u8] = b"Null";

    fn is_pdf_whitespace(byte: u8) -> bool {
        matches!(byte, 0 | b'\t' | b'\n' | 0x0c | b'\r' | b' ')
    }

    fn is_pdf_delimiter(byte: u8) -> bool {
        is_pdf_whitespace(byte)
            || matches!(
                byte,
                b'(' | b')' | b'<' | b'>' | b'[' | b']' | b'{' | b'}' | b'/' | b'%'
            )
    }

    let mut replacements = 0usize;
    let mut cursor = 0usize;
    while cursor + SUBTYPE.len() <= bytes.len() {
        let Some(relative) = bytes[cursor..]
            .windows(SUBTYPE.len())
            .position(|window| window == SUBTYPE)
        else {
            break;
        };
        let subtype_start = cursor + relative;
        let mut value_start = subtype_start + SUBTYPE.len();
        while value_start < bytes.len() && is_pdf_whitespace(bytes[value_start]) {
            value_start += 1;
        }

        let value_end = value_start + LINK.len();
        let is_link = value_end <= bytes.len()
            && &bytes[value_start..value_end] == LINK
            && (value_end == bytes.len() || is_pdf_delimiter(bytes[value_end]));
        if is_link {
            bytes[value_start + 1..value_end].copy_from_slice(INERT_SUBTYPE);
            replacements += 1;
        }
        cursor = subtype_start + SUBTYPE.len();
    }
    replacements
}

#[tauri::command]
pub async fn webview_print_preview(
    app: AppHandle,
    label: String,
    options: WebviewPrintOptions,
) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use base64::Engine;
        use std::sync::{Arc, Mutex};
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_16;
        use webview2_com::PrintToPdfStreamCompletedHandler;
        use windows_core::Interface;

        if !label.starts_with("nebula-tab-") {
            return Err("print preview is limited to browser tabs".to_string());
        }
        let _preview_guard = PRINT_PREVIEW_LOCK.lock().await;
        let webview = app
            .get_webview(&label)
            .ok_or_else(|| format!("webview '{label}' not found"))?;
        let (sender, receiver) = tokio::sync::oneshot::channel::<Result<String, String>>();
        let sender = Arc::new(Mutex::new(Some(sender)));
        let callback_sender = Arc::clone(&sender);

        webview
            .with_webview(move |inner| unsafe {
                let start = (|| -> Result<(), String> {
                    let core = inner
                        .controller()
                        .CoreWebView2()
                        .map_err(|error| error.to_string())?;
                    let settings = create_webview_print_settings(&core, &options)?;
                    let print: ICoreWebView2_16 = core.cast().map_err(|error| error.to_string())?;
                    let handler = PrintToPdfStreamCompletedHandler::create(Box::new(
                        move |result, stream| {
                            let preview = result
                                .map_err(|error| error.to_string())
                                .and_then(|_| {
                                    stream.ok_or_else(|| {
                                        "WebView2 returned no PDF preview stream".to_string()
                                    })
                                })
                                .and_then(|stream| read_pdf_stream(&stream))
                                .map(|mut bytes| {
                                    disable_pdf_link_annotations(&mut bytes);
                                    format!(
                                        "data:application/pdf;base64,{}",
                                        base64::engine::general_purpose::STANDARD.encode(bytes)
                                    )
                                });
                            if let Ok(mut sender) = callback_sender.lock() {
                                if let Some(sender) = sender.take() {
                                    let _ = sender.send(preview);
                                }
                            }
                            Ok(())
                        },
                    ));
                    print
                        .PrintToPdfStream(&settings, &handler)
                        .map_err(|error| error.to_string())
                })();

                if let Err(error) = start {
                    if let Ok(mut sender) = sender.lock() {
                        if let Some(sender) = sender.take() {
                            let _ = sender.send(Err(error));
                        }
                    }
                }
            })
            .map_err(|error| error.to_string())?;

        tokio::time::timeout(std::time::Duration::from_secs(30), receiver)
            .await
            .map_err(|_| format!("timed out rendering print preview for '{label}'"))?
            .map_err(|_| format!("print preview callback was dropped for '{label}'"))?
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, label, options);
        Ok(String::new())
    }
}

#[cfg(test)]
mod print_preview_tests {
    use super::disable_pdf_link_annotations;

    #[test]
    fn preview_pdf_link_annotations_are_made_inert_without_changing_offsets() {
        let mut pdf = b"%PDF-1.7\n<< /Subtype /Link /A << /S /URI >> >>\n<< /Subtype/Link/Rect [] >>\n<< /Subtype /Widget >>".to_vec();
        let original_len = pdf.len();

        assert_eq!(disable_pdf_link_annotations(&mut pdf), 2);
        assert_eq!(pdf.len(), original_len);
        assert!(!pdf
            .windows(b"/Subtype /Link".len())
            .any(|part| part == b"/Subtype /Link"));
        assert!(pdf
            .windows(b"/Subtype /Null".len())
            .any(|part| part == b"/Subtype /Null"));
        assert!(pdf
            .windows(b"/Subtype /Widget".len())
            .any(|part| part == b"/Subtype /Widget"));
    }
}

#[tauri::command]
pub fn webview_open_devtools(app: AppHandle, label: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        with_webview_result(&app, &label, |inner| unsafe {
            let core = inner
                .controller()
                .CoreWebView2()
                .map_err(|error| error.to_string())?;
            core.OpenDevToolsWindow().map_err(|error| error.to_string())
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, label);
        Ok(())
    }
}

#[tauri::command]
pub fn webview_set_memory_usage(app: AppHandle, label: String, low: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        };
        use windows_core::Interface;

        with_webview_result(&app, &label, move |inner| unsafe {
            let core = inner
                .controller()
                .CoreWebView2()
                .map_err(|error| error.to_string())?;
            let memory: ICoreWebView2_19 = core.cast().map_err(|error| error.to_string())?;
            memory
                .SetMemoryUsageTargetLevel(if low {
                    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                } else {
                    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
                })
                .map_err(|error| error.to_string())
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, label, low);
        Ok(())
    }
}

#[tauri::command]
pub fn webview_is_playing_audio(app: AppHandle, label: String) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_8;
        use windows_core::{Interface, BOOL};

        with_webview_result(&app, &label, |inner| unsafe {
            let core = inner
                .controller()
                .CoreWebView2()
                .map_err(|error| error.to_string())?;
            let media: ICoreWebView2_8 = core.cast().map_err(|error| error.to_string())?;
            let mut playing = BOOL::default();
            media
                .IsDocumentPlayingAudio(std::ptr::addr_of_mut!(playing))
                .map_err(|error| error.to_string())?;
            Ok(playing.as_bool())
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, label);
        Ok(false)
    }
}

#[tauri::command]
pub fn webview_set_muted(app: AppHandle, label: String, muted: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_8;
        use windows_core::Interface;

        with_webview_result(&app, &label, move |inner| unsafe {
            let core = inner
                .controller()
                .CoreWebView2()
                .map_err(|error| error.to_string())?;
            let media: ICoreWebView2_8 = core.cast().map_err(|error| error.to_string())?;
            media.SetIsMuted(muted).map_err(|error| error.to_string())
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, label, muted);
        Ok(())
    }
}

#[tauri::command]
pub fn webview_set_suspended(
    app: AppHandle,
    label: String,
    suspended: bool,
) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use std::sync::mpsc::sync_channel;
        use std::time::Duration;

        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_3;
        use webview2_com::TrySuspendCompletedHandler;
        use windows_core::{Interface, BOOL};

        if !label.starts_with("nebula-tab-") {
            return Err("webview suspension is limited to browser tabs".to_string());
        }

        if !suspended {
            return with_webview_result(&app, &label, |inner| unsafe {
                let core = inner
                    .controller()
                    .CoreWebView2()
                    .map_err(|error| error.to_string())?;
                let lifecycle: ICoreWebView2_3 = core.cast().map_err(|error| error.to_string())?;
                let mut is_suspended = BOOL::default();
                lifecycle
                    .IsSuspended(&mut is_suspended)
                    .map_err(|error| error.to_string())?;
                if !is_suspended.as_bool() {
                    return Ok(false);
                }
                lifecycle.Resume().map_err(|error| error.to_string())?;
                Ok(true)
            });
        }

        let webview = app
            .get_webview(&label)
            .ok_or_else(|| format!("webview '{label}' not found"))?;
        let (tx, rx) = sync_channel(1);
        let label_for_error = label.clone();

        webview
            .with_webview(move |inner| unsafe {
                let failure_tx = tx.clone();
                let handler =
                    TrySuspendCompletedHandler::create(Box::new(move |result, is_successful| {
                        let outcome = result
                            .map(|_| is_successful)
                            .map_err(|error| error.to_string());
                        let _ = tx.send(outcome);
                        Ok(())
                    }));

                let result = (|| -> windows_core::Result<()> {
                    let core = inner.controller().CoreWebView2()?;
                    let lifecycle: ICoreWebView2_3 = core.cast()?;
                    let mut is_suspended = BOOL::default();
                    lifecycle.IsSuspended(&mut is_suspended)?;
                    if is_suspended.as_bool() {
                        let _ = failure_tx.send(Ok(true));
                        return Ok(());
                    }
                    lifecycle.TrySuspend(&handler)
                })();

                if let Err(error) = result {
                    let _ = failure_tx.send(Err(error.to_string()));
                }
            })
            .map_err(|error| error.to_string())?;

        rx.recv_timeout(Duration::from_secs(3))
            .map_err(|_| format!("timed out suspending webview '{label_for_error}'"))?
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, label, suspended);
        Ok(false)
    }
}
