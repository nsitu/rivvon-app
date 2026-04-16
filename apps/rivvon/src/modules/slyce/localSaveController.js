import { ref } from 'vue';

export function createLocalSaveState() {
    return {
        isSavingLocally: false,
        saveLocalProgress: '',
        saveLocalError: null,
        saveLocalNotice: null,
        savedLocalTextureId: null,
        savedLocalTextureFamilyIds: [],
        canCancelLocalSave: false,
        localSaveAbortController: null,
        localSaveGeneration: 0,
    };
}

function createLocalSaveController(getValue, setValue) {
    function set(key, value) {
        setValue(key, value);
    }

    function resetLocalSaveState() {
        const generation = getValue('localSaveGeneration') + 1;
        setValue('localSaveGeneration', generation);
        setValue('isSavingLocally', false);
        setValue('saveLocalProgress', '');
        setValue('saveLocalError', null);
        setValue('saveLocalNotice', null);
        setValue('savedLocalTextureId', null);
        setValue('savedLocalTextureFamilyIds', []);
        setValue('canCancelLocalSave', false);
        setValue('localSaveAbortController', null);
        return generation;
    }

    function beginLocalSave(abortController = null) {
        const generation = getValue('localSaveGeneration') + 1;
        setValue('localSaveGeneration', generation);
        setValue('isSavingLocally', true);
        setValue('saveLocalProgress', '');
        setValue('saveLocalError', null);
        setValue('saveLocalNotice', null);
        setValue('savedLocalTextureId', null);
        setValue('savedLocalTextureFamilyIds', []);
        setValue('canCancelLocalSave', Boolean(abortController));
        setValue('localSaveAbortController', abortController);
        return generation;
    }

    function finishLocalSave() {
        setValue('isSavingLocally', false);
        setValue('canCancelLocalSave', false);
        setValue('localSaveAbortController', null);
    }

    function cancelLocalSave() {
        const abortController = getValue('localSaveAbortController');
        if (!abortController || abortController.signal?.aborted) {
            return false;
        }

        setValue('saveLocalProgress', 'Cancelling variant generation...');
        setValue('canCancelLocalSave', false);
        abortController.abort();
        return true;
    }

    return {
        get isSavingLocally() {
            return getValue('isSavingLocally');
        },
        get saveLocalProgress() {
            return getValue('saveLocalProgress');
        },
        get saveLocalError() {
            return getValue('saveLocalError');
        },
        get saveLocalNotice() {
            return getValue('saveLocalNotice');
        },
        get savedLocalTextureId() {
            return getValue('savedLocalTextureId');
        },
        get savedLocalTextureFamilyIds() {
            return getValue('savedLocalTextureFamilyIds');
        },
        get canCancelLocalSave() {
            return getValue('canCancelLocalSave');
        },
        get localSaveAbortController() {
            return getValue('localSaveAbortController');
        },
        get localSaveGeneration() {
            return getValue('localSaveGeneration');
        },
        set,
        resetLocalSaveState,
        beginLocalSave,
        finishLocalSave,
        cancelLocalSave,
    };
}

export function createObjectLocalSaveController(target) {
    return createLocalSaveController(
        key => target[key],
        (key, value) => {
            target[key] = value;
        }
    );
}

export function createRefLocalSaveController() {
    const refs = {
        isSavingLocally: ref(false),
        saveLocalProgress: ref(''),
        saveLocalError: ref(null),
        saveLocalNotice: ref(null),
        savedLocalTextureId: ref(null),
        savedLocalTextureFamilyIds: ref([]),
        canCancelLocalSave: ref(false),
        localSaveAbortController: ref(null),
        localSaveGeneration: ref(0),
    };

    const controller = createLocalSaveController(
        key => refs[key].value,
        (key, value) => {
            refs[key].value = value;
        }
    );

    return {
        ...refs,
        controller,
        resetLocalSaveState: controller.resetLocalSaveState,
        beginLocalSave: controller.beginLocalSave,
        finishLocalSave: controller.finishLocalSave,
        cancelLocalSave: controller.cancelLocalSave,
    };
}