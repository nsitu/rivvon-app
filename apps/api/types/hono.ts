export interface SessionAuthContext {
    userId: string;
    googleId: string;
    email: string;
    name: string;
    picture?: string;
}

export interface AppBindings {
    DB: D1Database;
    BUCKET: R2Bucket;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    SESSION_SECRET: string;
    API_URL: string;
    APP_URL: string;
    CORS_ORIGINS?: string;
    ADMIN_USERS?: string;
    AUTH0_DOMAIN?: string;
    AUTH0_AUDIENCE?: string;
}

export interface AppVariables {
    auth: SessionAuthContext;
}

export type AppEnv = {
    Bindings: AppBindings;
    Variables: AppVariables;
};