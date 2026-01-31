<template>
    <!-- Footer -->
    <div class="footer-container">
        <p class="footer-text">Slyce processes video files into multi-layered ktx2 texture tiles that can be used with
            <a href="https://rivvon.ca">rivvon</a> to create animated ribbons rendered via GPU shaders.
            It extracts
            <a
                target="_blank"
                href="https://en.wikipedia.org/wiki/Slit-scan_photography"
            >
                cross sections of a video
            </a> using
            <a
                target="_blank"
                href="https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API"
            >
                WebCodecs</a>,
            <a
                target="_blank"
                href="https://github.com/Vanilagy/mediabunny"
            >
                mediabunny</a>, and
            <a
                target="_blank"
                href="https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API"
            >
                Canvas</a>. Textures are encoded using <a href="https://github.com/BinomialLLC/basis_universal">Basis
                Encoder</a>.
            <span class="hide-mobile">
                Animations are achieved by taking multiple cross sections of the same video.
                Each cross section samples pixels from each frame.
                This can be done using one of two strategies. A linear sampling pattern stays on the same row for each
                sample, resulting in a planar cross section. The selection of rows is eased around the boundaries to
                achieve
                an animation that oscillates back and forth smoothly.
                Rendering a plane-based texture assumes the use of a shader that enacts a back-and-forth motion to
                achieve a
                looping effect.
                Alternately, sampling may follow a period function to achieve a wave-based result that always returns to
                the
                beginning (this ensures a directly loop-able animation).
            </span>
        </p>
        <p>Created by <a href="https://nsitu.ca">Harold Sikkema</a></p>
    </div>
</template>


<style scoped>
    .footer-container {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        align-items: center;
        justify-content: center;
        padding: 1rem;
        padding-bottom: 2rem;
    }

    @media (min-width: 640px) {
        .footer-container {
            gap: 1.25rem;
            padding: 1rem;
            padding-bottom: 4rem;
        }
    }

    .footer-text {
        font-size: 0.75rem;
        line-height: 1.5;
        max-width: 100%;
    }

    @media (min-width: 640px) {
        .footer-text {
            font-size: 0.875rem;
        }
    }

    .hide-mobile {
        display: none;
    }

    @media (min-width: 768px) {
        .hide-mobile {
            display: inline;
        }
    }

    a {
        color: var(--text-secondary);
        text-decoration: underline;
        transition: color 0.2s;
    }

    a:hover {
        color: var(--text-primary);
    }
</style>