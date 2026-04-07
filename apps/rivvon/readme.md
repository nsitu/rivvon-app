# Note

## Realtime Sampling

See [docs/realtime-sampling.md](./docs/realtime-sampling.md) for the current realtime webcam sampling design, why staging is now used everywhere, and why we intentionally do not enable `willReadFrequently` on the active sampling canvases.

In a previous version I used coi-serviceworker.js to allow for SharedArrayBuffer to work, but that was when we were attempting to get the ktx2 encoder to work in mlutithreeaded mode. but now we spawn multiple ktx2 encoders inside of workers to avoid having to use shared array buffer.

If you still see coi-serviceworker hanging around in chrome dev tools, you can Un register the service worker in >Applicaiton . Service Workers
