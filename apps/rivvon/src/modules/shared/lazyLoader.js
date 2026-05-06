export function createLazyLoader(load) {
    let instance = null;
    let pendingPromise = null;

    return async function ensure() {
        if (instance) {
            return instance;
        }

        if (!pendingPromise) {
            pendingPromise = Promise.resolve(load())
                .then((loadedInstance) => {
                    instance = loadedInstance;
                    return loadedInstance;
                })
                .finally(() => {
                    pendingPromise = null;
                });
        }

        return pendingPromise;
    };
}

export function createPendingTaskRunner(run) {
    let pendingPromise = null;

    function execute(...args) {
        if (!pendingPromise) {
            pendingPromise = Promise.resolve(run(...args)).finally(() => {
                pendingPromise = null;
            });
        }

        return pendingPromise;
    }

    execute.peek = () => pendingPromise;
    execute.reset = () => {
        pendingPromise = null;
    };

    return execute;
}