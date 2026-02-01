use std::fs;
use std::fs::File;
use std::path::PathBuf;
use std::{collections::HashMap, io::Write};

use symphonia::core::{
    codecs::DecoderOptions,
    formats::{FormatOptions, FormatReader},
    io::MediaSourceStream,
    meta::MetadataOptions,
    probe::Hint,
    units::TimeBase,
};

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct Metadata {
    file_data: FileData,
    codec: String,
    sample_rate: u32,
    duration: String,
    meta_tags: HashMap<String, String>,
    visual_info: VisualInfo,
}

impl Metadata {
    pub fn new(app_handle: &tauri::AppHandle, file_path: String) -> Self {
        let file_meta = FileData::build(&file_path);

        let (codec, sample_rate, duration) = Self::extract_track_info(&file_meta);
        let meta_tags = Self::extract_meta_tags(&file_meta);

        let mut format = Self::get_format_reader(&file_meta);

        let mut visual_info = Self::extract_visual_info(&mut *format);

        if !visual_info.media_type.is_empty() {
            let image_path = Self::create_album_image_file(app_handle, &meta_tags, &visual_info);
            visual_info.image_path = image_path;
        }

        Self {
            file_data: file_meta,
            codec,
            sample_rate,
            duration,
            meta_tags,
            visual_info,
        }
    }

    fn hash_string(s: &String) -> String {
        format!("{:?}", md5::compute(s.as_bytes()))
    }

    fn create_album_image_file(
        app_handle: &tauri::AppHandle,
        meta_tags: &HashMap<String, String>,
        visual_info: &VisualInfo,
    ) -> String {
        let default = String::from("unknown");
        let artist = Self::hash_string(meta_tags.get("Artist").unwrap_or(&default));
        let album = Self::hash_string(meta_tags.get("Album").unwrap_or(&default));
        let track = Self::hash_string(&meta_tags.get("TrackTitle").unwrap_or(&default));

        // Tauri v2: use app_handle.path() API instead of tauri::api::path
        use tauri::Manager;
        let local_data_dir = app_handle
            .path()
            .app_local_data_dir()
            .expect("failed to get app local data dir");

        // Jukebox/art/[artist]/[album]/
        let album_dir = PathBuf::from(local_data_dir)
            .join(&"Jukebox/art".to_string())
            .join(artist)
            .join(album);

        // Create album dir if it doesn't exist
        match album_dir.try_exists() {
            Ok(false) => {
                if let Err(e) = fs::create_dir_all(&album_dir) {
                    panic!("Error creating directories: {}", e);
                }
            }
            Ok(true) => {}
            Err(e) => {
                panic!("Error checking directory existence: {}", e);
            }
        }

        let file_extension = visual_info.media_type.split("/").last().unwrap();
        let file_name = album_dir.join(format!("{}.{}", track, file_extension));

        let mut f = match File::create(&file_name) {
            Ok(file) => file,
            Err(e) => panic!("Failed to create file: {}", e),
        };

        match f.write_all(&visual_info.media_data) {
            Ok(_) => (),
            Err(e) => panic!("Failed to write to file: {}", e),
        };

        file_name.to_str().map(|s| s.to_string()).unwrap()
    }

    fn extract_track_info(file_meta: &FileData) -> (String, u32, String) {
        let mut codec = String::new();
        let mut sample_rate = 0;
        let mut duration = String::new();

        let format = Self::get_format_reader(file_meta);
        if let Some(track) = format.tracks().first() {
            let params = &track.codec_params;
            codec = symphonia::default::get_codecs()
                .get_codec(params.codec)
                .map(|s_codec| s_codec.short_name.to_string())
                .unwrap_or_else(|| params.codec.to_string());

            if let Some(s_sample_rate) = params.sample_rate {
                sample_rate = s_sample_rate;
            }

            duration = fmt_time(params.n_frames.unwrap(), params.time_base.unwrap());
        }

        (codec, sample_rate, duration)
    }

    fn extract_meta_tags(file_meta: &FileData) -> HashMap<String, String> {
        let mut format = Self::get_format_reader(file_meta);
        let mut meta_tags = HashMap::new();

        if let Some(metadata_rev) = format.metadata().current() {
            let tags = metadata_rev.tags();
            for tag in tags.iter().filter(|tag| tag.is_known()) {
                if let Some(std_key) = tag.std_key {
                    meta_tags.insert(format!("{:?}", std_key), tag.value.to_string());
                }
            }
        }

        meta_tags
    }

    fn extract_visual_info(format: &mut dyn FormatReader) -> VisualInfo {
        let mut visual_info = VisualInfo {
            media_type: String::new(),
            media_data: Vec::new(),
            image_path: String::new(),
        };

        if let Some(metadata_rev) = format.metadata().current() {
            let visuals = metadata_rev.visuals();
            if let Some(visual) = visuals.first() {
                visual_info = VisualInfo {
                    media_type: visual.media_type.clone(),
                    media_data: visual.data.to_vec(),
                    image_path: String::new(),
                };
            }
        }

        visual_info
    }

    fn get_format_reader(file_meta: &FileData) -> Box<dyn FormatReader> {
        let file = File::open(&file_meta.file_name).unwrap();
        let mss = MediaSourceStream::new(Box::new(file), Default::default());
        let hint = Hint::new();
        let format_opts: FormatOptions = Default::default();
        let metadata_opts: MetadataOptions = Default::default();
        let _decoder_opts: DecoderOptions = Default::default();
        let format = symphonia::default::get_probe()
            .format(&hint, mss, &format_opts, &metadata_opts)
            .unwrap()
            .format;

        format
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct FileData {
    path_name: String,
    file_name: PathBuf,
    file_size: u64,
}

impl FileData {
    pub fn build(file_path: &str) -> Self {
        let file_name = PathBuf::from(file_path);
        let path_name = file_path.to_string();
        let file_size = fs::metadata(&file_name).unwrap().len();

        Self {
            path_name,
            file_name,
            file_size,
        }
    }
}

#[derive(Debug, Serialize)]
struct VisualInfo {
    media_type: String,
    media_data: Vec<u8>,
    image_path: String,
}

fn fmt_time(ts: u64, tb: TimeBase) -> String {
    let time = tb.calc_time(ts);

    let hours = time.seconds / (60 * 60);
    let mins = (time.seconds % (60 * 60)) / 60;
    let secs = f64::from((time.seconds % 60) as u32) + time.frac;

    format!("{}:{:0>2}:{:0>6.3}", hours, mins, secs)
}
