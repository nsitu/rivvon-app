Rivvon applies video texture to vector art to make animated ribbons.

Textures are created by extracting [cross sections](https://en.wikipedia.org/wiki/Slit-scan_photography) from video files. Video processing leverages [mediabunny](https://github.com/Vanilagy/mediabunny) with [WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API) under the hood. Rows of pixels are assembled as square tiles in a [WebGL2](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/Tutorial/Using_textures_in_WebGL) texture atlas.

Texture tiles are encoded as layered [KTX2](https://github.khronos.org/KTX-Specification/ktxspec.v2.html) files using [Binomial](https://www.binomial.info/)'s [Basis Encoder](https://github.com/BinomialLLC/basis_universal). Multi-threading is possible by running several encoders in parallel via [web workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers). Videos may be temporally stretched via an integrated an [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/) port of [RIFE](https://github.com/hzwer/ECCV2022-RIFE) (Real-Time Intermediate Flow Estimation for Video Frame Interpolation) by Zhewei Huang et al.

Texture data is stored in the browser via [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API), and may optionally be stored in the cloud via Google Drive and/or [Cloudflare R2](https://www.cloudflare.com/products/r2/).

Image contours are traced with [Marching Squares](https://en.wikipedia.org/wiki/Marching_squares) on a segmented mask via [U-2-Net](https://github.com/xuebinqin/U-2-Net) by [Xuebin Qin](https://xuebinqin.github.io/) et al and [quantized](https://github.com/xuebinqin/U-2-Net/issues/295) by [Kikedao](https://github.com/Kikedao) for [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/).

Animations are achieved by taking multiple cross sections of the same video. Each cross section samples pixels from each frame. This can be done using one of two strategies: a linear sampling pattern that stays on the same row for each sample (planar cross section), or a periodic function that achieves a wave-based, directly loopable animation.
