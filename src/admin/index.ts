import { Hono } from 'hono';
import { createDb } from '../db/client.js';
import { introspectCollectionFields } from '../api/views.js';
import { getAuthenticatedUser } from '../auth/guard.js';
import { renderDashboardView } from './views/dashboard.js';
import { renderTableView } from './views/table.js';
import { renderEditorView } from './views/editor.js';
import { renderModelsView } from './views/models.js';
import { renderMediaView } from './views/media.js';
import type { Env } from '../types.js';

export const adminRouter = new Hono<{ Bindings: Env }>();

// ── 1. Content Index Redirects ───────────────────────────────────────────────
adminRouter.get('/content', (c) => c.redirect('/admin'));

// ── 2. Universal In-Situ Deep Link Editor (/admin/edit/:idOrSlug) ─────────────
adminRouter.get('/edit/:idOrSlug', async (c) => {
  const idOrSlug = c.req.param('idOrSlug');
  const queryCol = c.req.query('collection');
  const isNew = idOrSlug === '+' || idOrSlug === 'new';
  const db = createDb(c.env.DB);
  const user = getAuthenticatedUser(c) || { email: 'dev@localhost', authMethod: 'local-dev' };

  let targetCollection = queryCol || '';
  let doc: any = null;

  if (!isNew) {
    if (targetCollection) {
      doc = await db
        .selectFrom('documents')
        .where('collection', '=', targetCollection)
        .where((eb) => eb.or([eb('id', '=', idOrSlug), eb('slug', '=', idOrSlug)]))
        .selectAll()
        .executeTakeFirst();
    }

    if (!doc) {
      doc = await db
        .selectFrom('documents')
        .where((eb) => eb.or([eb('id', '=', idOrSlug), eb('slug', '=', idOrSlug)]))
        .selectAll()
        .executeTakeFirst();
      
      if (doc) {
        targetCollection = doc.collection;
      }
    }
  }

  if (!doc) {
    targetCollection = targetCollection || 'page_sections';
    const docId = isNew ? crypto.randomUUID() : idOrSlug;
    const docSlug = isNew ? (c.req.query('slug') || '') : idOrSlug;

    const queryEntries = Object.fromEntries(new URL(c.req.url).searchParams.entries());
    const { collection: _c, slug: _s, ...restParams } = queryEntries;

    doc = {
      id: docId,
      collection: targetCollection,
      slug: docSlug || (queryEntries.slug || ''),
      title: queryEntries.title || '',
      status: queryEntries.status || 'draft',
      data: JSON.stringify(restParams),
    };
  }

  const fields = await introspectCollectionFields(db, targetCollection);
  return c.html(renderEditorView(targetCollection, doc, fields, isNew || !doc.created_at, user));
});

// ── 3. Content Dashboard (/admin) ───────────────────────────────────────────
adminRouter.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const user = getAuthenticatedUser(c) || { email: 'dev@localhost', authMethod: 'local-dev' };
  let collectionsList: { name: string; display_name?: string; description?: string; icon?: string | null; pack_name?: string; pack_author?: string | null; count?: number }[] = [];

  try {
    const metas = await db.selectFrom('collections').selectAll().execute();
    if (metas.length > 0) {
      collectionsList = metas.map((m) => ({
        name: m.name,
        display_name: m.display_name,
        description: m.description,
        icon: m.icon,
        pack_name: m.pack_name,
        pack_author: m.pack_author,
      }));
    }
  } catch {}

  if (collectionsList.length === 0) {
    const collectionsResult = await db
      .selectFrom('documents')
      .select('collection')
      .distinct()
      .execute();
    collectionsList = collectionsResult.map((r) => ({ name: r.collection, display_name: r.collection }));
  }

  for (const col of collectionsList) {
    try {
      const res = await db.selectFrom('documents').where('collection', '=', col.name).select('id').execute();
      col.count = res.length;
    } catch {
      col.count = 0;
    }
  }

  collectionsList.sort((a, b) => (a.display_name || a.name).localeCompare(b.display_name || b.name));
  const packs = Array.from(new Set(collectionsList.map((c) => c.pack_name || 'custom'))).sort();

  return c.html(renderDashboardView(collectionsList, packs, user));
});

// ── 4. Collection Items Table View (/admin/content/:collection) ─────────────
adminRouter.get('/content/:collection', async (c) => {
  const collection = c.req.param('collection');
  const db = createDb(c.env.DB);
  const user = getAuthenticatedUser(c) || { email: 'dev@localhost', authMethod: 'local-dev' };

  const items = await db
    .selectFrom('documents')
    .where('collection', '=', collection)
    .selectAll()
    .orderBy('updated_at', 'desc')
    .execute();

  return c.html(renderTableView(collection, items, user));
});

