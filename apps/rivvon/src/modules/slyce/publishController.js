import { ref } from 'vue';

export function createPublishState() {
    return {
        isPublishingToCloud: false,
        publishProgress: '',
        publishError: null,
        publishNotice: null,
        publishedCloudRootId: null,
        publishedCloudTextureFamilyIds: [],
        publishPendingResolutions: [],
        publishLocalDraftId: null,
        publishDestination: null,
        publishGeneration: 0,
    };
}

function createPublishController(getValue, setValue) {
    function set(key, value) {
        setValue(key, value);
    }

    function resetPublishState() {
        const generation = getValue('publishGeneration') + 1;
        setValue('publishGeneration', generation);
        setValue('isPublishingToCloud', false);
        setValue('publishProgress', '');
        setValue('publishError', null);
        setValue('publishNotice', null);
        setValue('publishedCloudRootId', null);
        setValue('publishedCloudTextureFamilyIds', []);
        setValue('publishPendingResolutions', []);
        setValue('publishLocalDraftId', null);
        setValue('publishDestination', null);
        return generation;
    }

    function beginPublish(destination = null) {
        const generation = getValue('publishGeneration') + 1;
        setValue('publishGeneration', generation);
        setValue('isPublishingToCloud', true);
        setValue('publishProgress', '');
        setValue('publishError', null);
        setValue('publishNotice', null);
        setValue('publishedCloudRootId', null);
        setValue('publishedCloudTextureFamilyIds', []);
        setValue('publishPendingResolutions', []);
        setValue('publishDestination', destination);
        return generation;
    }

    function finishPublish() {
        setValue('isPublishingToCloud', false);
    }

    return {
        get isPublishingToCloud() {
            return getValue('isPublishingToCloud');
        },
        get publishProgress() {
            return getValue('publishProgress');
        },
        get publishError() {
            return getValue('publishError');
        },
        get publishNotice() {
            return getValue('publishNotice');
        },
        get publishedCloudRootId() {
            return getValue('publishedCloudRootId');
        },
        get publishedCloudTextureFamilyIds() {
            return getValue('publishedCloudTextureFamilyIds');
        },
        get publishPendingResolutions() {
            return getValue('publishPendingResolutions');
        },
        get publishLocalDraftId() {
            return getValue('publishLocalDraftId');
        },
        get publishDestination() {
            return getValue('publishDestination');
        },
        get publishGeneration() {
            return getValue('publishGeneration');
        },
        set,
        resetPublishState,
        beginPublish,
        finishPublish,
    };
}

export function createObjectPublishController(target) {
    return createPublishController(
        key => target[key],
        (key, value) => {
            target[key] = value;
        }
    );
}

export function createRefPublishController() {
    const refs = {
        isPublishingToCloud: ref(false),
        publishProgress: ref(''),
        publishError: ref(null),
        publishNotice: ref(null),
        publishedCloudRootId: ref(null),
        publishedCloudTextureFamilyIds: ref([]),
        publishPendingResolutions: ref([]),
        publishLocalDraftId: ref(null),
        publishDestination: ref(null),
        publishGeneration: ref(0),
    };

    const controller = createPublishController(
        key => refs[key].value,
        (key, value) => {
            refs[key].value = value;
        }
    );

    return {
        ...refs,
        controller,
        resetPublishState: controller.resetPublishState,
        beginPublish: controller.beginPublish,
        finishPublish: controller.finishPublish,
    };
}