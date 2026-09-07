# Mobile interactions and bounded offline caching

Implemented for the private PWA, following the mobile player redesign.

- Albums is the default page; collection and queue navigation scroll smoothly,
  respecting reduced-motion preferences.
- Seeking has a 54px invisible pointer target with unchanged visible bar and
  layout footprint. Drag preview and committed playback position remain separate.
- Now Playing uses a native dialog with interruptible entrance/dismissal motion,
  drag-to-dismiss, Escape support, and a reduced-motion path.
- Catalog reads share concurrent requests and a bounded 45-second memory cache.
  Catalog revision changes invalidate memory; Refresh explicitly fetches anew.
- The service worker stores up to 40 visited catalog requests and 96 artwork
  responses. Online catalog reads remain network-first; failures can fall back
  to clearly marked offline data. Authorization failures remove cached responses.
- Save offline stores at most five complete songs, each at most 32 MB. It never
  automatically downloads streamed audio. Saved tracks support single byte-range
  requests for seeking, including Safari-style suffix ranges.
- Offline access covers saved songs and previously visited pages, not a complete
  library mirror. Browser storage may be evicted. Clearing site data removes
  downloaded songs and cached metadata; removing a song's offline copy is also
  available in Now Playing.

## Verification

Unit coverage includes request coalescing, freshness, revision invalidation,
failed downloads, bounded storage, range responses, service-worker routing,
offline catalog fallback, authorization failures, unavailable browser storage,
reduced motion, and interrupted sheet transitions.

Browser QA used actual audio-element playback with a silent WAV fixture, not a
mocked media element. Chromium passed offline reload/playback/seeking with network
emulation disabled. WebKit passed host-unavailable reload/playback/seeking; its
airplane-mode emulation returned an internal navigation error despite a populated
shell cache. Physical iPhone airplane-mode and background playback remain device
checks. Both engines passed enlarged-target scrubbing and drag dismissal, with
no page errors or horizontal overflow at mobile widths. Computer Use checked
the live player, queue navigation, and playback controls.
