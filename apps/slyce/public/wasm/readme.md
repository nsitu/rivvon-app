# Basis Encoder WASM

The Basis Encoder is used to convert images (e.g. JPG, PNG) into compressed KTX2 textures. The WASM builds here were made by [Laurent Thillet](https://github.com/lo-th/) and are available at [https://github.com/lo-th/uil/tree/main/examples/libs](https://github.com/lo-th/uil/tree/main/examples/libs). As of September 2025, BinomialLLC only publishes the [non-threaded build](https://github.com/BinomialLLC/basis_universal/tree/master/webgl/encoder/build).

## Threading Architecture

This project uses **`basis_encoder.wasm` (single-threaded)** running inside multiple web workers that we create and manage ourselves (see `KTX2WorkerPool`). The threaded encoder files are kept in this directory for reference but are **not used in production**.

### Why Single-Threaded Encoder in Worker Pool?

We initially explored using `basis_encoder_threads.wasm` but encountered significant challenges:

1. **Cross-Origin Isolation Complexity**: The threaded encoder requires `SharedArrayBuffer` support, which necessitates COOP/COEP headers. While achievable on GitHub Pages via `coi-serviceworker.js`, it adds deployment complexity and potential failure points.

2. **Worker Nesting Issues**: The threaded encoder spawns its own workers internally. When we tried to use it inside our own workers for parallel tile processing, we encountered nested worker problems and coordination difficulties that were hard to resolve.

3. **Equivalent Performance**: By running many single-threaded encoders in parallel workers, we achieve similar overall throughput. While individual layers encode more slowly, the aggregate parallelism across all workers matches or exceeds what we'd get from a single threaded encoder instance.

4. **Simpler Architecture**: Our approach gives us full control over worker lifecycle, error handling, and resource management without fighting the encoder's internal threading model.

### Files in This Directory

- **`basis_encoder.js`** / **`basis_encoder.wasm`** - Single-threaded encoder (actively used)
- **`basis_encoder_threads.js`** / **`basis_encoder_threads.wasm`** - Multi-threaded encoder (kept for reference, not used)
- **`basis_transcoder.js`** / **`basis_transcoder.wasm`** - Transcoder for decoding (used by Three.js)

# Basis Transcoder WASM 

The transcoder (`basis_transcoder.wasm`) is used by Three.js to decode/transcode existing Basis Universal textures to a supported GPU format. It has been sourced from [https://github.com/mrdoob/three.js/tree/dev/examples/jsm/libs/basis](https://github.com/mrdoob/three.js/tree/dev/examples/jsm/libs/basis). You can also load it from a CDN, e.g. [https://app.unpkg.com/three@0.180.0/files/examples/jsm/libs/basis](https://app.unpkg.com/three@0.180.0/files/examples/jsm/libs/basis)