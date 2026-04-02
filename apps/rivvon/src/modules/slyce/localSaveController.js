import { ref } from 'vue';

export function createLocalSaveState() {
    return {
        isSavingLocally: false,
        saveLocalProgress: '',
        saveLocalError: null,
        savedLocalTextureId: null,
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
        setValue('savedLocalTextureId', null);
        return generation;
    }

    function beginLocalSave() {
        const generation = getValue('localSaveGeneration') + 1;
        setValue('localSaveGeneration', generation);
        setValue('isSavingLocally', true);
        setValue('saveLocalProgress', '');
        setValue('saveLocalError', null);
        setValue('savedLocalTextureId', null);
        return generation;
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
        get savedLocalTextureId() {
            return getValue('savedLocalTextureId');
        },
        get localSaveGeneration() {
            return getValue('localSaveGeneration');
        },
        set,
        resetLocalSaveState,
        beginLocalSave,
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
        savedLocalTextureId: ref(null),
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
    };
}