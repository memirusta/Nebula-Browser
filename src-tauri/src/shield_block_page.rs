//! The page that takes the place of a site Nebula's shield stopped from opening (an address on the malware and scam lists).
//!
//! It says what happened in the person's language and offers two ways out: back to where they were, and "continue anyway" for the
//! day a list is wrong. A page of a site has no channel to the app (Nebula masks `window.chrome.webview` from every page, its own
//! error pages included), so "continue anyway" is a navigation to an address that cannot exist (`CONTINUE_URL`) carrying a code that
//! only this page was given. Nebula sees that navigation start, cancels it, remembers the choice for that site in that tab (see
//! `shield::allow_site`) and opens the real address. A site cannot do the same: it has never seen a code.
//!
//! This module only makes the page and keeps the codes; showing it is `tab_error_page::show_blocked_site`.
use std::collections::hash_map::RandomState;
use std::collections::VecDeque;
use std::hash::{BuildHasher, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};

use crate::tab_error_page::ErrorPageTheme;

/// The address "continue anyway" goes to. `.invalid` never resolves, and the navigation is cancelled before it could be tried.
pub const CONTINUE_URL: &str = "https://nebula-shield.invalid/continue?code=";

/// The address a navigation to `uri` is a request to continue to, if it is one: it must be this address with the code of a page that
/// was shown and not yet continued from. The code is used up.
pub fn continue_target(uri: &str) -> Option<String> {
    let code = uri.strip_prefix(CONTINUE_URL)?;
    if code.is_empty() || code.len() > 64 || !code.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    take(code)
}

/// What the page says, in one language.
pub struct BlockCopy {
    pub lang: &'static str,
    pub title: &'static str,
    pub body: &'static str,
    pub back: &'static str,
    pub proceed: &'static str,
    pub hint: &'static str,
}

pub fn copy(locale: &str) -> BlockCopy {
    match locale {
        "tr" => BlockCopy {
            lang: "tr",
            title: "Bu site engellendi",
            body: "Nebula’nın kalkanı bu adresi engelledi: dolandırıcılık, istenmeyen yazılım ya da zararlı yazılım yaydığı bilinen bir ağa ait.",
            back: "Geri dön",
            proceed: "Yine de devam et",
            hint: "Listeler bazen yanılır. Siteye güveniyorsan devam edebilirsin; bu sekmede bu site için bir daha sorulmaz.",
        },
        "es" => BlockCopy {
            lang: "es",
            title: "Este sitio fue bloqueado",
            body: "El escudo de Nebula bloqueó esta dirección porque pertenece a una red conocida por estafas, software no deseado o malware.",
            back: "Volver",
            proceed: "Continuar de todos modos",
            hint: "Las listas a veces se equivocan. Si confías en el sitio, puedes continuar; Nebula no volverá a preguntar por este sitio en esta pestaña.",
        },
        "de" => BlockCopy {
            lang: "de",
            title: "Diese Website wurde blockiert",
            body: "Der Schutz von Nebula hat diese Adresse blockiert, weil sie zu einem Netzwerk gehört, das für Betrug, unerwünschte Software oder Schadsoftware bekannt ist.",
            back: "Zurück",
            proceed: "Trotzdem fortfahren",
            hint: "Listen irren sich manchmal. Wenn du der Website vertraust, kannst du fortfahren; Nebula fragt in diesem Tab für diese Website nicht erneut.",
        },
        "fr" => BlockCopy {
            lang: "fr",
            title: "Ce site a été bloqué",
            body: "La protection de Nebula a bloqué cette adresse car elle appartient à un réseau connu pour des arnaques, des logiciels indésirables ou des logiciels malveillants.",
            back: "Retour",
            proceed: "Continuer quand même",
            hint: "Les listes se trompent parfois. Si vous faites confiance à ce site, vous pouvez continuer ; Nebula ne redemandera pas pour ce site dans cet onglet.",
        },
        "id" => BlockCopy {
            lang: "id",
            title: "Situs ini diblokir",
            body: "Perlindungan Nebula memblokir alamat ini karena termasuk jaringan yang dikenal untuk penipuan, perangkat lunak yang tidak diinginkan, atau malware.",
            back: "Kembali",
            proceed: "Tetap lanjutkan",
            hint: "Daftar kadang keliru. Jika Anda memercayai situs ini, Anda dapat melanjutkan; Nebula tidak akan bertanya lagi untuk situs ini di tab ini.",
        },
        "ru" => BlockCopy {
            lang: "ru",
            title: "Сайт заблокирован",
            body: "Защита Nebula заблокировала этот адрес: он принадлежит сети, известной мошенничеством, нежелательным или вредоносным ПО.",
            back: "Назад",
            proceed: "Всё равно продолжить",
            hint: "Списки иногда ошибаются. Если вы доверяете сайту, можно продолжить; Nebula больше не спросит об этом сайте в этой вкладке.",
        },
        "it" => BlockCopy {
            lang: "it",
            title: "Questo sito è stato bloccato",
            body: "La protezione di Nebula ha bloccato questo indirizzo perché appartiene a una rete nota per truffe, software indesiderato o malware.",
            back: "Indietro",
            proceed: "Continua comunque",
            hint: "Gli elenchi a volte sbagliano. Se ti fidi del sito, puoi continuare; Nebula non lo chiederà più per questo sito in questa scheda.",
        },
        "ja" => BlockCopy {
            lang: "ja",
            title: "このサイトはブロックされました",
            body: "Nebula の保護機能は、詐欺や迷惑ソフト、マルウェアで知られるネットワークに属しているため、このアドレスをブロックしました。",
            back: "戻る",
            proceed: "それでも続行",
            hint: "リストが誤っていることもあります。信頼できるサイトであれば続行できます。このタブでは、このサイトについて再度確認しません。",
        },
        _ => BlockCopy {
            lang: "en",
            title: "This site was blocked",
            body: "Nebula’s shield blocked this address because it belongs to a network known for scams, unwanted software or malware.",
            back: "Go back",
            proceed: "Continue anyway",
            hint: "Lists sometimes get it wrong. If you trust this site, you can continue; Nebula will not ask again for this site in this tab.",
        },
    }
}

