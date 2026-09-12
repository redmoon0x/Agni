use base64::{engine::general_purpose::STANDARD, Engine as _};
use rfd::AsyncFileDialog;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_SPRITESHEET_BYTES: u64 = 12 * 1024 * 1024;
const CATALOG_HOST: &str = "codingpets.com";
const ASSET_HOST: &str = "precious-ptarmigan-848.convex.cloud";

const CATALOG_SLUGS: &[&str] = &[
    "kyokit-cj3",
    "codex-ninja-szig83",
    "mousey-stephenjwhite",
    "monkey-d-luffy-1122",
    "vanlife-esme-iloapps",
    "lando-iloapps",
    "hopper-bretgreenstein",
    "plat-critters-quest",
    "algofox-dude",
    "kyokit-reeucq",
    "gulte-mama-nazmussayad",
    "gopal-nazmussayad",
    "alien-x-pet-nazmussayad",
    "thrungle-timtim",
    "monkey-d-luffy-timtim",
    "bipy-douglas-strey",
    "bro-bro",
    "firefang-timtim",
    "sukuna-girgis",
    "doodle-bob-girgis",
    "boostr-yanvi",
    "gob-weswinder",
    "biscuit-wes",
    "bytecap-wes",
    "voltling-wes",
    "pebbit-wes",
    "quillbit-wes",
    "glitchlet-wes",
    "tack-wes",
    "mochip-wes",
    "snips-wes",
    "kernel-wes",
];

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PetManifest {
    id: String,
    display_name: String,
    description: String,
    spritesheet_path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetInfo {
    id: String,
    display_name: String,
    description: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetSprite {
    data_url: String,
    frame_width: u32,
    frame_height: u32,
    columns: u32,
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_' || byte == b'-'
        })
}

fn pet_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("pets");
    fs::create_dir_all(&root)
        .map_err(|error| format!("could not create Agni pet storage: {error}"))?;
    Ok(root)
}

fn parse_manifest(bytes: &[u8]) -> Result<PetManifest, String> {
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err("pet manifest is too large".into());
    }
    let manifest: PetManifest =
        serde_json::from_slice(bytes).map_err(|error| format!("invalid pet manifest: {error}"))?;
    if !valid_id(&manifest.id) {
        return Err("pet manifest has an invalid id".into());
    }
    if manifest.display_name.trim().is_empty() || manifest.display_name.len() > 120 {
        return Err("pet manifest has an invalid display name".into());
    }
    let path = Path::new(&manifest.spritesheet_path);
    if path.components().count() != 1
        || !matches!(
            path.extension().and_then(|ext| ext.to_str()),
            Some("webp" | "png")
        )
    {
        return Err("pet manifest must reference a top-level WebP or PNG spritesheet".into());
    }
    Ok(manifest)
}

fn install_pet(
    app: &AppHandle,
    manifest_bytes: &[u8],
    spritesheet: &[u8],
) -> Result<PetInfo, String> {
    if spritesheet.is_empty() || spritesheet.len() as u64 > MAX_SPRITESHEET_BYTES {
        return Err("pet spritesheet is missing or too large".into());
    }
    let manifest = parse_manifest(manifest_bytes)?;
    let root = pet_root(app)?;
    let destination = root.join(&manifest.id);
    if destination.exists() {
        return Err("this pet is already installed".into());
    }
    let staging = tempfile::Builder::new()
        .prefix("pet-")
        .tempdir_in(&root)
        .map_err(|error| format!("could not prepare pet install: {error}"))?;
    fs::write(staging.path().join("pet.json"), manifest_bytes)
        .map_err(|error| format!("could not save pet manifest: {error}"))?;
    fs::write(staging.path().join(&manifest.spritesheet_path), spritesheet)
        .map_err(|error| format!("could not save pet spritesheet: {error}"))?;
    fs::rename(staging.keep(), &destination)
        .map_err(|error| format!("could not finish pet install: {error}"))?;
    Ok(PetInfo {
        id: manifest.id,
        display_name: manifest.display_name,
        description: manifest.description,
    })
}

fn read_pet(root: &Path, id: &str) -> Result<(PetManifest, PathBuf), String> {
    if !valid_id(id) {
        return Err("invalid pet id".into());
    }
    let folder = root.join(id);
    let manifest_bytes =
        fs::read(folder.join("pet.json")).map_err(|_| "pet is not installed".to_string())?;
    let manifest = parse_manifest(&manifest_bytes)?;
    if manifest.id != id {
        return Err("pet storage is invalid".into());
    }
    let sprite = folder.join(&manifest.spritesheet_path);
    if !sprite.is_file() {
        return Err("pet spritesheet is missing".into());
    }
    Ok((manifest, sprite))
}

#[tauri::command]
pub fn pets_list(app: AppHandle) -> Result<Vec<PetInfo>, String> {
    let root = pet_root(&app)?;
    let mut pets = Vec::new();
    for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
        let Ok(entry) = entry else { continue };
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().into_owned();
        if let Ok((manifest, _)) = read_pet(&pet_root(&app)?, &id) {
            pets.push(PetInfo {
                id: manifest.id,
                display_name: manifest.display_name,
                description: manifest.description,
            });
        }
    }
    pets.sort_by(|left, right| {
        left.display_name
            .to_lowercase()
            .cmp(&right.display_name.to_lowercase())
    });
    Ok(pets)
}

