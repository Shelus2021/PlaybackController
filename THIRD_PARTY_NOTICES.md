# Third-party notices

This extension contains code derived from or distributed with the following
third-party projects. The notices below must remain with source and packaged
copies of the extension.

## Video Speed Controller

- Original project: https://github.com/igrigorik/videospeed
- Firefox port used as an upstream reference: https://github.com/codebicycle/videospeed
- Copyright: Copyright (c) 2014 Ilya Grigorik
- License: MIT
- Included material: portions of the playback controller, styles, and settings
  behavior.
- Full terms: `licenses/Video-Speed-Controller-MIT.txt`

## Cat Catch 1.x (猫抓 1.x)

- Project and readable source: https://github.com/xifangczy/cat-catch
- Upstream code line: 1.x (the upstream changelog identifies 1.0.26 as the last
  1.x release before 2.0.0)
- Copyright: Copyright (c) [2017] [xifangczy]
- License for the 1.x code line used here: MIT
- Included material: portions of the media-resource discovery, filtering,
  request handling, state initialization, and Firefox compatibility logic.
- Full terms: `licenses/Cat-Catch-1.x-MIT.txt`

Cat Catch changed its upstream license beginning with the 2.x code line to
GPL-3.0. This extension's notice concerns the older 1.x MIT-licensed code; it
does not grant permission to copy later GPL-3.0-only Cat Catch code into this
extension without separately complying with GPL-3.0.

## hls.js 1.4.4

- Project: https://github.com/video-dev/hls.js
- Version: 1.4.4
- Release source: https://github.com/video-dev/hls.js/tree/v1.4.4
- License: Apache License 2.0
- Included file: `lib/hls.min.js`
- Copyright and derived-code notices: `lib/hls.LICENSE.txt`
- Complete Apache-2.0 terms: `lib/mux.LICENSE.txt`

## mux.js

- Project: https://github.com/videojs/mux.js
- Version: 7.1.0
- Release source: https://github.com/videojs/mux.js/tree/v7.1.0
- License: Apache License 2.0
- Included file: `lib/mux.min.js`
- Full terms: `lib/mux.LICENSE.txt`

## MP4Box.js

- Project: https://github.com/gpac/mp4box.js
- Readable source and releases: https://github.com/gpac/mp4box.js/releases
- Vendored build note: the bundled generated modules do not contain reliable
  version metadata; their SHA-256 fingerprints should be used to match the
  exact distributed files until the build is regenerated from a pinned release.
- `lib/mp4box.all.mjs`: `8A8795BEF295CB876149088FB939763542C3E83C1E1717D70652BEC77AEF9C47`
- `lib/styp-9TIZZDLN.mjs`: `D54F38B803C7628361F61E39F4D43A3213A53C3CFE30B62C9B7A80A0D34EA9E1`
- `lib/rolldown-runtime-w6R9maHv.mjs`: `183552FE973134BCE551888434B581D5A2CB695A82D8907E2CD9D2B61E12CE24`
- Copyright: Copyright (c) 2012 Telecom ParisTech/TSI/MM/GPAC Cyril Concolato
- License: BSD 3-Clause
- Included files: `lib/mp4box.all.mjs`, `lib/styp-9TIZZDLN.mjs`, and
  `lib/rolldown-runtime-w6R9maHv.mjs`
- Full terms: `lib/mp4box.LICENSE.txt`

## Project-specific code and modifications

The third-party licenses above apply only to the material covered by them.
They do not, by themselves, license independently written additions or transfer
copyright in those additions. No project-wide license for independently
written code is declared by this notice. Unless the copyright holder publishes
a separate license for that code, the ordinary default is that no permission
to copy, modify, or redistribute those independently written additions has
been granted.
