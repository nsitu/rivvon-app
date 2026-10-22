import { isLikelyIOSOrSafari } from '../modules/slyce/encodingPolicy.js';

export function getMaxConcurrentTextureDownloads() {
    if (isLikelyIOSOrSafari()) return 2;
    const memory = Number(typeof navigator !== 'undefined' ? navigator.deviceMemory : null);
    if (Number.isFinite(memory) && memory > 0 && memory <= 4) return 3;
    return 6;
}

export async function mapWithConcurrency(items, concurrency, mapper) {
    const results = new Array(items.length);
    let nextIndex = 0;
    let failed = false;
    const workerCount = Math.max(1, Math.min(concurrency, items.length));

    await Promise.all(Array.from({ length: workerCount }, async () => {
        while (!failed && nextIndex < items.length) {
            const currentIndex = nextIndex++;
            try {
                results[currentIndex] = await mapper(items[currentIndex], currentIndex);
            } catch (error) {
                failed = true;
                throw error;
            }
        }
    }));
    return results;
}
