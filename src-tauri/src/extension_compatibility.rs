//! Package preflight, before registration or any extension code is executed.
use serde_json::Value;
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

fn safe_path(value: &str) -> bool {
    !value.is_empty()
        && !value.contains(['\\', ':', '\0'])
        && value.split('/').all(|part| {
            !part.is_empty()
                && !part.ends_with(['.', ' '])
                && !matches!(
                    part.split('.')
                        .next()
                        .unwrap_or("")
                        .to_ascii_uppercase()
                        .as_str(),
                    "CON"
                        | "PRN"
                        | "AUX"
                        | "NUL"
                        | "COM1"
                        | "COM2"
                        | "COM3"
                        | "COM4"
                        | "COM5"
                        | "COM6"
                        | "COM7"
                        | "COM8"
                        | "COM9"
                        | "LPT1"
                        | "LPT2"
                        | "LPT3"
                        | "LPT4"
                        | "LPT5"
                        | "LPT6"
                        | "LPT7"
                        | "LPT8"
                        | "LPT9"
                )
        })
        && Path::new(value)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
}

fn valid_version(value: &str) -> bool {
    let parts: Vec<_> = value.split('.').collect();
    (1..=4).contains(&parts.len())
        && parts.iter().all(|p| {
            !p.is_empty()
                && p.bytes().all(|b| b.is_ascii_digit())
                && (p.len() == 1 || !p.starts_with('0'))
                && p.parse::<u16>().is_ok()
        })
        && parts.iter().any(|p| *p != "0")
}

pub(crate) fn validate_minimum_runtime(manifest: &Value, runtime: &str) -> Result<(), String> {
    let Some(minimum) = manifest.get("minimum_chrome_version") else {
        return Ok(());
    };
    let parse = |value: &str| -> Result<[u32; 4], String> {
        let parts: Vec<_> = value.split('.').collect();
        if parts.is_empty() || parts.len() > 4 {
            return Err("Invalid browser version".into());
        }
        let mut result = [0; 4];
        for (index, part) in parts.iter().enumerate() {
            if part.is_empty() || !part.bytes().all(|c| c.is_ascii_digit()) {
                return Err("Invalid browser version".into());
            }
            result[index] = part.parse().map_err(|_| "Invalid browser version")?;
        }
        Ok(result)
    };
    let minimum = minimum.as_str().ok_or("Invalid minimum Chrome version")?;
    if parse(runtime)? < parse(minimum)? {
        return Err(format!(
            "Extension requires browser engine {minimum}; current runtime is {runtime}"
        ));
    }
    Ok(())
}

