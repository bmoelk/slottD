import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { itemsRouter } from './api/items.js';
import { filesRouter } from './api/files.js';
import { adminRouter } from './admin/ui.js';
import { hydrateFromGit, exportToGitFormat, serializeToFiles, publishReleaseToGitHub } from './sync/git-sync.js';
import { createDb } from './db/client.js';
import { slotwirePack } from './packs/slotwire.js';
import { blogPack } from './packs/blog.js';
import type { Env } from './types.js';

export * from './types.js';
export * from './packs/slotwire.js';
export * from './packs/blog.js';
export * from './api/views.js';
export * from './db/client.js';
export * from './sync/git-sync.js';

const app = new Hono<{ Bindings: Env }>();

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
    packs: [slotwirePack.name, blogPack.name],
  });
});

// 3. Directus Items REST API
app.route('/items', itemsRouter);

// 4. Cloudflare R2 Media API
app.route('/files', filesRouter);

// Public /media/:key handler for direct R2 asset serving
app.get('/media/:key', async (c) => {
  const key = c.req.param('key');
  const bucket = c.env.MEDIA;
  if (!bucket) return c.text('Media storage unavailable', 503);

  const object = await bucket.get(key);
  if (!object) return c.text('Media object not found', 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  if (!headers.has('Content-Type')) {
    if (key.endsWith('.jpg') || key.endsWith('.jpeg')) headers.set('Content-Type', 'image/jpeg');
    else if (key.endsWith('.png')) headers.set('Content-Type', 'image/png');
    else if (key.endsWith('.webp')) headers.set('Content-Type', 'image/webp');
    else if (key.endsWith('.svg')) headers.set('Content-Type', 'image/svg+xml');
  }

  return new Response(object.body, { headers });
});

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

// 7. Git Release & Promotion Trigger
app.post('/api/release/publish', async (c) => {
  const env = c.env;
  if (!env.GITHUB_TOKEN) {
    return c.json({ error: 'GITHUB_TOKEN secret not configured in Cloudflare Worker' }, 400);
  }

  const db = createDb(env.DB);
  const body = await c.req.json().catch(() => ({}));
  const repoOwner = body.repoOwner || 'bmoelk';
  const repoName = body.repoName || 'brainendeavor.com';
  const branch = body.branch || 'main';

  // 1. Export all current published documents
  const items = await exportToGitFormat(db);
  const files = serializeToFiles(items, 'content');

  // 2. Generate timestamp tag
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '.');
  const timeStr = now.toTimeString().slice(0, 5).replace(/:/g, '');
  const tagName = body.tag || `release-${dateStr}-${timeStr}`;

  // 3. Commit & Tag on GitHub
  const gitResult = await publishReleaseToGitHub({
    githubToken: env.GITHUB_TOKEN,
    repoOwner,
    repoName,
    branch,
    files,
    tagName,
    commitMessage: body.message || `Production Content Release: ${tagName}`,
  });

  // 4. Trigger Pages Deploy Hook if configured
  let deployHookResult: any = null;
  if (env.PRODUCTION_DEPLOY_HOOK_URL) {
    try {
      const res = await fetch(env.PRODUCTION_DEPLOY_HOOK_URL, { method: 'POST' });
      deployHookResult = { status: res.status, ok: res.ok };
    } catch (e: any) {
      deployHookResult = { error: e.message };
    }
  }

  return c.json({
    success: true,
    tag: tagName,
    commitSha: gitResult.commitSha,
    tagCreated: gitResult.tagCreated,
    deployHook: deployHookResult,
  });
});

export default {
  fetch: app.fetch,
  // Scheduled Cron Handler for Scheduled Releases
  async scheduled(event: any, env: Env, ctx: any) {
    const db = createDb(env.DB);
    const now = Date.now();

    // Find any scheduled documents due for publishing
    const scheduledDocs = await db
      .selectFrom('documents')
      .where('status', '=', 'scheduled')
      .where('publish_at', '<=', now)
      .selectAll()
      .execute();

    if (scheduledDocs.length > 0) {
      // Transition to published
      await db
        .updateTable('documents')
        .set({ status: 'published', updated_at: now })
        .where('status', '=', 'scheduled')
        .where('publish_at', '<=', now)
        .execute();

      // Trigger automatic Git snapshot & Pages deployment
      if (env.GITHUB_TOKEN && env.PRODUCTION_DEPLOY_HOOK_URL) {
        const items = await exportToGitFormat(db);
        const files = serializeToFiles(items, 'content');
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
        const timeStr = new Date().toTimeString().slice(0, 5).replace(/:/g, '');
        const tagName = `release-scheduled-${dateStr}-${timeStr}`;

        await publishReleaseToGitHub({
          githubToken: env.GITHUB_TOKEN,
          repoOwner: 'bmoelk',
          repoName: 'brainendeavor.com',
          branch: 'main',
          files,
          tagName,
          commitMessage: `Automated Scheduled Content Release: ${tagName}`,
        });

        await fetch(env.PRODUCTION_DEPLOY_HOOK_URL, { method: 'POST' });
      }
    }
  },
};

