//! The script that makes what a page can read about the machine slightly different for each site (see
//! `resources/shield/fingerprint.js` for what it changes and what it leaves).
//!
//! The one decision made here is the number that script is given: the *seed*. It is the same for every page of one site (the
//! registrable domain: `www.example.com` and `shop.example.com` are one) for as long as the app runs, and different for every other
//! site, so a site always sees the same machine and two sites do not see the same one. It is made from a secret that is new every
//! time the app starts, so it cannot be worked out from outside and does not outlive the session.
use std::collections::hash_map::RandomState;
use std::hash::BuildHasher;
use std::sync::OnceLock;

/// The script, with `__SEED__` where its number goes.
const TEMPLATE: &str = include_str!("../resources/shield/fingerprint.js");

/// What the seeds are made with: new for every run of the app.
static SECRET: OnceLock<RandomState> = OnceLock::new();

/// The site an address belongs to for this purpose: its registrable domain, or the host itself when it has none (an address of
/// numbers, `localhost`). `None` for anything that is not a web page.
pub fn site_of(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return None;
    }
    match parsed.host()? {
        // An address of numbers is its own site (a list of public suffixes knows nothing of them: it reads 127.0.0.1 as "0.1").
        url::Host::Ipv4(address) => Some(address.to_string()),
        url::Host::Ipv6(address) => Some(address.to_string()),
        url::Host::Domain(domain) => {
            let host = domain.trim_end_matches('.').to_ascii_lowercase();
            if host.is_empty() {
                return None;
            }
            Some(psl::domain_str(&host).map(str::to_string).unwrap_or(host))
        }
    }
}

/// The number for a site.
pub fn seed_for(site: &str) -> u32 {
    let value = SECRET.get_or_init(RandomState::new).hash_one(site);
    (value ^ (value >> 32)) as u32
}

/// The site the script is made for and the script itself, for the page at `url`; `None` when the address is not a web page.
pub fn script_for(url: &str) -> Option<(String, String)> {
    let site = site_of(url)?;
    let script = TEMPLATE.replace("__SEED__", &seed_for(&site).to_string());
    Some((site, script))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_site_is_its_registrable_domain_and_only_web_pages_have_one() {
        assert_eq!(
            site_of("https://www.example.com/a?b=1").as_deref(),
            Some("example.com")
        );
        assert_eq!(
            site_of("https://shop.example.com/").as_deref(),
            Some("example.com")
        );
        assert_eq!(
            site_of("https://news.bbc.co.uk/").as_deref(),
            Some("bbc.co.uk")
        );
        assert_eq!(
            site_of("http://127.0.0.1:8080/x").as_deref(),
            Some("127.0.0.1")
        );
        assert_eq!(site_of("http://localhost/").as_deref(), Some("localhost"));
        assert_eq!(
            site_of("https://Example.COM./").as_deref(),
            Some("example.com")
        );
        for not_a_page in [
            "about:blank",
            "data:text/html,hi",
            "file:///C:/a.html",
            "not a url",
            "https://",
        ] {
            assert_eq!(site_of(not_a_page), None, "{not_a_page}");
        }
    }

    #[test]
    fn a_site_keeps_its_number_for_the_whole_run_and_other_sites_have_other_ones() {
        let a = seed_for("example.com");
        assert_eq!(a, seed_for("example.com"));
        assert_ne!(a, seed_for("example.org"));
        assert_ne!(seed_for("a.test"), seed_for("b.test"));
        let first = script_for("https://www.example.com/one").unwrap();
        let second = script_for("https://shop.example.com/two").unwrap();
        assert_eq!(first, second, "one site, one script, whatever the page");
        assert_ne!(first.1, script_for("https://example.org/").unwrap().1);
    }

    #[test]
    fn the_script_gets_its_number_and_nothing_is_left_to_fill_in() {
        let (site, script) = script_for("https://example.com/").unwrap();
        assert_eq!(site, "example.com");
        assert!(!script.contains("__SEED__"));
        let number = seed_for("example.com").to_string();
        assert!(
            script.contains(&format!("const SEED = {number} >>> 0;")),
            "the number is in its place"
        );
        assert!(script_for("about:blank").is_none());
        // The template has exactly one place for it.
        assert_eq!(TEMPLATE.matches("__SEED__").count(), 1);
    }
}
