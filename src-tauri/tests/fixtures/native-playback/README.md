# Native decoder fixtures

These files contain a copyright-free 440 Hz synthetic tone: 48 kHz, stereo, and 250 ms. They exist only to verify decoder compatibility; no personal media or machine-specific path is committed.

They were generated with FFmpeg 9.0.1 from the `sine` lavfi source:

```sh
ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'sine=frequency=440:sample_rate=48000:duration=0.25' -ac 2 -c:a libmp3lame -b:a 128k tone.mp3
ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'sine=frequency=440:sample_rate=48000:duration=0.25' -ac 2 -c:a aac -b:a 128k tone-aac.m4a
ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'sine=frequency=440:sample_rate=48000:duration=0.25' -ac 2 -c:a flac tone.flac
ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'sine=frequency=440:sample_rate=48000:duration=0.25' -ac 2 -c:a vorbis -strict experimental -q:a 4 tone.ogg
ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'sine=frequency=440:sample_rate=48000:duration=0.25' -ac 2 -c:a alac tone-alac.m4a
```

WAV coverage is generated in memory by the integration test so the repository does not carry a larger uncompressed fixture.
