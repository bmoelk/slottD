import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/schema.js';

export interface SiteRenameResult {
  success: boolean;
  oldSiteId: string;
  newSiteId: string;
  updatedSystemTables: string[];
  updatedContentTables: string[];
}

export interface SiteInfo {
  site_id: string;
  git_remote_url?: string;
  git_branch?: string;
  content_path?: string;
  deploy_hook?: string;
  updated_at: number;
}

/**
 * Executes a disciplined, hybrid atomic site rename across all partitioned database tables.
 */
export async function renameSite(
  db: Kysely<Database>,
  oldSiteId: string,
  newSiteId: string
): Promise<SiteRenameResult> {
  const cleanOld = oldSiteId.toLowerCase().trim();
  const cleanNew = newSiteId.toLowerCase().trim();

  if (!cleanNew || cleanOld === cleanNew) {
    throw new Error('Invalid or identical new site ID provided.');
  }

  // 1. Verify destination domain is not already registered in system_site_settings
  const existing = await db
    .selectFrom('system_site_settings')
    .where('site_id', '=', cleanNew)
    .select('site_id')
    .executeTakeFirst();

  if (existing) {
    throw new Error(`Cannot rename to '${cleanNew}': a site with this domain already exists.`);
  }

  const now = Date.now();
  const updatedContentTables: string[] = [];
  const updatedSystemTables: string[] = [
    'system_site_settings',
    'media',
    'site_domain_referrals',
    'directus_versions',
  ];

  // 2. Execute updates across system and content tables
  const executor = db;

  // ── Dedicated Handler 1: system_site_settings (site_id & updated_at in one go) ──
  await sql.raw(
    `UPDATE system_site_settings SET site_id = '${cleanNew}', updated_at = ${now} WHERE site_id = '${cleanOld}'`
  ).execute(executor);

  // ── Dedicated Handler 2: media (site_id & descriptive R2 key prefixes) ──
  await sql.raw(`
    UPDATE media 
    SET site_id = '${cleanNew}',
        key = CASE 
          WHEN key LIKE '${cleanOld}/%' THEN replace(key, '${cleanOld}/', '${cleanNew}/')
          ELSE key 
        END
    WHERE site_id = '${cleanOld}'
  `).execute(executor);

  // ── Dedicated Handler 3: site_domain_referrals ──
  await sql.raw(
    `UPDATE site_domain_referrals SET target_site_id = '${cleanNew}' WHERE target_site_id = '${cleanOld}'`
  ).execute(executor);

  // ── Dedicated Handler 4: directus_versions & bundles & activity_log ──
  for (const tbl of ['directus_versions', 'bundles', 'activity_log']) {
    try {
      await sql.raw(
        `UPDATE "${tbl}" SET site_id = '${cleanNew}' WHERE site_id = '${cleanOld}'`
      ).execute(executor);
    } catch {}
  }

  // 3. Dynamic Physical Table Discovery (Content Tables)
  const physicalTables = await sql<{ name: string }>`
    SELECT name FROM sqlite_master 
    WHERE type = 'table' 
      AND name NOT IN (
        'system_site_settings',
        'site_domain_referrals',
        'media',
        'directus_versions',
        'system_settings',
        'collections',
        'd1_migrations'
      )
      AND name NOT LIKE 'sqlite_%' 
      AND name NOT LIKE '_cf_%'
  `.execute(executor);

  for (const row of physicalTables.rows) {
    const cols = await sql<{ name: string }>`
      PRAGMA table_info(${sql.raw(`"${row.name}"`)})
    `.execute(executor);

    const hasSiteId = cols.rows.some((c) => c.name === 'site_id');
    if (hasSiteId) {
      await sql.raw(
        `UPDATE "${row.name}" SET site_id = '${cleanNew}' WHERE site_id = '${cleanOld}'`
      ).execute(executor);
      updatedContentTables.push(row.name);
    }
  }

  return {
    success: true,
    oldSiteId: cleanOld,
    newSiteId: cleanNew,
    updatedSystemTables,
    updatedContentTables,
  };
}

/**
 * Retrieves all registered sites from system_site_settings and documents tables.
 */
export async function listSites(db: Kysely<Database>): Promise<SiteInfo[]> {
  const sitesMap = new Map<string, Partial<SiteInfo>>();

  // 1. Gather all site IDs from system_site_settings
  try {
    const settingsRows = await db
      .selectFrom('system_site_settings')
      .selectAll()
      .execute();

    for (const row of settingsRows) {
      if (!sitesMap.has(row.site_id)) {
        sitesMap.set(row.site_id, { site_id: row.site_id, updated_at: row.updated_at });
      }
      const entry = sitesMap.get(row.site_id)!;
      if (row.key === 'git_remote_url') entry.git_remote_url = row.value;
      if (row.key === 'git_branch') entry.git_branch = row.value;
      if (row.key === 'content_path') entry.content_path = row.value;
      if (row.key === 'deploy_hook' || row.key === 'deploy_hook_url') entry.deploy_hook = row.value;
      if (row.updated_at > (entry.updated_at || 0)) entry.updated_at = row.updated_at;
    }
  } catch {}

  // 2. Discover any additional distinct site_ids from documents table
  try {
    const docSites = await sql<{ site_id: string; max_updated: number }>`
      SELECT site_id, MAX(updated_at) as max_updated FROM documents GROUP BY site_id
    `.execute(db);

    for (const r of docSites.rows) {
      if (r.site_id && !sitesMap.has(r.site_id)) {
        sitesMap.set(r.site_id, {
          site_id: r.site_id,
          updated_at: r.max_updated || Date.now(),
        });
      }
    }
  } catch {}

  if (sitesMap.size === 0) {
    sitesMap.set('default', { site_id: 'default', updated_at: Date.now() });
  }

  return Array.from(sitesMap.values()).map((s) => ({
    site_id: s.site_id!,
    git_remote_url: s.git_remote_url,
    git_branch: s.git_branch || 'main',
    content_path: s.content_path || 'content',
    deploy_hook: s.deploy_hook,
    updated_at: s.updated_at || Date.now(),
  }));
}

/**
 * Registers or updates a site's configuration in system_site_settings.
 */
export async function registerSite(
  db: Kysely<Database>,
  siteId: string,
  settings: Record<string, string>
): Promise<void> {
  const cleanSiteId = siteId.toLowerCase().trim();
  const now = Date.now();

  for (const [key, value] of Object.entries(settings)) {
    if (value === undefined || value === null) continue;
    await sql.raw(`
      INSERT INTO system_site_settings (site_id, key, value, updated_at)
      VALUES ('${cleanSiteId}', '${key}', '${value.replace(/'/g, "''")}', ${now})
      ON CONFLICT(site_id, key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).execute(db);
  }
}
