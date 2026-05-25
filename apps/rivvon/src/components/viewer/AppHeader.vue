<script setup>
    import { computed } from 'vue';
    import { resolveViewerHeaderContext } from '../../modules/viewer/viewerHeaderContext.js';
    import { useViewerStore } from '../../stores/viewerStore';
    import { useSlyceStore } from '../../stores/slyceStore';

    const props = defineProps({
        cameraActive: {
            type: Boolean,
            default: false,
        },
        cameraDismissLabel: {
            type: String,
            default: 'Turn off camera',
        },
        panelTitle: {
            type: String,
            default: null,
        },
        viewerTitle: {
            type: String,
            default: null,
        },
        viewerTitleModel: {
            type: Object,
            default: null,
        },
        toolbarOverlayTitle: {
            type: String,
            default: null,
        },
        navigationModel: {
            type: Object,
            default: null,
        },
    });

    const emit = defineEmits([
        'request-close-realtime-mode',
        'request-close-panel',
        'request-close-toolbar-overlay',
        'request-navigation-back',
        'request-navigation-exit',
        'request-viewer-title-kind-activate',
        'request-viewer-title-drawing-activate',
        'request-viewer-title-texture-activate',
        'request-turn-off-camera'
    ]);

    const app = useViewerStore();
    const slyce = useSlyceStore();

    function toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
            app.setFullscreen(true);
        } else {
            document.exitFullscreen();
            app.setFullscreen(false);
        }
    }

    // Listen for fullscreen changes (e.g., Escape key)
    if (typeof document !== 'undefined') {
        document.addEventListener('fullscreenchange', () => {
            app.setFullscreen(!!document.fullscreenElement);
        });
    }

    const isSlyceProcessing = computed(() => Object.keys(slyce.status).length > 0);
    const hasNavigationModel = computed(() => Array.isArray(props.navigationModel?.breadcrumbs) && props.navigationModel.breadcrumbs.length > 0);
    const navigationBreadcrumbs = computed(() => hasNavigationModel.value ? props.navigationModel.breadcrumbs : []);
    const navigationStatusLabel = computed(() => props.navigationModel?.statusLabel ?? null);
    const showNavigationBack = computed(() => props.navigationModel?.canGoBack === true);
    const showNavigationExit = computed(() => props.navigationModel?.canExit === true);
    const headerContext = computed(() => resolveViewerHeaderContext(app, {
        panelTitle: props.panelTitle,
        toolbarOverlayTitle: props.toolbarOverlayTitle,
        isSlyceProcessing: isSlyceProcessing.value,
        onClosePanel: () => emit('request-close-panel'),
        onCloseToolbarOverlay: () => emit('request-close-toolbar-overlay'),
        onCloseRealtimeMode: () => emit('request-close-realtime-mode'),
        onResetSlyceProcessing: () => slyce.resetProcessing(),
    }));
    const activeContext = computed(() => headerContext.value?.title ?? null);
    const passiveViewerTitleModel = computed(() => {
        if (hasNavigationModel.value || activeContext.value) {
            return null;
        }

        const structuredTitle = props.viewerTitleModel;
        if (structuredTitle && typeof structuredTitle === 'object') {
            const text = typeof structuredTitle.text === 'string' ? structuredTitle.text.trim() : '';
            if (text) {
                const kindLabel = typeof structuredTitle.kindLabel === 'string'
                    ? structuredTitle.kindLabel.trim()
                    : '';
                const drawingTitle = typeof structuredTitle.drawingTitle === 'string'
                    ? structuredTitle.drawingTitle.trim()
                    : '';
                const textureLabel = typeof structuredTitle.textureLabel === 'string'
                    ? structuredTitle.textureLabel.trim()
                    : (!kindLabel && !drawingTitle ? text : '');

                return {
                    text,
                    kindLabel: kindLabel || null,
                    drawingTitle: drawingTitle || null,
                    textureLabel: textureLabel || null,
                    kindInteractive: structuredTitle.kindInteractive === true && Boolean(kindLabel),
                    titleInteractive: structuredTitle.titleInteractive === true && Boolean(drawingTitle),
                    textureInteractive: structuredTitle.textureInteractive === true && Boolean(textureLabel),
                    structured: Boolean(kindLabel || drawingTitle || textureLabel),
                };
            }
        }

        const normalizedTitle = typeof props.viewerTitle === 'string' ? props.viewerTitle.trim() : '';
        if (!normalizedTitle) {
            return null;
        }

        return {
            text: normalizedTitle,
            kindLabel: null,
            drawingTitle: null,
            textureLabel: null,
            kindInteractive: false,
            titleInteractive: false,
            textureInteractive: false,
            structured: false,
        };
    });

    function closeContext() {
        headerContext.value?.close?.();
    }

