//! Chrome behaviour WebView2 does not reproduce, applied to a package when it is
//! prepared for registration.
//!
//! WebView2 reports the window Nebula opens for an extension's popup or side panel
//! as a browser tab, so messages from inside it carry `sender.tab`; Chrome sends
//! none. WebView2 offers no hook on extension messaging, and entering a worker
//! from the outside (DevTools) is racy and can leave it hung, so the one
//! dependable place to correct this is inside the worker, before the extension's
//! own code runs.
//!
//! Nothing the extension shipped is edited. Two files are added and the manifest's
//! `background.service_worker` points at the first: it loads the shim, then the
//! original worker. The result is a pure function of the verified package, so
//! preparing the same package twice gives identical bytes.
use serde_json::Value;
use std::path::PathBuf;

pub(crate) const SHIM_FILE: &str = "nebula-compat.js";
pub(crate) const ENTRY_FILE: &str = "nebula-compat-entry.js";
const SHIM_SOURCE: &str = include_str!("extension_compat_shim.js");

type Entries = Vec<(PathBuf, Vec<u8>)>;

/// Only plain relative paths are rewritten into an `import`/`importScripts`
/// string. Anything else keeps the extension as it shipped.
fn plain_worker_path(value: &str) -> Option<&str> {
    let path = value.trim_start_matches("./");
    let path = path.strip_prefix('/').unwrap_or(path);
    (!path.is_empty()
        && path
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-' | b'/'))
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != ".."))
    .then_some(path)
}

fn entry_source(worker: &str, module: bool) -> String {
    if module {
        // Static imports evaluate in order: the shim first, then the extension.
        format!("import \"./{SHIM_FILE}\";\nimport \"./{worker}\";\n")
    } else {
        format!("importScripts(\"{SHIM_FILE}\", \"{worker}\");\n")
    }
}

/// Add the compatibility entry to a package. Packages without a service worker, or
/// with one whose path is unusual, are returned untouched.
pub(crate) fn apply(mut entries: Entries, manifest: &Value) -> Result<(Entries, Value), String> {
    let Some(worker) = manifest
        .pointer("/background/service_worker")
        .and_then(Value::as_str)
        .and_then(plain_worker_path)
        .map(str::to_string)
    else {
        return Ok((entries, manifest.clone()));
    };
    let taken = |name: &str| {
        entries.iter().any(|(path, _)| {
            path.to_str()
                .is_some_and(|p| p.replace('\\', "/").eq_ignore_ascii_case(name))
        })
    };
    if taken(SHIM_FILE) || taken(ENTRY_FILE) {
        return Err("The package already contains Nebula compatibility file names".into());
    }
    let module = manifest.pointer("/background/type").and_then(Value::as_str) == Some("module");
    let mut updated = manifest.clone();
    updated["background"]["service_worker"] = Value::String(ENTRY_FILE.into());
    let manifest_bytes = serde_json::to_vec_pretty(&updated).map_err(|e| e.to_string())?;
    let slot = entries
        .iter_mut()
        .find(|(path, _)| path == &PathBuf::from("manifest.json"))
        .ok_or("Missing extension manifest")?;
    slot.1 = manifest_bytes;
    entries.push((PathBuf::from(SHIM_FILE), SHIM_SOURCE.as_bytes().to_vec()));
    entries.push((
        PathBuf::from(ENTRY_FILE),
        entry_source(&worker, module).into_bytes(),
    ));
    Ok((entries, updated))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn package(manifest: &Value) -> Entries {
        vec![
            (
                PathBuf::from("manifest.json"),
                serde_json::to_vec(manifest).unwrap(),
            ),
            (PathBuf::from("worker.js"), b"// original".to_vec()),
        ]
    }

    fn manifest(background: Value) -> Value {
        json!({ "manifest_version": 3, "name": "x", "version": "1.0.0", "key": "KEY", "background": background })
    }

    fn file<'a>(entries: &'a Entries, name: &str) -> &'a [u8] {
        &entries
            .iter()
            .find(|(p, _)| p == &PathBuf::from(name))
            .unwrap()
            .1
    }

    #[test]
    fn a_module_worker_loads_the_shim_before_the_original() {
        let m = manifest(json!({ "service_worker": "worker.js", "type": "module" }));
        let (entries, updated) = apply(package(&m), &m).unwrap();
        assert_eq!(updated["background"]["service_worker"], ENTRY_FILE);
        assert_eq!(updated["background"]["type"], "module");
        assert_eq!(
            std::str::from_utf8(file(&entries, ENTRY_FILE)).unwrap(),
            "import \"./nebula-compat.js\";\nimport \"./worker.js\";\n"
        );
    }

    #[test]
    fn a_classic_worker_imports_the_shim_first() {
        let m = manifest(json!({ "service_worker": "./worker.js" }));
        let (entries, _) = apply(package(&m), &m).unwrap();
        assert_eq!(
            std::str::from_utf8(file(&entries, ENTRY_FILE)).unwrap(),
            "importScripts(\"nebula-compat.js\", \"worker.js\");\n"
        );
    }

    #[test]
    fn extension_files_and_the_identity_key_are_untouched() {
        let m = manifest(json!({ "service_worker": "worker.js" }));
        let (entries, updated) = apply(package(&m), &m).unwrap();
        assert_eq!(file(&entries, "worker.js"), b"// original");
        assert_eq!(updated["key"], "KEY");
        let written: Value = serde_json::from_slice(file(&entries, "manifest.json")).unwrap();
        assert_eq!(written, updated);
        assert_eq!(file(&entries, SHIM_FILE), SHIM_SOURCE.as_bytes());
    }

    #[test]
    fn preparing_the_same_package_twice_gives_identical_bytes() {
        let m = manifest(json!({ "service_worker": "worker.js", "type": "module" }));
        assert_eq!(
            apply(package(&m), &m).unwrap().0,
            apply(package(&m), &m).unwrap().0
        );
    }

    #[test]
    fn packages_without_a_usable_worker_are_left_alone() {
        for background in [
            json!({}),
            json!({ "service_worker": "../escape.js" }),
            json!({ "service_worker": "a\"b.js" }),
            json!({ "service_worker": "dir//w.js" }),
            json!({ "service_worker": "" }),
        ] {
            let m = manifest(background);
            let before = package(&m);
            let (after, updated) = apply(before.clone(), &m).unwrap();
            assert_eq!(after, before, "{m}");
            assert_eq!(updated, m);
        }
    }

    #[test]
    fn a_package_that_already_uses_the_compat_names_is_refused() {
        let m = manifest(json!({ "service_worker": "worker.js" }));
        let mut entries = package(&m);
        entries.push((PathBuf::from("Nebula-Compat.js"), Vec::new()));
        assert!(apply(entries, &m).is_err());
    }

    #[test]
    fn the_shim_only_touches_the_extensions_own_senders() {
        // The rule is data-driven by one predicate; keep its shape pinned.
        assert!(SHIM_SOURCE.contains("tab.url.startsWith(own)"));
        assert!(SHIM_SOURCE.contains("'chrome-extension://' + runtime.id + '/'"));
        for event in [
            "onMessage",
            "onMessageExternal",
            "onConnect",
            "onConnectExternal",
        ] {
            assert!(SHIM_SOURCE.contains(&format!("runtime.{event}")), "{event}");
        }
        assert!(!SHIM_SOURCE.contains("eval(") && !SHIM_SOURCE.contains("new Function"));
    }
}
