import type { Kysely } from 'kysely';
import type { Database } from './schema.js';
import type { ActivityLogRow } from '../types.js';

let tableEnsured = false;

export async function ensureActivityLogTable(db: Kysely<Database>): Promise<void> {
  if (tableEnsured) return;
  try {
    const { sql } = await import('kysely');
    await sql.raw(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL DEFAULT 'default',
        timestamp INTEGER NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        collection TEXT NOT NULL,
        document_id TEXT NOT NULL,
        document_title TEXT,
        details TEXT
      )
    `).execute(db);
    await sql.raw(`CREATE INDEX IF NOT EXISTS idx_activity_site ON activity_log(site_id)`).execute(db);
    await sql.raw(`CREATE INDEX IF NOT EXISTS idx_activity_site_time ON activity_log(site_id, timestamp)`).execute(db);
    tableEnsured = true;
  } catch {
    tableEnsured = true;
  }
}

export interface LogActivityParams {
  siteId?: string;
  actor?: string;
  action: 'create' | 'update' | 'update_draft' | 'delete' | 'release_tag' | 'git_release' | 'hydrate' | 'version_create' | 'version_promote' | string;
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
    const site_id = (params.siteId || 'default').toLowerCase().trim();
    const detailsStr = params.details
      ? typeof params.details === 'string'
        ? params.details
        : JSON.stringify(params.details)
      : null;

    await db
      .insertInto('activity_log')
      .values({
        id,
        site_id,
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

export interface UnreleasedActivityResult {
  activities: ActivityLogRow[];
  lastReleaseTimestamp: number;
  lastReleaseTag?: string;
  lastReleaseSha?: string;
}

export async function getUnreleasedActivity(
  db: Kysely<Database>,
  siteId: string
): Promise<UnreleasedActivityResult> {
  await ensureActivityLogTable(db);
  const cleanSiteId = (siteId || 'default').toLowerCase().trim();

  let lastRelease: any = null;
  try {
    lastRelease = await db
      .selectFrom('activity_log')
      .where('site_id', '=', cleanSiteId)
      .where('action', '=', 'git_release')
      .selectAll()
      .orderBy('timestamp', 'desc')
      .limit(1)
      .executeTakeFirst();
  } catch {}

  const lastReleaseTimestamp = lastRelease ? Number(lastRelease.timestamp) : 0;
  let lastReleaseDetails: any = null;
  if (lastRelease?.details) {
    try {
      lastReleaseDetails = typeof lastRelease.details === 'string' ? JSON.parse(lastRelease.details) : lastRelease.details;
    } catch {}
  }

  const lastReleaseTag = lastReleaseDetails?.tag || lastRelease?.document_id || undefined;
  const lastReleaseSha = lastReleaseDetails?.commitSha || undefined;

  let activities: ActivityLogRow[] = [];
  try {
    activities = await db
      .selectFrom('activity_log')
      .where('site_id', '=', cleanSiteId)
      .where('timestamp', '>', lastReleaseTimestamp)
      .selectAll()
      .orderBy('timestamp', 'asc')
      .execute();
  } catch {}

  return {
    activities,
    lastReleaseTimestamp,
    lastReleaseTag,
    lastReleaseSha,
  };
}
