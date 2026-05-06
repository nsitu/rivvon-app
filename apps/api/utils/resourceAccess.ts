import type { SessionAuthContext } from '../types/hono';
import { isAdminUser } from './user';

export type ResourceTableName = 'texture_sets' | 'drawings';

type ResourceRecord = Record<string, unknown>;

interface AccessibleQueryOptions {
    ownerColumn?: string;
    orderBy?: string;
    limit?: number;
    offset?: number;
    bindings?: unknown[];
}

export function isAdminRequest(auth: SessionAuthContext, adminUsersEnv?: string): boolean {
    return isAdminUser(adminUsersEnv, auth.email);
}

async function queryResourceById<T extends ResourceRecord = ResourceRecord>(
    db: D1Database,
    table: ResourceTableName,
    id: string,
    columns: string,
    ownerId?: string
): Promise<T | null> {
    const sql = ownerId
        ? `SELECT ${columns} FROM ${table} WHERE id = ? AND owner_id = ?`
        : `SELECT ${columns} FROM ${table} WHERE id = ?`;

    return await db.prepare(sql).bind(...(ownerId ? [id, ownerId] : [id])).first() as T | null;
}

export async function getResourceById<T extends ResourceRecord = ResourceRecord>(
    db: D1Database,
    table: ResourceTableName,
    id: string,
    columns = '*'
): Promise<T | null> {
    return queryResourceById<T>(db, table, id, columns);
}

export async function getOwnedResourceById<T extends ResourceRecord = ResourceRecord>(
    db: D1Database,
    table: ResourceTableName,
    id: string,
    ownerId: string,
    columns = '*'
): Promise<T | null> {
    return queryResourceById<T>(db, table, id, columns, ownerId);
}

export async function getAccessibleResourceById<T extends ResourceRecord = ResourceRecord>(
    db: D1Database,
    table: ResourceTableName,
    id: string,
    auth: SessionAuthContext,
    adminUsersEnv?: string,
    columns = '*'
): Promise<T | null> {
    const ownerId = isAdminRequest(auth, adminUsersEnv) ? undefined : auth.userId;
    return queryResourceById<T>(db, table, id, columns, ownerId);
}

export async function queryAccessibleRowById<T extends ResourceRecord = ResourceRecord>(
    db: D1Database,
    baseQuery: string,
    idColumn: string,
    id: string,
    auth: SessionAuthContext,
    adminUsersEnv?: string,
    options: Pick<AccessibleQueryOptions, 'ownerColumn' | 'bindings'> = {}
): Promise<T | null> {
    const isAdmin = isAdminRequest(auth, adminUsersEnv);
    const ownerClause = !isAdmin && options.ownerColumn ? ` AND ${options.ownerColumn} = ?` : '';
    const bindings = [...(options.bindings || []), id];

    if (!isAdmin && options.ownerColumn) {
        bindings.push(auth.userId);
    }

    return await db.prepare(`${baseQuery} WHERE ${idColumn} = ?${ownerClause}`).bind(...bindings).first() as T | null;
}

export async function queryAccessibleRows<T extends ResourceRecord = ResourceRecord>(
    db: D1Database,
    baseQuery: string,
    auth: SessionAuthContext,
    adminUsersEnv?: string,
    options: AccessibleQueryOptions = {}
): Promise<T[]> {
    const isAdmin = isAdminRequest(auth, adminUsersEnv);
    const ownerClause = !isAdmin && options.ownerColumn ? ` WHERE ${options.ownerColumn} = ?` : '';
    const orderClause = options.orderBy ? ` ORDER BY ${options.orderBy}` : '';
    const hasPagination = Number.isInteger(options.limit) && Number.isInteger(options.offset);
    const paginationClause = hasPagination ? ' LIMIT ? OFFSET ?' : '';
    const bindings = [...(options.bindings || [])];

    if (!isAdmin && options.ownerColumn) {
        bindings.push(auth.userId);
    }

    if (hasPagination) {
        bindings.push(options.limit as number, options.offset as number);
    }

    const result = await db.prepare(`${baseQuery}${ownerClause}${orderClause}${paginationClause}`).bind(...bindings).all();
    return (result.results || []) as T[];
}

export async function countAccessibleRows(
    db: D1Database,
    table: ResourceTableName,
    auth: SessionAuthContext,
    adminUsersEnv?: string,
    ownerColumn = 'owner_id'
): Promise<number> {
    const isAdmin = isAdminRequest(auth, adminUsersEnv);
    const sql = isAdmin
        ? `SELECT COUNT(*) as total FROM ${table}`
        : `SELECT COUNT(*) as total FROM ${table} WHERE ${ownerColumn} = ?`;

    const result = await db.prepare(sql).bind(...(isAdmin ? [] : [auth.userId])).first() as { total?: number | string } | null;
    return Number(result?.total || 0);
}