import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { itemsRouter } from './api/items.js';
import { filesRouter } from './api/files.js';
import { versionsRouter } from './api/versions.js';
import { adminRouter } from './admin/ui.js';
import { hydrateFromGit, exportToGitFormat, serializeToFiles, publishReleaseToGitHub } from './sync/git-sync.js';
import { createDb } from './db/client.js';
import { slotwirePack } from './packs/slotwire.js';
import { blogPack } from './packs/blog.js';
import { requireWriteAuth, requireStudioAuth, getAuthenticatedUser, createBriefcaseSessionCookie } from './auth/guard.js';
import { ALPINE_VENDOR_JS } from './admin/vendor/alpine.js';
import { MARKDOWN_TOOLBAR_VENDOR_JS } from './admin/vendor/markdown-toolbar.js';
import { PELL_VENDOR_JS } from './admin/vendor/pell.js';
import { MARKED_VENDOR_JS } from './admin/vendor/marked.js';
import type { Env, SlottdConfig, PublishHookContext } from './types.js';

export * from './types.js';
export * from './packs/slotwire.js';
export * from './packs/blog.js';
export * from './api/views.js';
export * from './api/versions.js';
export * from './db/client.js';
export * from './sync/git-sync.js';
export * from './auth/guard.js';
export * from './checks/index.js';

export * from './config.js';
export * from './hooks/index.js';
import { getSlottdConfig, setDefaultPacks } from './config.js';

setDefaultPacks([slotwirePack, blogPack]);

const app = new Hono<{ Bindings: Env }>();

// Live Telemetry Tracker
let totalTelemetryRequests = 0;
let totalTelemetryLatencyMs = 0;

interface BurstTracker {
  count: number;
  totalDurationMs: number;
  startTime: number;
  timer: any;
  endpoints: string[];
}

let activeBurst: BurstTracker | null = null;
let lastCompletedBurst: { count: number; durationMs: number; avgMs: number; endpoints: string[] } | null = null;

function recordRequestTelemetry(path: string, durationMs: number) {
  totalTelemetryRequests += 1;
  totalTelemetryLatencyMs += durationMs;

  const now = performance.now();
  if (!activeBurst) {
    activeBurst = {
      count: 1,
      totalDurationMs: durationMs,
      startTime: now,
      timer: null,
      endpoints: [path],
    };
  } else {
    activeBurst.count += 1;
    activeBurst.totalDurationMs += durationMs;
    if (activeBurst.endpoints.length < 10) {
      activeBurst.endpoints.push(path);
    }
  }

  if (activeBurst.timer) {
    clearTimeout(activeBurst.timer);
  }

  activeBurst.timer = setTimeout(() => {
    if (activeBurst && activeBurst.count > 1) {
      const elapsed = Number((performance.now() - activeBurst.startTime).toFixed(1));
      const avg = Number((activeBurst.totalDurationMs / activeBurst.count).toFixed(1));
      lastCompletedBurst = {
        count: activeBurst.count,
        durationMs: elapsed,
        avgMs: avg,
        endpoints: [...activeBurst.endpoints],
      };
      console.log(`📊 [SlottD Telemetry] Page burst: ${activeBurst.count} queries in ${elapsed}ms (avg ${avg}ms/query)`);
    }
    activeBurst = null;
  }, 250);
}

// Canonical Host Redirect: slottd-cms.brainendeavor.com -> cms.brainendeavor.com
app.use('*', async (c, next) => {
  const host = c.req.header('host') || '';
  if (host === 'slottd-cms.brainendeavor.com') {
    const url = new URL(c.req.url);
    url.hostname = 'cms.brainendeavor.com';
    return c.redirect(url.toString(), 301);
  }
  await next();
});

// 1. Telemetry & Performance Timing Middleware
app.use('*', async (c, next) => {
  const t0 = performance.now();
  await next();
  const elapsedRaw = performance.now() - t0;
  const duration = elapsedRaw.toFixed(1);
  const status = c.res.status;
  const method = c.req.method;
  const path = c.req.path;
  
  // Set response telemetry header
  c.res.headers.set('Server-Timing', `slottd;dur=${duration}`);
  c.res.headers.set('X-Response-Time', `${duration}ms`);

  // Log non-asset requests to console for Briefcase / developer inspection
  if (!path.startsWith('/assets') && path !== '/' && !path.startsWith('/favicon')) {
    console.log(`⚡ [SlottD] ${method} ${path} -> ${status} (${duration}ms)`);
    recordRequestTelemetry(path, elapsedRaw);
  }
});

