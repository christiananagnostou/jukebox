use std::collections::HashMap;
use std::fs::{self, File};
use std::path::{Path, PathBuf};

use serde::Serialize;
use symphonia::core::{
    formats::{FormatOptions, FormatReader},
    io::MediaSourceStream,
    meta::MetadataOptions,
    probe::Hint,
    units::TimeBase,
};
use tauri::Manager;

#[derive(Debug, Serialize)]
pub struct Metadata {
    id: String,
    codec: String,
    sample_rate: u32,
    duration: String,
    meta_tags: HashMap<String, String>,
    visual_info: VisualInfo,
}

impl Metadata {
    pub fn new(app_handle: &tauri::AppHandle, file_path: String) -> Result<Self, String> {
        let path = PathBuf::from(&file_path);
        let id = hash_string(&file_path);
        let mut format = open_format(&path)?;
        let (codec, sample_rate, duration) = extract_track_info(&*format);
        let meta_tags = extract_meta_tags(&mut *format);
        let visual_info = extract_visual_info(&mut *format)
            .map(|visual| cache_visual(app_handle, &id, &meta_tags, visual))
            .transpose()?
            .unwrap_or_default();

        Ok(Self {
            id,
            codec,
            sample_rate,
            duration,
            meta_tags,
            visual_info,
        })
    }
}

#[derive(Debug, Default, Serialize)]
struct VisualInfo {
    media_type: String,
    image_path: String,
}

struct ExtractedVisual {
    media_type: String,
    media_data: Vec<u8>,
}

fn hash_string(value: &str) -> String {
    format!("{:x}", md5::compute(value.as_bytes()))
}

fn cache_visual(
    app_handle: &tauri::AppHandle,
    song_id: &str,
    meta_tags: &HashMap<String, String>,
    visual: ExtractedVisual,
) -> Result<VisualInfo, String> {
    let artist = hash_string(
        meta_tags
            .get("Artist")
            .map(String::as_str)
            .unwrap_or("unknown"),
    );
    let album = hash_string(
        meta_tags
            .get("Album")
            .map(String::as_str)
            .unwrap_or("unknown"),
    );
    let album_dir = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("Jukebox")
        .join("art")
        .join(artist)
        .join(album);

    fs::create_dir_all(&album_dir).map_err(|error| error.to_string())?;

    let extension = visual
        .media_type
        .rsplit('/')
        .next()
        .filter(|value| {
            !value.is_empty()
                && value
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric())
        })
        .unwrap_or("bin");
    let image_path = album_dir.join(format!("{song_id}.{extension}"));

    if !image_path.exists() {
        fs::write(&image_path, visual.media_data).map_err(|error| error.to_string())?;
    }

    Ok(VisualInfo {
        media_type: visual.media_type,
        image_path: image_path.to_string_lossy().into_owned(),
    })
}

fn extract_track_info(format: &dyn FormatReader) -> (String, u32, String) {
    let Some(track) = format.tracks().first() else {
        return (String::new(), 0, String::new());
    };
    let params = &track.codec_params;
    let codec = symphonia::default::get_codecs()
        .get_codec(params.codec)
        .map(|codec| codec.short_name.to_string())
        .unwrap_or_else(|| params.codec.to_string());
    let sample_rate = params.sample_rate.unwrap_or_default();
    let duration = match (params.n_frames, params.time_base) {
        (Some(frames), Some(time_base)) => fmt_time(frames, time_base),
        _ => String::new(),
    };

    (codec, sample_rate, duration)
}

fn extract_meta_tags(format: &mut dyn FormatReader) -> HashMap<String, String> {
    let mut meta_tags = HashMap::new();

    if let Some(metadata) = format.metadata().current() {
        for tag in metadata.tags().iter().filter(|tag| tag.is_known()) {
            if let Some(key) = tag.std_key {
                meta_tags.insert(format!("{key:?}"), tag.value.to_string());
            }
        }
    }

    meta_tags
}

fn extract_visual_info(format: &mut dyn FormatReader) -> Option<ExtractedVisual> {
    let visual = format.metadata().current()?.visuals().first()?.clone();

    Some(ExtractedVisual {
        media_type: visual.media_type,
        media_data: visual.data.to_vec(),
    })
}

fn open_format(path: &Path) -> Result<Box<dyn FormatReader>, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let stream = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();

    if let Some(extension) = path.extension().and_then(|value| value.to_str()) {
        hint.with_extension(extension);
    }

    symphonia::default::get_probe()
        .format(
            &hint,
            stream,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map(|result| result.format)
        .map_err(|error| error.to_string())
}

fn fmt_time(timestamp: u64, time_base: TimeBase) -> String {
    let time = time_base.calc_time(timestamp);
    let hours = time.seconds / (60 * 60);
    let minutes = (time.seconds % (60 * 60)) / 60;
    let seconds = f64::from((time.seconds % 60) as u32) + time.frac;

    format!("{hours}:{minutes:0>2}:{seconds:0>6.3}")
}
