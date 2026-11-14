//! The engine of Nebula's own shield: it reads the filter lists that ship with the app and says, for a request, whether to let it
//! through, stop it, or answer it with a harmless stand-in.
//!
//! The matching is done by `adblock` (Brave's engine, MPL-2.0), which understands the lists' own syntax (EasyList, EasyPrivacy,
//! uBlock Origin's filters). This module is only the part of Nebula that is not the matching: which lists, what the answer is,
//! and how a request of the browser is told to the engine. It knows nothing of WebView2, so it can be tested on its own.
//!
//! The lists are in `resources/shield/lists` and are compiled into the app (`include_str!`); they are not fetched at run time.
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use adblock::lists::{FilterSet, ParseOptions};
use adblock::request::Request;
use adblock::resources::{PermissionMask, Resource};
use adblock::Engine;

/// The lists that ship with the app: (name, text). The names are what a report and the settings call them.
pub const LISTS: &[(&str, &str)] = &[
    (
        "easylist",
        include_str!("../resources/shield/lists/easylist.txt"),
    ),
    (
        "easyprivacy",
        include_str!("../resources/shield/lists/easyprivacy.txt"),
    ),
    (
        "ubo-filters",
        include_str!("../resources/shield/lists/ubo-filters.txt"),
    ),
    (
        "ubo-privacy",
        include_str!("../resources/shield/lists/ubo-privacy.txt"),
    ),
    (
        "ubo-unbreak",
        include_str!("../resources/shield/lists/ubo-unbreak.txt"),
    ),
    (
        "ubo-badware",
        include_str!("../resources/shield/lists/ubo-badware.txt"),
    ),
    ("pgl", include_str!("../resources/shield/lists/pgl.txt")),
    // Written by hand, not fetched: hiding rules for Turkish sites that the lists above (written for English ones) do not have.
    (
        "nebula-tr",
        include_str!("../resources/shield/lists/nebula-tr.txt"),
    ),
    (
        "nebula-youtube",
        include_str!("../resources/shield/lists/nebula-youtube.txt"),
    ),
];

/// uBlock Origin's scriptlets, as `scripts/build-shield-resources.mjs` writes them. They are the page half of the shield: the
/// filter lists ask for them by name (`+js(json-prune, ...)`) and the engine turns that into the script put in a page.
const SCRIPTLETS: &str = include_str!("../resources/shield/ubo-scriptlets.json");

/// What runs, in a page, the hiding rules that need the page to be looked at (`:has-text`, `:upward`, `:xpath`, `:matches-css` ...): a
/// function that is given the rules as data. See the file for what it does and does not do.
const PROCEDURAL: &str = include_str!("../resources/shield/procedural.js");

/// How many rules of that kind one page is given; a list that has more for one site is read as far as this.
const PROCEDURAL_RULES_PER_PAGE: usize = 400;

/// What the shield does with a request.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Decision {
    /// Let it through.
    Allow,
    /// Stop it. `filter` is the rule that did it, kept so that a report can say who blocked what.
    Block {
        filter: Option<String>,
        kind: BlockKind,
    },
    /// Answer it with this resource (a script or an image that does nothing) instead of letting it through, so that a page that
    /// waits for the real one is not broken by its absence.
    Redirect { resource: String, kind: BlockKind },
}

/// What kind of list stopped a request, for the breakdown the shield panel shows: the lists about trackers (EasyPrivacy, uBlock's
/// privacy list) or everything else that blocks (advertising, the person's own rules).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BlockKind {
    Ad,
    Tracker,
}

/// A rule, as it is told apart from another: its text, trimmed.
fn rule_hash(rule: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    rule.trim().hash(&mut hasher);
    hasher.finish()
}

/// The text of a list that was downloaded (not one that ships with the app). Kept behind an `Arc` so that comparing two
/// configurations does not copy it, and printed as its size, not as twelve megabytes of rules.
#[derive(Clone)]
pub struct ListText(pub Arc<String>);

impl PartialEq for ListText {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0) || self.0 == other.0
    }
}

impl Eq for ListText {}

impl std::fmt::Debug for ListText {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "ListText({} bytes)", self.0.len())
    }
}

/// What the person chose to have the shield do: which kinds of lists are on, and their own rules.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    /// Advertising (EasyList, uBlock's own filters, Peter Lowe's server list).
    pub ads: bool,
    /// Trackers (EasyPrivacy, uBlock's privacy filters).
    pub trackers: bool,
    /// Malware and scam sites (uBlock's badware filters).
    pub malware: bool,
    /// The person's own rules, one per line, in the lists' syntax. They are read without the trust the bundled lists have, so a
    /// rule of theirs cannot ask for the scriptlets that rewrite what a page receives.
    pub custom_rules: String,
    /// The list of live malware addresses (URLhaus) the person let Nebula download, if there is one. Only the site check reads
    /// it, never the requests of a page.
    pub urlhaus: Option<ListText>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            ads: true,
            trackers: true,
            malware: true,
            custom_rules: String::new(),
            urlhaus: None,
        }
    }
}

impl Config {
    /// Whether the bundled list called `name` is part of what this asks for. The list that undoes rules which break sites
    /// (`ubo-unbreak`) is always part of it: without it the other lists would break pages the person never asked to break.
    fn wants(&self, name: &str) -> bool {
        match name {
            "easylist" | "ubo-filters" | "pgl" | "nebula-tr" | "nebula-youtube" => self.ads,
            "easyprivacy" | "ubo-privacy" => self.trackers,
            "ubo-badware" => self.malware,
            _ => true,
        }
    }
}

/// The style rule an action of the engine is, when it is only a plain selector with a style (`{"selector":[{"type":"css-selector",
/// "arg":".x"}],"action":{"type":"style","arg":"min-height: 0 !important"}}`). An action that needs the page to be looked at
/// (`:has-text`, `:upward`, an XPath) is none: this page layer has no runtime to do that.
fn style_rule_of(action: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(action).ok()?;
    let selector = value.get("selector")?.as_array()?;
    let [only] = selector.as_slice() else {
        return None;
    };
    if only.get("type")?.as_str()? != "css-selector" {
        return None;
    }
    let selector = only.get("arg")?.as_str()?;
    let style = value.get("action")?;
    if style.get("type")?.as_str()? != "style" {
        return None;
    }
    let declarations = style.get("arg")?.as_str()?;
    // A selector or a declaration that could close the rule and open another is not a plain one.
    if [selector, declarations]
        .iter()
        .any(|text| text.contains('{') || text.contains('}'))
    {
        return None;
    }
    Some(format!("{selector} {{ {declarations} }}"))
}

pub struct ShieldEngine {
    engine: Engine,
    /// What decides whether a site may be opened at all: the malware lists, and nothing else. Without it a rule of an advertising
    /// list that happens to name a document would stop a page from opening.
    guard: Option<Engine>,
    config: Config,
    /// The rules of the tracker lists (their hashes), to tell which kind of list stopped a request. A hash is eight bytes where the
    /// rule is a line of text: the report has no need of the text.
    trackers: HashSet<u64>,
}

