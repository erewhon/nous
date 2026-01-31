fn main() {
    let profile = std::env::var("PROFILE").unwrap_or_default();
    if profile == "release" {
        let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
        match target_os.as_str() {
            "macos" => {
                // .app/Contents/MacOS/nous → ../Resources/python-bundle/lib
                println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Resources/python-bundle/lib");
            }
            "linux" => {
                // AppImage/deb: binary alongside or in ../lib/nous/
                println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN/python-bundle/lib");
                println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN/../lib/nous/python-bundle/lib");
            }
            _ => {}
        }
    }
    tauri_build::build();
}
