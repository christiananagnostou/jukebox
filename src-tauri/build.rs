fn main() {
    embed_mobile_assets();
    tauri_build::build()
}

fn embed_mobile_assets() {
    use std::{env, fs, path::Path};
    let root = Path::new("../.mobile-dist");
    assert!(
        root.join("index.html").is_file(),
        "Build the mobile UI first: npm run build.mobile"
    );
    println!("cargo:rerun-if-changed=../.mobile-dist");
    fn collect(root: &Path, directory: &Path, assets: &mut Vec<(String, std::path::PathBuf)>) {
        for entry in std::fs::read_dir(directory).expect("read built mobile assets") {
            let entry = entry.expect("mobile asset entry");
            let path = entry.path();
            if path.is_dir() {
                collect(root, &path, assets);
            } else {
                let relative = path
                    .strip_prefix(root)
                    .expect("relative asset")
                    .to_string_lossy()
                    .replace('\\', "/");
                // Only public runtime assets, never manifests with source metadata or SSR code.
                if (relative.starts_with("build/") || relative.starts_with("assets/"))
                    && matches!(
                        path.extension().and_then(|ext| ext.to_str()),
                        Some("js" | "mjs" | "css" | "json")
                    )
                {
                    assets.push((
                        format!("/{relative}"),
                        path.canonicalize().expect("asset path"),
                    ));
                }
            }
        }
    }
    let mut assets = Vec::new();
    collect(root, root, &mut assets);
    assets.sort_by(|a, b| a.0.cmp(&b.0));
    let mut code = String::from("const MOBILE_ASSETS: &[(&str, &[u8])] = &[\n");
    for (url, path) in assets {
        code.push_str(&format!(
            "({url:?}, include_bytes!({:?})),\n",
            path.to_string_lossy()
        ));
    }
    code.push_str("];\n");
    fs::write(
        Path::new(&env::var("OUT_DIR").expect("build output directory")).join("mobile_assets.rs"),
        code,
    )
    .expect("write asset table");
}