impl ShieldEngine {
    /// An engine made of the given lists. A list that cannot be read in part is read as far as it can be: the engine skips the
    /// rules it does not understand.
    #[cfg(test)]
    pub fn from_lists<'a>(lists: impl IntoIterator<Item = &'a str>) -> Self {
        Self::with_scriptlets(lists, None)
    }

    /// An engine made of the given lists and, if there are any, the scriptlets they may ask for (the JSON of
    /// `build-shield-resources.mjs`). The lists are the ones that ship with the app, so they may use the scriptlets that only a
    /// trusted list may (the ones that rewrite what a page receives).
    #[cfg(test)]
    pub fn with_scriptlets<'a>(
        lists: impl IntoIterator<Item = &'a str>,
        scriptlets: Option<&str>,
    ) -> Self {
        // The rule that decided a request is kept so that it can be named; it costs memory, which is the price of a report that
        // says why.
        let mut filters = FilterSet::new(true);
        let options = ParseOptions {
            permissions: PermissionMask::from_bits(1),
            ..ParseOptions::default()
        };
        for list in lists {
            filters.add_filter_list(list.to_string(), options);
        }
        let mut engine = Engine::new_with_filter_set(filters);
        if let Some(json) = scriptlets {
            if let Ok(resources) = serde_json::from_str::<Vec<Resource>>(json) {
                engine.use_resources(resources);
            }
        }
        Self {
            engine,
            guard: None,
            config: Config::default(),
            trackers: HashSet::new(),
        }
    }

    /// The engine of the lists and scriptlets that ship with the app, as far as `config` asks for them, and the person's own
    /// rules.
    pub fn build(config: &Config) -> Self {
        let mut filters = FilterSet::new(true);
        let trusted = ParseOptions {
            permissions: PermissionMask::from_bits(1),
            ..ParseOptions::default()
        };
        let mut trackers = HashSet::new();
        for (name, text) in LISTS.iter().filter(|(name, _)| config.wants(name)) {
            filters.add_filter_list(text.to_string(), trusted);
            if matches!(*name, "easyprivacy" | "ubo-privacy") {
                trackers.extend(
                    text.lines()
                        .map(str::trim)
                        .filter(|line| {
                            !line.is_empty() && !line.starts_with('!') && !line.starts_with('[')
                        })
                        .map(rule_hash),
                );
            }
        }
        if !config.custom_rules.trim().is_empty() {
            filters.add_filter_list(config.custom_rules.clone(), ParseOptions::default());
        }
        let mut engine = Engine::new_with_filter_set(filters);
        if let Ok(resources) = serde_json::from_str::<Vec<Resource>>(SCRIPTLETS) {
            engine.use_resources(resources);
        }
        let guard = config.malware.then(|| {
            let mut filters = FilterSet::new(true);
            for (_, text) in LISTS.iter().filter(|(name, _)| *name == "ubo-badware") {
                filters.add_filter_list(text.to_string(), ParseOptions::default());
            }
            if let Some(urlhaus) = &config.urlhaus {
                filters.add_filter_list(urlhaus.0.to_string(), ParseOptions::default());
            }
            Engine::new_with_filter_set(filters)
        });
        Self {
            engine,
            guard,
            config: config.clone(),
            trackers,
        }
    }

    /// Whether the malware lists say the page at `url` must not be opened: the rule that says so, or `None`. Only for the address
    /// of a page the person is going to (a navigation of a tab), not for what a page asks for.
    pub fn guard_document(&self, url: &str) -> Option<String> {
        let guard = self.guard.as_ref()?;
        let request = Request::new(url, url, "document", "GET").ok()?;
        let result = guard.check_network_request(&request);
        result.should_block().then(|| {
            result
                .filter
                .and_then(|info| info.raw_line)
                .unwrap_or_default()
        })
    }

    /// The engine of everything that ships with the app.
    #[cfg(test)]
    pub fn bundled() -> Self {
        Self::build(&Config::default())
    }

    /// The script to put in the page at `url` before its own scripts run: the scriptlets the lists ask for on that address, and a
    /// style that hides what the lists say to hide on it. `None` when there is nothing to do, so a page the lists do not know costs
    /// nothing. It only does anything in the top frame: the lists are about the address of the page, not of what it embeds.
    pub fn page_script(&self, url: &str) -> Option<String> {
        let resources = self.engine.url_cosmetic_resources(url);
        let mut body = String::new();
        if !resources.injected_script.is_empty() {
            body.push_str("try {\n");
            body.push_str(&resources.injected_script);
            body.push_str("\n} catch (e) {}\n");
        }
        // One rule for each selector, never one rule for the lot: a selector the browser does not understand makes the whole rule it
        // is in void, and one such selector among many hid nothing at all on YouTube.
        let mut selectors: Vec<&str> = resources
            .hide_selectors
            .iter()
            .map(String::as_str)
            .collect();
        selectors.sort_unstable();
        let mut rules: Vec<String> = selectors
            .iter()
            .map(|selector| format!("{selector} {{ display: none !important; }}"))
            .collect();
        // Rules that give an element a style of their own (`site##.banner:style(min-height: 0 !important)`) come from the engine
        // as actions: the ones that are only a plain selector and a style are the same thing as a rule.
        rules.extend(
            resources
                .procedural_actions
                .iter()
                .filter_map(|action| style_rule_of(action)),
        );
        // The rules that are more than a selector and a style (`:has-text`, `:upward`, `:xpath` ...): the page runs them (see
        // `PROCEDURAL`). Sorted, so that the same page gets the same script every time.
        let mut procedural: Vec<&String> = resources
            .procedural_actions
            .iter()
            .filter(|action| style_rule_of(action).is_none())
            .collect();
        procedural.sort_unstable();
        let procedural: Vec<serde_json::Value> = procedural
            .into_iter()
            .filter_map(|action| serde_json::from_str(action).ok())
            .take(PROCEDURAL_RULES_PER_PAGE)
            .collect();
        if !procedural.is_empty() {
            if let Ok(data) = serde_json::to_string(&procedural) {
                body.push_str(&format!(
                    "try {{ ({})({}); }} catch (e) {{}}\n",
                    PROCEDURAL.trim_end(),
                    data
                ));
            }
        }
        if !rules.is_empty() {
            let css = rules.join("\n");
            let css = serde_json::to_string(&css).unwrap_or_else(|_| "\"\"".to_string());
            // The script runs before the page has a document element, so there may be nowhere to put the style yet: it waits for
            // the first one to appear. (Putting it at once and finding nothing to put it in hid nothing at all.)
            body.push_str(&format!(
                "try {{ const css = {css}; const put = () => {{ const root = document.head || document.documentElement; if (!root) {{ return false; }} const style = document.createElement('style'); style.textContent = css; root.appendChild(style); return true; }}; if (!put()) {{ const watch = new MutationObserver(() => {{ if (put()) {{ watch.disconnect(); }} }}); watch.observe(document, {{ childList: true }}); }} }} catch (e) {{}}\n"
            ));
        }
        if body.is_empty() {
            return None;
        }
        Some(format!(
            "(function () {{\nif (window !== window.top) {{ return; }}\n{body}}})();"
        ))
    }

    /// What to do with a request of `request_type` (the engine's words: "script", "image", "xhr", "document" ...) to `url` made
    /// by the page `source_url`. An address the engine cannot read is let through: the shield never breaks what it cannot judge.
    pub fn decide(&self, url: &str, source_url: &str, request_type: &str) -> Decision {
        // The last word is the method of the request; the engine only uses it for rules that name one.
        let Ok(request) = Request::new(url, source_url, request_type, "") else {
            return Decision::Allow;
        };
        let result = self.engine.check_network_request(&request);
        // An exception rule lets the request through unless a rule marked `important` stopped it first.
        if !result.should_block() {
            return Decision::Allow;
        }
        let kind = match result
            .filter
            .as_ref()
            .and_then(|info| info.raw_line.as_deref())
        {
            Some(rule) if self.trackers.contains(&rule_hash(rule)) => BlockKind::Tracker,
            _ => BlockKind::Ad,
        };
        if let Some(resource) = result.redirect {
            return Decision::Redirect { resource, kind };
        }
        Decision::Block {
            filter: result.filter.and_then(|info| info.raw_line),
            kind,
        }
    }
}

