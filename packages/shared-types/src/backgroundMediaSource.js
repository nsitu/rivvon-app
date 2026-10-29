export const BUILTIN_BACKGROUND_IDS = ['card', 'textile', 'cenote'];

export function normalizeBackgroundSource(value, legacy = 'card') {
    if (value == null) return { kind: 'builtin', id: BUILTIN_BACKGROUND_IDS.includes(legacy) ? legacy : 'card' };
    if (!value || !['builtin', 'image', 'clip'].includes(value.kind) || typeof value.id !== 'string'
        || !/^[\w-]{1,64}$/.test(value.id) || (value.kind === 'builtin' && !BUILTIN_BACKGROUND_IDS.includes(value.id))) {
        throw new Error('Invalid background media reference');
    }
    return { kind: value.kind, id: value.id };
}

