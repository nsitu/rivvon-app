// src/utils/cors.ts
export function getCorsHeaders(origin: string, allowedOrigins: string[]): HeadersInit {
    const headers: HeadersInit = {
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
    };

    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Credentials'] = 'true';
    }

    return headers;
}

export function resolveCorsOrigin(origin: string | undefined, allowedOrigins: string[]): string | undefined {
    if (!origin) {
        return undefined;
    }

    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        return origin;
    }

    return allowedOrigins[0];
}

export function handleCorsPreflightRequest(
    request: Request,
    allowedOrigins: string[]
): Response | null {
    if (request.method === 'OPTIONS') {
        const origin = request.headers.get('Origin') || undefined;
        const resolvedOrigin = resolveCorsOrigin(origin, allowedOrigins);
        return new Response(null, {
            status: 204,
            headers: getCorsHeaders(resolvedOrigin || '', resolvedOrigin ? [resolvedOrigin] : allowedOrigins),
        });
    }
    return null;
}
