use std::error::Error as StdError;
use std::io::{Cursor, Error as IoError, ErrorKind};

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{Decoder, DecoderOptions};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

const CHANNELS: usize = 2;
const SAMPLE_RATE: u32 = 48_000;
const FIXTURE_FRAMES: usize = 12_000;
const OUTPUT_CHUNK_SAMPLES: usize = 4_096;
const MAX_DECODED_PACKET_SAMPLES: usize = 65_536;

const CODEC_FIXTURES: [(&str, &str, &[u8]); 5] = [
    (
        "MP3",
        "mp3",
        include_bytes!("fixtures/native-playback/tone.mp3"),
    ),
    (
        "AAC/M4A",
        "m4a",
        include_bytes!("fixtures/native-playback/tone-aac.m4a"),
    ),
    (
        "FLAC",
        "flac",
        include_bytes!("fixtures/native-playback/tone.flac"),
    ),
    (
        "Ogg/Vorbis",
        "ogg",
        include_bytes!("fixtures/native-playback/tone.ogg"),
    ),
    (
        "ALAC",
        "m4a",
        include_bytes!("fixtures/native-playback/tone-alac.m4a"),
    ),
];

type TestResult<T> = Result<T, Box<dyn StdError>>;

struct DecoderSession {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn Decoder>,
    track_id: u32,
    codec: String,
}

#[derive(Debug)]
struct DecodeSummary {
    codec: String,
    sample_rate: u32,
    channels: usize,
    frames: usize,
    max_decoded_packet_samples: usize,
    max_output_chunk_samples: usize,
}

fn open_decoder(bytes: &[u8], extension: &str) -> TestResult<DecoderSession> {
    let source = MediaSourceStream::new(Box::new(Cursor::new(bytes.to_vec())), Default::default());
    let mut hint = Hint::new();
    hint.with_extension(extension);
    let format_options = FormatOptions {
        enable_gapless: true,
        ..FormatOptions::default()
    };
    let format = symphonia::default::get_probe()
        .format(&hint, source, &format_options, &MetadataOptions::default())?
        .format;
    let track = format.default_track().ok_or_else(|| {
        IoError::new(ErrorKind::InvalidData, "fixture has no default audio track")
    })?;
    let track_id = track.id;
    let codec = symphonia::default::get_codecs()
        .get_codec(track.codec_params.codec)
        .map(|descriptor| descriptor.short_name.to_string())
        .unwrap_or_else(|| track.codec_params.codec.to_string());
    let decoder =
        symphonia::default::get_codecs().make(&track.codec_params, &DecoderOptions::default())?;

    Ok(DecoderSession {
        format,
        decoder,
        track_id,
        codec,
    })
}

fn decode_to_sink<F>(session: &mut DecoderSession, mut sink: F) -> TestResult<DecodeSummary>
where
    F: FnMut(&[f32]),
{
    let mut frames = 0;
    let mut max_decoded_packet_samples = 0;
    let mut max_output_chunk_samples = 0;
    let mut signal_spec = None;

    loop {
        let packet = match session.format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(error)) if error.kind() == ErrorKind::UnexpectedEof => {
                break
            }
            Err(error) => return Err(error.into()),
        };
        if packet.track_id() != session.track_id {
            continue;
        }

        let decoded = session.decoder.decode(&packet)?;
        let decoded_spec = (decoded.spec().rate, decoded.spec().channels.count());
        if signal_spec.is_some_and(|spec| spec != decoded_spec) {
            return Err(IoError::new(
                ErrorKind::InvalidData,
                "decoded signal specification changed",
            )
            .into());
        }
        signal_spec = Some(decoded_spec);
        let decoded_frames = decoded.frames();
        max_decoded_packet_samples =
            max_decoded_packet_samples.max(decoded.capacity() * decoded_spec.1);
        let mut samples = SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
        samples.copy_interleaved_ref(decoded);
        for chunk in samples.samples().chunks(OUTPUT_CHUNK_SAMPLES) {
            max_output_chunk_samples = max_output_chunk_samples.max(chunk.len());
            sink(chunk);
        }
        frames += decoded_frames;
    }

    let (sample_rate, channels) = signal_spec
        .ok_or_else(|| IoError::new(ErrorKind::InvalidData, "fixture decoded no audio"))?;
    Ok(DecodeSummary {
        codec: session.codec.clone(),
        sample_rate,
        channels,
        frames,
        max_decoded_packet_samples,
        max_output_chunk_samples,
    })
}

