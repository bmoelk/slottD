import { Hono } from 'hono';
import { createDb } from '../db/client.js';
import { compileDirectusQuery, parseQueryParams } from './query-compiler.js';
import { syncCollectionView } from './views.js';
export const itemsRouter = new Hono();
// 1. Query items in collection (Directus AST Compatible)
itemsRouter.get('/:collection', async (c) => {
    const collection = c.req.param('collection');
    const db = createDb(c.env.DB);
    const url = new URL(c.req.url);
    const params = parseQueryParams(url);
    try {
        // Query directly from collection's SQLite view or documents fallback
        let query = db.selectFrom(collection);
        query = compileDirectusQuery(query, params);
        const data = await query.execute();
        // Directus standard response format
        return c.json({
            data,
            meta: {
                filter_count: data.length,
            },
        });
    }
    catch (err) {
        // If view does not exist yet, fallback to querying documents table directly
        if (err?.message?.includes('no such table') || err?.message?.includes('no such view')) {
            let query = db
                .selectFrom('documents')
                .where('collection', '=', collection)
                .selectAll();
            if (params.filter?.status) {
                query = query.where('status', '=', params.filter.status._eq || params.filter.status);
            }
            const rows = await query.execute();
            const formatted = rows.map((r) => {
                let parsedData = {};
                try {
                    parsedData = JSON.parse(r.data);
                }
                catch { }
                return {
                    id: r.id,
                    collection: r.collection,
                    slug: r.slug,
                    title: r.title,
                    status: r.status,
                    created_at: r.created_at,
                    updated_at: r.updated_at,
                    ...parsedData,
                };
            });
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
    try {
        const item = await db
            .selectFrom(collection)
            .where((eb) => eb.or([eb('id', '=', idOrSlug), eb('slug', '=', idOrSlug)]))
            .selectAll()
            .executeTakeFirst();
        if (!item) {
            return c.json({ error: `Item '${idOrSlug}' not found in '${collection}'` }, 404);
        }
        return c.json({ data: item });
    }
    catch (err) {
        // Fallback to documents table
        const row = await db
            .selectFrom('documents')
            .where('collection', '=', collection)
            .where((eb) => eb.or([eb('id', '=', idOrSlug), eb('slug', '=', idOrSlug)]))
            .selectAll()
            .executeTakeFirst();
        if (!row) {
            return c.json({ error: `Item '${idOrSlug}' not found in '${collection}'` }, 404);
        }
        let parsedData = {};
        try {
            parsedData = JSON.parse(row.data);
        }
        catch { }
        return c.json({
            data: {
                id: row.id,
                collection: row.collection,
                slug: row.slug,
                title: row.title,
                status: row.status,
                created_at: row.created_at,
                updated_at: row.updated_at,
                ...parsedData,
            },
        });
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
    const status = body.status || 'draft';
    const now = Date.now();
    // Extract core columns, everything else goes to JSON data
    const { id: _i, slug: _s, title: _t, status: _st, ...customData } = body;
    await db
        .insertInto('documents')
        .values({
        id,
        collection,
        slug,
        title,
        status,
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
    return c.json({
        data: {
            id,
            collection,
            slug,
            title,
            status,
            created_at: now,
            updated_at: now,
            ...customData,
        },
    }, 201);
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
        .where((eb) => eb.or([eb('id', '=', idOrSlug), eb('slug', '=', idOrSlug)]))
        .selectAll()
        .executeTakeFirst();
    if (!existing) {
        return c.json({ error: `Item '${idOrSlug}' not found` }, 404);
    }
    let existingData = {};
    try {
        existingData = JSON.parse(existing.data);
    }
    catch { }
    const { id: _i, slug: _s, title: _t, status: _st, ...newCustomData } = body;
    const mergedData = { ...existingData, ...newCustomData };
    const updatedSlug = body.slug || existing.slug;
    const updatedTitle = body.title || existing.title;
    const updatedStatus = body.status || existing.status;
    const now = Date.now();
    await db
        .updateTable('documents')
        .set({
        slug: updatedSlug,
        title: updatedTitle,
        status: updatedStatus,
        data: JSON.stringify(mergedData),
        updated_at: now,
    })
        .where('id', '=', existing.id)
        .execute();
    // Sync view if new keys were introduced
    await syncCollectionView(db, collection, Object.keys(mergedData));
    return c.json({
        data: {
            id: existing.id,
            collection,
            slug: updatedSlug,
            title: updatedTitle,
            status: updatedStatus,
            created_at: existing.created_at,
            updated_at: now,
            ...mergedData,
        },
    });
});
// 5. Delete Item
itemsRouter.delete('/:collection/:id', async (c) => {
    const collection = c.req.param('collection');
    const idOrSlug = c.req.param('id');
    const db = createDb(c.env.DB);
    await db
        .deleteFrom('documents')
        .where('collection', '=', collection)
        .where((eb) => eb.or([eb('id', '=', idOrSlug), eb('slug', '=', idOrSlug)]))
        .execute();
    return c.body(null, 204);
});
function generateSlug(text) {
    return text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/--+/g, '-')
        .trim();
}
