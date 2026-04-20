import { computed, onMounted, onUnmounted, watch } from 'vue';
import { useSlyceStore } from '../../stores/slyceStore';
import { useViewerStore } from '../../stores/viewerStore';

function describeWakeLockError(error) {
    if (!error) {
        return 'Failed to keep the screen awake.';
    }

    if (error.name === 'NotAllowedError') {
        return 'Wake lock is only available while this tab stays visible and allowed to remain awake.';
    }

    if (error.name === 'AbortError') {
        return 'Wake lock was interrupted. Rivvon will try again when the page becomes active.';
    }

    return error.message || 'Failed to keep the screen awake.';
}

export function useScreenWakeLock() {
    const viewer = useViewerStore();
    const slyce = useSlyceStore();

    let sentinel = null;
    let releaseHandler = null;
    let syncToken = 0;

    const isSupported = typeof window !== 'undefined'
        && typeof navigator !== 'undefined'
        && !!navigator.wakeLock
        && typeof navigator.wakeLock.request === 'function';

    const isSlyceProcessing = computed(() => Object.keys(slyce.status ?? {}).length > 0);

    const shouldHoldWakeLock = computed(() => (
        viewer.screenWakeLockEnabled
        && (
            viewer.isDrawingMode
            || viewer.isWalkMode
            || viewer.isSuspended
            || viewer.realtimeSamplerVisible
            || isSlyceProcessing.value
        )
    ));

    function removeReleaseHandler(target = sentinel) {
        if (target && releaseHandler) {
            target.removeEventListener('release', releaseHandler);
        }

        releaseHandler = null;
    }

    async function releaseWakeLock({ clearError = true } = {}) {
        syncToken += 1;

        const activeSentinel = sentinel;
        if (!activeSentinel) {
            viewer.setScreenWakeLockRuntimeState({
                active: false,
                ...(clearError ? { errorMessage: '' } : {}),
            });
            return;
        }

        sentinel = null;
        removeReleaseHandler(activeSentinel);

        try {
            await activeSentinel.release();
        } catch (error) {
            console.warn('[WakeLock] Failed to release screen wake lock:', error);
        } finally {
            viewer.setScreenWakeLockRuntimeState({
                active: false,
                ...(clearError ? { errorMessage: '' } : {}),
            });
        }
    }

    async function requestWakeLock() {
        const requestId = ++syncToken;

        try {
            const nextSentinel = await navigator.wakeLock.request('screen');

            if (requestId !== syncToken) {
                await nextSentinel.release().catch(() => {});
                return;
            }

            releaseHandler = () => {
                if (sentinel !== nextSentinel) {
                    return;
                }

                sentinel = null;
                releaseHandler = null;
                viewer.setScreenWakeLockRuntimeState({ active: false });

                if (document.visibilityState === 'visible' && shouldHoldWakeLock.value) {
                    void syncWakeLock();
                }
            };

            nextSentinel.addEventListener('release', releaseHandler);
            sentinel = nextSentinel;
            viewer.setScreenWakeLockRuntimeState({
                active: true,
                errorMessage: '',
            });
        } catch (error) {
            if (requestId !== syncToken) {
                return;
            }

            viewer.setScreenWakeLockRuntimeState({
                active: false,
                errorMessage: document.visibilityState === 'visible' && shouldHoldWakeLock.value
                    ? describeWakeLockError(error)
                    : '',
            });
        }
    }

    async function syncWakeLock() {
        viewer.setScreenWakeLockSupported(isSupported);

        if (!isSupported) {
            viewer.setScreenWakeLockRuntimeState({
                active: false,
                errorMessage: '',
            });
            return;
        }

        if (document.visibilityState !== 'visible' || !shouldHoldWakeLock.value) {
            await releaseWakeLock();
            return;
        }

        if (sentinel && !sentinel.released) {
            viewer.setScreenWakeLockRuntimeState({
                active: true,
                errorMessage: '',
            });
            return;
        }

        await requestWakeLock();
    }

    function handleVisibilityChange() {
        if (document.visibilityState !== 'visible') {
            void releaseWakeLock();
            return;
        }

        void syncWakeLock();
    }

    function handlePageShow() {
        void syncWakeLock();
    }

    watch(shouldHoldWakeLock, () => {
        void syncWakeLock();
    });

    onMounted(() => {
        viewer.setScreenWakeLockSupported(isSupported);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('pageshow', handlePageShow);
        void syncWakeLock();
    });

    onUnmounted(() => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('pageshow', handlePageShow);
        void releaseWakeLock({ clearError: false });
        viewer.setScreenWakeLockRuntimeState({ active: false });
    });
}