/// Text that goes inside an HTML element or a quoted attribute.
fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

/// The page, as HTML. `logo` is the base64 of the Nebula mark; `code` is what the page sends back to ask to continue.
pub fn page_html(
    url: &str,
    locale: &str,
    theme: &ErrorPageTheme,
    code: &str,
    logo: &str,
) -> String {
    let text = copy(locale);
    let display_url = escape_html(url);
    // `code` is made of hex digits only; it is still quoted as a script string, never trusted as markup.
    let continue_js = serde_json::to_string(&format!("{CONTINUE_URL}{code}"))
        .unwrap_or_else(|_| "\"\"".to_string());
    let scheme = if theme.dark { "dark" } else { "light" };
    let (base, ink, muted, border, surface, accent, strong, on) = (
        &theme.base,
        &theme.text,
        &theme.muted,
        &theme.border,
        &theme.surface,
        &theme.accent,
        &theme.strong,
        &theme.on,
    );
    let (lang, title, body, back, proceed, hint) = (
        text.lang,
        text.title,
        text.body,
        text.back,
        text.proceed,
        text.hint,
    );
    format!(
        r#"<!DOCTYPE html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nebula</title>
<style>
  :root {{
    color-scheme: {scheme};
    --base: {base};
    --text: {ink};
    --muted: {muted};
    --border: {border};
    --surface: {surface};
    --accent: {accent};
    --strong: {strong};
    --on: {on};
  }}
  * {{ box-sizing: border-box; margin: 0; }}
  body {{
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: var(--base);
    color: var(--text);
    font: 16px/1.5 "Segoe UI", system-ui, sans-serif;
    padding: 24px;
    text-align: center;
  }}
  .glyph {{ width: 56px; height: 56px; margin-bottom: 20px; border-radius: 16px; overflow: hidden; }}
  .glyph img {{ width: 100%; height: 100%; display: block; }}
  h1 {{ font-size: 22px; font-weight: 700; margin-bottom: 8px; letter-spacing: -0.01em; }}
  p {{ color: var(--muted); max-width: 440px; margin-bottom: 20px; }}
  .url {{ max-width: min(620px, 88vw); margin: -6px 0 24px; font-size: 13px; overflow-wrap: anywhere; }}
  .actions {{ display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }}
  button {{
    background: linear-gradient(135deg, var(--strong), var(--accent));
    color: var(--on);
    border: none;
    padding: 12px 24px;
    border-radius: 10px;
    font: inherit;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
  }}
  button:hover {{ filter: brightness(1.07); }}
  button:focus-visible {{ outline: 2px solid var(--accent); outline-offset: 3px; }}
  button:disabled {{ opacity: 0.6; cursor: default; filter: none; }}
  button.secondary {{ background: var(--surface); color: var(--text); border: 1px solid var(--border); }}
  .hint {{ max-width: 460px; margin: 22px 0 0; color: var(--muted); font-size: 13px; line-height: 1.55; }}
  .brand {{ position: fixed; bottom: 16px; color: var(--muted); opacity: 0.6; font-size: 13px; letter-spacing: 0.08em; }}
</style>
</head>
<body>
  <div class="glyph"><img src="data:image/png;base64,{logo}" alt=""></div>
  <h1>{title}</h1>
  <p>{body}</p>
  <div class="url">{display_url}</div>
  <div class="actions">
    <button type="button" id="back">{back}</button>
    <button type="button" id="proceed" class="secondary">{proceed}</button>
  </div>
  <p class="hint">{hint}</p>
  <div class="brand">NEBULA</div>
  <script>
    document.getElementById('back').onclick = () => {{
      if (history.length > 1) history.back();
      else location.replace('about:blank');
    }};
    const proceed = document.getElementById('proceed');
    proceed.onclick = () => {{
      proceed.disabled = true;
      location.href = {continue_js};
    }};
  </script>
</body>
</html>"#
    )
}