</script>

<template>
    <header
        class="app-header"
        :class="{ hidden: app.isFullscreen }"
    >
        <div class="header-main">
            <a
                href="/"
                class="app-logo"
                aria-label="Rivvon"
            >
                <svg
                    class="app-logo-rivvon"
                    xmlns="http://www.w3.org/2000/svg"
                    version="1.1"
                    viewBox="0 0 856.4000244 188.1999969"
                    aria-hidden="true"
                    focusable="false"
                >

                    <polygon
                        class="rivvon-ribbon"
                        points="0 0 856.4000244 0 796.4000244 94.1000031 856.4000244 187 0 187 60 94.1000031 0 0"
                    />
                    <path
                        class="rivvon-letter"
                        d="M246.7655539,123.3843284c1.5286119-9.5106236-12.9730494-19.3794266-6.9734032-30.6858477,2.654719-5.0078539,6.8321448-9.5263126,7.6412615-15.3598728,1.8158249-9.7432625-5.4336793-20.801371-14.8787512-22.7457197-3.5272521-.7447297-6.769532-.6479942-10.4674589-.6421134-3.970665.0988996-8.3831731-.084346-12.0316213.3532334-9.737114.6562299-9.7861482,10.2530137-9.8257435,17.9559447.036837,9.8690482.3725102,19.96962.1760199,29.7208699-.037591,3.8577247-.1528146,7.7344484-.0110817,11.5697856.0931912,3.0415519.5645929,6.9211328,2.1620238,9.1522535,4.2689375,5.1003632,5.6041423-5.2227077,5.4253217-8.7155647-.3106783-7.8552707-.6444257-16.396326,8.5857324-18.6393488,6.8207399-1.562217,12.5660613,1.9758338,15.613004,8.4900586,3.0913125,5.8129146,5.0632675,13.6401857,9.3458607,18.4722259,2.1997462,2.3167544,4.3492891,3.0383984,5.2082754,1.1502756l.0305606-.0761801ZM231.7479042,85.4682956c-5.8154602,1.5475803-12.2922402.4919152-18.2470552-.0190672-4.6260031-.583471-6.1339528-3.3991796-6.2128173-8.4140725.0066087-3.3937189-.2900898-7.3079896,2.1578135-9.8405854,3.0426936-2.7167205,7.760152-2.0363369,11.620911-2.344256,5.2509321-.2196351,11.0193136-.7438059,15.2277529,2.1175035,7.4301673,5.2470193,4.0084299,16.2555852-4.3807658,18.4497226l-.1658391.050755Z"
                    />
                    <path
                        class="rivvon-letter"
                        d="M409.3876968,55.2327865c.3460355,3.4049887-1.2180238,7.7180199-2.5971395,11.0484841-4.0543355,9.66461-7.0646934,20.1089952-10.1740003,30.1845402-1.3385634,4.4180624-2.8301682,8.7196512-4.0414084,12.7534756-1.0785226,3.6263033-2.1586389,8.1319779-4.0040437,10.7796816-2.4968146,3.7612617-6.0312318,3.561007-9.0551298.3780673-3.5846137-3.7612004-5.4176498-9.1301453-7.3803794-13.9363006-2.4774716-6.3035971-4.8260534-12.3844737-7.2313293-18.8774279-2.010515-5.4306757-4.0262745-10.9697948-5.9829424-16.4864277-1.6341846-5.0361447-5.4589785-14.5144011-1.7293331-18.7041734,4.1738807-2.1595064,6.4469839,8.000534,7.2634768,10.9996743,1.166615,4.7981899,2.3915996,9.5943826,4.0025453,14.3178772,3.050733,8.9753569,6.663108,17.6827247,9.8760498,26.5001739,3.6126065,9.0483393,7.4604486,2.0136753,9.6331316-3.3975858,4.3730865-10.958063,8.1926496-23.0670725,11.2584483-34.546702,1.1082046-3.9686643,1.9998491-8.5872529,4.2455997-11.9743074,2.0162498-3.123175,5.4054038-3.5993176,5.902846.8330747l.0135946.1278735.0000136.0000023Z"
                    />
                    <path
                        class="rivvon-letter"
                        d="M557.2649434,57.2664929c11.5110789,11.3663086,15.0905163,30.0462743,10.644049,45.4615693-1.6320868,6.2532167-3.9211548,12.248555-8.3289633,16.685848-9.7005461,9.9841527-26.4135594,5.2529958-34.1820386-4.8702358-7.6608939-9.7799512-8.4109668-23.0249367-6.3337456-34.9761168,1.9085283-11.1237113,7.3504523-21.1826156,19.0060589-24.1969034,6.5069609-2.0627622,13.8567048-3.3873695,19.0848476,1.7954518,0,0,.109792.1003883.109792.100387ZM547.1636156,62.4083576c-3.9346404-.4891048-7.7766523.9191701-10.9761494,3.1709227-8.5108148,5.7514555-11.613052,16.7169253-10.691562,26.8632324,1.0623126,20.4215142,25.7425205,34.7410345,35.3911401,11.1777969,3.961312-9.5720036,3.8806979-20.7793769-.596582-30.1294161-2.5895112-5.3106809-6.9886563-10.1651776-12.8191295-11.0408497l-.3076901-.041682-.0000272-.0000043Z"
                    />
                    <path
                        class="rivvon-letter"
                        d="M648.488779,128.2096871c6.0241485-2.2958585,3.1606476-14.9272041,3.3326914-20.307353-.4242113-15.6814316.4722146-31.6244059.5508671-47.2720383.0065385-3.6538096-2.1269136-7.6472551-4.6552356-3.2872651-3.1315786,5.876853-1.7273579,15.4820207-1.8974674,22.5084605-.2114382,7.472303-.2666611,15.0533968-1.082936,22.4813096-.669813,5.0759767-2.6624698,10.3813178-6.2099776,6.6706681-3.1614922-4.5122982-4.2843947-10.6610627-7.0250538-15.5300521-3.3751371-6.1755211-7.2945755-13.4116964-10.1344288-20.1721801-2.363416-4.9732884-4.3450936-10.231069-7.1074932-14.8958126-2.0242322-3.3395336-5.8770871-5.3965572-7.3922985-.593798-1.4471567,4.2011227-1.3218631,9.6673463-1.3289737,14.2170245-.029968,6.2928392-1.0783046,12.6485568-1.3130906,18.8948332-.2900906,8.4229506-.6648819,17.6537714.0638864,26.2548514,1.090864,10.9353384,6.8851031,12.3922007,6.681947.1193545-.639409-9.5561308-.7175166-19.4508698-.6285661-29.19568-.0319841-4.5702421-1.0203846-7.3390133-.7429078-11.1628299.1711992-2.6696298,2.5654278-2.4457327,4.4850443-.8599176,2.2078818,1.8958975,3.7535517,4.569968,5.2407566,7.1341732,5.0655798,9.0018071,9.9314635,18.3541961,15.0774393,27.158851,3.2842249,4.7219962,7.6323698,18.3113588,13.9989168,17.8555517,0,0,.0868801-.0181443.0868801-.0181511Z"
                    />
                    <path
                        class="rivvon-letter"
                        d="M312.0975191,115.3556789c-6.8500064-1.5938094-10.9543136-.2821423-10.6978757-9.441646-.0609986-10.2155333-.0314733-25.9208235-.0159716-36.3687623.0463483-2.2117062.2504647-4.6878003,2.6424797-5.4107614,3.360875-1.1326838,10.2423342-.6878508,11.2357135-5.1204239.2877204-7.6223629-13.2789005-4.0310298-18.2286743-4.326653-3.2657401.1079079-6.8265496-.2198665-9.939262.6790724-2.8833819.7601326-4.6238509,2.9322622-2.1836758,4.7762554,2.8000844,2.0938007,7.0699786,3.0803843,8.3625548,6.7897042,2.1417751,6.6983954,1.2527867,14.0591406,1.7598937,21.0545601.1414492,4.3516627.2872777,8.7270377.3441217,12.8738722-.0282381,3.8360932.3553529,8.0758764-1.1666831,11.6182181-1.5855137,4.0528235-6.8471458,5.0155195-9.3122488,8.3053362-1.259332,3.0879615,3.9703977,3.2682056,6.1621036,3.3159434,3.0716221.022946,6.2385494-.0303426,9.3154567.1780238,4.0548395.2452952,8.4885295.7388553,11.6411266-.6548834,4.0677462-1.5686158,5.0293934-6.3540081.2237795-8.2164333,0,0-.1428454-.0514224-.1428386-.0514224Z"
                    />
                    <path
                        class="rivvon-letter"
                        d="M490.5999452,55.6824397c.5510306,9.096487-5.6145126,28.2405164-8.893316,38.8616398-9.0726339,33.8927721-19.4034351,44.2018601-34.1364599,5.1393965-3.9398167-10.6612398-8.3957376-23.9891159-9.9578898-34.3665532-.860328-5.3963623-.9742065-9.1439765-.3333264-10.3839341,2.5800849-3.5805054,9.807423,17.7074866,11.0952315,22.0624731,2.5703317,8.2090026,5.2614346,18.5041759,9.6849082,25.3432985,8.4168514,12.4745515,14.5083735-6.0503841,17.8722861-15.7039178,2.3724881-7.3643431,4.4834097-15.0006275,7.4598629-22.130045.9203186-2.2742968,6.3110244-15.2063292,7.2014566-8.9001635l.0072741.0778079-.0000272-.0000021Z"
                    />
                </svg>

            </a>

            <button
                v-if="hasNavigationModel && showNavigationBack"
                type="button"
                class="header-nav-button"
                aria-label="Go back"
                @click="emit('request-navigation-back')"
            >
                <span class="material-symbols-outlined">arrow_back</span>
            </button>

            <Transition name="fade">
                <div
                    v-if="hasNavigationModel"
                    class="navigation-summary"
                >
                    <template
                        v-for="(breadcrumb, index) in navigationBreadcrumbs"
                        :key="`${breadcrumb}-${index}`"
                    >
                        <span
                            v-if="index > 0"
                            class="breadcrumb-separator"
                            aria-hidden="true"
                        >/</span>
                        <span class="breadcrumb-segment">{{ breadcrumb }}</span>
                    </template>
                    <span
                        v-if="navigationStatusLabel"
                        class="navigation-status"
                    >{{ navigationStatusLabel }}</span>
                </div>
                <span
                    v-else-if="activeContext"
                    class="context-title"
                >{{ activeContext }}</span>
                <div
                    v-else-if="passiveViewerTitleModel"
                    class="context-title"
                    :class="{ 'context-title-rich': passiveViewerTitleModel.structured }"
                >
                    <template v-if="passiveViewerTitleModel.structured">
                        <template v-if="passiveViewerTitleModel.kindLabel">
                            <button
                                v-if="passiveViewerTitleModel.kindInteractive"
                                type="button"
                                class="context-title-segment-link"
                                @click="emit('request-viewer-title-kind-activate')"
                            >{{ passiveViewerTitleModel.kindLabel }}</button>
                            <span
                                v-else
                                class="context-title-segment-label"
                            >{{ passiveViewerTitleModel.kindLabel }}</span>
                        </template>

                        <template v-if="passiveViewerTitleModel.drawingTitle">
                            <span
                                v-if="passiveViewerTitleModel.kindLabel"
                                class="context-title-separator"
                                aria-hidden="true"
                            >/</span>
                            <button
                                v-if="passiveViewerTitleModel.titleInteractive"
                                type="button"
                                class="context-title-segment-link"
                                @click="emit('request-viewer-title-drawing-activate')"
                            >{{ passiveViewerTitleModel.drawingTitle }}</button>
                            <span
                                v-else
                                class="context-title-segment-label"
                            >{{ passiveViewerTitleModel.drawingTitle }}</span>
                        </template>

                        <template v-if="passiveViewerTitleModel.textureLabel">
                            <span
                                v-if="passiveViewerTitleModel.kindLabel || passiveViewerTitleModel.drawingTitle"
                                class="context-title-separator"
                                aria-hidden="true"
                            >/</span>
                            <button
                                v-if="passiveViewerTitleModel.textureInteractive"
                                type="button"
                                class="context-title-segment-link"
                                @click="emit('request-viewer-title-texture-activate')"
                            >{{ passiveViewerTitleModel.textureLabel }}</button>
                            <span
                                v-else
                                class="context-title-segment-label"
                            >{{ passiveViewerTitleModel.textureLabel }}</span>
                        </template>
                    </template>
                    <template v-else>{{ passiveViewerTitleModel.text }}</template>
                </div>
            </Transition>
        </div>

        <div class="header-actions">
            <button
                v-if="hasNavigationModel && showNavigationExit"
                type="button"
                class="header-action"
                aria-label="Close workflow"
                @click="emit('request-navigation-exit')"
            >
                <span class="material-symbols-outlined">close</span>
            </button>

            <button
                v-else-if="!hasNavigationModel && activeContext"
                class="header-action"
                @click="closeContext"
            >
                <span class="material-symbols-outlined">close</span>
            </button>

            <button
                v-else-if="!hasNavigationModel"
                class="header-action"
                @click="toggleFullscreen"
            >
                <span class="material-symbols-outlined">{{ app.isFullscreen ? 'fullscreen_exit' : 'fullscreen' }}</span>
            </button>
        </div>
    </header>

    <Transition name="fade">
        <div
            v-if="props.cameraActive"
            class="camera-indicator"
            :class="{ hidden: app.isFullscreen }"
            role="status"
            aria-live="polite"
        >
            <span
                class="camera-indicator-icon material-symbols-outlined"
                aria-hidden="true"
            >videocam</span>
            <span class="camera-indicator-label">Camera on</span>
            <button
                type="button"
                class="camera-indicator-dismiss"
                :aria-label="props.cameraDismissLabel"
                @click="emit('request-turn-off-camera')"
            >
                <span class="material-symbols-outlined">close</span>
            </button>
        </div>
    </Transition>
