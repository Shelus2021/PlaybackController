# Playback Control

[Simplified Chinese](README.md) | [English](README_en.md)

Repository: <https://github.com/Shelus2021/PlaybackController>

A local Firefox extension for controlling the playback speed and position of
web video and audio, and for finding media resources loaded by the current
page.

## Features

- A draggable in-page playback controller that automatically stays within the
  edge of the video.
- Keyboard shortcuts for controller visibility, speed adjustment, seeking, and
  a custom playback speed.
- Remembers whether the extension is enabled on each website.
- Finds, filters, sorts, previews, and downloads media resources. Expand a
  resource to view, copy, or open its original URL.
- Displays the file format, size, or available quality options before creating
  a download.
- Embedded M3U8/HLS preview.
- For common on-demand M3U8 streams, presents one or more download options with
  resolution, estimated size, and audio-track status before downloading. It
  can losslessly merge a separate AAC audio track.
- Rebuilds a continuous MP4 timeline before completing a download, preventing
  incorrect duration or frozen playback caused by timestamp discontinuities
  in long segmented videos.
- Configurable file-extension, Content-Type, and minimum-size finder rules.
- Automatically switches between Simplified Chinese and English according to
  the Firefox interface language.
- Runs in private windows after Firefox grants private-window access; private
  media records remain in memory only.

## Default shortcuts

- `H`: show or hide the controller
- `S`: decrease playback speed
- `W`: increase playback speed
- `A`: rewind 5 seconds
- `D`: advance 5 seconds
- `R`: reset playback speed to 1.0×
- `V`: switch to the custom speed of 1.5×

All settings can be changed directly from the extension popup.

## Installation

In Firefox, choose **Install Add-on From File** and select the packaged `.xpi`
file. For development and testing, you can also temporarily load this
directory's `manifest.json` from `about:debugging`.

## Privacy

The extension contains no analytics, advertising, or developer-operated data
upload service. Media results are temporarily stored in the browser and can
include media URLs, source-page URLs, and page titles. They are removed on
navigation, tab closure, or periodic cleanup. Media records from private
windows remain in memory only and are never written to `storage.local`.

Previewing or downloading connects directly to the relevant media server and
may use existing site credentials and the Referer/Origin headers required by
that server. Ordinary settings use `storage.sync`; Firefox may synchronize
them when the user enables Firefox Sync. See [`PRIVACY.md`](PRIVACY.md).

## Sources and licensing

The playback-control portion is modified from Ilya Grigorik's Video Speed
Controller project and codebicycle's Firefox port. The relevant upstream code
is licensed under the MIT License.

The media-finder functionality is modified from the Cat Catch 1.x code line,
which is licensed under the MIT License. Cat Catch 2.x and later changed to
GPL-3.0. This project does not automatically become GPL-3.0 because of that
later change, but Cat Catch 2.x code must not be introduced without separately
complying with GPL-3.0.

HLS previews use hls.js 1.4.4 (Apache-2.0), lightweight MPEG-TS-to-MP4
transmuxing uses mux.js (Apache-2.0), and MP4 container merging for separate
audio and video tracks uses MP4Box.js (BSD-3-Clause).

See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for the complete index of third-party sources,
covered files, and license texts. Third-party licenses apply only to the
material they cover; they do not automatically waive or transfer copyright in
independently written additions. Keep these licenses and notices with any
distributed or republished copy.

This project is maintained by GitHub user [Shelus2021](https://github.com/Shelus2021).
Except for identified third-party material, project-specific additions are
source-visible but are not offered under an open-source license. A public
repository may be viewed and forked through GitHub's platform features, but no
additional permission is granted to copy, modify, distribute, sublicense, or
sell the independently written material. See [`LICENSE`](LICENSE) for the exact
scope, third-party-license exceptions, and disclaimer.
