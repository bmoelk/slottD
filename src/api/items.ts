import { Hono } from 'hono';
import { sql } from 'kysely';
import { createDb } from '../db/client.js';
import { compileDirectusQuery, parseQueryParams } from './query-compiler.js';
import { syncCollectionView } from './views.js';
import { requireWriteAuth, getAuthenticatedUser } from '../auth/guard.js';
import { logActivity } from '../db/audit.js';
import type { Env, DocumentRow } from '../types.js';

export const itemsRouter = new Hono<{ Bindings: Env }>();

// Guard all mutating methods (POST, PATCH, DELETE)
itemsRouter.use('/:collection', async (c, next) => {
  if (['POST', 'PATCH', 'DELETE'].includes(c.req.method)) {
    return requireWriteAuth(c, next);
  }
  return next();
});

itemsRouter.use('/:collection/:id', async (c, next) => {
  if (['POST', 'PATCH', 'DELETE'].includes(c.req.method)) {
    return requireWriteAuth(c, next);
  }
  return next();
});

/**
 * Helper to apply draft or version delta overlay onto a document record.
 */
async function applyVersionOverlay(
  db: any,
  doc: DocumentRow,
  version?: string
): Promise<Record<string, any>> {
  let baseData = {};
  try {
    baseData = JSON.parse(doc.data || '{}');
  } catch {}

  let merged = {
    id: doc.id,
    collection: doc.collection,
    slug: doc.slug,
    title: doc.title,
    status: doc.status,
    draft_status: doc.draft_status || 'none',
    draft_updated_at: doc.draft_updated_at,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
    ...baseData,
  };

  if (!version) {
    return merged;
  }

  if (version === 'draft') {
    // Merge dual-state working copy
    if (doc.draft_data && doc.draft_status && doc.draft_status !== 'none') {
      try {
        const draftPayload = JSON.parse(doc.draft_data);
        merged = { ...merged, ...draftPayload };
      } catch {}
    }
    return merged;
  }

  // Named version query: look up directus_versions
  try {
    const vRecord = await db
      .selectFrom('directus_versions')
      .where('collection', '=', doc.collection)
      .where('item', '=', doc.id)
      .where('key', '=', version)
      .selectAll()
      .executeTakeFirst();

    if (vRecord?.delta) {
      const deltaObj = JSON.parse(vRecord.delta);
      merged = { ...merged, ...deltaObj, _version: version };
    }
  } catch {}

  return merged;
}

// 1. Query items in collection (Directus AST Compatible)
itemsRouter.get('/:collection', async (c) => {
  const collection = c.req.param('collection');
  const db = createDb(c.env.DB);
  const url = new URL(c.req.url);
  const params = parseQueryParams(url);
  const version = url.searchParams.get('version') || undefined;

  const user = await getAuthenticatedUser(c);
  const statusFilter = params.filter?.status?._eq || params.filter?.status;
  const isDraftQuery = Boolean(version || (statusFilter && statusFilter !== 'published'));

  // Directus permission matrix: unauthenticated access must not leak unpublished drafts
  if (isDraftQuery && !user) {
    return c.json(
      {
        error: 'Unauthorized',
        message: 'Draft content and version queries require authentication via Cloudflare Access or Bearer token',
      },
      401
    );
  }

  // Unauthenticated requests default to published items only
  if (!user && !statusFilter) {
    if (!params.filter) params.filter = {};
    params.filter.status = { _eq: 'published' };
  }

  try {
    // When version overlay is requested, query underlying documents table to apply deltas
    if (version) {
      let query = db
        .selectFrom('documents')
        .where('collection', '=', collection)
        .selectAll();

      if (params.filter?.status) {
        query = query.where('status', '=', params.filter.status._eq || params.filter.status);
      }
      if (params.filter?.slug) {
        query = query.where('slug', '=', params.filter.slug._eq || params.filter.slug);
      }

      const rows = await query.execute();
      const formatted = await Promise.all(
        rows.map((r: any) => applyVersionOverlay(db, r, version))
      );

      return c.json({
        data: formatted,
        meta: { filter_count: formatted.length },
      });
    }

    // Standard Directus AST view query
    let query = db.selectFrom(collection as any);
    query = compileDirectusQuery(query, params);

    const data = await query.execute();

    return c.json({
      data,
      meta: {
        filter_count: data.length,
      },
    });
  } catch (err: any) {
    // Fallback to documents table directly if dynamic SQLite view doesn't exist
    if (err?.message?.includes('no such table') || err?.message?.includes('no such view')) {
      let query = db
        .selectFrom('documents')
        .where('collection', '=', collection)
        .selectAll();

      if (params.filter?.status) {
        query = query.where('status', '=', params.filter.status._eq || params.filter.status);
      }
      if (params.filter?.slug) {
        query = query.where('slug', '=', params.filter.slug._eq || params.filter.slug);
      }

      const rows = await query.execute();
      const formatted = await Promise.all(
        rows.map((r: any) => applyVersionOverlay(db, r, version))
      );

      return c.json({
        data: formatted,
        meta: { filter_count: formatted.length },
      });
    }

    return c.json({ error: err.message || 'Failed to query items' }, 500);
  }
});

