import { ref, shallowRef, onUnmounted } from 'vue';
import { useViewerStore } from '../../stores/viewerStore';
import { WalkingManager } from '../../modules/viewer/walking';

export function useWalking() {
    const app = useViewerStore();

    const walkingManager = shallowRef(null);
    const mapElementRef = ref(null);
    const status = ref('idle');
    const errorMessage = ref(null);
    const pointCount = ref(0);
    const distanceMeters = ref(0);
    const accuracyMeters = ref(null);
    const isTracking = ref(false);

    function syncState(nextState) {
        status.value = nextState.status;
        errorMessage.value = nextState.errorMessage;
        pointCount.value = nextState.pointCount;
        distanceMeters.value = nextState.distanceMeters;
        accuracyMeters.value = nextState.accuracyMeters;
        isTracking.value = nextState.isTracking;
    }

    function initWalking(mapElement) {
        mapElementRef.value = mapElement;

        if (walkingManager.value) {
            return walkingManager.value;
        }

        walkingManager.value = new WalkingManager(
            mapElement,
            (nextPointCount) => {
                app.setWalkPointCount(nextPointCount);
            },
            syncState
        );

        return walkingManager.value;
    }

    function setWalkingMode(enabled) {
        app.setWalkMode(enabled);

        if (walkingManager.value) {
            walkingManager.value.setActive(enabled);
        }
    }

    function finalizeWalk() {
        if (!walkingManager.value) {
            return null;
        }

        return walkingManager.value.finalizeWalk();
    }

    function clearWalk() {
        walkingManager.value?.clearWalk();
        app.setWalkPointCount(0);
    }

    onUnmounted(() => {
        walkingManager.value?.destroy();
    });

    return {
        walkingManager,
        mapElementRef,
        status,
        errorMessage,
        pointCount,
        distanceMeters,
        accuracyMeters,
        isTracking,
        initWalking,
        setWalkingMode,
        finalizeWalk,
        clearWalk
    };
}