</template>

<style scoped>
    .app-header {
        --app-header-side-padding: 3rem;
        --app-header-top-padding: 2rem;
        --app-logo-height: 1.5rem;
        --app-header-height: calc((var(--app-header-top-padding) * 2) + var(--app-logo-height));
        --app-logo-aspect-ratio: 4.5505;
        --app-logo-image-width: calc(var(--app-header-height) * var(--app-logo-aspect-ratio));
        --app-logo-width: calc(var(--app-logo-image-width) + (var(--app-header-side-padding) * 2));
        --app-logo-mobile-scale: 0.5;
        --app-logo-condensed-width: calc((var(--app-header-height) * var(--app-logo-mobile-scale)) + (var(--app-header-side-padding) * 2));
    }

    .app-header {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        z-index: 10;
        display: flex;
        justify-content: space-between;
        align-items: center;
        min-height: var(--app-header-height);
        pointer-events: none;
        transition: opacity 0.3s ease, transform 0.3s ease;
        background: #000000;
        background: linear-gradient(90deg, rgba(0, 0, 0, 0.15) 0%, rgba(0, 0, 0, 0.37) 35%, rgba(0, 0, 0, 0.68) 100%);
    }

    .header-main {
        display: flex;
        align-items: center;
        min-width: 0;
        flex: 1;
    }

    .header-actions {
        display: flex;
        align-items: center;
        margin-left: auto;
        min-height: 100%;
    }

    .app-header.hidden,
    .camera-indicator.hidden {
        opacity: 0;
        transform: translateY(-100%);
        pointer-events: none;
    }

    .app-header>* {
        pointer-events: auto;
    }

    .app-logo {
        position: relative;
        margin-left: -2rem;
        display: inline-flex;
        align-items: center;
        width: var(--app-logo-width);
        height: var(--app-header-height);
        text-decoration: none;
        line-height: 0;
        flex-shrink: 0;
        overflow: visible;
        transition: background-color 0.28s ease;
    }

    .app-logo-rivvon {
        display: block;
        height: 100%;
        width: auto;
        max-width: none;
        transform-origin: top left;
        transition: transform 0.38s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .rivvon-ribbon {
        fill: #000;
        opacity: 0.5;
    }

    .rivvon-letter {
        fill: #fff;
    }


    .header-nav-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2.5rem;
        height: 2.5rem;
        margin-left: 0.5rem;
        border: none;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.82);
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;
        flex-shrink: 0;
    }

    .header-nav-button:hover {
        background: rgba(255, 255, 255, 0.16);
        color: #fff;
    }

    .header-nav-button .material-symbols-outlined {
        font-size: 1.2rem;
    }

    .navigation-summary {
        display: flex;
        align-items: center;
        gap: 0.45rem;
        min-width: 0;
        margin-left: 0.9rem;
        color: rgba(255, 255, 255, 0.78);
        white-space: nowrap;
        overflow: hidden;
    }

    .breadcrumb-segment {
        font-size: 0.85rem;
        font-weight: 500;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .breadcrumb-separator {
        font-size: 0.82rem;
        color: rgba(255, 255, 255, 0.42);
        flex-shrink: 0;
    }

    .navigation-status {
        color: rgba(255, 255, 255, 0.56);
    }

    .camera-indicator {
        --camera-indicator-left-offset: 2rem;
        --camera-indicator-top-offset: 6.6rem;
        position: absolute;
        top: var(--camera-indicator-top-offset);
        left: var(--camera-indicator-left-offset);
        z-index: 11;
        display: inline-flex;
        align-items: center;
        gap: 0.55rem;
        padding: 0.45rem 0.5rem 0.45rem 0.7rem;
        border-radius: 999px;
        background: #a82020;
        color: #fff;
        pointer-events: auto;
        transition: opacity 0.3s ease, transform 0.3s ease;
    }

    .camera-indicator-icon {
        font-size: 1rem;
        color: #fff;
        flex-shrink: 0;
    }

    .camera-indicator-label {
        font-size: 0.74rem;
        font-weight: 600;
        letter-spacing: 0.05em;
        line-height: 1;
        font-variant-caps: normal;
        white-space: nowrap;
    }

    .camera-indicator-dismiss {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.6rem;
        height: 1.6rem;
        padding: 0;
        border: none;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.82);
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;
        flex-shrink: 0;
    }

    .camera-indicator-dismiss:hover {
        background: rgba(255, 255, 255, 0.18);
        color: #fff;
    }

    .camera-indicator-dismiss .material-symbols-outlined {
        font-size: 1rem;
    }

    .context-title {
        margin-left: auto;
        display: block;
        min-width: 0;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 0.85rem;
        font-weight: 500;
        letter-spacing: 0.04em;
        color: rgba(255, 255, 255, 0.7);
        text-transform: uppercase;
        pointer-events: none;
        white-space: nowrap;
    }

    .context-title-rich {
        pointer-events: auto;
    }

    .context-title-segment-link,
    .context-title-segment-label {
        font: inherit;
        letter-spacing: inherit;
        text-transform: inherit;
    }

    .context-title-segment-link {
        padding: 0;
        border: none;
        background: transparent;
        color: rgba(255, 255, 255, 0.86);
        text-decoration: none;
        text-decoration-thickness: 0.08em;
        text-underline-offset: 0.18em;
        cursor: pointer;
        transition: color 0.15s ease;
    }

    .context-title-segment-link:hover {
        color: #fff;
        text-decoration: underline;
    }

    .context-title-segment-link:focus-visible {
        color: #fff;
    }

    .context-title-separator {
        color: rgba(255, 255, 255, 0.42);
    }

    .header-action {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2rem 2.5rem;
        background: transparent;
        border: none;
        color: rgba(255, 255, 255, 0.7);
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;
        flex-shrink: 0;
    }

    .header-action:hover {
        background: rgba(0, 0, 0, 0.25);
        color: #fff;
    }

    .header-action .material-symbols-outlined {
        font-size: 1.5rem;
    }

    /* Transition */
    .fade-enter-active,
    .fade-leave-active {
        transition: opacity 0.2s ease;
    }

    .fade-enter-from,
    .fade-leave-to {
        opacity: 0;
    }

    /* Mobile adjustments */
    @media (max-width: 768px) {
        .app-header {
            --app-header-side-padding: 1.2rem;
        }

        .app-logo {
            width: var(--app-logo-condensed-width);
            padding: 0 var(--app-header-side-padding);
            margin-left: 0px;
        }

        .app-logo-rivvon {
            position: absolute;
            top: 11rem;
            left: 1rem;
            transform: rotate(-90deg) scale(var(--app-logo-mobile-scale));
        }

        .navigation-summary {
            margin-left: 0.65rem;
            gap: 0.35rem;
        }

        .breadcrumb-segment {
            font-size: 0.75rem;
        }

        .camera-indicator {
            --camera-indicator-left-offset: 2rem;
            --camera-indicator-top-offset: 6.45rem;
        }

        .header-action {
            padding: 2rem 1.5rem;
        }
    }
</style>