// 2. CORS Middleware
app.use('*', async (c, next) => {
  const origin = c.env?.ALLOWED_ORIGINS || '*';
  return cors({
    origin,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-API-Key'],
    exposeHeaders: ['Content-Length', 'X-SlottD-Version', 'Server-Timing', 'X-Response-Time'],
    maxAge: 86400,
  })(c, next);
});

// 2. Health & Diagnostics
app.get('/', (c) => {
  return c.json({
    name: 'SlottD',
    version: '0.2.0',
    engine: 'cloudflare-d1',
    storage: 'cloudflare-r2',
    provider: 'directus-compatible',
    status: 'online',
    packs: [slotwirePack.name, blogPack.name],
  });
});

// 3. Directus AST REST Routes
app.route('/items', itemsRouter);
app.route('/files', filesRouter);
app.route('/versions', versionsRouter);

// Directus-Compliant Audit & Activity Log
app.get('/activity', requireWriteAuth, async (c) => {
  const db = createDb(c.env.DB);
  const limit = Number(c.req.query('limit')) || 50;
  const logs = await db
    .selectFrom('activity_log')
    .selectAll()
    .orderBy('timestamp', 'desc')
    .limit(limit)
    .execute();

  return c.json({
    data: logs,
    meta: { filter_count: logs.length },
  });
});

app.get('/revisions', requireWriteAuth, async (c) => {
  const db = createDb(c.env.DB);
  const limit = Number(c.req.query('limit')) || 50;
  const revisions = await db
    .selectFrom('activity_log')
    .where('action', 'in', ['create', 'update', 'update_draft', 'delete', 'version_promote'])
    .selectAll()
    .orderBy('timestamp', 'desc')
    .limit(limit)
    .execute();

  return c.json({
    data: revisions,
    meta: { filter_count: revisions.length },
  });
});

