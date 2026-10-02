fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var_os("CARGO_FEATURE_EXTENSION_NATIVE_SMOKE").is_some()
    {
        // GUI unit-test executables need the same common-controls activation
        // context as the app; otherwise TaskDialogIndirect fails at load time.
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
        // The linker provides it for this test configuration; do not also
        // embed a second manifest through Tauri's resource library.
        println!("cargo:rerun-if-changed=../dist");
        tauri_build::try_build(
            tauri_build::Attributes::new()
                .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest()),
        )
        .expect("could not prepare native extension smoke test");
        return;
    }
    println!("cargo:rerun-if-changed=../dist");
    tauri_build::build()
}
