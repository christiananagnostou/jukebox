---
name: Jukebox private PWA
description: Familiar mobile music browsing and playback in the desktop Jukebox palette.
colors:
  canvas: '#17171f'
  surface: '#22232e'
  surface-elevated: '#303747'
  border: '#343746'
  text: '#e2e8f0'
  muted: '#94a3b8'
  primary: '#7c93bf'
  primary-hover: '#a8c1eb'
  focus-ring: '#9bbcf2'
  danger: '#efa0a8'
rounded:
  artwork: '6px'
  control: '8px'
  dock: '10px'
  sheet: '18px'
  dialog: '16px'
  thin-track: '2px'
spacing:
  small: '8px'
  medium: '16px'
  large: '24px'
---

# Design System: Jukebox private PWA

## Overview

This document covers only the private browser player in
`src-tauri/src/remote_access/`. The desktop app remains the incumbent visual
authority; this document does not redefine its layout or components.

Use familiar music-app patterns: browse a library, keep playback within reach,
and open an artwork-led Now Playing screen. The visual identity comes from
Jukebox's existing dark surfaces and muted blue accents. Album artwork supplies
the imagery and variety.

## Colors

Canvas is the page background. Surface frames search and hover states;
surface-elevated distinguishes the persistent mini-player and artwork fallback.
Use text for titles, muted for supporting metadata, and primary-hover for active
navigation and playback emphasis. Border separates controls and queue content.
Reserve danger for destructive queue actions and focus-ring for keyboard focus.

## Typography

Use the native system sans-serif stack shared by the implemented surface.
The library title is 28px, section titles 22px, track titles 15px, and supporting
metadata 12-13px. Now Playing titles are 25px, reducing to 21px on short screens.
Keep timestamps tabular. Truncate compact rows; allow full-player titles to wrap.

## Layout

Center the library within 960px. Mobile content uses 20px side padding, reducing
to 16px at widths of 360px or below. Account for device safe areas and reserve
bottom space for the fixed player and navigation dock.

Album artwork uses an adaptive grid with 140px minimum columns and 16px column
gaps; at 700px and above, use four columns. Songs and artists use compact rows.
The dock places the mini-player immediately above Songs, Albums, and Artists.

Now Playing fills the mobile viewport and scrolls when needed. Its content is
centered within 480px; artwork scales with available height to retain access to
transport controls on small screens. At wider widths, the player uses a centered
520px dialog. Preserve usable layouts down to 320px.

Albums is the initial library view. Navigation to a collection or queue scrolls
smoothly; reduced-motion preferences disable these transitions.

## Elevation & Depth

Use flat tonal layers and fine borders. There are no decorative shadows or
gradients. On larger screens, a dark translucent backdrop separates the player
dialog from the library.

## Shapes

Album covers are square with gently rounded corners. Artist fallbacks are
circular. The main play/pause control is circular and larger than adjacent
transport controls. Use consistent outlined SVG icons.

## Components

- Search has a leading search icon, a labeled input, and a submit action.
- Library navigation uses visible labels and a blue active state.
- The mini-player shows artwork, track and artist, play/pause, next, and progress.
  Its title/artwork region opens Now Playing.
- Now Playing shows artwork, title, artist and album links, seek position and
  times, previous/play-pause/next, playback feedback, and the queue.
- The player enters as an interruptible bottom sheet (340ms ease-out), dismisses
  faster (220ms), and supports dragging its handle down. Keep native dialog focus
  and Escape behavior. Reduced motion removes the animated transition.
- The seek bar retains its thin visual track within a 54px pointer target;
  dragging anywhere in that target previews position and commits on release.
- Saving a song offline is explicit and removable. Keep storage bounded and
  communicate download failures without interrupting playback.
- Playback status sits quietly below the song metadata, above seeking. Routine
  Playing/Paused states never add another Play button; reserve feedback actions
  for recovery that the primary transport controls do not cover.
- Queue access opens and focuses the queue section. Rows support playback and
  removal; clearing the queue is a separate action.
- Artwork failures reveal the icon fallback. Loading, empty, playback failure,
  and disconnected states use specific text with recovery actions where useful.
- Standard icon buttons have 44px targets. Provide explicit accessible names,
  visible keyboard focus, and disabled transport states. Seeking continues to
  track playback after a committed adjustment, even while the control has focus.

## Do's and Don'ts

- Do preserve the desktop palette and familiar browse/player relationship.
- Do use actual library artwork, with a consistent missing-art fallback.
- Do keep primary playback controls accessible on narrow and short screens.
- Don't add decorative panels, invented music features, or a separate mobile
  brand identity as part of routine refinement.
- Don't treat repeated artwork in synthetic QA fixtures as production content.
