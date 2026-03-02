// src/composables/viewer/useEmojiPicker.js
// Vue composable that bridges the OpenMoji SVG fetching module with Vue
// reactivity.  Lazily loads the emoji catalog, provides search/filter,
// and handles SVG fetch → point conversion on selection.

import { ref, shallowRef } from 'vue';
import {
    loadOpenMojiCatalog,
    fetchOpenMojiSvg,
    parseOpenMojiSvgToPoints,
    loadGroupSprite,
    isGroupSpriteLoaded,
    extractSvgFromSprite,
} from '../../modules/viewer/emojiToSvg';
import { normalizePointsMultiPath } from '../../modules/viewer/svgPathToPoints';

export function useEmojiPicker() {
    /** @type {import('vue').Ref<Array|null>} */
    const emojiGroups = shallowRef(null);
    const isDataLoaded = ref(false);
    const isLoading = ref(false);
    const isSpriteLoading = ref(false);
    const error = ref(null);

    /** Track which group sprites have been loaded (slug → true) */
    const loadedSprites = ref(new Set());

    /**
     * Lazily load the OpenMoji catalog on first panel open.
     * Fetches the compact `/openmoji-index.json` from static assets.
     */
    async function loadEmojiData() {
        if (isDataLoaded.value) return;

        try {
            emojiGroups.value = await loadOpenMojiCatalog();
            isDataLoaded.value = true;
        } catch (err) {
            console.error('[useEmojiPicker] Failed to load emoji catalog:', err);
            error.value = 'Failed to load emoji data.';
        }
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

        isSpriteLoading.value = true;
        try {
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
        } catch (err) {
            console.error(`[useEmojiPicker] Failed to load sprite for ${slug}:`, err);
            error.value = `Failed to load emoji group.`;
        } finally {
            isSpriteLoading.value = false;
        }
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
        isLoading.value = true;
        error.value = null;

        try {
            // Try local sprite extraction first, fall back to CDN
            let svgString = extractSvgFromSprite(hexcode);
            if (!svgString) {
                svgString = await fetchOpenMojiSvg(hexcode);
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

            return normalizePointsMultiPath(pathsPoints);
        } catch (err) {
            console.error('[useEmojiPicker] Failed to process emoji:', err);
            error.value = 'Failed to process emoji.';
            return null;
        } finally {
            isLoading.value = false;
        }
    }

    return {
        emojiGroups,
        isDataLoaded,
        isLoading,
        isSpriteLoading,
        error,
        loadEmojiData,
        ensureGroupLoaded,
        selectEmoji,
    };
}
