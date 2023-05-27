use std::collections::HashMap;
use std::fs::File;
use std::fs;
use std::path::Path;

use symphonia::core::{
    codecs::{DecoderOptions},
    io::MediaSourceStream,
    formats::FormatOptions,
    meta::MetadataOptions,
    probe::Hint,
    units::{TimeBase},
};

use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct Metadata {
    path_name: String,
    file_name: Box<Path>,
    file_size: u64,
    codec: String,
    // bpm: u64,
    // bit_rate: u64,
    sample_rate: u32,
    // start_time: u64,
    duration: String,
    meta_tags: HashMap<String, String>,
}

impl Metadata {
    pub fn build(song_path: String) -> Self {
        let file_name = Path::new(&song_path).into();
        let path_name = song_path;
        let file_size = fs::metadata(&file_name).unwrap().len();
        let mut codec = String::from("");
        let mut sample_rate = 0;
        let mut duration = String::from("");
        let mut meta_tags = HashMap::new();

        let file = Box::new(File::open(&file_name).unwrap());
        let mss = MediaSourceStream::new(file, Default::default());
        let hint = Hint::new();
        let format_opts: FormatOptions = Default::default();
        let metadata_opts: MetadataOptions = Default::default();
        let _decoder_opts: DecoderOptions = Default::default();
        let mut probed = symphonia::default::get_probe()
            .format(&hint, mss, &format_opts, &metadata_opts)
            .unwrap();

        let tracks = probed.format.tracks();
        for track in tracks.iter() {
            let params = &track.codec_params;
            if let Some(s_codec) = symphonia::default::get_codecs()
                .get_codec(params.codec) {
                codec = s_codec.short_name.to_string();
            }
            else {
                codec = params.codec.to_string();
            }

            if let Some(s_sample_rate) = params.sample_rate {
                sample_rate = s_sample_rate;
            }

            duration = fmt_time(
                    params.n_frames.unwrap(),
                    params.time_base.unwrap(),
            );
        }

        if let Some(metadata_rev) = probed.format.metadata().current() {
            // print metadata
            let tags = metadata_rev.tags();
            for tag in tags.iter().filter(|tag| tag.is_known()) {
                if let Some(std_key) = tag.std_key {
                    // println!("{:?}:\t\t{}", std_key, &tag.value);
                    meta_tags.insert(format!("{:?}", std_key), tag.value.to_string());
                }
            }
            for _tag in tags.iter().filter(|tag| !tag.is_known()) {
                // println!("key:\t\t{}, {}", &tag.key, MyValue(&tag.value.clone()));
            }
        } else if let Some(metadata_rev) = probed.metadata.get().as_ref().and_then(|m| m.current()) {
            let tags = metadata_rev.tags();
            for tag in tags.iter().filter(|tag| tag.is_known()) {
                if let Some(std_key) = tag.std_key {
                    // println!("{:?}:\t\t{}", std_key, &tag.value);
                    meta_tags.insert(format!("{:?}", std_key), tag.value.to_string());
                }
            }
            for _tag in tags.iter().filter(|tag| !tag.is_known()) {
                // println!("key:\t\t{}, {}", &tag.key, MyValue(&tag.value.clone()));
            }
        }
        // let visuals = metadata_rev.visuals();
        for cue in probed.format.cues() {
            for _tag in &cue.tags {
                // println!("cue tag:\t{:?}", tag);
            }
        }

    Self {
        path_name,
        file_name,
        file_size,
        codec,
        sample_rate,
        duration,
        meta_tags,
        }
    }
}

fn fmt_time(ts: u64, tb: TimeBase) -> String {
    let time = tb.calc_time(ts);

    let hours = time.seconds / (60 * 60);
    let mins = (time.seconds % (60 * 60)) / 60;
    let secs = f64::from((time.seconds % 60) as u32) + time.frac;

    format!("{}:{:0>2}:{:0>6.3}", hours, mins, secs)
}
