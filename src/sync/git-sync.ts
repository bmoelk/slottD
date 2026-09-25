import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import type { DocumentStatus, ActivityLogRow } from '../types.js';
import { assertSchemaVersion } from '../api/views.js';
import { getUnreleasedActivity, ensureActivityLogTable, logActivity } from '../db/audit.js';

export interface GitContentItem {
  id?: string;
  siteId?: string;
  collection: string;
  slug: string;
  title: string;
  status?: DocumentStatus;
  schemaVersion?: number;
  publishAt?: number | null;
  data: Record<string, any>;
  createdAt?: number;
  updatedAt?: number;
}

export interface SerializedGitFile {
  path: string;
  content: string;
}

/**
 * Hydrates / restores the D1 database from an array of Git content items.
 * Scoped strictly to siteId to enforce multi-site database isolation.
 * Enforces Rule 5 Fail-Fast version validation.
/**
 * Hydrates activity logs from an array of JSONL lines or ActivityLogRow objects into D1 SQLite.
 * Uses ID checking to ensure idempotency.
 */
export async function hydrateActivityLogs(
  db: Kysely<Database>,
  activityData: string | string[] | ActivityLogRow[],
  siteId?: string
): Promise<{ restored: number; skipped: number }> {
  await ensureActivityLogTable(db);
  const cleanSiteId = siteId ? siteId.toLowerCase().trim() : undefined;

  const records: ActivityLogRow[] = [];
  if (typeof activityData === 'string') {
    const lines = activityData.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      try {
        records.push(JSON.parse(line));
      } catch {}
    }
  } else if (Array.isArray(activityData)) {
    for (const item of activityData) {
      if (typeof item === 'string') {
        try {
          records.push(JSON.parse(item));
        } catch {}
      } else if (item && typeof item === 'object') {
        records.push(item);
      }
    }
  }

  let restored = 0;
  let skipped = 0;

  for (const act of records) {
    if (!act.id) continue;
    const targetSiteId = (act.site_id || cleanSiteId || 'default').toLowerCase().trim();
    if (cleanSiteId && targetSiteId !== cleanSiteId) {
      continue;
    }

    const existing = await db
      .selectFrom('activity_log')
      .select(['id'])
      .where('id', '=', act.id)
      .executeTakeFirst();

    if (!existing) {
      try {
        await db
          .insertInto('activity_log')
          .values({
            id: act.id,
            site_id: targetSiteId,
            timestamp: Number(act.timestamp) || Date.now(),
            actor: act.actor || 'system',
            action: act.action,
            collection: act.collection,
            document_id: act.document_id,
            document_title: act.document_title || null,
            details: act.details ? (typeof act.details === 'string' ? act.details : JSON.stringify(act.details)) : null,
          })
          .execute();
        restored++;
      } catch {
        skipped++;
      }
    } else {
      skipped++;
    }
  }

  return { restored, skipped };
}

/**
 * Hydrates / restores the D1 database from an array of Git content items.
 * Scoped strictly to siteId to enforce multi-site database isolation.
 * Optionally restores serialized activity logs (.slottd/activity.jsonl).
 * Enforces Rule 5 Fail-Fast version validation.
 */
