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
                        <div class="about-primary-layout">
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

                            <div class="about-primary-copy">
                                <h3>About Rivvon</h3>
                                <p>
                                    Rivvon applies video texture to vector art to make animated 3D ribbons. Rendering
                                    happens
                                    via <a href="https://threejs.org/">three.js</a> using <a
                                        href="https://www.khronos.org/webgpu"
                                    >WebGPU</a> if available, and <a href="https://www.khronos.org/webgl">WebGL</a>
                                    fallback if needed.
                                </p>
                                <h3>Textures</h3>
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
                                    (Real-Time Intermediate Flow Estimation for Video Frame Interpolation) by Zhewei
                                    Huang et
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
                                <h3>Drawing rivvons</h3>
                                <p>Rivvon supports various drawing modalities. Gesture input allows for touch or mouse
                                    based
                                    drawings. You can also import an SVG file to use as rivvon geometry.</p>
                                <p>
                                    You can draw a rivvon using the GPS on your phone, via the browser's <a
                                        href="https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API"
                                    >Geolocation</a> features.
                                    This modality lets you walk/bike/drive around in order to record a trace on a map.
                                    The geographic shape of your journey then forms the geometry of the rivvon.
                                    Map tiles via <a href="https://www.openstreetmap.org/">Open Street Map</a> on <a
                                        href="https://leafletjs.com/"
                                    >Leaflet</a>.

                                </p>
                                <p>You can create rivvons based on simple emojii. For this purpose, the <a
                                        href="https://openmoji.org/styleguide/#contour"
                                    >OpenMoji</a> set has proven useful due to its emphasis on simple traceable
                                    contours. </p>
                                <p>
                                    You can create a rivvon from text input.
                                    Single Line fonts (commonly used with pen plotters) work well for this.
                                    These fonts are based around a spine, rather than outlines, and thus lend themselves
                                    well to
                                    creating a clear stroke.
                                    Single Line fonts are available as SVG files, and more recently via OTF, which now
                                    supports
                                    svg-based glyphs.
                                    This has been by notably explored by <a
                                        href="https://github.com/isdat-type">isdaT-type</a>.
                                </p>
                                <p>

                                    Vector contours can be derived from an image to make a rivvon.
                                    The foreground/subject of the image is segmented using <a
                                        target="_blank"
                                        href="https://github.com/xuebinqin/U-2-Net"
                                    >U-2-Net</a> by <a href="https://xuebinqin.github.io/">Xuebin Qin</a>. A <a
                                        href="https://github.com/xuebinqin/U-2-Net/issues/295"
                                    >quantized</a> version by <a href="https://github.com/Kikedao">Kikedao</a> is used
                                    for
                                    optimal<a href="https://onnxruntime.ai/docs/tutorials/web/">ONNX Runtime
                                        Web</a> compatibility. After segmentation, a vector is derived from the mask
                                    using a <a
                                        href="https://en.wikipedia.org/wiki/Marching_squares"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >marching squares</a> algorithm plus smoothing.
                                </p>
                                <h3>Interaction</h3>
                                <p>Interaction happens using standard three.js <a
                                        href="https://threejs.org/docs/#OrbitControls"
                                    >Orbit Controls</a>.
                                    In head-tracking mode, the webcam allows the user to control the rivvon via <a
                                        href="https://ai.google.dev/edge/mediapipe/"
                                    >MediaPipe</a> <a
                                        href="https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker"
                                    >Face landmarker</a> </p>
                                <h3>Exporting and Sharing</h3>
                                <p>Rivvons can be exported as images or videos. Video encoding happens via <a
                                        target="_blank"
                                        href="https://github.com/Vanilagy/mediabunny"
                                    >mediabunny</a> with <a
                                        target="_blank"
                                        href="https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API"
                                    >WebCodecs</a>. Configuration allows video export to follow a loopable format by
                                    aligning
                                    animation cycles. </p>
                                <h3>Slit Scan Technique</h3>
                                <p>
                                    Rivvon textures employ a variation on the classic slit-scan technique.
                                    In a simple slit scan, you sample one row of pixels from each frame, and then stich
                                    them
                                    together to form a cross section.
                                    One can animate multiple such cross sections to get an effective axis-swap (time
                                    becomes
                                    spatial).
                                    Rivvon does this with some added strategy. First, if we are simpling in a linear
                                    way, we
                                    ensure that samples are distributed in such a way that the animation yields an
                                    easing
                                    effect.
                                    Beyond this it's also possible to sample more dynamically, via a periodic function.
                                    In this way, the texture animation always returns to its point of origin.
                                    These adaptations to the technique allow the texture animation to play in
                                    a
                                    continuous loop without jarring jumps.
                                </p>
                                <h3>Contact</h3>
                                <p>
                                    You can get in touch via email: harold@nsitu.ca or via <a
                                        href="https://nsitu.ca/contact/"
                                    >my website</a>.
                                </p>
                                <p>
                                    Thank you!
                                </p>
                                <p class="info-build">
                                    Build: {{ buildTimestampDisplay }}
                                </p>
                            </div>
                        </div>

                    </div>

                    <div class="info-content about-secondary">
                        <h2>Thanks to:</h2>
                        <div class="logo-section">

                            <a
                                target="_blank"
                                href="https://threejs.org/"
                            ><img
                                    style="width: 90%; margin: auto;"
                                    src="/threejs-white.svg"
                                ></a>
                            <a
                                target="_blank"
                                href="https://www.cloudflare.com"
                            ><img
                                    src="/cloudflare-white.svg"
                                    class="pb-2"
                                ></a>

                            <a
                                target="_blank"
                                href="https://github.com/BinomialLLC/basis_universal"
                            ><img src="/binomial.svg"></a>
                            <a
                                target="_blank"
                                href="https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html"
                            ><img
                                    src="/ktx-white.svg"
                                    style="width: 75%; margin: auto;"
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
                                href="https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker"
                            ><img src="/mediapipe-white.svg"></a>
                            <a
                                target="_blank"
                                href="https://openmoji.org/"
                            ><img src="/openmoji.svg"></a>

                            <a
                                target="_blank"
                                href="https://www.openstreetmap.org/"
                            ><img
                                    src="/osm-white.svg"
                                    style="width: 80%; margin: auto;"
                                ></a>
                            <a
                                target="_blank"
                                href="https://leafletjs.com/"
                            ><img src="/leaflet-white.svg"></a>

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

    .about-primary h3 {
        text-transform: uppercase;
    }

    .about-primary-layout {
        display: grid;
        gap: 1.5rem;
        align-items: start;
    }

    .about-primary-copy>*+* {
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

    @media (min-width: 960px) {
        .about-panel-content {
            max-width: none;
        }

        .about-layout {
            grid-template-columns: minmax(0, 1.6fr) minmax(300px, 1fr);
            align-items: start;
            gap: 6rem;
        }

        .about-primary-layout {
            grid-template-columns: minmax(180px, 220px) minmax(0, 1fr);
            gap: 2rem;
        }

        .creator-figure {
            margin: 0;
        }

        .creator-caption {
            text-align: left;
        }
    }
</style>