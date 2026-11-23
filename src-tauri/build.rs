fn main() {
    // `generate_context!` intègre les icônes au binaire (celle du Dock en dev
    // comprise) sans que Cargo le sache : régénérées par `tauri icon`, elles ne
    // déclenchaient aucune recompilation et l'application gardait l'ancienne.
    // Relancer ce script quand le dossier change suffit à recompiler la crate.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build();
}
