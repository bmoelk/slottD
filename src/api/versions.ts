import { Hono } from 'hono';
import { createDb } from '../db/client.js';
import { requireWriteAuth, getAuthenticatedUser } from '../auth/guard.js';
import { logActivity } from '../db/audit.js';
import type { Env, DirectusVersionRow } from '../types.js';

export const versionsRouter = new Hono<{ Bindings: Env }>();

// All versions operations require authentication
versionsRouter.use('*', requireWriteAuth);

// 1. List versions
versionsRouter.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const collection = c.req.query('collection') || c.req.query('filter[collection][_eq]');
  const item = c.req.query('item') || c.req.query('filter[item][_eq]');
  const key = c.req.query('key') || c.req.query('filter[key][_eq]');

  let query = db.selectFrom('directus_versions').selectAll();

  if (collection) {
    query = query.where('collection', '=', collection);
  }
  if (item) {
    query = query.where('item', '=', item);
  }
  if (key) {
    query = query.where('key', '=', key);
  }

  const versions = await query.orderBy('date_updated', 'desc').execute();

  const formatted = versions.map((v: any) => {
    let parsedDelta = {};
    try {
      parsedDelta = JSON.parse(v.delta || '{}');
    } catch {}
    return {
      ...v,
      delta: parsedDelta,
    };
  });

  return c.json({
    data: formatted,
    meta: { filter_count: formatted.length },
  });
});

// 2. Read single version
versionsRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  const db = createDb(c.env.DB);

  const version = await db
    .selectFrom('directus_versions')
    .where('id', '=', id)
    .selectAll()
    .executeTakeFirst();

  if (!version) {
    return c.json({ error: `Version '${id}' not found` }, 404);
  }

  let parsedDelta = {};
  try {
    parsedDelta = JSON.parse(version.delta || '{}');
  } catch {}

  return c.json({
    data: {
      ...version,
      delta: parsedDelta,
    },
  });
});

// 3. Create version
versionsRouter.post('/', async (c) => {
  const body = await c.req.json();
  const db = createDb(c.env.DB);
  const user = await getAuthenticatedUser(c);

  const { collection, item, key, name, delta } = body;

  if (!collection || !item || !key) {
    return c.json(
      { error: 'Bad Request', message: 'Fields collection, item, and key are required' },
      400
    );
  }

  const id = body.id || crypto.randomUUID();
  const now = Date.now();
  const deltaStr = typeof delta === 'string' ? delta : JSON.stringify(delta || {});

  await db
    .insertInto('directus_versions')
    .values({
      id,
      key,
      name: name || key,
      collection,
      item,
      delta: deltaStr,
      date_created: now,
      date_updated: now,
      user_created: user?.email || 'admin@edge',
      user_updated: user?.email || 'admin@edge',
    })
    .execute();

  await logActivity(db, {
    actor: user?.email || 'admin@edge',
    action: 'version_create',
    collection,
    documentId: item,
    documentTitle: name || key,
    details: JSON.stringify({ versionId: id, key }),
  });

  return c.json(
    {
      data: {
        id,
        key,
        name: name || key,
        collection,
        item,
        delta: typeof delta === 'object' ? delta : JSON.parse(deltaStr),
        date_created: now,
        date_updated: now,
        user_created: user?.email || 'admin@edge',
        user_updated: user?.email || 'admin@edge',
      },
    },
    201
  );
});

// 4. Promote version atomically into live item
versionsRouter.post('/:id/promote', async (c) => {
  const id = c.req.param('id');
  const db = createDb(c.env.DB);
  const user = await getAuthenticatedUser(c);

  const version = await db
    .selectFrom('directus_versions')
    .where('id', '=', id)
    .selectAll()
    .executeTakeFirst();

  if (!version) {
    return c.json({ error: `Version '${id}' not found` }, 404);
  }

  const liveDoc = await db
    .selectFrom('documents')
    .where('collection', '=', version.collection)
    .where('id', '=', version.item)
    .selectAll()
    .executeTakeFirst();

  if (!liveDoc) {
    return c.json(
      { error: `Target item '${version.item}' in collection '${version.collection}' not found` },
      404
    );
  }

  let liveData = {};
  try {
    liveData = JSON.parse(liveDoc.data || '{}');
  } catch {}

  let versionDelta = {};
  try {
    versionDelta = JSON.parse(version.delta || '{}');
  } catch {}

  const mergedData = { ...liveData, ...versionDelta };
  const now = Date.now();

  // Atomically update live document
  await db
    .updateTable('documents')
    .set({
      data: JSON.stringify(mergedData),
      status: 'published',
      draft_data: null,
      draft_status: 'none',
      updated_at: now,
    })
    .where('id', '=', liveDoc.id)
    .execute();

  // Remove or archive the promoted version
  await db.deleteFrom('directus_versions').where('id', '=', id).execute();

  await logActivity(db, {
    actor: user?.email || 'admin@edge',
    action: 'version_promote',
    collection: version.collection,
    documentId: liveDoc.id,
    documentTitle: liveDoc.title,
    details: JSON.stringify({ versionId: id, versionKey: version.key }),
  });

  return c.json({
    success: true,
    message: `Version '${version.key}' promoted into '${version.collection}/${liveDoc.slug}'`,
    data: {
      id: liveDoc.id,
      collection: liveDoc.collection,
      slug: liveDoc.slug,
      title: liveDoc.title,
      status: 'published',
      ...mergedData,
    },
  });
});

// 5. Delete version
versionsRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const db = createDb(c.env.DB);

  await db.deleteFrom('directus_versions').where('id', '=', id).execute();
  return c.body(null, 204);
});
