//! A hint on the error page when an extension is routing the browser's traffic through a proxy.
//!
//! A VPN extension that says "connected" but whose proxy servers cannot be reached (a network that
//! blocks them) makes every site fail with a plain timeout, and nothing on the page says why. When a
//! page fails with a network-type error and an extension controls the proxy right now, the error
//! page gets one more line naming it. The question is asked after the error page is shown, off the
//! main thread, and the answer is kept for a short while: most failures cost nothing, and an
//! installation without a proxy extension never asks the browser anything.
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// How long the answer of the last check is reused.
const ANSWER_LIFETIME: Duration = Duration::from_secs(20);

/// The hint, in the user's language. `names` is already joined ("A, B").
pub(crate) fn hint_text(locale: &str, names: &str) -> String {
    match locale {
        "tr" => format!("{names} eklentisi bu bağlantıyı bir proxy üzerinden yönlendiriyor. Proxy sunucusuna ulaşılamıyorsa hiçbir site açılmaz. Eklentinin bağlantısını kesip tekrar deneyin."),
        "es" => format!("{names} está enviando esta conexión a través de un proxy. Si no se puede llegar al servidor proxy, ningún sitio se cargará. Desconecta la extensión y vuelve a intentarlo."),
        "de" => format!("{names} leitet diese Verbindung über einen Proxy. Ist der Proxy-Server nicht erreichbar, lädt keine Website. Trenne die Erweiterung und versuche es erneut."),
        "fr" => format!("{names} fait passer cette connexion par un proxy. Si le serveur proxy est injoignable, aucun site ne se charge. Déconnectez l’extension et réessayez."),
        "id" => format!("{names} mengalirkan koneksi ini lewat proxy. Jika server proxy tidak dapat dijangkau, tidak ada situs yang akan dimuat. Putuskan ekstensi lalu coba lagi."),
        "ru" => format!("{names} направляет это соединение через прокси. Если прокси-сервер недоступен, ни один сайт не загрузится. Отключите расширение и повторите попытку."),
        "it" => format!("{names} instrada questa connessione tramite un proxy. Se il server proxy non è raggiungibile, nessun sito si carica. Disconnetti l’estensione e riprova."),
        "ja" => format!("{names} がこの接続をプロキシ経由にしています。プロキシサーバーに接続できないと、どのサイトも読み込まれません。拡張機能の接続を切ってからもう一度お試しください。"),
        _ => format!("{names} is routing this connection through a proxy. If the proxy server cannot be reached, no site will load. Disconnect the extension and try again."),
    }
}

/// The script that adds the hint to the error page. The text travels as a JSON string and is
/// set with `textContent`; the script only acts on Nebula's own error page (a `data:` page with
/// its retry button) and only once.
pub(crate) fn hint_script(text: &str) -> String {
    let text = serde_json::to_string(text).unwrap_or_else(|_| "\"\"".to_string());
    format!(
        r#"(() => {{
  if (!location.href.startsWith('data:text/html') || !document.getElementById('retry')) return;
  if (document.getElementById('proxy-hint')) return;
  const actions = document.querySelector('.actions');
  if (!actions || !actions.parentNode) return;
  const hint = document.createElement('p');
  hint.id = 'proxy-hint';
  hint.textContent = {text};
  hint.style.cssText = 'color:#d8c9f4;max-width:460px;margin:-6px 0 22px;font-size:14px';
  actions.parentNode.insertBefore(hint, actions);
}})();"#
    )
}

/// Joins names for the sentence: "A", "A, B".
pub(crate) fn join_names(names: &[String]) -> String {
    names.join(", ")
}

struct Answer {
    at: Instant,
    names: Vec<String>,
}

static LAST: OnceLock<Mutex<Option<Answer>>> = OnceLock::new();
/// One check at a time: pages that fail together wait for the same answer.
static ASKING: OnceLock<Mutex<()>> = OnceLock::new();

fn fresh_answer() -> Option<Vec<String>> {
    let last = LAST.get_or_init(|| Mutex::new(None)).lock().ok()?;
    last.as_ref()
        .filter(|answer| answer.at.elapsed() < ANSWER_LIFETIME)
        .map(|answer| answer.names.clone())
}

fn controlling_extensions(app: &tauri::AppHandle) -> Vec<String> {
    if let Some(names) = fresh_answer() {
        return names;
    }
    let Ok(_asking) = ASKING.get_or_init(|| Mutex::new(())).lock() else {
        return Vec::new();
    };
    // Someone else may have asked while this one waited.
    if let Some(names) = fresh_answer() {
        return names;
    }
    #[cfg(target_os = "windows")]
    let names = crate::extension_host::proxy_controlling_extensions(app);
    #[cfg(not(target_os = "windows"))]
    let names = {
        let _ = app;
        Vec::new()
    };
    if let Ok(mut last) = LAST.get_or_init(|| Mutex::new(None)).lock() {
        *last = Some(Answer {
            at: Instant::now(),
            names: names.clone(),
        });
    }
    names
}

/// After a network-type error page was shown in `label`: if an extension controls the proxy, tell
/// the user so on that page. Returns at once; the work happens on its own thread.
pub(crate) fn offer(app: &tauri::AppHandle, label: &str, locale: &str) {
    let (app, label, locale) = (app.clone(), label.to_string(), locale.to_string());
    std::thread::spawn(move || {
        let names = controlling_extensions(&app);
        if names.is_empty() {
            return;
        }
        let script = hint_script(&hint_text(&locale, &join_names(&names)));
        if let Some(webview) = tauri::Manager::get_webview(&app, &label) {
            let _ = webview.eval(script);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_language_names_the_extension_and_tells_what_to_do() {
        for locale in ["tr", "en", "de", "es", "fr", "id", "ru", "it", "ja", "xx"] {
            let text = hint_text(locale, "Proton VPN");
            assert!(text.contains("Proton VPN"), "{locale}");
            assert!(text.chars().count() > 50, "{locale}");
        }
        assert!(hint_text("tr", "A").contains("proxy"));
    }

    #[test]
    fn the_script_carries_the_text_as_data_and_only_touches_the_error_page() {
        let hostile = "x\"; document.body.remove(); //</script>";
        let script = hint_script(hostile);
        // The text is a JSON string literal set with textContent, never markup or code.
        assert!(script.contains("textContent = \"x\\\"; document.body.remove(); //<"));
        assert!(!script.contains("innerHTML"));
        // Only Nebula's own error page, and only once.
        assert!(script.contains("startsWith('data:text/html')"));
        assert!(script.contains("getElementById('retry')"));
        assert!(script.contains("getElementById('proxy-hint')"));
    }

    #[test]
    fn names_are_joined_for_the_sentence() {
        assert_eq!(join_names(&["A".to_string()]), "A");
        assert_eq!(join_names(&["A".to_string(), "B".to_string()]), "A, B");
    }
}