/// The engine in use. It is replaced as a whole when the person changes what they want, so a request being judged keeps the
/// engine it started with.
static ENGINE: RwLock<Option<Arc<ShieldEngine>>> = RwLock::new(None);
/// What the engine should be made of now, and whether a thread is busy making it.
static WANTED: Mutex<Option<Config>> = Mutex::new(None);
static BUILDING: AtomicBool = AtomicBool::new(false);
/// Which engine is in use: a number that grows with every engine that is put in place. What was made with one engine (the script of a
/// page) is out of date when the number has moved.
static EPOCH: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// The number of the engine in use (see `EPOCH`).
pub fn epoch() -> u64 {
    EPOCH.load(Ordering::SeqCst)
}
/// What was stopped for the page of each tab.
static BLOCKED: Mutex<Option<HashMap<String, PageStats>>> = Mutex::new(None);

/// How many different addresses of one page are told apart; a page that asks for more than this still counts, it is only the list of
/// who was stopped that stops growing.
const PAGE_HOSTS_KEPT: usize = 256;

#[derive(Clone, Default)]
struct PageStats {
    ads: u32,
    trackers: u32,
    hosts: HashMap<String, u32>,
}

/// One address among those a page had stopped, and how many of its requests were.
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
pub struct HostCount {
    pub host: String,
    pub count: u32,
}

/// What the shield stopped for the page of a tab: the totals by kind and the addresses it stopped most.
#[derive(Clone, Debug, Default, Eq, PartialEq, serde::Serialize)]
pub struct PageSummary {
    pub total: u32,
    pub ads: u32,
    pub trackers: u32,
    pub top: Vec<HostCount>,
}

/// The site an address belongs to, as a person knows it (`cdn.tracker.example` is `tracker.example`); an address that is a number
/// stays as it is.
fn site_of(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    match parsed.host()? {
        url::Host::Domain(domain) => {
            let domain = domain.to_ascii_lowercase();
            Some(
                psl::domain_str(&domain)
                    .map(str::to_string)
                    .unwrap_or(domain),
            )
        }
        other => Some(other.to_string()),
    }
}

/// What the shield has stopped since the person last cleared it, on this device only. It is kept in a file in the app's data (see
/// `stats_file`) and goes nowhere.
#[derive(Clone, Debug, Default, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Totals {
    pub ads: u64,
    pub trackers: u64,
    pub malware: u64,
    /// When the count began (milliseconds since 1970).
    pub since_ms: u64,
}

static TOTALS: Mutex<Totals> = Mutex::new(Totals {
    ads: 0,
    trackers: 0,
    malware: 0,
    since_ms: 0,
});
static TOTALS_DIRTY: AtomicBool = AtomicBool::new(false);

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

fn stats_file(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    use tauri::Manager;
    Some(
        app.path()
            .app_local_data_dir()
            .ok()?
            .join("shield")
            .join("stats.json"),
    )
}

/// What was stopped so far, in total.
pub fn totals() -> Totals {
    TOTALS
        .lock()
        .map(|totals| totals.clone())
        .unwrap_or_default()
}

/// Starts the count again from nothing.
pub fn reset_totals(app: &tauri::AppHandle) {
    if let Ok(mut totals) = TOTALS.lock() {
        *totals = Totals {
            since_ms: now_ms(),
            ..Totals::default()
        };
    }
    TOTALS_DIRTY.store(true, Ordering::SeqCst);
    flush_totals(app);
}

/// A page the malware check refused to open.
pub fn note_malware_page() {
    if let Ok(mut totals) = TOTALS.lock() {
        totals.malware += 1;
        TOTALS_DIRTY.store(true, Ordering::SeqCst);
    }
}

/// Reads the totals kept in the file, and starts a thread that writes them back (at most every twenty seconds, and only when they
/// changed) so that a count that is going up all the time is not a write every time.
fn start_totals(app: &tauri::AppHandle) {
    if let Some(file) = stats_file(app) {
        let read = std::fs::read_to_string(&file)
            .ok()
            .and_then(|text| serde_json::from_str::<Totals>(&text).ok());
        if let Ok(mut totals) = TOTALS.lock() {
            *totals = read.unwrap_or_else(|| Totals {
                since_ms: now_ms(),
                ..Totals::default()
            });
        }
    }
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(20));
        flush_totals(&app);
    });
}

/// Writes the totals if they changed since they were last written. The file is made whole or not at all (written aside, then put
/// in place), so that a power cut does not leave half of it.
pub fn flush_totals(app: &tauri::AppHandle) {
    if !TOTALS_DIRTY.swap(false, Ordering::SeqCst) {
        return;
    }
    let (Some(file), Ok(text)) = (stats_file(app), serde_json::to_string(&totals())) else {
        return;
    };
    if let Some(folder) = file.parent() {
        let _ = std::fs::create_dir_all(folder);
    }
    let aside = file.with_extension("json.tmp");
    if std::fs::write(&aside, text).is_ok() && std::fs::rename(&aside, &file).is_err() {
        let _ = std::fs::remove_file(&aside);
        TOTALS_DIRTY.store(true, Ordering::SeqCst);
    }
}

/// A list that ships with the app, for the page of the settings that tells which lists the shield is made of.
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
pub struct ListInfo {
    pub name: &'static str,
    pub rules: usize,
    /// Written by Nebula (and not made from a list somebody else keeps).
    pub own: bool,
}

pub fn list_info() -> Vec<ListInfo> {
    LISTS
        .iter()
        .map(|(name, text)| ListInfo {
            name,
            rules: text
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty() && !line.starts_with('!') && !line.starts_with('['))
                .count(),
            own: name.starts_with("nebula-"),
        })
        .collect()
}

/// The engine, once it is ready. Until then (a fraction of a second after the first tab asks for the shield) requests are let
/// through: the shield never holds a page back to wait for itself.
pub fn engine() -> Option<Arc<ShieldEngine>> {
    ENGINE.read().ok().and_then(|engine| engine.clone())
}

/// The downloaded malware list changed (or went away): the engine is made again with it, in the configuration last asked for.
pub fn set_urlhaus(list: Option<ListText>) {
    let wanted = WANTED.lock().ok().and_then(|wanted| wanted.clone());
    if let Some(mut config) = wanted {
        config.urlhaus = list;
        configure(&config);
    }
}

