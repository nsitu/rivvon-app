// src/utils/response.ts
export function jsonResponse(data: unknown, status: number = 200, headers: HeadersInit = {}): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            ...headers,
        },
    });
}

export function errorResponse(message: string, status: number = 400, details: Record<string, unknown> = {}): Response {
    return jsonResponse({ error: message, ...details }, status);
}

export function successResponse(data: Record<string, unknown> = {}, message?: string, status = 200): Response {
    const response = message ? { success: true, message, ...data } : { success: true, ...data };
    return jsonResponse(response, status);
}

export function notFoundResponse(message: string, details: Record<string, unknown> = {}): Response {
    return errorResponse(message, 404, details);
}

export function unauthorizedResponse(message = 'Not authenticated', details: Record<string, unknown> = {}): Response {
    return errorResponse(message, 401, details);
}

export function forbiddenResponse(message = 'Forbidden', details: Record<string, unknown> = {}): Response {
    return errorResponse(message, 403, details);
}

export function badRequestResponse(message: string, details: Record<string, unknown> = {}): Response {
    return errorResponse(message, 400, details);
}

export function serverErrorResponse(message = 'Internal server error', details: Record<string, unknown> = {}): Response {
    return errorResponse(message, 500, details);
}
