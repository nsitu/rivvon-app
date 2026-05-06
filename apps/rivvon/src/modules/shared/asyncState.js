export async function runAsyncWithState(task, options = {}) {
    const {
        loading = null,
        errorRef = null,
        resetError = true,
        onError = null,
        fallbackValue,
    } = options;

    if (loading) {
        loading.value = true;
    }

    if (errorRef && resetError) {
        errorRef.value = null;
    }

    try {
        return await task();
    } catch (error) {
        if (onError) {
            onError(error);
        }

        return fallbackValue;
    } finally {
        if (loading) {
            loading.value = false;
        }
    }
}