/// The pages shown and not yet continued from: the address each was made for, by the code it was given. Bounded, so an endless
/// run of blocked redirects cannot grow it.
const MAX_PAGES: usize = 32;
static PAGES: LazyLock<Mutex<VecDeque<(String, String)>>> =
    LazyLock::new(|| Mutex::new(VecDeque::new()));
static COUNTER: AtomicU64 = AtomicU64::new(1);

/// A new code for a page that is about to be shown for `url`: unpredictable (a hasher seeded at random for this process), and
/// different every time.
pub fn register(url: &str) -> String {
    let mut hasher = RandomState::new().build_hasher();
    hasher.write_u64(COUNTER.fetch_add(1, Ordering::Relaxed));
    let code = format!("{:016x}", hasher.finish());
    if let Ok(mut pages) = PAGES.lock() {
        pages.push_back((code.clone(), url.to_string()));
        while pages.len() > MAX_PAGES {
            pages.pop_front();
        }
    }
    code
}

/// The address a page with this code was made for, once: a second message with the same code finds nothing.
pub fn take(code: &str) -> Option<String> {
    let mut pages = PAGES.lock().ok()?;
    let at = pages.iter().position(|(known, _)| known == code)?;
    pages.remove(at).map(|(_, url)| url)
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOCALES: [&str; 9] = ["en", "tr", "es", "de", "fr", "id", "ru", "it", "ja"];

    #[test]
    fn every_language_has_all_of_the_texts_and_they_differ_from_english_unless_they_are_english() {
        let english = copy("en");
        for locale in LOCALES {
            let text = copy(locale);
            assert_eq!(text.lang, locale);
            for part in [text.title, text.body, text.back, text.proceed, text.hint] {
                assert!(!part.trim().is_empty(), "{locale}");
            }
            if locale != "en" {
                assert_ne!(text.title, english.title, "{locale}");
                assert_ne!(text.proceed, english.proceed, "{locale}");
            }
        }
        assert_eq!(
            copy("xx").lang,
            "en",
            "a language without texts gets English"
        );
    }

    #[test]
    fn the_page_shows_the_address_as_text_and_asks_to_continue_with_its_code_only() {
        let theme = ErrorPageTheme::default();
        let html = page_html(
            "https://bad.example/a?x=<script>alert(1)</script>&y=\"'",
            "en",
            &theme,
            "00ab00ab00ab00ab",
            "LOGO",
        );
        assert!(html.contains(
            "https://bad.example/a?x=&lt;script&gt;alert(1)&lt;/script&gt;&amp;y=&quot;&#39;"
        ));
        assert!(
            !html.contains("<script>alert(1)"),
            "the address is never markup"
        );
        assert!(html.contains("\"https://nebula-shield.invalid/continue?code=00ab00ab00ab00ab\""));
        assert!(
            !html.contains("postMessage"),
            "a page has no channel to the app"
        );
        // The address itself is not in the script: the page cannot be made to open another one.
        let script = &html[html.rfind("<script>").unwrap()..];
        assert!(!script.contains("bad.example"));
        assert!(html.contains("This site was blocked"));
        assert!(html.contains("color-scheme: dark"));
    }

    #[test]
    fn a_code_is_used_once_and_belongs_to_one_address() {
        let first = register("https://one.example/");
        let second = register("https://two.example/");
        assert_ne!(first, second);
        assert_eq!(take("not-a-code"), None);
        assert_eq!(take(&second).as_deref(), Some("https://two.example/"));
        assert_eq!(
            take(&second),
            None,
            "a second message with the same code is ignored"
        );
        assert_eq!(take(&first).as_deref(), Some("https://one.example/"));
    }

    #[test]
    fn only_the_continue_address_with_a_live_code_is_a_request_to_continue() {
        let code = register("https://bad.example/page");
        let address = format!("{CONTINUE_URL}{code}");
        assert_eq!(
            continue_target(&format!("{CONTINUE_URL}zzzz")),
            None,
            "not a code"
        );
        assert_eq!(continue_target(CONTINUE_URL), None);
        assert_eq!(
            continue_target(&format!("{CONTINUE_URL}{code}x")),
            None,
            "not a code that was given"
        );
        assert_eq!(
            continue_target("https://nebula-shield.invalid/other?code=abc"),
            None
        );
        assert_eq!(
            continue_target(&format!("http://evil.example/continue?code={code}")),
            None,
            "only this address"
        );
        assert_eq!(
            continue_target(&address).as_deref(),
            Some("https://bad.example/page")
        );
        assert_eq!(continue_target(&address), None, "a code is used once");
    }

    #[test]
    fn the_codes_that_are_waiting_are_bounded() {
        let first = register("https://first.example/");
        for index in 0..MAX_PAGES {
            register(&format!("https://page{index}.example/"));
        }
        assert_eq!(take(&first), None, "the oldest was dropped");
    }
}