// ── 5. Content Editor by Collection & ID (/admin/content/:collection/:id) ─────
adminRouter.get('/content/:collection/:id', async (c) => {
  const collection = c.req.param('collection');
  const idOrSlug = c.req.param('id');
  const isNew = idOrSlug === '+' || idOrSlug === 'new';
  const db = createDb(c.env.DB);
  const user = getAuthenticatedUser(c) || { email: 'dev@localhost', authMethod: 'local-dev' };

  let doc: any = {
    id: isNew ? crypto.randomUUID() : '',
    collection,
    slug: '',
    title: '',
    status: 'draft',
    data: '{}',
  };

  if (!isNew) {
    const existing = await db
      .selectFrom('documents')
      .where('collection', '=', collection)
      .where((eb) => eb.or([eb('id', '=', idOrSlug), eb('slug', '=', idOrSlug)]))
      .selectAll()
      .executeTakeFirst();

    if (existing) {
      doc = existing;
    }
  }

  if (isNew) {
    const queryEntries = Object.fromEntries(new URL(c.req.url).searchParams.entries());
    doc.slug = queryEntries.slug || doc.slug;
    doc.title = queryEntries.title || doc.title;
    doc.status = queryEntries.status || doc.status;
    const { collection: _c, slug: _s, title: _t, status: _st, ...restParams } = queryEntries;
    if (Object.keys(restParams).length > 0) {
      doc.data = JSON.stringify(restParams);
    }
  }

  const fields = await introspectCollectionFields(db, collection);
  return c.html(renderEditorView(collection, doc, fields, isNew, user));
});

// ── 6. Shorthand Route Fallbacks (/admin/:collection/:id) ────────────────────
adminRouter.get('/:collection/:id', async (c) => {
  const collection = c.req.param('collection');
  const idOrSlug = c.req.param('id');

  if (['models', 'media', 'edit', 'content'].includes(collection)) {
    return c.notFound();
  }

  const isNew = idOrSlug === '+' || idOrSlug === 'new';
  const db = createDb(c.env.DB);
  const user = getAuthenticatedUser(c) || { email: 'dev@localhost', authMethod: 'local-dev' };

  let doc: any = {
    id: isNew ? crypto.randomUUID() : '',
    collection,
    slug: '',
    title: '',
    status: 'draft',
    data: '{}',
  };

  if (!isNew) {
    const existing = await db
      .selectFrom('documents')
      .where('collection', '=', collection)
      .where((eb) => eb.or([eb('id', '=', idOrSlug), eb('slug', '=', idOrSlug)]))
      .selectAll()
      .executeTakeFirst();

    if (existing) {
      doc = existing;
    }
  }

  if (isNew) {
    const queryEntries = Object.fromEntries(new URL(c.req.url).searchParams.entries());
    doc.slug = queryEntries.slug || doc.slug;
    doc.title = queryEntries.title || doc.title;
    doc.status = queryEntries.status || doc.status;
    const { collection: _c, slug: _s, title: _t, status: _st, ...restParams } = queryEntries;
    if (Object.keys(restParams).length > 0) {
      doc.data = JSON.stringify(restParams);
    }
  }

  const fields = await introspectCollectionFields(db, collection);
  return c.html(renderEditorView(collection, doc, fields, isNew, user));
});

// ── 7. Models & Schema Overview (/admin/models) ──────────────────────────────
adminRouter.get('/models', async (c) => {
  const db = createDb(c.env.DB);
  const user = getAuthenticatedUser(c) || { email: 'dev@localhost', authMethod: 'local-dev' };

  let collections: any[] = [];
  try {
    collections = await db.selectFrom('collections').selectAll().execute();
  } catch {}

  const modelsWithFields = await Promise.all(
    collections.map(async (col) => {
      const fields = await introspectCollectionFields(db, col.name);
      return {
        ...col,
        fields,
      };
    })
  );

  return c.html(renderModelsView(modelsWithFields, user));
});

// ── 8. Descriptive R2 Media Library (/admin/media) ───────────────────────────
adminRouter.get('/media', async (c) => {
  const db = createDb(c.env.DB);
  const user = getAuthenticatedUser(c) || { email: 'dev@localhost', authMethod: 'local-dev' };

  let mediaFiles: any[] = [];
  try {
    mediaFiles = await db.selectFrom('media').selectAll().orderBy('created_at', 'desc').execute();
  } catch {}

  return c.html(renderMediaView(mediaFiles, user));
});
