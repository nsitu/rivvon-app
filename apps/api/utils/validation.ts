export function parsePositiveInteger(value: unknown, fieldName: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${fieldName} must be a positive integer`);
    }
    return parsed;
}

export function normalizePayloadJson(payload: unknown, fieldName = 'payloadJson'): string {
    const payloadJson = typeof payload === 'string' ? payload : JSON.stringify(payload ?? null);
    if (!payloadJson || payloadJson === 'null') {
        throw new Error(`${fieldName} is required`);
    }

    try {
        JSON.parse(payloadJson);
    } catch {
        throw new Error(`${fieldName} must be valid JSON`);
    }

    return payloadJson;
}

export function normalizeHttpsUrl(url: unknown, fallback = ''): string {
    const normalized = typeof url === 'string' ? url.trim() : '';
    if (!normalized) {
        return fallback;
    }
    if (!normalized.startsWith('https://')) {
        throw new Error('URL must use HTTPS');
    }
    return normalized;
}

export function normalizeOptionalId(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}