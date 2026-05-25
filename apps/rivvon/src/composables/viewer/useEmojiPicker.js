// src/composables/viewer/useEmojiPicker.js
// Vue composable that bridges the OpenMoji SVG fetching module with Vue
// reactivity.  Lazily loads the emoji catalog, provides search/filter,
// and handles SVG fetch → point conversion on selection.

import { ref, shallowRef } from 'vue';
import { runAsyncWithState } from '../../modules/shared/asyncState.js';
import {
    loadOpenMojiCatalog,
    fetchOpenMojiSvg,
    parseOpenMojiSvgToPoints,
    loadGroupSprite,
    isGroupSpriteLoaded,
    extractSvgFromSprite,
} from '../../modules/viewer/emojiToSvg';
import { normalizePointsMultiPath } from '../../modules/viewer/svgPathToPoints';
import { splitAllPathsAtCusps3D } from '../../modules/viewer/cuspSplitter.js';

export function useEmojiPicker() {
    /** @type {import('vue').Ref<Array|null>} */
    const emojiGroups = shallowRef(null);
    const isDataLoaded = ref(false);
    const isLoading = ref(false);
    const isSpriteLoading = ref(false);
    const error = ref(null);

    /** Track which group sprites have been loaded (slug → true) */
    const loadedSprites = ref(new Set());

    function normalizeEmojiHexcode(value) {
        if (typeof value !== 'string') {
            return '';
        }

        return value
            .trim()
            .replace(/^u\+/i, '')
            .replace(/_/g, '-')
            .replace(/\s+/g, '')
            .toUpperCase();
    }

    function findEmojiEntryByHexcode(hexcode) {
        const normalizedHexcode = normalizeEmojiHexcode(hexcode);
        if (!normalizedHexcode || !Array.isArray(emojiGroups.value)) {
            return null;
        }

        for (const group of emojiGroups.value) {
            const match = Array.isArray(group?.emojis)
                ? group.emojis.find((entry) => normalizeEmojiHexcode(entry?.h) === normalizedHexcode)
                : null;

            if (match) {
                return match;
            }
        }

        return null;
    }

    /**
     * Lazily load the OpenMoji catalog on first panel open.
     * Fetches the compact `/openmoji-index.json` from static assets.
     */
    async function loadEmojiData() {
        if (isDataLoaded.value) return;

        return runAsyncWithState(async () => {
            emojiGroups.value = await loadOpenMojiCatalog();
            isDataLoaded.value = true;
        }, {
            errorRef: error,
            resetError: false,
            onError: (cause) => {
                console.error('[useEmojiPicker] Failed to load emoji catalog:', cause);
                error.value = 'Failed to load emoji data.';
            },
        });
    }

    /**
     * Ensure a group's SVG spritemap is loaded and injected into the given
     * container element. Called on tab activation.
     *
     * @param {string} slug - Group slug (e.g. "smileys-emotion")
     * @param {HTMLElement} container - Hidden DOM element to hold injected sprite SVGs
     */
    async function ensureGroupLoaded(slug, container) {
        if (loadedSprites.value.has(slug)) return;

        return runAsyncWithState(async () => {
            const doc = await loadGroupSprite(slug);
            // Inject the root <svg> element (with all <symbol> defs) into the
            // container so <use href="#hex"> can resolve within the same document.
            const svgEl = doc.documentElement;
            // Check if already injected (e.g. by a concurrent call)
            if (!container.querySelector(`[data-sprite="${slug}"]`)) {
                const imported = document.importNode(svgEl, true);
                imported.setAttribute('data-sprite', slug);
                container.appendChild(imported);
            }
            // Reactive tracking
            loadedSprites.value = new Set([...loadedSprites.value, slug]);
        }, {
            loading: isSpriteLoading,
            errorRef: error,
            resetError: false,
            onError: (cause) => {
                console.error(`[useEmojiPicker] Failed to load sprite for ${slug}:`, cause);
                error.value = 'Failed to load emoji group.';
            },
        });
    }

    /**
     * Fetch the OpenMoji Black SVG for an emoji and convert to ribbon-ready
     * point arrays.
     * Prefers extracting from an already-loaded sprite over a CDN fetch.
     *
     * @param {string} hexcode - The OpenMoji hexcode (e.g. "1F600")
     * @returns {Promise<Array<Array<import('three').Vector3>>|null>}
     */
    async function selectEmoji(hexcode) {
        return runAsyncWithState(async () => {
            const normalizedHexcode = normalizeEmojiHexcode(hexcode);
            if (!normalizedHexcode) {
                error.value = 'This emoji isn\'t available as a shape.';
                return null;
            }

            if (isDataLoaded.value && !findEmojiEntryByHexcode(normalizedHexcode)) {
                error.value = 'This emoji isn\'t available as a shape.';
                return null;
            }

            // Try local sprite extraction first, fall back to CDN
            let svgString = extractSvgFromSprite(normalizedHexcode);
            if (!svgString) {
                svgString = await fetchOpenMojiSvg(normalizedHexcode);
            }

            if (!svgString) {
                error.value = 'This emoji isn\'t available as a shape.';
                return null;
            }

            const pathsPoints = parseOpenMojiSvgToPoints(svgString);
            if (pathsPoints.length === 0) {
                error.value = 'Could not extract paths from this emoji.';
                return null;
            }

            // Split at cusps before normalizing — preserves sharp corners
            const splitPaths = splitAllPathsAtCusps3D(pathsPoints);

            return normalizePointsMultiPath(splitPaths);
        }, {
            loading: isLoading,
            errorRef: error,
            fallbackValue: null,
            onError: (cause) => {
                console.error('[useEmojiPicker] Failed to process emoji:', cause);
                error.value = 'Failed to process emoji.';
            },
        });
    }

    return {
        emojiGroups,
        isDataLoaded,
        isLoading,
        isSpriteLoading,
        error,
        loadEmojiData,
        ensureGroupLoaded,
        normalizeEmojiHexcode,
        findEmojiEntryByHexcode,
        selectEmoji,
    };
}
