import type { Kysely } from 'kysely';
import type { Database } from './schema.js';
import type { ActivityLogRow } from '../types.js';

let tableEnsured = false;

export async function ensureActivityLogTable(db: Kysely<Database>): Promise<void> {
  if (tableEnsured) return;
  try {
    const rawSql = `
      CREATE TABLE IF NOT EXISTS activity_log (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        collection TEXT NOT NULL,
        document_id TEXT NOT NULL,
        document_title TEXT,
        details TEXT
      );
    `;
    const { sql } = await import('kysely');
    await sql.raw(rawSql).execute(db);
    tableEnsured = true;
  } catch {
    tableEnsured = true;
  }
}

export interface LogActivityParams {
  actor?: string;
  action: 'create' | 'update' | 'update_draft' | 'delete' | 'release_tag' | 'hydrate' | 'version_create' | 'version_promote' | string;
  collection: string;
  documentId: string;
  documentTitle?: string | null;
  details?: Record<string, any> | string | null;
}

export async function logActivity(
  db: Kysely<Database>,
  params: LogActivityParams
): Promise<void> {
  try {
    await ensureActivityLogTable(db);
    const id = crypto.randomUUID();
    const timestamp = Date.now();
    const actor = params.actor || 'admin@localhost';
    const detailsStr = params.details
      ? typeof params.details === 'string'
        ? params.details
        : JSON.stringify(params.details)
      : null;

    await db
      .insertInto('activity_log')
      .values({
        id,
        timestamp,
        actor,
        action: params.action,
        collection: params.collection,
        document_id: params.documentId,
        document_title: params.documentTitle || null,
        details: detailsStr,
      })
      .execute();
  } catch (err: any) {
    console.warn('Activity log write error (non-fatal):', err.message);
  }
}
