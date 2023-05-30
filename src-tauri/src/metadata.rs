use std::collections::HashMap;
use std::fs;
use std::fs::File;
use std::path::Path;

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
    // bpm: u64,
    // bit_rate: u64,
    sample_rate: u32,
    // start_time: u64,
    duration: String,
    meta_tags: HashMap<String, String>,
    visual_info: VisualInfo,
}

impl Metadata {
    pub fn new(file_path: String) -> Self {
        let file_meta = FileData::build(file_path);

        let mut codec = String::from("");
        let mut sample_rate = 0;
        let mut duration = String::from("");
        let mut meta_tags = HashMap::new();

        let mut format = Self::get_format_reader(file_meta.clone());

        let tracks = format.tracks();
        for track in tracks.iter() {
            let params = &track.codec_params;
            if let Some(s_codec) = symphonia::default::get_codecs().get_codec(params.codec) {
                codec = s_codec.short_name.to_string();
            } else {
                codec = params.codec.to_string();
            }

            if let Some(s_sample_rate) = params.sample_rate {
                sample_rate = s_sample_rate;
            }

            duration = fmt_time(params.n_frames.unwrap(), params.time_base.unwrap());
        }

        if let Some(metadata_rev) = format.metadata().current() {
            // print metadata
            let tags = metadata_rev.tags();
            for tag in tags.iter().filter(|tag| tag.is_known()) {
                if let Some(std_key) = tag.std_key {
                    // println!("{:?}:\t\t{}", std_key, &tag.value);
                    meta_tags.insert(format!("{:?}", std_key), tag.value.to_string());
                }
            }
            for tag in tags.iter().filter(|tag| !tag.is_known()) {
                println!("key:\t\t{}, {}", &tag.key, &tag.value.clone());
            }
            // } else if let Some(metadata_rev) = probed.metadata.get().as_ref().and_then(|m| m.current()) {
            //      let tags = metadata_rev.tags();
            //      for tag in tags.iter().filter(|tag| tag.is_known()) {
            //          if let Some(std_key) = tag.std_key {
            //              println!("{:?}:\t\t{}", std_key, &tag.value);
            //              meta_tags.insert(format!("{:?}", std_key), tag.value.to_string());
            //          }
            //      }
            //      for tag in tags.iter().filter(|tag| !tag.is_known()) {
            //          println!("key:\t\t{}, {}", &tag.key, &tag.value.clone());
            //     }
        }

        // let visuals = metadata_rev.visuals();
        for cue in format.cues() {
            for tag in &cue.tags {
                println!("cue tag:\t{:?}", tag);
            }
        }

        let mut visual_info = VisualInfo {
            media_type: String::new(),
            media_data: Vec::new(),
        };
        let binding = format.metadata();
        let metadata_rev = binding.current().unwrap();
        let visuals = metadata_rev.visuals();
        for visual in visuals.iter() {
            visual_info = VisualInfo {
                media_type: visual.media_type.clone(),
                media_data: visual.data.to_vec(),
            };
        }

        Self {
            file_data: file_meta,
            codec,
            sample_rate,
            duration,
            meta_tags,
            visual_info: visual_info,
        }
    }

    fn get_format_reader(file_meta: FileData) -> Box<dyn FormatReader> {
        let file = Box::new(File::open(&file_meta.file_name).unwrap());
        let mss = MediaSourceStream::new(file, Default::default());
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
    file_name: Box<Path>,
    file_size: u64,
}

impl FileData {
    pub fn build(file_path: String) -> Self {
        let file_name = Path::new(&file_path).into();
        let path_name = file_path;
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
}

fn fmt_time(ts: u64, tb: TimeBase) -> String {
    let time = tb.calc_time(ts);

    let hours = time.seconds / (60 * 60);
    let mins = (time.seconds % (60 * 60)) / 60;
    let secs = f64::from((time.seconds % 60) as u32) + time.frac;

    format!("{}:{:0>2}:{:0>6.3}", hours, mins, secs)
}