export async function hydrateFromGit(
  db: Kysely<Database>,
  items: GitContentItem[],
  supportedVersion: number = 1,
  siteId: string = 'default',
  activities?: string | string[] | ActivityLogRow[]
): Promise<{ inserted: number; updated: number; activitiesRestored: number }> {
  let inserted = 0;
  let updated = 0;
  const now = Date.now();
  const cleanSiteId = (siteId || 'default').toLowerCase().trim();

  for (const item of items) {
    const docVersion = item.schemaVersion || 1;
    // Rule 5: Fail fast if incoming git content has higher schema version than supported
    assertSchemaVersion(`${item.collection}/${item.slug}`, docVersion, supportedVersion);

    const existing = await db
      .selectFrom('documents')
      .select(['id'])
      .where('site_id', '=', cleanSiteId)
      .where('collection', '=', item.collection)
      .where('slug', '=', item.slug)
      .executeTakeFirst();

    const status = item.status || 'published';
    const createdAt = item.createdAt || now;
    const updatedAt = item.updatedAt || now;

    if (existing) {
      await db
        .updateTable('documents')
        .set({
          title: item.title,
          status,
          schema_version: docVersion,
          publish_at: item.publishAt || null,
          data: JSON.stringify(item.data),
          updated_at: updatedAt,
        })
        .where('id', '=', existing.id)
        .execute();
      updated++;
    } else {
      let targetId = item.id;
      if (targetId) {
        const idTaken = await db
          .selectFrom('documents')
          .select(['id'])
          .where('id', '=', targetId)
          .executeTakeFirst();
        if (idTaken) {
          targetId = crypto.randomUUID();
        }
      } else {
        targetId = crypto.randomUUID();
      }

      await db
        .insertInto('documents')
        .values({
          id: targetId,
          site_id: cleanSiteId,
          collection: item.collection,
          slug: item.slug,
          title: item.title,
          status,
          schema_version: docVersion,
          publish_at: item.publishAt || null,
          data: JSON.stringify(item.data),
          created_at: createdAt,
          updated_at: updatedAt,
        })
        .execute();
      inserted++;
    }
  }

  let activitiesRestored = 0;
  if (activities) {
    const actRes = await hydrateActivityLogs(db, activities, cleanSiteId);
    activitiesRestored = actRes.restored;
  }

  return { inserted, updated, activitiesRestored };
}


/**
 * Exports records from D1 into serialized format suitable for writing to Git files.
 * Can be optionally filtered by siteId and collection.
 */
