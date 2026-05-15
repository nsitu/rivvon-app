<script setup>
    defineProps({
        active: { type: Boolean, default: false },
        buildTimestampDisplay: { type: String, default: 'Unavailable' },
    });
</script>

<template>
    <div
        class="about-panel"
        :class="{ active }"
    >
        <div class="about-panel-container viewer-chrome-panel-container">
            <div class="about-panel-content">
                <div class="about-layout">
                    <div class="info-content about-primary">

                        <figure class="creator-figure">
                            <a
                                class="creator-image-link"
                                target="_blank"
                                href="https://nsitu.ca"
                            ><img
                                    src="/harold.png"
                                    alt="Portrait of Harold Sikkema"
                                    class="creator-image"
                                ></a>
                            <figcaption class="creator-caption">
                                <a
                                    target="_blank"
                                    href="https://nsitu.ca"
                                >Harold Sikkema</a> - <i>creator of Rivvon</i>
                            </figcaption>
                        </figure>
                        <p>
                            Rivvon applies video texture to vector art to make animated ribbons.
                        </p>
                        <p>

                            Textures are created by extracting
                            <a
                                target="_blank"
                                href="https://en.wikipedia.org/wiki/Slit-scan_photography"
                            >cross sections</a>
                            from video files. Video processing leverages
                            <a
                                target="_blank"
                                href="https://github.com/Vanilagy/mediabunny"
                            >mediabunny</a> with <a
                                target="_blank"
                                href="https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API"
                            >WebCodecs</a> under the
                            hood. Rows of pixels are assembled as square tiles in a <a
                                href="https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/Tutorial/Using_textures_in_WebGL"
                            >WebGL2</a>
                            texture atlas.
                        </p>
                        <p>
                            Texture tiles are encoded as layered <a
                                href="https://github.khronos.org/KTX-Specification/ktxspec.v2.html"
                            >KTX2</a> files using <a href="https://www.binomial.info/">Binomial</a>'s
                            <a
                                target="_blank"
                                href="https://github.com/BinomialLLC/basis_universal"
                            >Basis Encoder</a>.
                            Multi-threading is possible by running several encoders
                            in parallel via <a
                                href="https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers"
                            >web
                                workers</a>. Videos may be temporally stretched via an integrated an <a
                                href="https://onnxruntime.ai/docs/tutorials/web/"
                            >ONNX Runtime
                                Web</a> port of <a href="https://github.com/hzwer/ECCV2022-RIFE">RIFE</a>
                            (Real-Time Intermediate Flow Estimation for Video Frame Interpolation) by Zhewei Huang et
                            al.

                        </p>
                        <p>
                            Texture data is stored in the browser via <a
                                href="https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API"
                            >IndexedDB</a>, and may
                            optionally be stored in the cloud via Google Drive and/or <a
                                href="https://www.cloudflare.com/products/r2/"
                            >Cloudflare R2</a>.
                        </p>
                        <p>
                            Image contours are traced with <a
                                href="https://en.wikipedia.org/wiki/Marching_squares"
                                target="_blank"
                                rel="noopener noreferrer"
                            >Marching Squares</a> on a segmented
                            mask via <a
                                target="_blank"
                                href="https://github.com/xuebinqin/U-2-Net"
                            >U-2-Net</a> by <a href="https://xuebinqin.github.io/">Xuebin Qin</a> et al and <a
                                href="https://github.com/xuebinqin/U-2-Net/issues/295"
                            >quantized</a> by <a href="https://github.com/Kikedao">Kikedao</a> for <a
                                href="https://onnxruntime.ai/docs/tutorials/web/"
                            >ONNX Runtime
                                Web</a>.
                        </p>
                        <p>
                            Animations are achieved by taking multiple cross sections of the same video.
                            Each cross section samples pixels from each frame.
                            This can be done using one of two strategies: a linear sampling pattern that stays on the
                            same
                            row
                            for each sample (planar cross section), or a periodic function that achieves a wave-based,
                            directly loopable animation.
                        </p>
                        <p class="info-build">
                            Build: {{ buildTimestampDisplay }}
                        </p>

                    </div>

                    <div class="info-content about-secondary">
                        <h2>Thanks to:</h2>
                        <div class="logo-section">
                            <a
                                target="_blank"
                                href="https://github.com/BinomialLLC/basis_universal"
                            ><img src="/binomial.svg"></a>
                            <a
                                target="_blank"
                                href="https://www.cloudflare.com"
                            ><img
                                    src="/cloudflare-white.svg"
                                    class="pb-3"
                                ></a>

                            <a
                                target="_blank"
                                href="https://mediabunny.dev/"
                            ><img src="/mediabunny-white-with-wordmark.svg"></a>
                            <a
                                target="_blank"
                                href="https://onnxruntime.ai/"
                            ><img src="/onnx-white.svg"></a>
                            <a
                                target="_blank"
                                href="https://www.khronos.org/"
                            ><img src="/khronos-group-white.svg"></a>
                            <a
                                target="_blank"
                                href="https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html"
                            ><img
                                    src="/ktx-white.svg"
                                    style="width: 80%; margin: auto;"
                                ></a>
                            <a
                                target="_blank"
                                href="https://webgpu.org/"
                            ><img src="/webgpu-white-horizontal.svg"></a>
                            <a
                                target="_blank"
                                href="https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API"
                            ><img
                                    src="/WebGL-white.svg"
                                    style="width: 90%; margin: auto;"
                                ></a>
                            <a
                                target="_blank"
                                href="https://openmoji.org/"
                            ><img src="/openmoji.svg"></a>

                            <a
                                target="_blank"
                                href="https://xuebinqin.github.io/"
                            ><img
                                    src="/xuebin.svg"
                                    style="width: 90%; margin: auto;"
                                ></a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
    .about-layout {
        display: grid;
        gap: 2rem;
    }

    .logo-section {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 3rem;
        margin-top: 0.5rem;
        align-items: center;
    }

    .about-panel {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 8;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.3s ease;
        display: flex;
        flex-direction: column;
    }

    .about-panel.active {
        pointer-events: auto;
        opacity: 1;
    }

    .about-panel-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        width: 100%;
        box-sizing: border-box;
        background: var(--viewer-toolbar-panel-background, rgba(0, 0, 0, 0.75));
    }

    .about-panel-content {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 2rem 1.5rem;
        width: 100%;
        max-width: 720px;
        margin: 0 auto;
        box-sizing: border-box;
    }

    .info-content {
        width: 100%;
        font-size: 0.9rem;
        line-height: 1.6;
        color: var(--text-secondary);
    }

    .about-primary {
        display: flow-root;
    }

    .about-primary>*+* {
        margin-top: 1rem;
    }

    .about-secondary {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .creator-figure {
        width: min(100%, 220px);
        margin: 0 auto 1.25rem;
    }

    .creator-image-link {
        display: block;
        text-decoration: none;
    }

    .creator-image {
        display: block;
        width: 100%;
        height: auto;
        border-radius: 1rem;
        border: 1px solid var(--border-primary);
        background: rgba(255, 255, 255, 0.04);
    }

    .creator-caption {
        margin-top: 0.75rem;
        font-size: 0.85rem;
        line-height: 1.45;
        color: var(--text-secondary);
        text-align: center;
    }

    .info-build {
        margin-top: 0.5rem;
        font-size: 0.8rem;
        color: rgba(255, 255, 255, 0.58);
    }

    .info-content a {
        color: var(--text-primary);
        text-decoration: underline;
        transition: opacity 0.2s;
    }

    .info-content a:hover {
        opacity: 0.8;
    }

    @media (min-width: 720px) {
        .creator-figure {
            float: right;
            margin: 0 0 1.25rem 1.5rem;
        }

        .creator-caption {
            text-align: left;
        }
    }

    @media (min-width: 960px) {
        .about-panel-content {
            max-width: 1180px;
        }

        .about-layout {
            grid-template-columns: minmax(0, 1.6fr) minmax(300px, 1fr);
            align-items: start;
            gap: 6rem;
        }
    }
</style>