/// Says what the engine should be made of. If it is not that already, a thread of its own builds the new one and puts it in
/// place when it is ready; until then the old one (or none) keeps judging. Asking for what is already there, or already being
/// built, does nothing, so every tab may ask on every change of settings.
pub fn configure(config: &Config) {
    if engine().is_some_and(|engine| engine.config == *config) {
        return;
    }
    {
        let Ok(mut wanted) = WANTED.lock() else {
            return;
        };
        if wanted.as_ref() == Some(config) {
            return;
        }
        *wanted = Some(config.clone());
    }
    if BUILDING.swap(true, Ordering::SeqCst) {
        // The thread that is building will see the new wish when it is done.
        return;
    }
    std::thread::spawn(|| loop {
        let Some(config) = WANTED.lock().ok().and_then(|wanted| wanted.clone()) else {
            BUILDING.store(false, Ordering::SeqCst);
            return;
        };
        // An engine that cannot be made (a list the engine chokes on) must not leave the shield stuck as "being made" for good: the
        // one in use stays, and the next change of settings tries again.
        let Ok(built) = std::panic::catch_unwind(|| ShieldEngine::build(&config)) else {
            if let Ok(mut wanted) = WANTED.lock() {
                *wanted = None;
            }
            BUILDING.store(false, Ordering::SeqCst);
            return;
        };
        let built = Arc::new(built);
        if let Ok(mut engine) = ENGINE.write() {
            *engine = Some(built);
            EPOCH.fetch_add(1, Ordering::SeqCst);
        }
        let still_wanted = WANTED.lock().ok().and_then(|wanted| wanted.clone());
        if still_wanted.as_ref() == Some(&config) {
            BUILDING.store(false, Ordering::SeqCst);
            return;
        }
    });
}

/// One more request of this tab was stopped: `url` is what it asked for, `kind` what kind of list stopped it.
pub fn note_blocked(label: &str, kind: BlockKind, url: &str) {
    let site = site_of(url);
    if let Ok(mut counts) = BLOCKED.lock() {
        let page = counts
            .get_or_insert_with(HashMap::new)
            .entry(label.to_string())
            .or_default();
        match kind {
            BlockKind::Ad => page.ads += 1,
            BlockKind::Tracker => page.trackers += 1,
        }
        if let Some(site) = site {
            if page.hosts.contains_key(&site) || page.hosts.len() < PAGE_HOSTS_KEPT {
                *page.hosts.entry(site).or_insert(0) += 1;
            }
        }
    }
    if let Ok(mut totals) = TOTALS.lock() {
        match kind {
            BlockKind::Ad => totals.ads += 1,
            BlockKind::Tracker => totals.trackers += 1,
        }
        TOTALS_DIRTY.store(true, Ordering::SeqCst);
    }
}

/// The file whose presence says the person turned the shield off. The settings live in the window (its local storage); the app
/// side only needs to know, when it starts, whether to have the engine ready before the first page, and this is how it knows.
fn off_marker(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    use tauri::Manager;
    Some(
        app.path()
            .app_local_data_dir()
            .ok()?
            .join("shield")
            .join("off"),
    )
}

/// Starts making the engine as the app starts, unless the shield was left off, so that it is ready before the first page: a link
/// that starts the app would otherwise be loaded while the engine is still being made, and that page would not be protected. What
/// is made is the usual engine; when the window then says something else is wanted (their own rules, a list off), it is made again.
pub fn start_at_launch(app: &tauri::AppHandle) {
    start_totals(app);
    if off_marker(app).is_some_and(|marker| marker.exists()) {
        return;
    }
    configure(&Config::default());
}

/// What the window says about the shield (on or off) is remembered for the next start.
pub fn remember_choice(app: &tauri::AppHandle, on: bool) {
    use std::sync::atomic::AtomicU8;
    // 0: not known yet, 1: on, 2: off. The window says it with every tab and every change, so only a change is written.
    static LAST: AtomicU8 = AtomicU8::new(0);
    let now = if on { 1 } else { 2 };
    if LAST.swap(now, Ordering::SeqCst) == now {
        return;
    }
    let Some(marker) = off_marker(app) else {
        return;
    };
    if on {
        let _ = std::fs::remove_file(&marker);
    } else if let Some(folder) = marker.parent() {
        let _ = std::fs::create_dir_all(folder);
        let _ = std::fs::write(&marker, b"");
    }
}

/// A page is being loaded in this tab: what was stopped for the page before is not counted for this one.
pub fn start_page(label: &str) {
    if let Ok(mut counts) = BLOCKED.lock() {
        if let Some(map) = counts.as_mut() {
            map.remove(label);
        }
    }
}

/// The tab is gone.
pub fn forget(label: &str) {
    start_page(label);
    if let Ok(mut allowed) = ALLOWED.lock() {
        if let Some(map) = allowed.as_mut() {
            map.remove(label);
        }
    }
}

/// The sites the person chose to open anyway, by tab: the host of the address, as the page that stopped it was shown.
static ALLOWED: Mutex<Option<HashMap<String, std::collections::HashSet<String>>>> =
    Mutex::new(None);

fn host_of(url: &str) -> Option<String> {
    let parsed = reqwest::Url::parse(url).ok()?;
    parsed.host_str().map(|host| host.to_ascii_lowercase())
}

/// The person chose to open this site in this tab anyway: it is not stopped again here, until the tab is closed.
pub fn allow_site(label: &str, url: &str) {
    let Some(host) = host_of(url) else {
        return;
    };
    if let Ok(mut allowed) = ALLOWED.lock() {
        allowed
            .get_or_insert_with(HashMap::new)
            .entry(label.to_string())
            .or_default()
            .insert(host);
    }
}

/// Whether the person already chose to open the site at `url` in this tab.
pub fn site_is_allowed(label: &str, url: &str) -> bool {
    let Some(host) = host_of(url) else {
        return false;
    };
    ALLOWED
        .lock()
        .ok()
        .and_then(|allowed| {
            allowed
                .as_ref()
                .and_then(|map| map.get(label).map(|hosts| hosts.contains(&host)))
        })
        .unwrap_or(false)
}

#[cfg(test)]
/// How many requests of this tab were stopped since its page began loading. The interface shows it in the site panel.
pub fn blocked_count(label: &str) -> u32 {
    page_summary(label).total
}

/// What the shield stopped for the page of this tab, with the five addresses it stopped most (the most first; equal counts in
/// alphabetical order, so that the list does not shuffle between two looks at it).
pub fn page_summary(label: &str) -> PageSummary {
    let Some(page) = BLOCKED
        .lock()
        .ok()
        .and_then(|counts| counts.as_ref().and_then(|map| map.get(label).cloned()))
    else {
        return PageSummary::default();
    };
    let mut hosts: Vec<HostCount> = page
        .hosts
        .into_iter()
        .map(|(host, count)| HostCount { host, count })
        .collect();
    hosts.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.host.cmp(&b.host)));
    hosts.truncate(5);
    PageSummary {
        total: page.ads + page.trackers,
        ads: page.ads,
        trackers: page.trackers,
        top: hosts,
    }
}

/// What a stopped request is answered with, so that the page gets something it can live with: a script that does nothing, an
/// empty image, a refusal for a call it made itself. Returns (status, reason, headers). The header lets a measurement tell this
/// shield's answers from a page's own.
pub fn stand_in_for(request_type: &str) -> (i32, &'static str, &'static str) {
    match request_type {
        "script" => (
            200,
            "Blocked by Nebula Shield",
            "Content-Type: text/javascript\r\nCache-Control: no-store\r\nX-Nebula-Shield: blocked",
        ),
        "xhr" | "fetch" | "ping" | "csp_report" | "beacon" => (
            403,
            "Blocked by Nebula Shield",
            "Cache-Control: no-store\r\nX-Nebula-Shield: blocked",
        ),
        _ => (
            204,
            "Blocked by Nebula Shield",
            "Cache-Control: no-store\r\nX-Nebula-Shield: blocked",
        ),
    }
}

