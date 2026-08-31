import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { itemsRouter } from './api/items.js';
import { filesRouter } from './api/files.js';
import { adminRouter } from './admin/ui.js';
import { hydrateFromGit, exportToGitFormat } from './sync/git-sync.js';
import { createDb } from './db/client.js';
const app = new Hono();
// 1. CORS Middleware
app.use('*', async (c, next) => {
    const origin = c.env.ALLOWED_ORIGINS || '*';
    return cors({
        origin,
        allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
        exposeHeaders: ['Content-Length', 'X-SlottD-Version'],
        maxAge: 86400,
    })(c, next);
});
// 2. Health & Diagnostics
app.get('/', (c) => {
    return c.json({
        name: 'SlottD',
        version: '0.1.0',
        engine: 'cloudflare-d1',
        storage: 'cloudflare-r2',
        provider: 'directus-compatible',
        status: 'online',
    });
});
// 3. Directus Items REST API
app.route('/items', itemsRouter);
// 4. Cloudflare R2 Media API
app.route('/files', filesRouter);
// 5. Micro-Studio Admin UI (SlotWire deep-linkable)
app.route('/admin', adminRouter);
// 6. Bi-Directional Git Sync API
app.post('/api/sync/hydrate', async (c) => {
    const body = await c.req.json();
    const db = createDb(c.env.DB);
    const items = Array.isArray(body) ? body : body.items || [];
    const result = await hydrateFromGit(db, items);
    return c.json({ success: true, result });
});
app.get('/api/sync/export', async (c) => {
    const collection = c.req.query('collection');
    const db = createDb(c.env.DB);
    const items = await exportToGitFormat(db, collection);
    return c.json({ items });
});
export default app;
