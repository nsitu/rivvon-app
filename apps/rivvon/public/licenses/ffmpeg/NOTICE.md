The SDR MP4 exporter loads the unmodified single-threaded @ffmpeg/core 0.12.10
distribution on demand. It includes FFmpeg and libx264 and is licensed
GPL-2.0-or-later. A copy of GPLv2 is shipped beside this notice.

Upstream project, build scripts, dependency source versions, and licensing:
- https://github.com/ffmpegwasm/ffmpeg.wasm
- https://github.com/ffmpegwasm/ffmpeg.wasm/tree/71aa99d37c02a7b4c435275ca9ef50e612f6efa1
- https://github.com/ffmpegwasm/ffmpeg.wasm/blob/71aa99d37c02a7b4c435275ca9ef50e612f6efa1/Dockerfile
- https://ffmpegwasm.netlify.app/docs/overview/#licensing
- https://ffmpeg.org/legal.html
- https://www.videolan.org/developers/x264.html

The pinned npm archive integrity is
sha512-dzNplnn2Nxle2c2i2rrDhqcB19q9cglCkWnoMTDN9Q9l3PvdjZWd1HfSPjCNWc/p8Q3CT+Es9fWOR0UhAeYQZA==.

Before distributing a release containing this runtime, supply the corresponding
source/build materials and notices for the exact binary under its GPL terms.
The core 0.12.10 release commit above specifies FFmpeg n5.1.4 and its library
dependencies. The wrapper's similarly named v0.12.10 tag contains core 0.12.6
and must not be mistaken for this core's source release.
The ffmpeg.wasm JavaScript wrapper (@ffmpeg/ffmpeg 0.12.15) is MIT-licensed;
the wrapper's MIT licence does not replace the core's GPL licence.
