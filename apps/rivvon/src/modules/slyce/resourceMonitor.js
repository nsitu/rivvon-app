import { useSlyceStore } from '../../stores/slyceStore';

function formatMiB(bytes) {
    const mib = bytes / (1024 * 1024);
    return mib >= 100 ? `${mib.toFixed(0)} MB` : `${mib.toFixed(1)} MB`;
}

function buildProcessingResourceStatus(telemetry) {
    if (!telemetry) {
        return '';
    }

    let status = '';

    if (telemetry.builderType === 'webgl2' && telemetry.atlasWidth && telemetry.atlasHeight) {
        // Collapse atlas/source texture math into one user-facing VRAM estimate.
        // Browsers do not expose actual VRAM, so we estimate RGBA8 texture backing
        // from the live atlas count maintained by videoProcessor.
        const estimatedVramBytes = telemetry.estimatedLiveGpuBytes || telemetry.estimatedTotalGpuBytes || 0;
        if (estimatedVramBytes > 0) {
            status += `<br/>VRAM (estimated) - ${formatMiB(estimatedVramBytes)}`;
        }
    }

    if (telemetry.layerFingerprintSummary) {
        status += `<br/>Layer fingerprints - ${telemetry.layerFingerprintSummary}`;
    }

    return status;
}

const resourceUsageReport = async () => {

    const app = useSlyceStore();
    app.removeStatus('Decoding');

    // Update system metrics
    let systemInfo = `CPU (cores) - ${navigator.hardwareConcurrency}`;
    
    // Add memory usage if available (Chrome only)
    if (performance.memory) {
        const { usedJSHeapSize, jsHeapSizeLimit } = performance.memory;
        systemInfo += `<br/>RAM (memory) - ${(usedJSHeapSize / 1024 / 1024).toFixed(0)} / ${(jsHeapSizeLimit / 1024 / 1024).toFixed(0)} MB`;
    }

    systemInfo += buildProcessingResourceStatus(app.processingResourceTelemetry);
    
    app.setStatus('System', systemInfo);
}

export { resourceUsageReport }