// 2. Read single item by ID or Slug
itemsRouter.get('/:collection/:id', async (c) => {
  const collection = c.req.param('collection');
  const idOrSlug = c.req.param('id');
  const db = createDb(c.env.DB);
  const url = new URL(c.req.url);
  const version = url.searchParams.get('version') || undefined;

  const user = await getAuthenticatedUser(c);
  if (version && !user) {
    return c.json(
      {
        error: 'Unauthorized',
        message: 'Draft version queries require authentication via Cloudflare Access or Bearer token',
      },
      401
    );
  }

  try {
    const row = await db
      .selectFrom('documents')
      .where('collection', '=', collection)
      .where((eb: any) => eb.or([eb('id', '=', idOrSlug), eb('slug', '=', idOrSlug)]))
      .selectAll()
      .executeTakeFirst();

    if (!row) {
      return c.json({ error: `Item '${idOrSlug}' not found in '${collection}'` }, 404);
    }

    // Check permission: if unpublished and unauthenticated, return 404/401
    if (row.status !== 'published' && !user) {
      return c.json({ error: `Item '${idOrSlug}' not found in '${collection}'` }, 404);
    }

    const item = await applyVersionOverlay(db, row, version);
    return c.json({ data: item });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to retrieve item' }, 500);
  }
});

// 3. Create Item
itemsRouter.post('/:collection', async (c) => {
  const collection = c.req.param('collection');
  const body = await c.req.json();
  const db = createDb(c.env.DB);

  const id = body.id || crypto.randomUUID();
  const slug = body.slug || generateSlug(body.title || id);
  const title = body.title || slug;
  const isDraft = body.draft === true || body.status === 'draft';
  const status = isDraft ? 'draft' : (body.status || 'published');
  const draftStatus = isDraft ? 'new' : 'none';
  const now = Date.now();

  // Extract core columns, everything else goes to JSON data
  const { id: _i, slug: _s, title: _t, status: _st, draft: _dr, ...customData } = body;

  await db
    .insertInto('documents')
    .values({
      id,
      collection,
      slug,
      title,
      status,
      draft_status: draftStatus,
      draft_data: isDraft ? JSON.stringify(customData) : null,
      draft_updated_at: isDraft ? now : null,
      schema_version: 1,
      data: JSON.stringify(customData),
      created_at: now,
      updated_at: now,
    })
    .execute();

  // Sync / update the collection SQLite view with any new custom fields
  const customKeys = Object.keys(customData);
  if (customKeys.length > 0) {
    await syncCollectionView(db, collection, customKeys);
  }

  const user = await getAuthenticatedUser(c);
  await logActivity(db, {
    actor: user?.email || 'admin@localhost',
    action: 'create',
    collection,
    documentId: id,
    documentTitle: title,
    details: JSON.stringify({ slug, status, draftStatus }),
  });

  return c.json(
    {
      data: {
        id,
        collection,
        slug,
        title,
        status,
        draft_status: draftStatus,
        created_at: now,
        updated_at: now,
        ...customData,
      },
    },
    201
  );
});

