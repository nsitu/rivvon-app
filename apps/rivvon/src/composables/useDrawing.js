// src/composables/useDrawing.js
// Drawing mode composable for rivvon

import { ref, shallowRef, onUnmounted } from 'vue';
import { useAppStore } from '../stores/appStore';
import { DrawingManager } from '../modules/drawing';

export function useDrawing() {
    const app = useAppStore();
    
    const drawingManager = shallowRef(null);
    const canvasRef = ref(null);
    
    // Auto-finalize countdown state
    const autoFinalizeCountdown = ref(null);

    /**
     * Initialize drawing manager
     */
    function initDrawing(canvas, onComplete, onStrokeChange) {
        canvasRef.value = canvas;
        
        drawingManager.value = new DrawingManager(
            canvas,
            (normalizedStrokes) => {
                // Callback when drawing is finalized
                if (onComplete) {
                    onComplete(normalizedStrokes);
                }
            },
            (strokeCount) => {
                // Callback when stroke count changes
                app.setStrokeCount(strokeCount);
                if (onStrokeChange) {
                    onStrokeChange(strokeCount);
                }
            }
        );

        // Set up auto-finalize countdown callback
        drawingManager.value.onAutoFinalizeCountdown = (seconds, inFinal) => {
            autoFinalizeCountdown.value = seconds;
            app.setCountdownSeconds(seconds);
        };

        // Set up auto-finalize progress callback
        drawingManager.value.onAutoFinalizeProgress = (progress, inFinal) => {
            app.setCountdownProgress(progress, inFinal);
        };

        return drawingManager.value;
    }

    /**
     * Enable or disable drawing mode
     */
    function setDrawingMode(enabled) {
        app.setDrawingMode(enabled);
        
        // Set the drawing manager active state - this handles pointer events and clears strokes
        if (drawingManager.value) {
            drawingManager.value.setActive(enabled);
        }
        
        // Update canvas class for styling
        if (canvasRef.value) {
            canvasRef.value.classList.toggle('active', enabled);
        }
    }

    /**
     * Toggle drawing mode
     */
    function toggleDrawingMode() {
        setDrawingMode(!app.isDrawingMode);
    }

    /**
     * Finalize drawing and get normalized strokes
     */
    function finalizeDrawing() {
        if (drawingManager.value) {
            return drawingManager.value.finalizeDrawing();
        }
        return [];
    }

    /**
     * Clear current drawing
     */
    function clearDrawing() {
        if (drawingManager.value) {
            drawingManager.value.clearStrokes();
        }
        app.setStrokeCount(0);
        autoFinalizeCountdown.value = null;
    }

    /**
     * Get current strokes
     */
    function getStrokes() {
        if (drawingManager.value) {
            return drawingManager.value.getStrokes();
        }
        return [];
    }

    /**
     * Clean up on unmount
     */
    onUnmounted(() => {
        if (drawingManager.value) {
            drawingManager.value.destroy?.();
        }
    });

    return {
        // State
        drawingManager,
        autoFinalizeCountdown,
        
        // Methods
        initDrawing,
        setDrawingMode,
        toggleDrawingMode,
        finalizeDrawing,
        clearDrawing,
        getStrokes
    };
}
