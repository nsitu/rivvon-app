import { consumeSamplingSource } from './samplingRuntime.js';

function resolveSamplingSource(source) {
    if (source && typeof source.frames === 'function') {
        return source.frames();
    }
    return source;
}

export async function runSamplingPipeline({
    source,
    signal = null,
    getBuilderKey,
    createBuilder,
    processItem,
    onBuilderCreated = null,
    onItemProcessed = null,
    onTileComplete = null,
    retainBuilderOnComplete = false,
    onError = null
}) {
    if (typeof getBuilderKey !== 'function' || typeof createBuilder !== 'function' || typeof processItem !== 'function') {
        throw new Error('runSamplingPipeline requires getBuilderKey, createBuilder, and processItem callbacks.');
    }

    const builders = new Map();

    function shouldRetainBuilder(context) {
        if (typeof retainBuilderOnComplete === 'function') {
            return retainBuilderOnComplete(context);
        }
        return retainBuilderOnComplete === true;
    }

    function registerBuilder(builderKey, builder) {
        builder.on('complete', payload => {
            const context = { builderKey, builder, payload };
            const retain = shouldRetainBuilder(context);

            if (!retain) {
                builders.delete(builderKey);
            }

            void Promise.resolve().then(async () => {
                try {
                    if (typeof onTileComplete === 'function') {
                        await onTileComplete(context);
                    }
                } finally {
                    if (!retain) {
                        builder.dispose?.();
                    }
                }
            });
        });
    }

    try {
        await consumeSamplingSource({
            source: resolveSamplingSource(source),
            signal,
            onItem: async item => {
                const builderKey = getBuilderKey(item);
                let builder = builders.get(builderKey);

                if (!builder) {
                    builder = createBuilder(item, builderKey);
                    builders.set(builderKey, builder);
                    registerBuilder(builderKey, builder);

                    if (typeof onBuilderCreated === 'function') {
                        await onBuilderCreated({ builderKey, builder, item });
                    }
                }

                const control = await processItem({ builderKey, builder, item });

                if (typeof onItemProcessed === 'function') {
                    const processedControl = await onItemProcessed({ builderKey, builder, item });
                    if (processedControl === false) {
                        return false;
                    }
                }

                return control;
            },
            onError
        });
    } finally {
        for (const builder of builders.values()) {
            builder.dispose?.();
        }
        builders.clear();
    }
}