pub(crate) fn validate_manifest_files(
    manifest: &Value,
    entries: &[(PathBuf, Vec<u8>)],
) -> Result<(), String> {
    if manifest["manifest_version"] != 3
        || manifest["name"]
            .as_str()
            .map_or(true, |s| s.trim().is_empty())
        || manifest["version"]
            .as_str()
            .map_or(true, |s| !valid_version(s))
    {
        return Err("Invalid Manifest V3 name or version".into());
    }
    for key in [
        "permissions",
        "optional_permissions",
        "host_permissions",
        "optional_host_permissions",
    ] {
        if let Some(value) = manifest.get(key) {
            if value
                .as_array()
                .map_or(true, |a| a.iter().any(|v| !v.is_string()))
            {
                return Err(format!("Invalid manifest field: {key}"));
            }
        }
    }
    let mut files = HashSet::new();
    for (path, _) in entries {
        let path = path
            .to_str()
            .ok_or("Non-Unicode extension path")?
            .replace('\\', "/");
        if !safe_path(&path) || !files.insert(path.to_ascii_lowercase()) {
            return Err("Unsafe or duplicate extension file path".into());
        }
    }
    let check_file = |value: &Value| -> Result<(), String> {
        let path = value
            .as_str()
            .ok_or("Manifest resource path must be a string")?;
        // A manifest reference may be written `./a`, `a` or `/a`; all are relative
        // to the extension root. One leading slash is valid (Chrome resolves it
        // against the extension origin); `//a` and traversal still fail below.
        // Archive entry names are checked separately and must never start with `/`.
        let path = path.trim_start_matches("./");
        let path = path.strip_prefix('/').unwrap_or(path);
        if !safe_path(path) || !files.contains(&path.to_ascii_lowercase()) {
            return Err(format!("Missing or unsafe manifest resource: {path}"));
        }
        Ok(())
    };
    for key in ["background", "action", "options_ui", "side_panel", "icons"] {
        if manifest.get(key).is_some_and(|value| !value.is_object()) {
            return Err(format!("Invalid manifest object: {key}"));
        }
    }
    if manifest["background"].get("scripts").is_some()
        || manifest["background"].get("page").is_some()
        || manifest["background"].get("persistent").is_some()
    {
        return Err(
            "Legacy background configuration is not supported by this MV3 installer".into(),
        );
    }
    for pointer in [
        "/background/service_worker",
        "/action/default_popup",
        "/options_ui/page",
        "/side_panel/default_path",
        "/options_page",
        "/devtools_page",
    ] {
        let Some(value) = manifest.pointer(pointer) else {
            continue;
        };
        // Only an empty popup explicitly means no popup.
        if value.as_str() == Some("") && pointer == "/action/default_popup" {
            continue;
        }
        check_file(value)?;
    }
    if let Some(icons) = manifest["icons"].as_object() {
        for path in icons.values() {
            check_file(path)?;
        }
    }
    if let Some(value) = manifest.get("content_scripts") {
        let scripts = value.as_array().ok_or("Invalid content_scripts")?;
        for script in scripts {
            if !script.is_object()
                || script["matches"]
                    .as_array()
                    .map_or(true, |a| a.is_empty() || a.iter().any(|v| !v.is_string()))
            {
                return Err("Invalid content script match patterns".into());
            }
            for key in ["js", "css"] {
                if let Some(paths) = script.get(key) {
                    for path in paths.as_array().ok_or("Invalid content script files")? {
                        check_file(path)?;
                    }
                }
            }
        }
    }
    if let Some(resources) = manifest.pointer("/declarative_net_request/rule_resources") {
        for resource in resources
            .as_array()
            .ok_or("Invalid declarative rule resources")?
        {
            check_file(&resource["path"])?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn entries(names: &[&str]) -> Vec<(PathBuf, Vec<u8>)> {
        names
            .iter()
            .map(|name| (PathBuf::from(name), vec![]))
            .collect()
    }
    fn manifest() -> Value {
        json!({"manifest_version":3,"name":"Fixture","version":"1.0","background":{"service_worker":"worker.js"}})
    }
    #[test]
    fn missing_entry_points_fail_before_execution() {
        assert!(validate_manifest_files(&manifest(), &entries(&["manifest.json"])).is_err());
        assert!(
            validate_manifest_files(&manifest(), &entries(&["manifest.json", "worker.js"])).is_ok()
        );
    }
    #[test]
    fn windows_aliases_and_duplicate_files_are_rejected() {
        for bad in [
            "../escape",
            "C:/escape",
            "CON.txt",
            "x. /file",
            "file:stream",
            "/worker.js",
        ] {
            assert!(
                validate_manifest_files(&manifest(), &entries(&["worker.js", bad])).is_err(),
                "{bad}"
            );
        }
        assert!(
            validate_manifest_files(&manifest(), &entries(&["worker.js", "WORKER.JS"])).is_err()
        );
    }

    #[test]
    fn manifest_relative_prefix_is_valid_but_traversal_is_not() {
        let mut value = manifest();
        value["background"]["service_worker"] = json!("./worker.js");
        assert!(validate_manifest_files(&value, &entries(&["worker.js"])).is_ok());
        value["background"]["service_worker"] = json!("../worker.js");
        assert!(validate_manifest_files(&value, &entries(&["worker.js"])).is_err());
    }

    #[test]
    fn a_single_leading_slash_in_the_manifest_is_extension_root_relative() {
        // Seen in real packages (e.g. rule resources "/rulesets/main/x.json").
        let mut value = manifest();
        value["background"]["service_worker"] = json!("/worker.js");
        value["declarative_net_request"] =
            json!({"rule_resources":[{"id":"r","enabled":true,"path":"/rulesets/main/x.json"}]});
        value["action"] =
            json!({"default_icon":{"16":"/icons/16.png"},"default_popup":"/popup.html"});
        value["icons"] = json!({"16":"/icons/16.png"});
        let files = entries(&[
            "worker.js",
            "rulesets/main/x.json",
            "icons/16.png",
            "popup.html",
        ]);
        assert!(validate_manifest_files(&value, &files).is_ok());
        // Still fail closed: protocol-relative, traversal, a missing target, and
        // a slash combined with `./`.
        for bad in [
            "//worker.js",
            "/../worker.js",
            "/missing.js",
            "/./../worker.js",
            "///worker.js",
        ] {
            let mut value = manifest();
            value["background"]["service_worker"] = json!(bad);
            assert!(validate_manifest_files(&value, &files).is_err(), "{bad}");
        }
    }

    #[test]
    fn empty_popup_is_valid_but_empty_worker_is_not() {
        let mut value = manifest();
        value["action"] = json!({"default_popup":""});
        assert!(validate_manifest_files(&value, &entries(&["worker.js"])).is_ok());
        value["background"]["service_worker"] = json!("");
        assert!(validate_manifest_files(&value, &entries(&["worker.js"])).is_err());
    }
    #[test]
    fn missing_popup_content_script_or_rules_are_rejected() {
        for extra in [
            json!({"action":{"default_popup":"missing.html"}}),
            json!({"content_scripts":[{"matches":["https://example.com/*"],"js":["missing.js"]}]}),
            json!({"declarative_net_request":{"rule_resources":[{"path":"missing.json"}]}}),
        ] {
            let mut value = manifest();
            value
                .as_object_mut()
                .unwrap()
                .extend(extra.as_object().unwrap().clone());
            assert!(validate_manifest_files(&value, &entries(&["worker.js"])).is_err());
        }
    }
    #[test]
    fn malformed_and_legacy_manifests_fail_closed() {
        for extra in [
            json!({"manifest_version":2}),
            json!({"version":"1.70000"}),
            json!({"permissions":"tabs"}),
            json!({"background":{"scripts":["worker.js"]}}),
            json!({"content_scripts":{}}),
        ] {
            let mut value = manifest();
            value
                .as_object_mut()
                .unwrap()
                .extend(extra.as_object().unwrap().clone());
            assert!(validate_manifest_files(&value, &entries(&["worker.js"])).is_err());
        }
    }

    #[test]
    fn runtime_requirement_is_compared_numerically() {
        let value = json!({"minimum_chrome_version":"150.0.9"});
        assert!(validate_minimum_runtime(&value, "150.0.10").is_ok());
        assert!(validate_minimum_runtime(&value, "149.99.99").is_err());
        assert!(validate_minimum_runtime(&value, "unknown").is_err());
        assert!(validate_minimum_runtime(&json!({"minimum_chrome_version":150}), "151").is_err());
    }
}