export async function exportToGitFormat(
  db: Kysely<Database>,
  collection?: string,
  siteId?: string
): Promise<GitContentItem[]> {
  let query = db.selectFrom('documents').selectAll();
  if (siteId) {
    query = query.where('site_id', '=', siteId.toLowerCase().trim());
  }
  if (collection) {
    query = query.where('collection', '=', collection);
  }

  const rows = await query.execute();
  return rows.map((r) => {
    let parsedData = {};
    try {
      parsedData = JSON.parse(r.data);
    } catch {}

    return {
      id: r.id,
      siteId: r.site_id,
      collection: r.collection,
      slug: r.slug,
      title: r.title,
      status: r.status,
      schemaVersion: r.schema_version,
      publishAt: r.publish_at,
      data: parsedData,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });
}

/**
 * Auto-generates a standardized README.md for dedicated or monorepo content repositories.
 */
export function generateContentReadme(siteId: string = 'default', isMonorepo?: boolean): string {
  const cleanSiteId = (siteId || 'default').toLowerCase().trim();
  const repoType = isMonorepo ? 'Monorepo content directory' : 'Dedicated content repository';
  return `# ${cleanSiteId} — Content Repository

This repository stores the version-controlled content and release snapshots for **${cleanSiteId}**, powered by [SlottD CMS](https://github.com/bmoelk/slottD).

## 📁 Repository Structure (${repoType})

- Collections are stored as serialized companion files:
  - \`<collection>/<slug>.json\`: Document metadata, schema version, status, and structured fields.
  - \`<collection>/<slug>.md\`: Companion Markdown body (for documents with narrative content).
- \`README.md\`: Architecture and workflow documentation.

## 🚀 Headless Architecture & Workflows

1. **SlottD Headless CMS**:
   - Manages content authoring, SQLite D1 database persistence, and Cloudflare R2 media storage.
   - Serves AST REST endpoints (\`/items/<collection>\`, \`/files/<idOrKey>\`) partitioned by \`site_id: ${cleanSiteId}\`.

2. **Git Snapshot Releases**:
   - Every published release snapshot creates an annotated Git tag (\`release-YYYY.MM.DD-HHMM\`).
   - Tags can be inspected, compared, and restored at any time via the SlottD Studio Git Center.

3. **Frontend Integration**:
   - Consumed by Astro and SlotWire frontends via Directus filter \`?filter[site_id][_eq]=${cleanSiteId}\` or site-scoped Bearer token.
`;
}

/**
 * Converts GitContentItems into plain .json and narrative .md file pairs.
 * Optionally includes an auto-generated README.md for the content repository.
 */
export function serializeToFiles(
  items: GitContentItem[],
  basePath: string = 'content',
  siteId: string = 'default',
  isMonorepo?: boolean,
  includeReadme: boolean = true,
  activities?: ActivityLogRow[]
): SerializedGitFile[] {
  const files: SerializedGitFile[] = [];
  const normalizedBase = basePath === '.' || basePath === '/' ? '' : basePath.replace(/^\/+|\/+$/g, '');

  for (const item of items) {
    const dir = normalizedBase ? `${normalizedBase}/${item.collection}` : item.collection;
    const dataCopy = { ...item.data };

    // If narrative body/content exists, separate it to clean companion .md
    if (dataCopy.content && typeof dataCopy.content === 'string') {
      const markdownBody = dataCopy.content;
      delete dataCopy.content;

      files.push({
        path: `${dir}/${item.slug}.md`,
        content: markdownBody,
      });
    }

    const metadata = {
      id: item.id,
      collection: item.collection,
      slug: item.slug,
      title: item.title,
      status: item.status,
      schema_version: item.schemaVersion || 1,
      created_at: item.createdAt,
      updated_at: item.updatedAt,
      data: dataCopy,
    };

    files.push({
      path: `${dir}/${item.slug}.json`,
      content: JSON.stringify(metadata, null, 2),
    });
  }

  // Include auto-generated README.md if requested and not present in collection files
  if (includeReadme) {
    const readmePath = normalizedBase ? `${normalizedBase}/README.md` : 'README.md';
    if (!files.some((f) => f.path === readmePath)) {
      files.push({
        path: readmePath,
        content: generateContentReadme(siteId, isMonorepo),
      });
    }
  }

  // Serialize activity log into append-only JSONL format (.slottd/activity.jsonl)
  if (activities && activities.length > 0) {
    const activityPath = normalizedBase ? `${normalizedBase}/.slottd/activity.jsonl` : '.slottd/activity.jsonl';
    const jsonlContent = activities.map((act) => JSON.stringify(act)).join('\n') + '\n';
    files.push({
      path: activityPath,
      content: jsonlContent,
    });
  }

  return files;
}


/**
 * Pushes serialized files to GitHub and creates an annotated release Git tag.
 */
export async function publishReleaseToGitHub(options: {
  githubToken: string;
  repoOwner: string;
  repoName: string;
  branch?: string;
  files: SerializedGitFile[];
  tagName: string;
  commitMessage: string;
}): Promise<{ commitSha: string; tagCreated: boolean }> {
  const { githubToken, repoOwner, repoName, branch = 'main', files, tagName, commitMessage } = options;
  const baseUrl = `https://api.github.com/repos/${repoOwner}/${repoName}`;
  const headers = {
    Authorization: `Bearer ${githubToken}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'SlottD-Git-Sync/1.0',
  };

  // 1. Get latest commit SHA on branch
  const refRes = await fetch(`${baseUrl}/git/ref/heads/${branch}`, { headers });
  if (!refRes.ok) {
    throw new Error(`Failed to get ref heads/${branch}: ${await refRes.text()}`);
  }
  const refData: any = await refRes.json();
  const latestCommitSha = refData.object.sha;

  // 1b. Fetch existing tree to discover deleted content files and mirror deletions
  const newPathSet = new Set(files.map((f) => f.path));
  const deleteEntries: any[] = [];
  try {
    const baseTreeRes = await fetch(`${baseUrl}/git/trees/${latestCommitSha}?recursive=1`, { headers });
    if (baseTreeRes.ok) {
      const baseTreeData: any = await baseTreeRes.json();
      const existingContentFiles = (baseTreeData.tree || []).filter(
        (node: any) => node.type === 'blob' && node.path.startsWith('content/')
      );
      for (const oldNode of existingContentFiles) {
        if (!newPathSet.has(oldNode.path)) {
          deleteEntries.push({
            path: oldNode.path,
            mode: '100644',
            type: 'blob',
            sha: null,
          });
        }
      }
    }
  } catch {}

  // 2. Create Tree with updated and deleted files
  const treePayload = {
    base_tree: latestCommitSha,
    tree: [
      ...files.map((f) => ({
        path: f.path,
        mode: '100644',
        type: 'blob',
        content: f.content,
      })),
      ...deleteEntries,
    ],
  };

  const treeRes = await fetch(`${baseUrl}/git/trees`, {
    method: 'POST',
    headers,
    body: JSON.stringify(treePayload),
  });
  if (!treeRes.ok) {
    throw new Error(`Failed to create tree: ${await treeRes.text()}`);
  }
  const treeData: any = await treeRes.json();

  // 3. Create Commit
  const commitRes = await fetch(`${baseUrl}/git/commits`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: commitMessage,
      tree: treeData.sha,
      parents: [latestCommitSha],
    }),
  });
  if (!commitRes.ok) {
    throw new Error(`Failed to create commit: ${await commitRes.text()}`);
  }
  const commitData: any = await commitRes.json();

  // 4. Update branch ref
  await fetch(`${baseUrl}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ sha: commitData.sha }),
  });

  // 5. Create Tag Ref
  const tagRes = await fetch(`${baseUrl}/git/refs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ref: `refs/tags/${tagName}`,
      sha: commitData.sha,
    }),
  });

  return {
    commitSha: commitData.sha,
    tagCreated: tagRes.ok,
  };
}

export interface ConventionalCommitResult {
  commitMessage: string;
  nextTag: string;
  lastReleaseTag?: string;
  itemsCount: number;
  collectionsCount: number;
  hasUnreleased: boolean;
  changes: Array<{
    action: 'feat' | 'fix' | 'chore';
    collection: string;
    documentId: string;
    title: string;
    description: string;
    actor?: string;
  }>;
}

/**
 * Pure function: synthesizes a Conventional Commit message from a chronological stream
 * of unreleased ActivityLogRows. Computes net delta per (collection, documentId),
 * deduplicating multiple edits, filtering ephemeral create+deletes, and appending
 * an Audit-Checkpoint trailer.
 */
export function synthesizeCommitFromActivities(
  activities: ActivityLogRow[],
  options?: {
    siteId?: string;
    lastReleaseTag?: string;
    lastReleaseSha?: string;
    nextTag?: string;
    baseSha?: string;
  }
): ConventionalCommitResult {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '.');
  const timeStr = `${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}`;
  const defaultNextTag = `release-${dateStr}-${timeStr}`;
  const tag = options?.nextTag || defaultNextTag;

  interface DocDelta {
    collection: string;
    documentId: string;
    title: string;
    isCreated: boolean;
    isDeleted: boolean;
    isPromoted: boolean;
    updateCount: number;
    actors: Set<string>;
  }

  const itemMap = new Map<string, DocDelta>();

  // Sort activities chronologically by timestamp ascending
  const sorted = [...activities].sort((a, b) => Number(a.timestamp) - Number(b.timestamp));

  for (const act of sorted) {
    // Ignore internal git events when compiling content changes
    if (act.collection === '_git' || act.action === 'git_release') {
      continue;
    }

    const key = `${act.collection}:${act.document_id}`;
    let item = itemMap.get(key);
    if (!item) {
      item = {
        collection: act.collection,
        documentId: act.document_id,
        title: act.document_title || act.document_id,
        isCreated: false,
        isDeleted: false,
        isPromoted: false,
        updateCount: 0,
        actors: new Set<string>(),
      };
      itemMap.set(key, item);
    }

    if (act.document_title) {
      item.title = act.document_title;
    }

    if (act.actor) {
      const cleanActor = act.actor.includes('@') ? act.actor.split('@')[0] : act.actor;
      item.actors.add(cleanActor);
    }

    if (act.action === 'create') {
      item.isCreated = true;
      item.isDeleted = false;
    } else if (act.action === 'delete') {
      item.isDeleted = true;
    } else if (act.action === 'version_promote' || act.action === 'draft_promote') {
      item.isPromoted = true;
    } else if (act.action === 'update' || act.action === 'update_draft') {
      item.updateCount++;
    }
  }

  const changes: ConventionalCommitResult['changes'] = [];
  const collectionsSet = new Set<string>();

  for (const item of itemMap.values()) {
    // 1. If created and deleted within the same unreleased window, net change is 0
    if (item.isCreated && item.isDeleted) {
      continue;
    }

    const actorList = Array.from(item.actors).join(', ');
    const actorSuffix = actorList ? ` (by ${actorList})` : '';

    if (item.isDeleted) {
      changes.push({
        action: 'chore',
        collection: item.collection,
        documentId: item.documentId,
        title: item.title,
        description: `- chore(${item.collection}): deleted '${item.title}'${actorSuffix}`,
        actor: actorList,
      });
      collectionsSet.add(item.collection);
    } else if (item.isCreated) {
      changes.push({
        action: 'feat',
        collection: item.collection,
        documentId: item.documentId,
        title: item.title,
        description: `- feat(${item.collection}): created '${item.title}'${actorSuffix}`,
        actor: actorList,
      });
      collectionsSet.add(item.collection);
    } else if (item.isPromoted) {
      changes.push({
        action: 'feat',
        collection: item.collection,
        documentId: item.documentId,
        title: item.title,
        description: `- feat(${item.collection}): promoted draft '${item.title}'${actorSuffix}`,
        actor: actorList,
      });
      collectionsSet.add(item.collection);
    } else if (item.updateCount > 0) {
      changes.push({
        action: 'fix',
        collection: item.collection,
        documentId: item.documentId,
        title: item.title,
        description: `- fix(${item.collection}): updated '${item.title}'${actorSuffix}`,
        actor: actorList,
      });
      collectionsSet.add(item.collection);
    }
  }

  const hasUnreleased = changes.length > 0;
  const itemsCount = changes.length;
  const collectionsCount = collectionsSet.size;

  const subject = `chore(content): release snapshot ${tag}`;

  let body = '';
  if (hasUnreleased) {
    const previousRef = options?.lastReleaseTag || 'initial baseline';
    const summaryLine = `Changes since ${previousRef} (${itemsCount} ${itemsCount === 1 ? 'item' : 'items'} across ${collectionsCount} ${collectionsCount === 1 ? 'collection' : 'collections'}):`;
    const changeLines = changes.map((c) => c.description).join('\n');
    body = `${summaryLine}\n${changeLines}`;
  } else {
    body = `Snapshot release ${tag}. Zero unreleased database activity logged.`;
  }

  const checkpointSha = options?.lastReleaseSha || options?.baseSha;
  const trailer = checkpointSha ? `Audit-Checkpoint: ${checkpointSha}..HEAD` : undefined;

  const parts = [subject, body];
  if (trailer) {
    parts.push(trailer);
  }

  const commitMessage = parts.join('\n\n');

  return {
    commitMessage,
    nextTag: tag,
    lastReleaseTag: options?.lastReleaseTag,
    itemsCount,
    collectionsCount,
    hasUnreleased,
    changes,
  };
}

/**
 * Queries unreleased activity logs from SQLite for the given site and synthesizes
 * an audit-driven conventional commit message.
 */
export async function synthesizeConventionalCommit(
  db: Kysely<Database>,
  siteId: string,
  nextTag?: string
): Promise<ConventionalCommitResult> {
  const unreleased = await getUnreleasedActivity(db, siteId);
  return synthesizeCommitFromActivities(unreleased.activities, {
    siteId,
    lastReleaseTag: unreleased.lastReleaseTag,
    lastReleaseSha: unreleased.lastReleaseSha,
    nextTag,
  });
}

export interface StashDraftsResult {
  count: number;
  snapshottedVersions: number;
  documents: Array<{ id: string; collection: string; title: string; slug: string }>;
}

/**
 * Identifies documents with unreleased edits since the last git_release.
 */
export async function getUnreleasedDocuments(
  db: Kysely<Database>,
  siteId: string
): Promise<Array<{ id: string; collection: string; title: string; slug: string; updated_at: number }>> {
  const lastRelease = await db
    .selectFrom('activity_log')
    .where('site_id', '=', siteId)
    .where('action', '=', 'git_release')
    .select(db.fn.max('timestamp').as('last_ts'))
    .executeTakeFirst();
  const lastTs = Number(lastRelease?.last_ts) || 0;

  let query = db.selectFrom('documents')
    .where('site_id', '=', siteId)
    .select(['id', 'collection', 'title', 'slug', 'updated_at']);

  if (lastTs > 0) {
    query = query.where('updated_at', '>', lastTs);
  }

  const docs = await query.execute();
  return docs.map((d) => ({
    id: d.id,
    collection: d.collection,
    title: d.title || d.slug,
    slug: d.slug,
    updated_at: Number(d.updated_at) || 0,
  }));
}

/**
 * Draft-Driven Conflict Resolution & Tag Restore Guard:
 * Stashes unreleased local content into working drafts (`draft_data`).
 * If an active draft already exists on a document, it is automatically snapshotted
 * into `directus_versions` first before stashing, ensuring zero data loss.
 */
export async function stashUnreleasedAsDrafts(
  db: Kysely<Database>,
  siteId: string,
  actor: string = 'operator@slottd.dev',
  docIds?: string[]
): Promise<StashDraftsResult> {
  const lastRelease = await db
    .selectFrom('activity_log')
    .where('site_id', '=', siteId)
    .where('action', '=', 'git_release')
    .select(db.fn.max('timestamp').as('last_ts'))
    .executeTakeFirst();
  const lastTs = Number(lastRelease?.last_ts) || 0;

  let query = db.selectFrom('documents').where('site_id', '=', siteId).selectAll();
  if (docIds && docIds.length > 0) {
    query = query.where('id', 'in', docIds);
  } else if (lastTs > 0) {
    query = query.where('updated_at', '>', lastTs);
  }
  const candidateDocs = await query.execute();

  let count = 0;
  let snapshottedVersions = 0;
  const now = Date.now();
  const affectedDocs: Array<{ id: string; collection: string; title: string; slug: string }> = [];

  for (const doc of candidateDocs) {
    // 1. If an active draft already exists, snapshot it to directus_versions
    if (doc.draft_status && doc.draft_status !== 'none' && doc.draft_data) {
      await db.insertInto('directus_versions').values({
        id: crypto.randomUUID(),
        site_id: siteId,
        key: `v_auto_${now}_${doc.id.slice(0, 8)}`,
        name: `Draft snapshot before upstream sync (${new Date(now).toLocaleTimeString()})`,
        collection: doc.collection,
        item: doc.id,
        delta: typeof doc.draft_data === 'string' ? doc.draft_data : JSON.stringify(doc.draft_data || {}),
        date_created: now,
        date_updated: now,
        user_created: actor,
        user_updated: actor,
      }).execute();
      snapshottedVersions++;
    }

    // 2. Stash the local version of content into draft_data
    await db.updateTable('documents').set({
      draft_data: typeof doc.data === 'string' ? doc.data : JSON.stringify(doc.data || {}),
      draft_status: 'modified',
      draft_updated_at: now,
    }).where('id', '=', doc.id).where('site_id', '=', siteId).execute();

    await logActivity(db, {
      siteId,
      actor,
      action: 'conflict_stashed_as_draft',
      collection: doc.collection,
      documentId: doc.id,
      documentTitle: doc.title,
      details: JSON.stringify({ message: 'Local version of content stashed as working draft following upstream sync' }),
    });

    count++;
    affectedDocs.push({
      id: doc.id,
      collection: doc.collection,
      title: doc.title || doc.slug,
      slug: doc.slug,
    });
  }

  return {
    count,
    snapshottedVersions,
    documents: affectedDocs,
  };
}