// 4. Update Item (PATCH)
itemsRouter.patch('/:collection/:id', async (c) => {
  const collection = c.req.param('collection');
  const idOrSlug = c.req.param('id');
  const body = await c.req.json();
  const db = createDb(c.env.DB);

  const existing = await db
    .selectFrom('documents')
    .where('collection', '=', collection)
    .where((eb: any) => eb.or([eb('id', '=', idOrSlug), eb('slug', '=', idOrSlug)]))
    .selectAll()
    .executeTakeFirst();

  if (!existing) {
    return c.json({ error: `Item '${idOrSlug}' not found` }, 404);
  }

  let existingData = {};
  try {
    existingData = JSON.parse(existing.data || '{}');
  } catch {}

  const isWorkingCopyUpdate = body.draft === true || c.req.query('draft') === 'true';
  const now = Date.now();
  const { id: _i, slug: _s, title: _t, status: _st, draft: _dr, ...newCustomData } = body;

  const updatedSlug = body.slug || existing.slug;
  const updatedTitle = body.title || existing.title;

  if (isWorkingCopyUpdate) {
    // Update ONLY working copy (draft_data), preserving live published data
    let currentDraft = {};
    if (existing.draft_data) {
      try {
        currentDraft = JSON.parse(existing.draft_data);
      } catch {}
    } else {
      currentDraft = { ...existingData };
    }

    const mergedDraft = { ...currentDraft, ...newCustomData };
    const newDraftStatus = existing.status === 'draft' ? 'new' : 'modified';

    await db
      .updateTable('documents')
      .set({
        draft_data: JSON.stringify(mergedDraft),
        draft_updated_at: now,
        draft_status: newDraftStatus,
        updated_at: now,
      })
      .where('id', '=', existing.id)
      .execute();

    const user = await getAuthenticatedUser(c);
    await logActivity(db, {
      actor: user?.email || 'admin@localhost',
      action: 'update_draft',
      collection,
      documentId: existing.id,
      documentTitle: updatedTitle,
      details: JSON.stringify({ draft_status: newDraftStatus }),
    });

    return c.json({
      data: {
        id: existing.id,
        collection,
        slug: updatedSlug,
        title: updatedTitle,
        status: existing.status,
        draft_status: newDraftStatus,
        draft_updated_at: now,
        ...mergedDraft,
      },
    });
  }

  // Full / Live Update
  const mergedData = { ...existingData, ...newCustomData };
  const updatedStatus = body.status || existing.status;

  await db
    .updateTable('documents')
    .set({
      slug: updatedSlug,
      title: updatedTitle,
      status: updatedStatus,
      draft_data: null,
      draft_status: 'none',
      data: JSON.stringify(mergedData),
      updated_at: now,
    })
    .where('id', '=', existing.id)
    .execute();

  // Sync view if new keys were introduced
  await syncCollectionView(db, collection, Object.keys(mergedData));

  const user = await getAuthenticatedUser(c);
  await logActivity(db, {
    actor: user?.email || 'admin@localhost',
    action: 'update',
    collection,
    documentId: existing.id,
    documentTitle: updatedTitle,
    details: JSON.stringify({ slug: updatedSlug, status: updatedStatus }),
  });

  return c.json({
    data: {
      id: existing.id,
      collection,
      slug: updatedSlug,
      title: updatedTitle,
      status: updatedStatus,
      draft_status: 'none',
      created_at: existing.created_at,
      updated_at: now,
      ...mergedData,
    },
  });
});

// 5. Discard Working Copy Draft
itemsRouter.post('/:collection/:id/discard-draft', async (c) => {
  const collection = c.req.param('collection');
  const idOrSlug = c.req.param('id');
  const db = createDb(c.env.DB);

  const existing = await db
    .selectFrom('documents')
    .where('collection', '=', collection)
    .where((eb: any) => eb.or([eb('id', '=', idOrSlug), eb('slug', '=', idOrSlug)]))
    .selectAll()
    .executeTakeFirst();

  if (!existing) {
    return c.json({ error: `Item '${idOrSlug}' not found` }, 404);
  }

  const now = Date.now();
  await db
    .updateTable('documents')
    .set({
      draft_data: null,
      draft_status: 'none',
      draft_updated_at: null,
      updated_at: now,
    })
    .where('id', '=', existing.id)
    .execute();

  const user = await getAuthenticatedUser(c);
  await logActivity(db, {
    actor: user?.email || 'admin@localhost',
    action: 'discard_draft',
    collection,
    documentId: existing.id,
    documentTitle: existing.title,
    details: JSON.stringify({ message: 'Working draft copy discarded' }),
  });

  return c.json({
    success: true,
    message: `Working draft for '${existing.title || existing.slug}' discarded successfully`,
  });
});

// 6. Delete Item
itemsRouter.delete('/:collection/:id', async (c) => {
  const collection = c.req.param('collection');
  const idOrSlug = c.req.param('id');
  const db = createDb(c.env.DB);

  const existing = await db
    .selectFrom('documents')
    .where('collection', '=', collection)
    .where((eb: any) => eb.or([eb('id', '=', idOrSlug), eb('slug', '=', idOrSlug)]))
    .selectAll()
    .executeTakeFirst();

  await db
    .deleteFrom('documents')
    .where('collection', '=', collection)
    .where((eb: any) => eb.or([eb('id', '=', idOrSlug), eb('slug', '=', idOrSlug)]))
    .execute();

  if (existing) {
    const user = await getAuthenticatedUser(c);
    await logActivity(db, {
      actor: user?.email || 'admin@localhost',
      action: 'delete',
      collection,
      documentId: existing.id,
      documentTitle: existing.title || existing.slug,
      details: JSON.stringify({ slug: existing.slug }),
    });
  }

  return c.body(null, 204);
});

function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/--+/g, '-')
    .trim();
}