/// The stand-in a `$redirect=` rule names: the engine hands it over as a `data:` address (`data:application/javascript;base64,...`);
/// this gives its type and its bytes, so that the page can be answered with it. `None` for anything that is not one.
pub fn stand_in_body(resource: &str) -> Option<(String, Vec<u8>)> {
    use base64::Engine as _;
    let rest = resource.strip_prefix("data:")?;
    let (mime, data) = rest.split_once(";base64,")?;
    let body = base64::engine::general_purpose::STANDARD
        .decode(data)
        .ok()?;
    Some((mime.to_string(), body))
}

/// The engine's word for what a request of the browser is, from the kind WebView2 gives it (`COREWEBVIEW2_WEB_RESOURCE_CONTEXT`).
pub fn request_type_for_context(context: i32) -> &'static str {
    match context {
        1 => "document",
        2 => "stylesheet",
        3 => "image",
        4 => "media",
        5 => "font",
        6 => "script",
        7 => "xhr",
        8 => "fetch",
        9 => "other",
        10 => "other",
        11 => "websocket",
        12 => "other",
        13 => "other",
        14 => "ping",
        15 => "csp_report",
        _ => "other",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    fn small() -> ShieldEngine {
        ShieldEngine::from_lists([
            "||ads.example.com^\n||tracker.test^$third-party\n@@||ads.example.com/allowed^\n",
        ])
    }

    #[test]
    fn a_request_the_lists_name_is_stopped_and_the_rule_is_kept() {
        let engine = small();
        let decision = engine.decide(
            "https://ads.example.com/banner.js",
            "https://news.example.org/",
            "script",
        );
        assert_eq!(
            decision,
            Decision::Block {
                filter: Some("||ads.example.com^".to_string()),
                kind: BlockKind::Ad,
            }
        );
    }

    #[test]
    fn an_exception_in_the_lists_lets_the_request_through() {
        let engine = small();
        assert_eq!(
            engine.decide(
                "https://ads.example.com/allowed/x.js",
                "https://news.example.org/",
                "script"
            ),
            Decision::Allow
        );
    }

    #[test]
    fn a_rule_for_third_party_requests_leaves_the_sites_own_alone() {
        let engine = small();
        assert!(matches!(
            engine.decide(
                "https://tracker.test/p.gif",
                "https://news.example.org/",
                "image"
            ),
            Decision::Block { .. }
        ));
        assert_eq!(
            engine.decide(
                "https://tracker.test/p.gif",
                "https://tracker.test/",
                "image"
            ),
            Decision::Allow
        );
    }

    #[test]
    fn an_address_that_cannot_be_read_is_let_through() {
        let engine = small();
        assert_eq!(
            engine.decide("not a url", "https://news.example.org/", "script"),
            Decision::Allow
        );
        assert_eq!(
            engine.decide("", "https://news.example.org/", "script"),
            Decision::Allow
        );
    }

    #[test]
    fn a_page_the_lists_know_gets_the_scriptlets_asked_for_and_one_they_do_not_know_only_the_generic_hiding(
    ) {
        let engine = ShieldEngine::bundled();
        let script = engine
            .page_script("https://www.youtube.com/watch?v=abc")
            .expect("the lists have scriptlets for YouTube");
        // YouTube's player data is rewritten before the player reads it, and only in the top frame.
        assert!(
            script.contains("adPlacements"),
            "{}",
            &script[..script.len().min(400)]
        );
        assert!(script.contains("window !== window.top"));
        // A page the lists do not name still gets the generic hiding rules (an empty ad slot is hidden everywhere), but none of
        // YouTube's scriptlets.
        let unknown = engine
            .page_script("https://no-such-site.invalid/")
            .expect("generic hiding rules apply everywhere");
        assert!(!unknown.contains("adPlacements"));
        assert!(unknown.len() < 100_000, "{} bytes", unknown.len());
    }

    #[test]
    fn a_hiding_rule_of_a_list_becomes_a_style_put_in_the_page() {
        let engine =
            ShieldEngine::from_lists(["news.example##.ad-banner\nnews.example##.sponsored\n"]);
        let script = engine
            .page_script("https://news.example/story")
            .expect("hiding rules for news.example");
        assert!(script.contains(".ad-banner"));
        // The script runs before the page has a document element: it must wait for one, not fail silently.
        assert!(script.contains("new MutationObserver"), "{script}");
        assert!(script.contains("watch.observe(document, { childList: true })"));
        assert!(script.contains(".sponsored"));
        // Each selector has a rule of its own, so that one the browser cannot read does not take the others with it.
        assert!(
            script.contains(".ad-banner { display: none !important; }"),
            "{script}"
        );
        assert!(
            script.contains(".sponsored { display: none !important; }"),
            "{script}"
        );
        assert!(script.contains("display: none !important"));
        // Another site gets none of news.example's rules.
        assert!(engine
            .page_script("https://other.example/")
            .is_none_or(|script| !script.contains(".ad-banner")));
    }

    #[test]
    fn the_server_list_of_peter_lowe_is_among_the_lists_and_stops_its_hosts() {
        let (_, text) = LISTS
            .iter()
            .find(|(name, _)| *name == "pgl")
            .expect("the list ships");
        let host = text
            .lines()
            .find_map(|line| {
                line.strip_prefix("||")
                    .and_then(|rest| rest.strip_suffix('^'))
            })
            .expect("a host rule");
        let engine = ShieldEngine::from_lists([*text]);
        assert!(
            matches!(
                engine.decide(
                    &format!("https://{host}/x.js"),
                    "https://news.example/",
                    "script"
                ),
                Decision::Block { .. }
            ),
            "{host}"
        );
    }

    #[test]
    fn the_hiding_rules_for_turkish_sites_close_the_boxes_the_advertisements_leave_and_follow_the_advertising_switch(
    ) {
        let on = ShieldEngine::build(&Config::default());
        let off = ShieldEngine::build(&Config {
            ads: false,
            ..Config::default()
        });
        for (page, selector) in [
            (
                "https://www.hurriyet.com.tr/",
                "section.adv.masthead-header",
            ),
            (
                "https://www.hurriyet.com.tr/gundem/x-1/",
                ".medyanet-header",
            ),
            ("https://www.sabah.com.tr/", "div.advert.w300"),
            ("https://www.haberturk.com/", ".masthead-top"),
            ("https://www.milliyet.com.tr/", ".card-ads"),
            ("https://www.fanatik.com.tr/", ".adRenderer.dfp"),
            ("https://www.cnnturk.com/", "div.adv.adv-desktop"),
            ("https://www.sozcu.com.tr/", "div.ad.masthead"),
            ("https://www.ntv.com.tr/", ".js-gpt-ad"),
            ("https://www.mynet.com/", "div.col-adv"),
            ("https://www.webtekno.com/", "div.adv-col"),
            ("https://www.takvim.com.tr/", "div.advert"),
            ("https://www.haber7.com/", ".subhead-ad"),
            // The style is a string of the script: its quotes have a backslash.
            ("https://www.sporx.com/", r#"div[id^=\"dfp_\"]"#),
            ("https://www.donanimhaber.com/", ".reklam-kare"),
            ("https://shiftdelete.net/", ".sd-ad"),
            ("https://www.yenisafak.com/", ".banner-ad-gap-masthead"),
            ("https://arsiv.mackolik.com/", "div.top-banner"),
            ("https://www.transfermarkt.com.tr/", "div.werbung"),
            ("https://www.transfermarkt.de/", "div.werbung"),
        ] {
            let script = on.page_script(page).unwrap_or_default();
            assert!(script.contains(selector), "{page} {selector}");
            assert!(
                off.page_script(page)
                    .is_none_or(|script| !script.contains(selector)),
                "{page}: with the advertising lists off it is not hidden"
            );
        }
        // Another site gets none of them.
        assert!(on
            .page_script("https://www.example.com/")
            .is_none_or(|script| !script.contains(".medyanet-header")));
    }

    #[test]
    fn the_answer_of_youtubes_get_watch_request_is_cleaned_like_the_one_of_the_player_request_and_follows_the_advertising_switch(
    ) {
        let on = ShieldEngine::build(&Config::default());
        let off = ShieldEngine::build(&Config {
            ads: false,
            ..Config::default()
        });
        let page = "https://www.youtube.com/watch?v=abc";
        let script = on.page_script(page).unwrap_or_default();
        assert!(script.contains("get_watch?"), "{script}");
        assert!(script.contains("no_playerAds"), "{script}");
        assert!(off
            .page_script(page)
            .is_none_or(|script| !script.contains("get_watch?")));
    }

    #[test]
    fn the_kinds_of_lists_the_person_turned_off_are_not_in_the_engine() {
        let page = "https://news.example/";
        let blocked = |engine: &ShieldEngine, url: &str| {
            !matches!(engine.decide(url, page, "script"), Decision::Allow)
        };
        let all = ShieldEngine::build(&Config::default());
        let no_ads = ShieldEngine::build(&Config {
            ads: false,
            ..Config::default()
        });
        let no_trackers = ShieldEngine::build(&Config {
            trackers: false,
            ..Config::default()
        });
        // A server that only the lists of one kind know: the first host of such a list that the other kind does not stop.
        let only = |list: &str, without: &ShieldEngine| {
            let (_, text) = LISTS
                .iter()
                .find(|(name, _)| *name == list)
                .expect("the list ships");
            text.lines()
                .filter_map(|line| {
                    line.strip_prefix("||")
                        .and_then(|rest| rest.strip_suffix('^'))
                })
                .map(|host| format!("https://{host}/x.js"))
                .find(|url| blocked(&all, url) && !blocked(without, url))
                .expect("a server only that kind of list stops")
        };
        let ad = only("pgl", &no_ads);
        let tracker = only("easyprivacy", &no_trackers);
        assert!(!blocked(&no_ads, &ad), "the advertising lists are off");
        assert!(blocked(&no_ads, &tracker), "the tracker lists are not");
        assert!(
            blocked(&no_trackers, &ad),
            "the advertising lists are not off"
        );
        assert!(!blocked(&no_trackers, &tracker), "the tracker lists are");
    }

    #[test]
    fn the_persons_own_rules_stop_what_they_name_and_cannot_ask_for_a_trusted_scriptlet() {
        let engine = ShieldEngine::build(&Config {
            custom_rules: "||annoying.example^\nnews.example##+js(trusted-replace-fetch-response, a, b)\nnews.example##.promo\n"
                .to_string(),
            ..Config::default()
        });
        assert!(matches!(
            engine.decide(
                "https://annoying.example/x.js",
                "https://news.example/",
                "script"
            ),
            Decision::Block { .. }
        ));
        let script = engine
            .page_script("https://news.example/")
            .expect("their hiding rule");
        assert!(script.contains(".promo"));
        assert!(
            !script.contains("trusted-replace-fetch-response"),
            "a rule of the person is read without the trust of the bundled lists"
        );
    }

    #[test]
    fn a_change_of_what_the_person_wants_replaces_the_engine_while_it_keeps_judging() {
        let wait_for = |wanted: &Config| {
            let started = std::time::Instant::now();
            loop {
                if engine().is_some_and(|engine| engine.config == *wanted) {
                    return;
                }
                assert!(
                    started.elapsed() < std::time::Duration::from_secs(120),
                    "the engine was not built"
                );
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        };
        let first = Config {
            custom_rules: "||first.example^
"
            .to_string(),
            ..Config::default()
        };
        configure(&first);
        // Asking again for the same does not start another build.
        configure(&first);
        wait_for(&first);
        let page = "https://news.example/";
        assert!(matches!(
            engine()
                .unwrap()
                .decide("https://first.example/a.js", page, "script"),
            Decision::Block { .. }
        ));
        let second = Config {
            custom_rules: "||second.example^
"
            .to_string(),
            ..Config::default()
        };
        configure(&second);
        let old = engine().unwrap();
        wait_for(&second);
        let new = engine().unwrap();
        assert!(matches!(
            new.decide("https://second.example/a.js", page, "script"),
            Decision::Block { .. }
        ));
        assert_eq!(
            new.decide("https://first.example/a.js", page, "script"),
            Decision::Allow
        );
        // The engine a request already holds is not changed under it.
        assert!(matches!(
            old.decide("https://first.example/a.js", page, "script"),
            Decision::Block { .. }
        ));
    }

    #[test]
    fn a_site_on_the_malware_lists_is_not_opened_and_any_other_is() {
        let engine = ShieldEngine::bundled();
        // A network the bundled badware list names with `$all`: a page of it is stopped, and the rule is kept.
        let rule = engine
            .guard_document("https://buzzadnetwork.com/landing?x=1")
            .expect("the badware list names this network");
        assert!(rule.contains("buzzadnetwork.com"), "{rule}");
        assert_eq!(engine.guard_document("https://example.com/"), None);
        assert_eq!(
            engine.guard_document("https://www.youtube.com/watch?v=abc"),
            None
        );
        // Only the malware lists count for a page: an advertising server is stopped as a request, not as a site.
        assert_eq!(
            engine.guard_document("https://securepubads.g.doubleclick.net/"),
            None
        );
        assert_eq!(engine.guard_document("not a url"), None);
    }

    #[test]
    fn the_site_check_is_off_with_the_malware_lists_and_knows_the_downloaded_list() {
        let off = ShieldEngine::build(&Config {
            malware: false,
            ..Config::default()
        });
        assert_eq!(off.guard_document("https://buzzadnetwork.com/"), None);
        let downloaded = ListText(Arc::new(
            "! Title: Online Malicious URL Blocklist
||203.0.113.9^$document
||payload.example^$document
"
            .to_string(),
        ));
        let with = ShieldEngine::build(&Config {
            urlhaus: Some(downloaded.clone()),
            ..Config::default()
        });
        assert!(with
            .guard_document("http://203.0.113.9/payload.exe")
            .is_some());
        assert!(with.guard_document("https://payload.example/").is_some());
        assert_eq!(with.guard_document("https://example.com/"), None);
        // The list is not used for what a page asks for, only for pages: a request to that address is not its business.
        assert_eq!(
            with.decide(
                "http://203.0.113.9/pixel.gif",
                "https://news.example/",
                "image"
            ),
            Decision::Allow
        );
        // The same text is the same configuration, a different one is not.
        let same = Config {
            urlhaus: Some(ListText(Arc::new((*downloaded.0).clone()))),
            ..Config::default()
        };
        assert_eq!(
            same,
            Config {
                urlhaus: Some(downloaded),
                ..Config::default()
            }
        );
        assert_ne!(same, Config::default());
    }

    #[test]
    fn a_site_opened_anyway_stays_open_in_that_tab_only_and_for_that_site_only() {
        let tab = "tab-continue";
        assert!(!site_is_allowed(tab, "https://bad.example/a"));
        allow_site(tab, "https://Bad.Example/a");
        assert!(
            site_is_allowed(tab, "https://bad.example/other?x=1"),
            "the same host, whatever the path"
        );
        assert!(
            site_is_allowed(tab, "http://bad.example/"),
            "and the other scheme: a redirect to it is the same choice"
        );
        assert!(!site_is_allowed(tab, "https://other.example/"));
        assert!(!site_is_allowed("tab-elsewhere", "https://bad.example/"));
        allow_site(tab, "not a url");
        forget(tab);
        assert!(
            !site_is_allowed(tab, "https://bad.example/"),
            "closing the tab forgets it"
        );
    }

    #[test]
    fn what_youtubes_player_checks_for_a_blocker_gets_the_answer_a_page_without_one_would_give() {
        let engine = ShieldEngine::bundled();
        // The player loads this script to see whether advertising is blocked, and waits for an answer when it finds none. The lists
        // do not say "block" for it but "answer with a script that says all is well" (a redirect rule of uBlock's main list, which
        // is only in the list when its yearly pieces are put together).
        let decision = engine.decide(
            "https://static.doubleclick.net/instream/ad_status.js",
            "https://www.youtube.com/watch?v=abc",
            "script",
        );
        let Decision::Redirect { resource, .. } = decision else {
            panic!("expected a redirect, got {decision:?}");
        };
        let (mime, body) = stand_in_body(&resource).expect("a data address");
        assert_eq!(mime, "application/javascript");
        assert!(String::from_utf8_lossy(&body).contains("google_ad_status"));
    }

    #[test]
    fn a_rule_that_gives_an_element_a_style_is_put_in_the_page_and_one_that_needs_the_page_looked_at_is_run_by_the_page(
    ) {
        let engine = ShieldEngine::from_lists([concat!(
            "news.example##.slot:style(min-height: 0 !important)\n",
            "news.example##.plain\n",
            "news.example##.promo:has-text(Sponsored)\n",
        )]);
        let script = engine
            .page_script("https://news.example/story")
            .expect("rules for news.example");
        assert!(
            script.contains(".slot { min-height: 0 !important }"),
            "{script}"
        );
        assert!(script.contains(".plain { display: none !important; }"));
        // A selector that needs the page looked at is not a style rule (the browser cannot read it): the page is given it as data.
        assert!(!script.contains(".promo:has-text(Sponsored) {"), "{script}");
        assert!(
            script.contains(
                r#"{"arg":".promo","type":"css-selector"},{"arg":"Sponsored","type":"has-text"}"#
            ),
            "{script}"
        );
        assert_eq!(style_rule_of("not json"), None);
        assert_eq!(
            style_rule_of(r#"{"selector":[{"type":"css-selector","arg":".a"}],"action":{"type":"style","arg":"color: red"}}"#).as_deref(),
            Some(".a { color: red }")
        );
        assert_eq!(
            style_rule_of(
                r#"{"selector":[{"type":"css-selector","arg":".a"},{"type":"has-text","arg":"x"}],"action":{"type":"style","arg":"color: red"}}"#
            ),
            None
        );
        assert_eq!(
            style_rule_of(
                r#"{"selector":[{"type":"css-selector","arg":".a"}],"action":{"type":"remove"}}"#
            ),
            None
        );
        assert_eq!(
            style_rule_of(
                r#"{"selector":[{"type":"css-selector","arg":".a"}],"action":{"type":"style","arg":"color: red } body { display: none"}}"#
            ),
            None,
            "a declaration cannot open another rule"
        );
    }

    #[test]
    fn a_page_that_starts_loading_begins_its_count_again() {
        note_blocked("tab-page", BlockKind::Ad, "https://a.example/x.js");
        note_blocked("tab-page", BlockKind::Ad, "https://a.example/y.js");
        assert_eq!(blocked_count("tab-page"), 2);
        start_page("tab-page");
        assert_eq!(blocked_count("tab-page"), 0);
        note_blocked("tab-page", BlockKind::Ad, "https://a.example/x.js");
        forget("tab-page");
        assert_eq!(blocked_count("tab-page"), 0);
    }

    #[test]
    fn a_redirect_rule_is_answered_with_the_stand_in_it_names() {
        let engine = ShieldEngine::bundled();
        let rule = "||ads.example^$script,redirect=noopjs\n";
        let engine_with_rule = ShieldEngine::with_scriptlets([rule], Some(SCRIPTLETS));
        let Decision::Redirect { resource, .. } = engine_with_rule.decide(
            "https://ads.example/show.js",
            "https://news.example/",
            "script",
        ) else {
            panic!("the rule redirects");
        };
        let (mime, body) = stand_in_body(&resource).expect("a data address");
        assert_eq!(mime, "application/javascript");
        assert!(!body.is_empty());
        // The bundled lists use the same stand-ins for what they redirect: a legacy `+js(nofab.js)` line finds its script.
        assert!(engine
            .page_script("https://www.youtube.com/watch?v=abc")
            .is_some());
        assert_eq!(stand_in_body("https://example.com/"), None);
    }

    #[test]
    fn a_stopped_request_gets_the_answer_its_kind_can_live_with_and_the_mark_of_the_shield() {
        assert_eq!(stand_in_for("script").0, 200);
        assert_eq!(stand_in_for("fetch").0, 403);
        assert_eq!(stand_in_for("xhr").0, 403);
        assert_eq!(stand_in_for("image").0, 204);
        for kind in ["script", "fetch", "image", "other"] {
            assert!(
                stand_in_for(kind).2.contains("X-Nebula-Shield: blocked"),
                "{kind}"
            );
        }
    }

    #[test]
    fn what_was_stopped_is_counted_per_tab() {
        note_blocked("tab-a", BlockKind::Ad, "https://a.example/x.js");
        note_blocked("tab-a", BlockKind::Tracker, "https://a.example/y.js");
        note_blocked("tab-b", BlockKind::Ad, "https://a.example/x.js");
        assert_eq!(blocked_count("tab-a"), 2);
        assert_eq!(blocked_count("tab-b"), 1);
        assert_eq!(blocked_count("tab-unknown"), 0);
    }

    #[test]
    fn what_was_stopped_is_told_by_kind_and_by_the_site_that_was_stopped_most() {
        let label = "tab-summary";
        for url in [
            "https://cdn.tracker.example/a.js",
            "https://pixel.tracker.example/b.gif",
            "https://www.tracker.example/c.js",
        ] {
            note_blocked(label, BlockKind::Tracker, url);
        }
        note_blocked(label, BlockKind::Ad, "https://ads.other.example/x.js");
        note_blocked(label, BlockKind::Ad, "https://ads.other.example/y.js");
        note_blocked(label, BlockKind::Ad, "https://192.0.2.7/z.js");
        let summary = page_summary(label);
        assert_eq!(summary.total, 6);
        assert_eq!(summary.ads, 3);
        assert_eq!(summary.trackers, 3);
        assert_eq!(
            summary.top,
            vec![
                HostCount {
                    host: "tracker.example".into(),
                    count: 3
                },
                HostCount {
                    host: "other.example".into(),
                    count: 2
                },
                HostCount {
                    host: "192.0.2.7".into(),
                    count: 1
                },
            ],
            "the most first, a number address as it is"
        );
        start_page(label);
        assert_eq!(page_summary(label), PageSummary::default());
    }

    #[test]
    fn a_page_that_asks_for_a_great_many_sites_is_still_counted_but_only_so_many_are_told_apart() {
        let label = "tab-many";
        for n in 0..(PAGE_HOSTS_KEPT + 50) {
            note_blocked(label, BlockKind::Ad, &format!("https://site{n}.test/x.js"));
        }
        // One of the sites that were kept goes on counting.
        note_blocked(label, BlockKind::Ad, "https://site0.test/again.js");
        let page = BLOCKED
            .lock()
            .unwrap()
            .as_ref()
            .and_then(|map| map.get(label).cloned())
            .unwrap();
        assert_eq!(page.hosts.len(), PAGE_HOSTS_KEPT);
        assert_eq!(page_summary(label).total as usize, PAGE_HOSTS_KEPT + 51);
        forget(label);
    }

    #[test]
    fn a_request_stopped_by_a_tracker_list_is_a_tracker_and_one_by_the_others_an_advertisement() {
        let engine = ShieldEngine::bundled();
        let page = "https://news.example/";
        let first_host = |list: &str, wants: BlockKind| {
            let (_, text) = LISTS
                .iter()
                .find(|(name, _)| *name == list)
                .expect("the list ships");
            text.lines()
                .filter_map(|line| {
                    line.strip_prefix("||")
                        .and_then(|rest| rest.strip_suffix('^'))
                })
                .map(|host| format!("https://{host}/x.js"))
                .find(|url| {
                    matches!(
                        engine.decide(url, page, "script"),
                        Decision::Block { kind, .. } if kind == wants
                    )
                })
        };
        assert!(
            first_host("easyprivacy", BlockKind::Tracker).is_some(),
            "a host of the tracker list is a tracker"
        );
        assert!(
            first_host("pgl", BlockKind::Ad).is_some(),
            "a host of the server list is an advertisement"
        );
    }

    #[test]
    fn the_lists_that_ship_are_told_with_their_rule_counts_and_who_wrote_them() {
        let lists = list_info();
        assert_eq!(lists.len(), LISTS.len());
        assert!(lists.iter().all(|list| list.rules > 0), "{lists:?}");
        let own: Vec<_> = lists
            .iter()
            .filter(|list| list.own)
            .map(|list| list.name)
            .collect();
        assert_eq!(own, vec!["nebula-tr", "nebula-youtube"]);
        assert!(lists
            .iter()
            .any(|list| list.name == "easylist" && !list.own));
    }

    #[test]
    fn a_hiding_rule_that_needs_the_page_to_be_looked_at_is_given_to_the_page_as_data_and_a_plain_one_is_not(
    ) {
        let rules = "news.example##.card:has-text(Sponsored)\n\
                     news.example##div.row:upward(2)\n\
                     news.example##.plain\n\
                     news.example##.tall:style(min-height: 0 !important)\n\
                     other.example##.x:has-text(y)\n";
        let engine = ShieldEngine::from_lists([rules]);
        let script = engine
            .page_script("https://news.example/story")
            .expect("rules for this site");
        assert!(script.contains("\"has-text\""), "{script}");
        assert!(script.contains("\"Sponsored\""));
        assert!(script.contains("\"upward\""));
        // The function that runs them is in the page, and what is only a selector (or a selector and a style) is still a style rule.
        assert!(script.contains("const matcherOf"));
        assert!(script.contains(".plain { display: none !important; }"));
        assert!(script.contains(".tall { min-height: 0 !important }"));
        assert!(!script.contains("\"y\""), "another site's rule is not here");
        // A page that has no such rule is not given the function.
        let only_plain = ShieldEngine::from_lists(["news.example##.plain\n"]);
        let script = only_plain.page_script("https://news.example/").unwrap();
        assert!(!script.contains("const matcherOf"), "{script}");
    }

    #[test]
    fn the_kinds_of_requests_of_the_browser_have_the_engines_words() {
        assert_eq!(request_type_for_context(1), "document");
        assert_eq!(request_type_for_context(6), "script");
        assert_eq!(request_type_for_context(7), "xhr");
        assert_eq!(request_type_for_context(8), "fetch");
        assert_eq!(request_type_for_context(11), "websocket");
        assert_eq!(request_type_for_context(14), "ping");
        assert_eq!(request_type_for_context(99), "other");
    }

    #[test]
    fn the_lists_that_ship_with_the_app_stop_the_advertising_a_page_asks_for_and_leave_the_page_alone(
    ) {
        let started = Instant::now();
        let engine = ShieldEngine::bundled();
        let built = started.elapsed();
        eprintln!("the engine of {} lists was built in {built:?}", LISTS.len());

        let page = "https://www.youtube.com/watch?v=abc";
        for (url, kind) in [
            ("https://googleads.g.doubleclick.net/pagead/id", "script"),
            (
                "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",
                "script",
            ),
            ("https://www.google-analytics.com/analytics.js", "script"),
            ("https://www.googletagmanager.com/gtm.js?id=GTM-X", "script"),
        ] {
            assert!(
                matches!(
                    engine.decide(url, page, kind),
                    Decision::Block { .. } | Decision::Redirect { .. }
                ),
                "{url}"
            );
        }
        for (url, kind) in [
            ("https://www.youtube.com/watch?v=abc", "document"),
            ("https://i.ytimg.com/vi/abc/hqdefault.jpg", "image"),
            ("https://www.gstatic.com/youtube/img/x.png", "image"),
        ] {
            assert_eq!(engine.decide(url, page, kind), Decision::Allow, "{url}");
        }
    }

    // A debug build runs the matching a hundred times slower and says nothing about the app, so this is run on purpose with the
    // engine's crates optimised: cargo test --lib --features extension-native-smoke --config profile.dev.package.adblock.opt-level=3
    // (and the same for regex, regex-automata, regex-syntax, memchr, aho-corasick) shield -- --ignored --nocapture
    #[test]
    #[ignore = "needs an optimised engine, see the comment"]
    fn deciding_is_fast_enough_for_every_request_of_a_page() {
        let engine = ShieldEngine::bundled();
        let page = "https://www.youtube.com/watch?v=abc";
        let urls = [
            "https://www.youtube.com/s/player/abc/player_ias.vflset/en_US/base.js",
            "https://rr1---sn-q4flrnez.googlevideo.com/videoplayback?expire=1&ei=a&ip=1.1.1.1&id=o-A&itag=18",
            "https://googleads.g.doubleclick.net/pagead/id",
            "https://i.ytimg.com/vi/abc/hqdefault.jpg",
            "https://fonts.gstatic.com/s/roboto/v30/x.woff2",
        ];
        let started = Instant::now();
        let mut count = 0u32;
        for _ in 0..2000 {
            for url in urls {
                let _ = engine.decide(url, page, "script");
                count += 1;
            }
        }
        let per_request = started.elapsed() / count;
        eprintln!("{count} decisions, {per_request:?} each");
        // Generous on purpose: this is a guard against the engine being used in a way that is not fast, not a benchmark.
        assert!(per_request.as_micros() < 500, "{per_request:?} per request");
    }
}
