# Private remote listening

## Objective

Let the owner browse and play the laptop's Jukebox library from an iPhone while preserving the app's local-first model: no hosted catalog, no public port, no mandatory Jukebox account, and no arbitrary filesystem access.

## Product decision

The default remote path is a loopback-only HTTP service proxied through Tailscale Serve. Tailscale supplies device identity, encrypted transport, stable private DNS, and access policy without making Jukebox an internet-facing service. Direct LAN binding and Tailscale Funnel remain disabled.

Original files are served with single HTTP byte ranges when Safari supports their codecs. This keeps CPU use and latency low while allowing seek and resume. On-demand HLS transcoding is a later compatibility path for unsupported formats or constrained networks; it is not required for already compatible AAC, ALAC, FLAC, MP3, or WAV libraries.

## Implementation progress

- The loopback server, mobile shell, bounded catalog search, direct byte-range streaming, path containment, and opt-in lifecycle are implemented.
- Tailscale installation, connection state, DNS name, occupied HTTPS ports, and the Jukebox Serve target are detected with bounded CLI calls.
- Settings can create and remove a dedicated Jukebox Serve endpoint after an explicit click. It selects an unused HTTPS port and refuses unsafe removal when an endpoint is shared with another app.
- The mobile shell includes an origin-scoped web manifest, application icons, iPhone standalone metadata, and a shell-only service worker so it can be installed separately from other private apps.
- Public Funnel is never offered or configured.

## Security boundaries

- Bind only to `127.0.0.1` unless a future authenticated LAN mode is explicitly enabled.
- Resolve streams by opaque track ID through the catalog; never accept a filesystem path from a request.
- Canonicalize the catalog path and require it to remain beneath an approved library root.
- Support one bounded byte range and reject multipart or malformed ranges to limit resource abuse.
- Keep the API read-only in the first release and apply strict response CSP/no-store headers.
- Recommend Tailscale Serve, never Funnel, for iPhone access.
- Treat Tailscale identity headers as trusted only when the service remains loopback-bound behind the local proxy.

## Delivery sequence

### 1. Loopback listening foundation

- Add an opt-in setting and lifecycle-managed backend server.
- Serve a compact, responsive, motion-light mobile player and a bounded search endpoint.
- Stream approved catalog files with correct `206`, `Content-Range`, `Content-Length`, MIME, and `Accept-Ranges` behavior.
- Add tests for range parsing, wildcard escaping, settings compatibility, and path containment.

### 2. Private HTTPS setup

- Detect Tailscale CLI/app availability and signed-in state without changing configuration automatically.
- Offer a guided setup for `tailscale serve --bg 45321` and show the resulting private HTTPS URL.
- Verify the URL is tailnet-only and clearly distinguish Serve from public Funnel.
- Add a one-click disable flow that stops Jukebox's listener; leave external Tailscale configuration visible and reversible.

### 3. Mobile library experience

- Move the remote catalog endpoint onto plan 2's paged FTS query service.
- Add album/artist browsing, favorites, queue, recent items, artwork thumbnails, and stable continuation cursors.
- Add Media Session metadata and transport handlers for iPhone lock-screen controls.
- Keep the mobile UI compact and installable; avoid large animation or streaming-service imitation.

### 4. Codec compatibility

- Record direct-play compatibility by codec/container and Safari version.
- Add a bounded FFmpeg capability probe; do not assume a Homebrew binary exists in production.
- For incompatible media, create short-lived audio-only HLS renditions with bounded concurrency, cache limits, cancellation, and cleanup.
- Prefer AAC-LC for the broad fallback and retain original lossless delivery when direct play works.

### 5. Operational hardening

- Add structured connection, search, stream, range, and transcode diagnostics without logging full personal paths.
- Rate-limit catalog requests and concurrent streams, cap query sizes, and enforce request timeouts.
- Test sleep/wake, network changes, app restart, partial reads, unavailable files, malformed headers, and client disconnects.
- Add integration tests using a copied fixture library and browser checks against WebKit.

## Performance budgets

- Initial mobile shell loads in under one second on a normal private connection after TLS establishment.
- Search returns the first page in under 150 ms on the reference 100k-track library.
- Direct streaming uses bounded buffers and does not load complete tracks into memory.
- A disconnected client releases its file handle promptly.
- Transcoding, when added, is concurrency-limited and never starves desktop playback or scanning.

## Acceptance criteria

- The service is disabled by default and remains unreachable from other devices without an explicit private proxy.
- An authorized iPhone can search, start, pause, resume, and seek supported tracks over HTTPS.
- API requests cannot select files outside configured library roots.
- Malformed and multi-range requests fail safely with standards-compliant responses.
- Closing the window to the tray keeps an enabled server available; quitting Jukebox stops it.
- No library metadata or audio is uploaded to a Jukebox-operated cloud service.

## Rollout and rollback

- Ship loopback mode behind the opt-in setting first.
- Keep the API read-only until authentication, revision checks, and queue ownership are established.
- Allow the server to be disabled instantly without changing the local library or desktop playback state.
- Keep HLS transcoding separately feature-gated so direct streaming remains available if transcoding regresses.