#[tauri::command]
pub fn pets_sprite(app: AppHandle, id: String) -> Result<PetSprite, String> {
    let (_, path) = read_pet(&pet_root(&app)?, &id)?;
    let bytes =
        fs::read(&path).map_err(|error| format!("could not read pet spritesheet: {error}"))?;
    if bytes.len() as u64 > MAX_SPRITESHEET_BYTES {
        return Err("pet spritesheet is too large".into());
    }
    let mime = match path.extension().and_then(|ext| ext.to_str()) {
        Some("png") => "image/png",
        _ => "image/webp",
    };
    Ok(PetSprite {
        data_url: format!("data:{mime};base64,{}", STANDARD.encode(bytes)),
        frame_width: 192,
        frame_height: 208,
        columns: 8,
    })
}

#[tauri::command]
pub fn pets_remove(app: AppHandle, id: String) -> Result<(), String> {
    let root = pet_root(&app)?;
    let _ = read_pet(&root, &id)?;
    fs::remove_dir_all(root.join(id)).map_err(|error| format!("could not remove pet: {error}"))
}

fn archive_entry(
    archive: &mut zip::ZipArchive<fs::File>,
    suffix: &str,
    limit: u64,
) -> Result<Vec<u8>, String> {
    let mut matching_index = None;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|error| format!("invalid pet archive: {error}"))?;
        let name = entry.name();
        if (name == suffix || name.ends_with(&format!("/{suffix}")))
            && matching_index.replace(index).is_some()
        {
            return Err(format!("pet archive contains multiple {suffix} files"));
        }
    }
    let index = matching_index.ok_or_else(|| format!("pet archive has no {suffix}"))?;
    let mut entry = archive
        .by_index(index)
        .map_err(|error| format!("invalid pet archive: {error}"))?;
    if entry.size() > limit {
        return Err(format!("{suffix} is too large"));
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry
        .read_to_end(&mut bytes)
        .map_err(|error| format!("could not read {suffix}: {error}"))?;
    Ok(bytes)
}

#[tauri::command]
pub async fn pets_import(app: AppHandle) -> Result<Option<PetInfo>, String> {
    let Some(file) = AsyncFileDialog::new()
        .set_title("Import Agni pet")
        .add_filter("Pet package", &["zip"])
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    let archive_file = fs::File::open(file.path())
        .map_err(|error| format!("could not open pet archive: {error}"))?;
    let mut archive = zip::ZipArchive::new(archive_file)
        .map_err(|error| format!("invalid pet archive: {error}"))?;
    if archive.len() > 8 {
        return Err("pet archive contains too many files".into());
    }
    let manifest_bytes = archive_entry(&mut archive, "pet.json", MAX_MANIFEST_BYTES)?;
    let manifest = parse_manifest(&manifest_bytes)?;
    let spritesheet = archive_entry(
        &mut archive,
        &manifest.spritesheet_path,
        MAX_SPRITESHEET_BYTES,
    )?;
    install_pet(&app, &manifest_bytes, &spritesheet).map(Some)
}

fn asset_url_from_page(page: &str, key: &str) -> Result<String, String> {
    let marker = format!("{key}:\"");
    let start = page
        .find(&marker)
        .ok_or_else(|| "pet source is unavailable".to_string())?
        + marker.len();
    let rest = &page[start..];
    let end = rest
        .find('"')
        .ok_or_else(|| "pet source is invalid".to_string())?;
    let url = rest[..end].replace("\\u0026", "&");
    let parsed =
        reqwest::Url::parse(&url).map_err(|_| "pet source has an invalid URL".to_string())?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some(ASSET_HOST)
        || !parsed.path().starts_with("/api/storage/")
    {
        return Err("pet source is not from the trusted catalog".into());
    }
    Ok(url)
}

async fn download(url: &str, max_bytes: u64) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("pet download failed: {error}"))?;
    if !response.status().is_success() {
        return Err("pet download failed".into());
    }
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes)
    {
        return Err("pet download is too large".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("pet download failed: {error}"))?;
    if bytes.len() as u64 > max_bytes {
        return Err("pet download is too large".into());
    }
    Ok(bytes.to_vec())
}

#[tauri::command]
pub async fn pets_install_catalog(app: AppHandle, slug: String) -> Result<PetInfo, String> {
    if !CATALOG_SLUGS.contains(&slug.as_str()) {
        return Err("pet is not in the Agni catalog".into());
    }
    let page_url = format!("https://{CATALOG_HOST}/pets/{slug}");
    let page = String::from_utf8(download(&page_url, 3 * 1024 * 1024).await?)
        .map_err(|_| "pet source is invalid".to_string())?;
    let manifest_url = asset_url_from_page(&page, "pet_json_url")?;
    let spritesheet_url = asset_url_from_page(&page, "spritesheet_url")?;
    let manifest = download(&manifest_url, MAX_MANIFEST_BYTES).await?;
    let spritesheet = download(&spritesheet_url, MAX_SPRITESHEET_BYTES).await?;
    install_pet(&app, &manifest, &spritesheet)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unsafe_manifest_paths() {
        let manifest = br#"{"id":"pet","displayName":"Pet","description":"","spritesheetPath":"../sprite.webp"}"#;
        assert!(parse_manifest(manifest).is_err());
    }

    #[test]
    fn accepts_standard_pet_manifest() {
        let manifest = br#"{"id":"pet-1","displayName":"Pet","description":"Tiny","spritesheetPath":"spritesheet.webp"}"#;
        assert!(parse_manifest(manifest).is_ok());
    }
}
