import { useAppStore } from '../stores/appStore';
const resourceUsageReport = async () => {

    const app = useAppStore();

    // Update decoding progress with FPS
    const effectiveFrameCount = app.framesToSample > 0 ? Math.min(app.framesToSample, app.frameCount) : app.frameCount;
    const streamStatus = app.readerIsFinished 
        ? 'Complete' 
        : `Frame ${app.frameNumber} of ${effectiveFrameCount}<br/>${app.fps} FPS`;
    app.setStatus('Decoding', streamStatus);

    // Update system metrics
    let systemInfo = `CPU Cores: ${navigator.hardwareConcurrency}`;
    
    // Add memory usage if available (Chrome only)
    if (performance.memory) {
        const { usedJSHeapSize, jsHeapSizeLimit } = performance.memory;
        systemInfo += `<br/>Memory: ${(usedJSHeapSize / 1024 / 1024).toFixed(0)} / ${(jsHeapSizeLimit / 1024 / 1024).toFixed(0)} MB`;
    }
    
    app.setStatus('System', systemInfo);
}

export { resourceUsageReport }