fn pcm_wav(left: i16, right: i16, frames: usize) -> Vec<u8> {
    let data_bytes = frames * CHANNELS * size_of::<i16>();
    let mut bytes = Vec::with_capacity(44 + data_bytes);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_bytes as u32).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16_u32.to_le_bytes());
    bytes.extend_from_slice(&1_u16.to_le_bytes());
    bytes.extend_from_slice(&(CHANNELS as u16).to_le_bytes());
    bytes.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    bytes.extend_from_slice(
        &(SAMPLE_RATE * CHANNELS as u32 * size_of::<i16>() as u32).to_le_bytes(),
    );
    bytes.extend_from_slice(&((CHANNELS * size_of::<i16>()) as u16).to_le_bytes());
    bytes.extend_from_slice(&16_u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&(data_bytes as u32).to_le_bytes());
    for _ in 0..frames {
        bytes.extend_from_slice(&left.to_le_bytes());
        bytes.extend_from_slice(&right.to_le_bytes());
    }
    bytes
}

#[test]
fn decodes_every_supported_codec_through_bounded_output_chunks() -> TestResult<()> {
    for (label, extension, bytes) in CODEC_FIXTURES {
        let mut session = open_decoder(bytes, extension)?;
        let summary = decode_to_sink(&mut session, |_| {})?;
        assert_eq!(summary.sample_rate, SAMPLE_RATE, "{label} sample rate");
        assert_eq!(summary.channels, CHANNELS, "{label} channel count");
        assert!(
            summary.frames >= FIXTURE_FRAMES,
            "{label} decoded too few frames: {summary:?}"
        );
        assert!(
            summary.frames <= FIXTURE_FRAMES + 2_304,
            "{label} retained excessive padding: {summary:?}"
        );
        assert!(
            summary.max_decoded_packet_samples <= MAX_DECODED_PACKET_SAMPLES,
            "{label} decoder packet exceeded the memory bound: {summary:?}"
        );
        assert!(
            summary.max_output_chunk_samples <= OUTPUT_CHUNK_SAMPLES,
            "{label} exceeded the bounded output chunk: {summary:?}"
        );
        assert!(!summary.codec.is_empty(), "{label} codec descriptor");
    }

    let wav = pcm_wav(8_192, -8_192, FIXTURE_FRAMES);
    let mut session = open_decoder(&wav, "wav")?;
    let summary = decode_to_sink(&mut session, |_| {})?;
    assert_eq!(summary.frames, FIXTURE_FRAMES);
    assert!(summary.max_decoded_packet_samples <= MAX_DECODED_PACKET_SAMPLES);
    assert!(summary.max_output_chunk_samples <= OUTPUT_CHUNK_SAMPLES);
    Ok(())
}

#[test]
fn accurate_seek_reaches_the_requested_pcm_frame() -> TestResult<()> {
    let target_frame = 6_000_u64;
    let wav = pcm_wav(12_288, -12_288, FIXTURE_FRAMES);
    let mut session = open_decoder(&wav, "wav")?;
    let seeked = session.format.seek(
        SeekMode::Accurate,
        SeekTo::TimeStamp {
            ts: target_frame,
            track_id: session.track_id,
        },
    )?;
    session.decoder.reset();

    assert_eq!(seeked.required_ts, target_frame);
    assert!(seeked.actual_ts <= seeked.required_ts);

    let packet = loop {
        let packet = session.format.next_packet()?;
        if packet.track_id() == session.track_id {
            break packet;
        }
    };
    let packet_ts = packet.ts;
    let decoded = session.decoder.decode(&packet)?;
    let decoded_channels = decoded.spec().channels.count();
    let mut samples = SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
    samples.copy_interleaved_ref(decoded);
    let frame_offset = usize::try_from(target_frame.saturating_sub(packet_ts))?;
    let sample_offset = frame_offset * decoded_channels;

    assert!(sample_offset + 1 < samples.samples().len());
    assert!((samples.samples()[sample_offset] - 0.375).abs() < 0.000_1);
    assert!((samples.samples()[sample_offset + 1] + 0.375).abs() < 0.000_1);
    Ok(())
}

#[test]
fn consecutive_tracks_handoff_without_inserted_or_duplicated_samples() -> TestResult<()> {
    let first = pcm_wav(8_192, 8_192, FIXTURE_FRAMES);
    let second = pcm_wav(-8_192, -8_192, FIXTURE_FRAMES);
    let mut rendered = Vec::with_capacity(FIXTURE_FRAMES * CHANNELS * 2);

    for wav in [&first, &second] {
        let mut session = open_decoder(wav, "wav")?;
        let summary = decode_to_sink(&mut session, |chunk| rendered.extend_from_slice(chunk))?;
        assert_eq!(summary.frames, FIXTURE_FRAMES);
        assert!(summary.max_output_chunk_samples <= OUTPUT_CHUNK_SAMPLES);
    }

    let boundary = FIXTURE_FRAMES * CHANNELS;
    assert_eq!(rendered.len(), boundary * 2);
    assert!((rendered[boundary - 1] - 0.25).abs() < 0.000_1);
    assert!((rendered[boundary] + 0.25).abs() < 0.000_1);
    assert!(rendered[..boundary].iter().all(|sample| *sample > 0.0));
    assert!(rendered[boundary..].iter().all(|sample| *sample < 0.0));
    Ok(())
}