// 4. Public /media/:key handler for direct R2 asset serving
app.get('/media/:key', async (c) => {
  const key = c.req.param('key');
  const bucket = c.env.MEDIA;
  let object = bucket ? await bucket.get(key) : null;

  if (!object) {
    const remoteUrl = c.env.REMOTE_MEDIA_URL || 'https://cms.brainendeavor.com/media';
    try {
      const res = await fetch(`${remoteUrl}/${encodeURIComponent(key)}`);
      if (res.ok) {
        const body = await res.arrayBuffer();
        if (bucket) {
          c.executionCtx?.waitUntil?.(
            bucket.put(key, body, {
              httpMetadata: { contentType: res.headers.get('content-type') || 'image/jpeg' },
            }).catch(() => {})
          );
        }
        const headers = new Headers(res.headers);
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        return new Response(body, { headers });
      }
    } catch {}
    return c.text('Media object not found', 404);
  }

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

// 5. Micro-Studio Vendor Assets (Public, Unauthenticated)
app.get('/admin/vendor/alpine.js', (c) => {
  return new Response(ALPINE_VENDOR_JS, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});

app.get('/admin/vendor/markdown-toolbar.js', (c) => {
  return new Response(MARKDOWN_TOOLBAR_VENDOR_JS, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});

app.get('/admin/vendor/pell.js', (c) => {
  return new Response(PELL_VENDOR_JS, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});

app.get('/admin/vendor/marked.js', (c) => {
  return new Response(MARKED_VENDOR_JS, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});

// 6. Micro-Studio Admin UI (SlotWire deep-linkable)
app.use('/admin/*', requireStudioAuth);
app.route('/admin', adminRouter);
app.get('/docs/user', (c) => c.redirect('/admin/docs'));

const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#1e293b"/><path d="M 160 128 H 210 V 384 H 160 Z" fill="#FFD043"/><path d="M 218 128 H 304 C 364 128 408 172 408 232 H 344 C 344 198 320 184 296 184 H 218 Z" fill="#FF8A00"/><path d="M 218 328 H 296 C 320 328 344 314 344 280 H 408 C 408 340 364 384 304 384 H 218 Z" fill="#FFD043"/><rect x="200" y="244" width="112" height="24" rx="4" fill="#FFE082"/></svg>`;
app.get('/favicon.ico', (c) => {
  return new Response(faviconSvg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400',
    },
  });
});

// ── SlottD Extended Engine (/ext/*) ──────────────────────────────────────────

/**
 * Release Publisher Handler with Standardized Lifecycle Hooks.
 */
async function handlePublishRelease(c: any) {
  const env = c.env;
  const db = createDb(env.DB);
  const body = await c.req.json().catch(() => ({}));
  const user = await getAuthenticatedUser(c);

  const repoOwner = body.repoOwner || 'bmoelk';
  const repoName = body.repoName || 'brainendeavor.com';
  const branch = body.branch || 'main';
  const bundleSlug = body.bundleSlug || body.bundle;
  const forcePublish = Boolean(body.forcePublish);
  const now = Date.now();

  // 1. Gather all working drafts / changed items
  let changedQuery = db
    .selectFrom('documents')
    .where('draft_status', 'in', ['modified', 'new'])
    .selectAll();

  const changedDocs = await changedQuery.execute();

  const changedItems = changedDocs.map((doc: any) => {
    let baseData = {};
    let draftData = {};
    try { baseData = JSON.parse(doc.data || '{}'); } catch {}
    try { draftData = JSON.parse(doc.draft_data || '{}'); } catch {}

    const delta: Record<string, any> = {};
    const modifiedFields: string[] = [];

    for (const [k, v] of Object.entries(draftData)) {
      if (JSON.stringify(v) !== JSON.stringify((baseData as any)[k])) {
        delta[k] = v;
        modifiedFields.push(k);
      }
    }

    return {
      collection: doc.collection,
      slug: doc.slug,
      status: doc.draft_status as 'new' | 'modified',
      modifiedFields,
      delta: Object.keys(delta).length > 0 ? delta : draftData,
    };
  });

  const allItems = await exportToGitFormat(db);

  // 2. Build PublishHookContext
  const hookCtx: PublishHookContext = {
    bundle: bundleSlug ? { id: `bundle-${bundleSlug}`, slug: bundleSlug, name: bundleSlug } : undefined,
    items: allItems,
    changedItems,
    actor: { email: user?.email || 'admin@edge', authMethod: user?.authMethod || 'unknown' },
    forcePublish,
    timestamp: now,
    env: c.env,
    db,
  };

  // 3. Execute onBeforePublish Hook
  let auditReport: any = null;
  const appConfig = getSlottdConfig();
  if (appConfig?.hooks?.onBeforePublish) {
    const hookResult = await appConfig.hooks.onBeforePublish(hookCtx);

    if (hookResult.status === 'error' && !forcePublish) {
      return c.json(
        {
          error: 'Pre-publish verification failed',
          message: hookResult.message,
          report: hookResult.data,
        },
        422
      );
    }

    auditReport = {
      timestamp: new Date(now).toISOString(),
      actor: hookCtx.actor,
      bundle: hookCtx.bundle,
      status: hookResult.status,
      message: hookResult.message,
      data: hookResult.data,
    };
  }

  // 4. Promote working copies in D1
  for (const doc of changedDocs) {
    let baseData = {};
    let draftData = {};
    try { baseData = JSON.parse(doc.data || '{}'); } catch {}
    try { draftData = JSON.parse(doc.draft_data || '{}'); } catch {}
    const promotedData = { ...baseData, ...draftData };

    await db
      .updateTable('documents')
      .set({
        data: JSON.stringify(promotedData),
        draft_data: null,
        draft_status: 'none',
        status: 'published',
        updated_at: now,
      })
      .where('id', '=', doc.id)
      .execute();
  }

  // 5. Serialize documents for Git release
  const updatedItems = await exportToGitFormat(db);
  const files = serializeToFiles(updatedItems, 'content');

  // Embed verification report in content/.audit/
  if (auditReport) {
    files.push({
      path: 'content/.audit/verification-report.json',
      content: JSON.stringify(auditReport, null, 2),
    });
  }

  // 6. Generate Release Tag & Commit to GitHub (if token configured)
  const dateStr = new Date(now).toISOString().slice(0, 10).replace(/-/g, '.');
  const timeStr = new Date(now).toTimeString().slice(0, 5).replace(/:/g, '');
  const tagName = body.tag || `release-${dateStr}-${timeStr}`;

  let gitResult: any = { commitSha: 'local', tagCreated: false };
  if (env.GITHUB_TOKEN) {
    gitResult = await publishReleaseToGitHub({
      githubToken: env.GITHUB_TOKEN,
      repoOwner,
      repoName,
      branch,
      files,
      tagName,
      commitMessage: body.message || `Production Content Release: ${tagName}`,
    });
  }

  // 7. Trigger Production Deploy Hook if configured
  let deployHookResult: any = null;
  if (env.PRODUCTION_DEPLOY_HOOK_URL) {
    try {
      const res = await fetch(env.PRODUCTION_DEPLOY_HOOK_URL, { method: 'POST' });
      deployHookResult = { status: res.status, ok: res.ok };
    } catch (e: any) {
      deployHookResult = { error: e.message };
    }
  }

  // 8. Execute onAfterPublish Hook
  hookCtx.commitSha = gitResult.commitSha;
  if (appConfig?.hooks?.onAfterPublish) {
    try {
      await appConfig.hooks.onAfterPublish(hookCtx);
    } catch (afterErr: any) {
      console.warn('[SlottD] onAfterPublish hook error:', afterErr.message);
    }
  }

  return c.json({
    success: true,
    tag: tagName,
    commitSha: gitResult.commitSha,
    tagCreated: gitResult.tagCreated,
    promotedCount: changedDocs.length,
    deployHook: deployHookResult,
    auditReport,
  });
}

// SlottD Extension Endpoints (/ext/*)
app.get('/ext/auth/me', async (c) => {
  const user = await getAuthenticatedUser(c);
  if (!user) {
    return c.json({ authenticated: false, error: 'Unauthenticated' }, 401);
  }
  return c.json({
    authenticated: true,
    user: {
      email: user.email,
      name: user.name || user.email.split('@')[0],
      authMethod: user.authMethod,
    },
  });
});

app.get('/ext/auth/handshake', async (c) => {
  const user = await getAuthenticatedUser(c);
  const targetOrigin = (c.req.query('origin') || '*').trim();
  const safeOrigin =
    targetOrigin.startsWith('http://localhost') ||
    targetOrigin.startsWith('http://127.0.0.1') ||
    targetOrigin.startsWith('https://')
      ? targetOrigin
      : '*';

  if (!user) {
    return c.redirect(`/admin/login?slotwire_auth=1&origin=${encodeURIComponent(targetOrigin)}`);
  }

  const secret = c.env.JWT_SECRET || 'briefcase-local-secret';
  const sessionToken = await createBriefcaseSessionCookie(user.email, secret);

  return c.html(`<!DOCTYPE html>
<html>
<head><title>SlottD Authentication Successful</title></head>
<body style="background:#090d16;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
  <div style="text-align:center;padding:24px;">
    <h2 style="color:#10b981;margin-bottom:8px;">✓ Authenticated</h2>
    <p style="color:#94a3b8;font-size:14px;">Connecting to SlotWire...</p>
  </div>
  <script>
    if (window.opener) {
      window.opener.postMessage({
        type: 'slotwire:auth_success',
        token: '${sessionToken}',
        email: '${user.email}',
        name: '${user.name || user.email}',
        provider: 'slottd'
      }, '${safeOrigin}');
      setTimeout(function() { window.close(); }, 300);
    } else {
      window.location.href = '/admin/home';
    }
  </script>
</body>
</html>`);
});

app.post('/ext/release/publish', requireWriteAuth, handlePublishRelease);

app.post('/ext/sync/hydrate', requireWriteAuth, async (c) => {
  const body = await c.req.json();
  const db = createDb(c.env.DB);
  const items = Array.isArray(body) ? body : body.items || [];
  const result = await hydrateFromGit(db, items);
  return c.json({ success: true, result });
});

app.get('/ext/sync/export', async (c) => {
  const collection = c.req.query('collection');
  const db = createDb(c.env.DB);
  const items = await exportToGitFormat(db, collection);
  return c.json({ items });
});

app.get('/ext/briefcase/status', requireWriteAuth, async (c) => {
  const db = createDb(c.env.DB);
  const dirtyDrafts = await db
    .selectFrom('documents')
    .where('draft_status', 'in', ['modified', 'new'])
    .select(['id', 'collection', 'slug', 'title', 'draft_status'])
    .execute();

  const totalDocs = await db.selectFrom('documents').select(db.fn.count('id').as('count')).executeTakeFirst();
  const totalVersions = await db.selectFrom('directus_versions').select(db.fn.count('id').as('count')).executeTakeFirst();

  return c.json({
    offline: false,
    dirtyDraftCount: dirtyDrafts.length,
    dirtyDrafts,
    totalDocuments: Number((totalDocs as any)?.count || 0),
    totalVersions: Number((totalVersions as any)?.count || 0),
    telemetry: {
      totalRequests: totalTelemetryRequests,
      averageLatencyMs: totalTelemetryRequests > 0 ? Number((totalTelemetryLatencyMs / totalTelemetryRequests).toFixed(2)) : 0,
      lastBurst: lastCompletedBurst,
    },
  });
});

interface PageBoundaryPayload {
  route: string;
  slotCount: number;
  slots: string[];
  populatedCount: number;
  missingCount: number;
  renderMs: number;
  cmsQueriesCount?: number;
  cmsDurationMs?: number;
}

let lastPageBoundary: PageBoundaryPayload | null = null;

app.post('/ext/telemetry/page-boundary', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as PageBoundaryPayload;
  const route = body.route || '/';
  const slotCount = body.slotCount || 0;
  const renderMs = body.renderMs || 0;
  const slots = body.slots || [];

  const cmsCount = activeBurst ? activeBurst.count : (lastCompletedBurst?.count || 0);
  const cmsDuration = activeBurst ? Number(activeBurst.totalDurationMs.toFixed(1)) : (lastCompletedBurst?.durationMs || 0);
  const cmsAvg = cmsCount > 0 ? Number((cmsDuration / cmsCount).toFixed(1)) : 0;

  lastPageBoundary = {
    ...body,
    cmsQueriesCount: cmsCount,
    cmsDurationMs: cmsDuration,
  };

  const slotPreview = slots.length > 4 ? `${slots.slice(0, 4).join(', ')} +${slots.length - 4} more` : slots.join(', ');
  console.log(`🏁 [SlottD Telemetry] Page '${route}' boundaries: ${slotCount} slots [${slotPreview}] | ${cmsCount} CMS queries in ${cmsDuration}ms (avg ${cmsAvg}ms/query) | Astro SSR: ${renderMs}ms`);

  return c.json({ status: 'ok', acknowledged: true });
});

app.get('/ext/telemetry', (c) => {
  const avg = totalTelemetryRequests > 0 ? Number((totalTelemetryLatencyMs / totalTelemetryRequests).toFixed(2)) : 0;
  return c.json({
    status: 'ok',
    total_requests: totalTelemetryRequests,
    average_latency_ms: avg,
    last_burst: lastCompletedBurst,
    last_page: lastPageBoundary,
  });
});

app.post('/ext/bundle/validate', requireWriteAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const db = createDb(c.env.DB);
  const user = await getAuthenticatedUser(c);

  const changedDocs = await db
    .selectFrom('documents')
    .where('draft_status', 'in', ['modified', 'new'])
    .selectAll()
    .execute();

  const changedItems = changedDocs.map((doc: any) => {
    let draftData = {};
    try { draftData = JSON.parse(doc.draft_data || '{}'); } catch {}
    return {
      collection: doc.collection,
      slug: doc.slug,
      status: doc.draft_status as 'new' | 'modified',
      modifiedFields: Object.keys(draftData),
      delta: draftData,
    };
  });

  const ctx: PublishHookContext = {
    bundle: body.bundleSlug ? { id: `bundle-${body.bundleSlug}`, slug: body.bundleSlug, name: body.bundleSlug } : undefined,
    items: await exportToGitFormat(db),
    changedItems,
    actor: { email: user?.email || 'admin@edge', authMethod: user?.authMethod || 'unknown' },
    timestamp: Date.now(),
    env: c.env,
    db,
  };

  const appConfig = getSlottdConfig();
  if (!appConfig?.hooks?.onBeforePublish) {
    return c.json({ status: 'ok', message: 'No pre-publish checks configured', data: null });
  }

  const report = await appConfig.hooks.onBeforePublish(ctx);
  return c.json(report);
});

app.post('/ext/deploy/trigger', requireWriteAuth, async (c) => {
  if (!c.env.PRODUCTION_DEPLOY_HOOK_URL) {
    return c.json({ error: 'PRODUCTION_DEPLOY_HOOK_URL not configured' }, 400);
  }
  try {
    const res = await fetch(c.env.PRODUCTION_DEPLOY_HOOK_URL, { method: 'POST' });
    return c.json({ success: true, status: res.status, ok: res.ok });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ── Backward-Compatibility Aliases for /api/* ──────────────────────────────
app.post('/api/release/publish', requireWriteAuth, handlePublishRelease);
app.post('/api/sync/hydrate', requireWriteAuth, async (c) => {
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

export default {
  fetch: app.fetch,
  // Scheduled Cron Handler for Scheduled Releases
  async scheduled(event: any, env: Env, ctx: any) {
    const db = createDb(env.DB);
    const now = Date.now();

    const scheduledDocs = await db
      .selectFrom('documents')
      .where('status', '=', 'scheduled')
      .where('publish_at', '<=', now)
      .selectAll()
      .execute();

    if (scheduledDocs.length > 0) {
      await db
        .updateTable('documents')
        .set({ status: 'published', updated_at: now })
        .where('status', '=', 'scheduled')
        .where('publish_at', '<=', now)
        .execute();

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
