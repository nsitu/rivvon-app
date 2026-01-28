// src/composables/useTextToSvg.js
// Text to SVG composable for rivvon

import { ref, shallowRef } from 'vue';
import { TextToSvg } from '../modules/textToSvg';
import { parseSvgContentDynamicResolution, normalizePointsMultiPath } from '../modules/svgPathToPoints';

export function useTextToSvg() {
    const textToSvg = shallowRef(null);
    const fonts = ref([]);
    const selectedFont = ref(null);
    const isLoading = ref(false);
    const error = ref(null);

    /**
     * Initialize TextToSvg converter
     */
    async function init() {
        isLoading.value = true;
        error.value = null;

        try {
            textToSvg.value = new TextToSvg();
            
            // Load available fonts
            fonts.value = await textToSvg.value.loadAvailableFonts();
            
            // Load the first font by default
            if (fonts.value.length > 0) {
                selectedFont.value = fonts.value[0];
                await textToSvg.value.loadFont(selectedFont.value);
            }
            
            console.log('[TextToSvg] Initialized with', fonts.value.length, 'fonts');
        } catch (e) {
            console.error('[TextToSvg] Initialization failed:', e);
            error.value = e.message;
        } finally {
            isLoading.value = false;
        }
    }

    /**
     * Convert text to SVG path points
     * Uses dynamic resolution based on path length for optimal smoothness
     * @param {string} text - Text to convert
     * @param {Object} options - Options (font, resolution settings, etc.)
     * @returns {Array} Normalized points for ribbon creation
     */
    async function textToPoints(text, options = {}) {
        if (!textToSvg.value) {
            throw new Error('TextToSvg not initialized');
        }

        const font = options.font || selectedFont.value;

        try {
            // Ensure the requested font is loaded
            if (font !== textToSvg.value.currentFont) {
                await textToSvg.value.loadFont(font);
            }
            
            // Generate SVG string from text
            const svgContent = textToSvg.value.generateSvgString(text, options);
            
            if (!svgContent) {
                throw new Error('Failed to generate SVG from text');
            }

            // Parse SVG with dynamic resolution based on path lengths
            // Uses defaults from svgPathToPoints unless overridden in options
            const paths = parseSvgContentDynamicResolution(svgContent, {
                pointsPerUnit: options.pointsPerUnit,
                minPoints: options.minPoints,
                maxPoints: options.maxPoints
            });
            
            if (paths.length === 0) {
                throw new Error('No paths found in generated SVG');
            }

            // Normalize points for ribbon creation
            const normalizedPaths = normalizePointsMultiPath(paths);
            
            return normalizedPaths;
        } catch (e) {
            console.error('[TextToSvg] Conversion failed:', e);
            throw e;
        }
    }

    /**
     * Select and load a font
     */
    async function setFont(fontName) {
        if (!fonts.value.includes(fontName)) {
            console.warn('[TextToSvg] Font not available:', fontName);
            return;
        }
        
        try {
            await textToSvg.value.loadFont(fontName);
            selectedFont.value = fontName;
        } catch (e) {
            console.error('[TextToSvg] Failed to load font:', e);
            error.value = e.message;
        }
    }

    return {
        // State
        fonts,
        selectedFont,
        isLoading,
        error,
        
        // Methods
        init,
        textToPoints,
        setFont
    };
}
