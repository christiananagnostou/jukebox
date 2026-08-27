use std::collections::HashMap;
use std::fs::File;
use std::path::{Path, PathBuf};

use crate::artwork::ArtworkCache;
use serde::Serialize;
use symphonia::core::{
    formats::{FormatOptions, FormatReader},
    io::MediaSourceStream,
    meta::MetadataOptions,
    probe::Hint,
    units::TimeBase,
};

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
        let extracted = extract_metadata(&path)?;
        let visual_info = extracted.cache_visual(app_handle)?;

        Ok(Self {
            id,
            codec: extracted.codec,
            sample_rate: extracted.sample_rate,
            duration: extracted.duration,
            meta_tags: extracted.meta_tags,
            visual_info,
        })
    }
}

#[derive(Debug)]
pub(crate) struct ExtractedMetadata {
    pub codec: String,
    pub sample_rate: u32,
    pub duration: String,
    pub meta_tags: HashMap<String, String>,
    visual: Option<ExtractedVisual>,
}

impl ExtractedMetadata {
    fn cache_visual(&self, app_handle: &tauri::AppHandle) -> Result<VisualInfo, String> {
        self.visual
            .as_ref()
            .map(|visual| cache_visual(app_handle, visual))
            .transpose()
            .map(|visual| visual.unwrap_or_default())
    }

    pub(crate) fn cache_visual_path(
        &self,
        app_handle: &tauri::AppHandle,
    ) -> Result<String, String> {
        self.cache_visual(app_handle)
            .map(|visual| visual.image_path)
    }
}

#[derive(Debug, Default, Serialize)]
struct VisualInfo {
    media_type: String,
    image_path: String,
}

#[derive(Debug)]
struct ExtractedVisual {
    media_type: String,
    media_data: Vec<u8>,
}

pub(crate) fn hash_string(value: &str) -> String {
    format!("{:x}", md5::compute(value.as_bytes()))
}

pub(crate) fn extract_metadata(path: &Path) -> Result<ExtractedMetadata, String> {
    let mut format = open_format(path)?;
    let (codec, sample_rate, duration) = extract_track_info(&*format);
    let meta_tags = extract_meta_tags(&mut *format);
    let visual = extract_visual_info(&mut *format);

    Ok(ExtractedMetadata {
        codec,
        sample_rate,
        duration,
        meta_tags,
        visual,
    })
}

fn cache_visual(
    app_handle: &tauri::AppHandle,
    visual: &ExtractedVisual,
) -> Result<VisualInfo, String> {
    let Some(image_path) =
        ArtworkCache::from_app(app_handle)?.cache(&visual.media_type, &visual.media_data)?
    else {
        return Ok(VisualInfo::default());
    };
    Ok(VisualInfo {
        media_type: visual.media_type.clone(),
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
