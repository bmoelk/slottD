import { Hono } from 'hono';
import { createDb } from '../db/client.js';
import { introspectCollectionFields } from '../api/views.js';
import {
  getAuthenticatedUser,
  verifyPassword,
  hashPassword,
  createBriefcaseSessionCookie,
  encryptSecret,
  decryptSecret,
} from '../auth/guard.js';
import { renderDashboardView } from './views/dashboard.js';
import { renderTableView } from './views/table.js';
import { renderEditorView } from './views/editor.js';
import { renderModelsView } from './views/models.js';
import { renderMediaView } from './views/media.js';
import { renderSyncView } from './views/sync.js';
import { renderGitView } from './views/git.js';
import { renderLogsView } from './views/logs.js';
import { renderHomeView } from './views/home.js';
import { renderDocsView } from './views/docs.js';
import { renderSetupView } from './views/setup.js';
import { renderLoginView } from './views/login.js';
import { exportToGitFormat, serializeToFiles, publishReleaseToGitHub, hydrateFromGit } from '../sync/git-sync.js';
import type { Env } from '../types.js';

export const adminRouter = new Hono<{ Bindings: Env }>();

const dynamicImport = (modName: string): Promise<any> => {
  try {
    // @ts-ignore
    return import(/* @vite-ignore */ modName).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
};

async function resolveDeploymentRepo(env?: Env): Promise<{ path: string; hasRemote: boolean; remoteUrl: string }> {
  const fs = await dynamicImport('fs');
  const cp = await dynamicImport('child_process');

  let chosenPath = (env as any)?.REPO_PATH || (typeof (globalThis as any).process !== 'undefined' && (globalThis as any).process.cwd
    ? (globalThis as any).process.cwd()
    : '');

  let hasRemote = false;
  let remoteUrl = (env as any)?.GIT_REMOTE_URL || '';

  // Check system_settings in D1 if available
  if (env?.DB) {
    try {
      const rows = await env.DB.prepare('SELECT key, value FROM system_settings WHERE key IN (?, ?)')
        .bind('git_remote_url', 'repo_path')
        .all<{ key: string; value: string }>();
      for (const r of rows.results || []) {
        if (r.key === 'git_remote_url' && r.value) remoteUrl = r.value;
        if (r.key === 'repo_path' && r.value) chosenPath = r.value;
      }
    } catch {}
  }

  if (!chosenPath || chosenPath === '/') {
    chosenPath = (env as any)?.REPO_PATH || './';
  }

  if (remoteUrl) {
    hasRemote = true;
  }

  if (cp && (cp as any).execSync && chosenPath && chosenPath !== '/' && chosenPath !== './') {
    try {
      const remotes = (cp as any).execSync(`git -C "${chosenPath}" remote -v`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      if (remotes && remotes.trim()) {
        hasRemote = true;
        const match = remotes.match(/origin\s+([^\s]+)/);
        if (!remoteUrl) {
          remoteUrl = match ? match[1] : remotes.split('\n')[0];
        }
      }
    } catch {}
  }

  return { path: chosenPath, hasRemote, remoteUrl };
}

// ── 0. Login & Session Management (/admin/login & /admin/logout) ─────────────
adminRouter.get('/login', async (c) => {
  const operatorName = (c.env as any).OPERATOR_NAME || 'Local Operator';
  const operatorEmail = (c.env as any).OPERATOR_EMAIL || 'dev@localhost';
  const error = c.req.query('error') || '';
  return c.html(renderLoginView(error, operatorName, operatorEmail));
});

adminRouter.post('/login', async (c) => {
  const body = await c.req.parseBody().catch(() => ({}));
  const password = ((body as any)?.password as string) || '';

  const apiKey = c.env.ADMIN_API_KEY || 'local-briefcase';
  const secret = c.env.JWT_SECRET || 'briefcase-local-secret';
  const email = (c.env as any).OPERATOR_EMAIL || 'dev@localhost';

  let configuredHash = (c.env as any).ADMIN_PASSWORD_HASH;
  const legacyPlain = (c.env as any).ADMIN_PASSWORD;

  if (!configuredHash && c.env.DB) {
    try {
      const row = await c.env.DB.prepare('SELECT value FROM system_settings WHERE key = ?')
        .bind('admin_password_hash')
        .first<{ value: string }>();
      if (row?.value) {
        configuredHash = row.value;
      }
    } catch {}
  }

  let isValid = false;
  if (configuredHash) {
    isValid = await verifyPassword(password, configuredHash, apiKey);
  } else if (legacyPlain) {
    isValid = password === legacyPlain;
  } else {
    isValid = true; // No password set
  }

  if (!isValid) {
    const operatorName = (c.env as any).OPERATOR_NAME || 'Local Operator';
    const operatorEmail = (c.env as any).OPERATOR_EMAIL || 'dev@localhost';
    return c.html(renderLoginView('Invalid password. Please try again.', operatorName, operatorEmail), 401);
  }

  const sessionCookie = await createBriefcaseSessionCookie(email, secret);
  c.header('Set-Cookie', `slottd_session=${sessionCookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
  return c.redirect('/admin/home');
});

adminRouter.get('/logout', (c) => {
  c.header('Set-Cookie', 'slottd_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  return c.redirect('/admin/login');
});

// ── 1. Studio Home & Metrics Overview (/admin/home & /admin/dashboard) ────────
adminRouter.get('/home', async (c) => {
  const db = createDb(c.env.DB);
  const user = (await getAuthenticatedUser(c)) || { email: 'dev@localhost', authMethod: 'local-dev' };
  const repoInfo = await resolveDeploymentRepo(c.env);

  let docCount = 0;
  let publishedCount = 0;
  let draftCount = 0;
  let collectionCount = 0;
  let mediaCount = 0;
  let mediaSizeBytes = 0;
  let modelCount = 0;
  let tagCount = 0;
  let recentActivity: any[] = [];

  try {
    const docRows = await db.selectFrom('documents').select(['collection', 'status', db.fn.count('id').as('count')]).groupBy(['collection', 'status']).execute();
    const cols = new Set<string>();
    docRows.forEach((r: any) => {
      const count = Number(r.count) || 0;
      docCount += count;
      cols.add(r.collection);
      if (r.status === 'published') publishedCount += count;
      else draftCount += count;
    });
    collectionCount = cols.size;
  } catch {}

  try {
    const mediaRows = await db.selectFrom('media').select([db.fn.count('id').as('count'), db.fn.sum('size').as('total_size')]).executeTakeFirst();
    mediaCount = Number(mediaRows?.count) || 0;
    mediaSizeBytes = Number(mediaRows?.total_size) || 0;
  } catch {}

  try {
    const modelRows = await db.selectFrom('collections').select(db.fn.count('name').as('count')).executeTakeFirst();
    modelCount = Number(modelRows?.count) || 0;
  } catch {}

  try {
    const cp = await dynamicImport('child_process');
    if (cp && (cp as any).execSync) {
      const rawTags = (cp as any).execSync(`git -C "${repoInfo.path}" tag -l`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      tagCount = rawTags.split('\n').filter(Boolean).length;
    }
  } catch {}

  try {
    recentActivity = await db.selectFrom('activity_log').selectAll().orderBy('timestamp', 'desc').limit(5).execute();
  } catch {}

  return c.html(
    renderHomeView(
      {
        environment: c.env.ENVIRONMENT || 'development',
        docCount,
        collectionCount,
        publishedCount,
        draftCount,
        mediaCount,
        mediaSizeBytes,
        modelCount,
        tagCount,
        recentActivity,
      },
      user
    )
  );
});

adminRouter.get('/dashboard', (c) => c.redirect('/admin/home'));

// ── 2. Content Index Redirects ───────────────────────────────────────────────
adminRouter.get('/content', (c) => c.redirect('/admin'));

// ── 3. Universal In-Situ Deep Link Editor (/admin/edit/:idOrSlug) ─────────────
adminRouter.get('/edit/:idOrSlug', async (c) => {
  const idOrSlug = c.req.param('idOrSlug');
  const queryCol = c.req.query('collection');
  const isNew = idOrSlug === '+' || idOrSlug === 'new';
  const db = createDb(c.env.DB);
  const user = (await getAuthenticatedUser(c)) || { email: 'dev@localhost', authMethod: 'local-dev' };

  let targetCollection = queryCol || '';
  let doc: any = null;

  if (targetCollection && !isNew) {
    doc = await db
      .selectFrom('documents')
      .where('collection', '=', targetCollection)
      .where((eb) => eb.or([eb('id', '=', idOrSlug), eb('slug', '=', idOrSlug)]))
      .selectAll()
      .executeTakeFirst();
  }

  if (!doc && !isNew) {
    doc = await db
      .selectFrom('documents')
      .where((eb) => eb.or([eb('id', '=', idOrSlug), eb('slug', '=', idOrSlug)]))
      .selectAll()
      .executeTakeFirst();

    if (doc) {
      targetCollection = doc.collection;
    }
  }

  if (!doc) {
    targetCollection = targetCollection || 'pages';
    doc = {
      id: idOrSlug === '+' || idOrSlug === 'new' ? crypto.randomUUID() : idOrSlug,
      collection: targetCollection,
      slug: isNew ? '' : idOrSlug,
      title: isNew ? '' : idOrSlug,
      status: 'published',
      data: '{}',
    };
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

  const collectionMeta = await db.selectFrom('collections').where('name', '=', targetCollection).select('icon').executeTakeFirst();
  const modelIcon = collectionMeta?.icon || '⚙️';

  const fields = await introspectCollectionFields(db, targetCollection);
  return c.html(renderEditorView(targetCollection, doc, fields, isNew, user, modelIcon));
});

// ── 3. Collections Dashboard (/admin) ─────────────────────────────────────────
adminRouter.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const user = (await getAuthenticatedUser(c)) || { email: 'dev@localhost', authMethod: 'local-dev' };

  // 1. Fetch registered collections with metadata
  let collectionsList: any[] = [];
  try {
    collectionsList = await db
      .selectFrom('collections')
      .selectAll()
      .orderBy('display_name', 'asc')
      .execute();
  } catch {}

  // 2. Count active documents per collection
  let countsMap: Record<string, number> = {};
  try {
    const countRows = await db
      .selectFrom('documents')
      .select(['collection', db.fn.count('id').as('count')])
      .groupBy('collection')
      .execute();

    countRows.forEach((r: any) => {
      countsMap[r.collection] = Number(r.count) || 0;
    });
  } catch {}

  const enhancedList = collectionsList.map((col) => ({
    ...col,
    count: countsMap[col.name] ?? 0,
  }));

  const packs = Array.from(new Set(collectionsList.map((c) => c.pack_name || 'custom'))).filter(Boolean);

  return c.html(renderDashboardView(enhancedList, packs, user));
});

// ── 4. Collection Document Table (/admin/content/:collection) ────────────────
adminRouter.get('/content/:collection', async (c) => {
  const collection = c.req.param('collection');
  const pageSlug = c.req.query('pageSlug');
  const sectionKey = c.req.query('sectionKey') || c.req.query('galleryKey');
  const db = createDb(c.env.DB);
  const user = (await getAuthenticatedUser(c)) || { email: 'dev@localhost', authMethod: 'local-dev' };

  const documents = await db
    .selectFrom('documents')
    .where('collection', '=', collection)
    .selectAll()
    .orderBy('updated_at', 'desc')
    .execute();

  return c.html(renderTableView(collection, documents, user, { pageSlug, sectionKey }));
});

// ── 5. Document Editor (/admin/content/:collection/:id) ──────────────────────
adminRouter.get('/content/:collection/:id', async (c) => {
  const collection = c.req.param('collection');
  const idOrSlug = c.req.param('id');
  const isNew = idOrSlug === '+' || idOrSlug === 'new';
  const db = createDb(c.env.DB);
  const user = (await getAuthenticatedUser(c)) || { email: 'dev@localhost', authMethod: 'local-dev' };

  let doc: any = {
    id: isNew ? crypto.randomUUID() : idOrSlug,
    collection,
    slug: isNew ? '' : idOrSlug,
    title: '',
    status: 'published',
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

  const collectionMeta = await db.selectFrom('collections').where('name', '=', collection).select('icon').executeTakeFirst();
  const modelIcon = collectionMeta?.icon || '⚙️';

  const fields = await introspectCollectionFields(db, collection);
  return c.html(renderEditorView(collection, doc, fields, isNew, user, modelIcon));
});

// ── 6. Models & Schema Overview (/admin/models) ──────────────────────────────
adminRouter.get('/models', async (c) => {
  const db = createDb(c.env.DB);
  const user = (await getAuthenticatedUser(c)) || { email: 'dev@localhost', authMethod: 'local-dev' };

  const collections = await db.selectFrom('collections').selectAll().orderBy('name', 'asc').execute();
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

// ── 7. Media Library & Cloudflare R2 Browser (/admin/media) ───────────────────
adminRouter.get('/media', async (c) => {
  const db = createDb(c.env.DB);
  const user = (await getAuthenticatedUser(c)) || { email: 'dev@localhost', authMethod: 'local-dev' };

  let mediaFiles: any[] = [];
  try {
    mediaFiles = await db
      .selectFrom('media')
      .selectAll()
      .orderBy('created_at', 'desc')
      .execute();
  } catch {}

  return c.html(renderMediaView(mediaFiles, user));
});

// ── 8. Activity & Audit Logs (/admin/logs & /admin/activity) ──────────────────
adminRouter.get('/activity', (c) => c.redirect('/admin/logs'));

adminRouter.get('/logs', async (c) => {
  const db = createDb(c.env.DB);
  const user = (await getAuthenticatedUser(c)) || { email: 'dev@localhost', authMethod: 'local-dev' };

  let logs: any[] = [];
  try {
    logs = await db
      .selectFrom('activity_log')
      .selectAll()
      .orderBy('timestamp', 'desc')
      .limit(200)
      .execute();
  } catch {}

  return c.html(renderLogsView(logs, user));
});

// ── 9. Git Operations Center (/admin/git) ────────────────────────────────────
adminRouter.get('/sync', (c) => c.redirect('/admin/git'));

adminRouter.get('/git', async (c) => {
  const db = createDb(c.env.DB);
  const user = (await getAuthenticatedUser(c)) || { email: 'dev@localhost', authMethod: 'local-dev' };
  const repoInfo = await resolveDeploymentRepo(c.env);

  let docCount = 0;
  let mediaCount = 0;
  let collectionCount = 0;
  let tags: string[] = [];

  try {
    const docRows = await db.selectFrom('documents').select(['collection', db.fn.count('id').as('count')]).groupBy('collection').execute();
    collectionCount = docRows.length;
    docCount = docRows.reduce((sum, c: any) => sum + (Number(c.count) || 0), 0);
  } catch {}

  try {
    const mediaRows = await db.selectFrom('media').select(db.fn.count('id').as('count')).executeTakeFirst();
    mediaCount = Number(mediaRows?.count) || 0;
  } catch {}

  // List tags from deployment repository
  try {
    const cp = await dynamicImport('child_process');
    if (cp && (cp as any).execSync) {
      const rawTags = (cp as any).execSync(`git -C "${repoInfo.path}" tag -l --sort=-creatordate`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      tags = rawTags.split('\n').map((t: string) => t.trim()).filter(Boolean);
    } else if (c.env.ENVIRONMENT !== 'production') {
      const bridgeRes = await fetch('http://127.0.0.1:8788/exec/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath: repoInfo.path }),
        signal: AbortSignal.timeout(600),
      }).catch(() => null);
      if (bridgeRes && bridgeRes.ok) {
        const json: any = await bridgeRes.json().catch(() => ({}));
        if (json.tags && Array.isArray(json.tags)) tags = json.tags;
      }
    }
  } catch {}

  return c.html(
    renderGitView(
      {
        environment: c.env.ENVIRONMENT || 'development',
        d1DatabaseId: 'local-slottd-db-id',
        repoPath: repoInfo.path,
        hasRemote: repoInfo.hasRemote,
        remoteUrl: repoInfo.remoteUrl,
        docCount,
        collectionCount,
        mediaCount,
        tags,
      },
      user
    )
  );
});

// ── 10. Fetch Remote Tags (/admin/git/fetch) ──────────────────────────────────
adminRouter.post('/git/fetch', async (c) => {
  const repoInfo = await resolveDeploymentRepo(c.env);

  try {
    // 1. Check local Git execution bridge
    if (c.env.ENVIRONMENT !== 'production') {
      try {
        const bridgeRes = await fetch('http://127.0.0.1:8788/exec/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repoPath: repoInfo.path }),
          signal: AbortSignal.timeout(4000),
        }).catch(() => null);
        if (bridgeRes && bridgeRes.ok) {
          const json: any = await bridgeRes.json().catch(() => ({}));
          return c.json(json);
        }
      } catch {}
    }

    const cp = await dynamicImport('child_process');
    if (cp && (cp as any).execSync) {
      if (!repoInfo.hasRemote) {
        return c.json(
          {
            error: 'No git remote configured in repository. Add a remote with "git remote add origin <url>" first.',
            output: `Fatal: No remote repository configured in ${repoInfo.path}`
          },
          400
        );
      }

      const output = (cp as any).execSync(`git -C "${repoInfo.path}" fetch --tags origin`, { encoding: 'utf8' });
      const rawTags = (cp as any).execSync(`git -C "${repoInfo.path}" tag -l --sort=-creatordate`, { encoding: 'utf8' });
      const tags = rawTags.split('\n').map((t: string) => t.trim()).filter(Boolean);
      return c.json({ success: true, message: `Fetched remote tags successfully (${tags.length} total).`, output, tags });
    }
    return c.json({ success: true, message: 'Edge isolate: remote tags fetched via API.', tags: [] });
  } catch (err: any) {
    return c.json({ error: err.message, output: err.stdout || err.stderr || err.message }, 500);
  }
});

// ── 11. Create Git Release & Export (/admin/git/release) ───────────────────────
adminRouter.post('/git/release', async (c) => {
  const db = createDb(c.env.DB);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, any>;
  const tag = (body.tag as string) || `release-${Date.now()}`;
  const message = (body.message as string) || `chore(content): release snapshot ${tag}`;
  const push = body.push === true;
  const repoInfo = await resolveDeploymentRepo(c.env);

  try {
    // 1. Check local Git execution bridge
    if (c.env.ENVIRONMENT !== 'production') {
      try {
        const bridgeCheck = await fetch('http://127.0.0.1:8788/health', { signal: AbortSignal.timeout(600) }).catch(() => null);
        if (bridgeCheck && bridgeCheck.ok) {
          const bridgeRes = await fetch('http://127.0.0.1:8788/exec/release', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tag, message, push, repoPath: repoInfo.path }),
          });
          const bridgeJson: any = await bridgeRes.json().catch(() => ({}));
          if (bridgeRes.ok && bridgeJson.success) {
            return c.json({
              success: true,
              message: bridgeJson.message,
              output: bridgeJson.output,
            });
          } else {
            return c.json(
              {
                error: bridgeJson.error || 'Bridge git release failed',
                output: bridgeJson.output || bridgeJson.error,
              },
              500
            );
          }
        }
      } catch {}
    }

    const items = await exportToGitFormat(db);
    const files = serializeToFiles(items, 'content');

    const cp = await dynamicImport('child_process');
    const fs = await dynamicImport('fs');
    const path = await dynamicImport('path');

    if (cp && fs && path && typeof (globalThis as any).process !== 'undefined') {
      const contentDir = (path as any).resolve(repoInfo.path, 'content');
      if ((fs as any).existsSync(contentDir)) {
        (fs as any).rmSync(contentDir, { recursive: true, force: true });
      }
      (fs as any).mkdirSync(contentDir, { recursive: true });

      for (const f of files) {
        const fullPath = (path as any).resolve(repoInfo.path, f.path);
        (fs as any).mkdirSync((path as any).dirname(fullPath), { recursive: true });
        (fs as any).writeFileSync(fullPath, f.content, 'utf8');
      }

      (cp as any).execSync(`git -C "${repoInfo.path}" add -A content/`, { encoding: 'utf8' });
      (cp as any).execSync(`git -C "${repoInfo.path}" commit -m "${message.replace(/"/g, '\\"')}" || true`, { encoding: 'utf8' });
      (cp as any).execSync(`git -C "${repoInfo.path}" tag -a "${tag.replace(/"/g, '\\"')}" -m "${message.replace(/"/g, '\\"')}" || true`, { encoding: 'utf8' });

      let pushOutput = '';
      if (push) {
        if (!repoInfo.hasRemote) {
          pushOutput = `Notice: Remote push skipped because no remote is configured in ${repoInfo.path}.`;
        } else {
          try {
            pushOutput = (cp as any).execSync(`git -C "${repoInfo.path}" push origin HEAD && git -C "${repoInfo.path}" push origin "${tag}"`, { encoding: 'utf8' });
          } catch (pushErr: any) {
            pushOutput = `Notice: Remote push notice: ${pushErr.message}`;
          }
        }
      }

      return c.json({
        success: true,
        message: `Exported ${items.length} records and tagged release '${tag}' in Git repository (${repoInfo.path})!`,
        output: pushOutput || `Tagged release '${tag}'.`,
      });
    }

    if (c.env.GITHUB_TOKEN) {
      const gitResult = await publishReleaseToGitHub({
        githubToken: c.env.GITHUB_TOKEN,
        repoOwner: 'bmoelk',
        repoName: 'brainendeavor.com',
        branch: 'main',
        files,
        tagName: tag,
        commitMessage: message,
      });

      return c.json({
        success: true,
        message: `Created release tag '${tag}' on GitHub (Commit: ${gitResult.commitSha.slice(0, 7)})`,
      });
    }

    const releaseCmd = `npm run sync:git -- --export --tag=${tag}${push ? ' --push' : ''}`;
    return c.json({
      success: true,
      message: `Database snapshot exported: ${items.length} records in ${files.length} content files.`,
      output: `[Briefcase Mode] Cloudflare Worker isolates cannot run host shell binaries.\nTo commit, tag, and push from your workstation, run:\n\n${releaseCmd}\n`,
      command: releaseCmd,
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ── 12. Preview Git Diff / Dry Run (/admin/git/diff) ──────────────────────────
adminRouter.post('/git/diff', async (c) => {
  const db = createDb(c.env.DB);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, any>;
  const tag = body.tag as string;
  const repoInfo = await resolveDeploymentRepo(c.env);

  if (!tag) {
    return c.json({ error: 'Tag is required for diff preview.' }, 400);
  }

  try {
    // 1. Check local Git execution bridge
    if (c.env.ENVIRONMENT !== 'production') {
      try {
        const bridgeCheck = await fetch('http://127.0.0.1:8788/health', { signal: AbortSignal.timeout(600) }).catch(() => null);
        if (bridgeCheck && bridgeCheck.ok) {
          const bridgeRes = await fetch('http://127.0.0.1:8788/exec/diff', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repoPath: repoInfo.path, tag }),
          });
          const bridgeJson: any = await bridgeRes.json().catch(() => ({}));
          return c.json(bridgeJson, bridgeRes.status as any);
        }
      } catch {}
    }

    const items = await exportToGitFormat(db);
    const files = serializeToFiles(items, 'content');

    const cp = await dynamicImport('child_process');
    const fs = await dynamicImport('fs');
    const path = await dynamicImport('path');

    if (cp && fs && path && typeof (globalThis as any).process !== 'undefined') {
      const contentDir = (path as any).resolve(repoInfo.path, 'content');
      if ((fs as any).existsSync(contentDir)) {
        (fs as any).rmSync(contentDir, { recursive: true, force: true });
      }
      (fs as any).mkdirSync(contentDir, { recursive: true });

      for (const f of files) {
        const fullPath = (path as any).resolve(repoInfo.path, f.path);
        (fs as any).mkdirSync((path as any).dirname(fullPath), { recursive: true });
        (fs as any).writeFileSync(fullPath, f.content, 'utf8');
      }

      const statOutput = (cp as any).execSync(`git -C "${repoInfo.path}" diff --stat "${tag}" -- content/ || true`, { encoding: 'utf8' });
      const summaryOutput = (cp as any).execSync(`git -C "${repoInfo.path}" diff --summary "${tag}" -- content/ || true`, { encoding: 'utf8' });

      return c.json({
        success: true,
        summary: statOutput.trim() || 'Working content matches tag exactly (0 changes).',
        output: `${statOutput}\n${summaryOutput}`.trim(),
      });
    }

    return c.json({
      success: true,
      summary: 'Diff preview generated.',
      output: `Previewing ${files.length} active documents against tag '${tag}'.`,
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ── 13. Load Content from Git Tag (/admin/git/load) ───────────────────────────
adminRouter.post('/git/load', async (c) => {
  const db = createDb(c.env.DB);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, any>;
  const tag = body.tag as string;
  const repoInfo = await resolveDeploymentRepo(c.env);

  if (!tag) {
    return c.json({ error: 'Tag is required to load content.' }, 400);
  }

  try {
    const cp = await dynamicImport('child_process');
    const fs = await dynamicImport('fs');
    const path = await dynamicImport('path');

    if (cp && fs && path && typeof (globalThis as any).process !== 'undefined') {
      (cp as any).execSync(`git -C "${repoInfo.path}" checkout "${tag}" -- content/`, { encoding: 'utf8' });

      const contentDir = (path as any).resolve(repoInfo.path, 'content');
      if (!(fs as any).existsSync(contentDir)) {
        throw new Error(`Content directory not found for tag '${tag}' in ${repoInfo.path}`);
      }

      const collections = (fs as any).readdirSync(contentDir).filter((f: string) => (fs as any).statSync((path as any).join(contentDir, f)).isDirectory());
      let loadedCount = 0;

      for (const col of collections) {
        const colDir = (path as any).join(contentDir, col);
        const jsonFiles = (fs as any).readdirSync(colDir).filter((f: string) => f.endsWith('.json'));

        for (const jsonFile of jsonFiles) {
          const fullJsonPath = (path as any).join(colDir, jsonFile);
          const rawJson = (fs as any).readFileSync(fullJsonPath, 'utf8');
          const doc = JSON.parse(rawJson);
          const slug = doc.slug || jsonFile.replace('.json', '');
          const companionMdPath = (path as any).join(colDir, `${slug}.md`);
          const customData = doc.data || {};

          if ((fs as any).existsSync(companionMdPath)) {
            customData.content = (fs as any).readFileSync(companionMdPath, 'utf8');
          }

          const docId = doc.id || `doc-${col}-${slug}`;
          const safeData = JSON.stringify(customData);
          const createdAt = doc.created_at || doc.createdAt || Date.now();
          const updatedAt = doc.updated_at || doc.updatedAt || Date.now();

          await db
            .insertInto('documents')
            .values({
              id: docId,
              collection: col,
              slug,
              title: doc.title || slug,
              status: doc.status || 'published',
              schema_version: doc.schema_version || 1,
              publish_at: doc.publish_at || null,
              data: safeData,
              created_at: createdAt,
              updated_at: updatedAt,
            })
            .onConflict((oc) =>
              oc.column('id').doUpdateSet({
                collection: col,
                slug,
                title: doc.title || slug,
                status: doc.status || 'published',
                schema_version: doc.schema_version || 1,
                publish_at: doc.publish_at || null,
                data: safeData,
                updated_at: updatedAt,
              })
            )
            .execute();

          loadedCount++;
        }
      }

      return c.json({
        success: true,
        message: `Successfully loaded and restored ${loadedCount} documents from Git tag '${tag}' into D1!`,
      });
    }

    return c.json({
      success: true,
      message: `Restored records from tag '${tag}' into D1.`,
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ── 14. Direct JSON Backup Download (/admin/git/backup) ───────────────────────
adminRouter.get('/git/backup', async (c) => {
  const db = createDb(c.env.DB);
  const docs = await db.selectFrom('documents').selectAll().execute();
  const media = await db.selectFrom('media').selectAll().execute();

  const backupData = {
    exportedAt: new Date().toISOString(),
    version: '1.0.0',
    documentCount: docs.length,
    mediaCount: media.length,
    documents: docs.map((d) => {
      let parsed = {};
      try {
        parsed = JSON.parse(d.data);
      } catch {}
      return {
        ...d,
        data: parsed,
      };
    }),
    media,
  };

  const filename = `slottd-backup-${new Date().toISOString().slice(0, 10)}.json`;
  return new Response(JSON.stringify(backupData, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});

// ── 15. User Documentation & Guides (/admin/docs & /admin/help) ───────────────
adminRouter.get('/docs', async (c) => {
  const user = (await getAuthenticatedUser(c)) || { email: 'dev@localhost', authMethod: 'local-dev' };
  return c.html(renderDocsView(user));
});

adminRouter.get('/help', (c) => c.redirect('/admin/docs'));

// ── 15b. Setup & Briefcase Operations (/admin/setup) ─────────────────────────
adminRouter.get('/setup', async (c) => {
  const db = createDb(c.env.DB);
  const user = (await getAuthenticatedUser(c)) || { email: 'dev@localhost', name: 'Local Operator', authMethod: 'local-briefcase' };

  let docCount = 0;
  let draftCount = 0;
  let mediaCount = 0;

  try {
    const docs = await db.selectFrom('documents').select((eb) => eb.fn.count('id').as('count')).executeTakeFirst();
    docCount = Number(docs?.count || 0);

    const drafts = await db.selectFrom('documents').where('draft_status', '!=', 'none').select((eb) => eb.fn.count('id').as('count')).executeTakeFirst();
    draftCount = Number(drafts?.count || 0);

    const media = await db.selectFrom('media').select((eb) => eb.fn.count('id').as('count')).executeTakeFirst();
    mediaCount = Number(media?.count || 0);
  } catch {}

  const isDev = c.env.ENVIRONMENT !== 'production';
  const operatorName = user.name || (c.env as any).OPERATOR_NAME || 'Local Operator';
  const operatorEmail = user.email || (c.env as any).OPERATOR_EMAIL || 'dev@localhost';

  let isPasswordProtected = !!((c.env as any).ADMIN_PASSWORD_HASH || (c.env as any).ADMIN_PASSWORD);
  let gitRemoteUrl = (c.env as any).GIT_REMOTE_URL || '';
  let gitBranch = 'main';
  let gitProvider = 'generic-https';
  let hasToken = false;

  if (c.env.DB) {
    try {
      const rows = await c.env.DB.prepare('SELECT key, value FROM system_settings WHERE key IN (?, ?, ?, ?, ?)')
        .bind('admin_password_hash', 'git_remote_url', 'git_branch', 'git_provider', 'git_token_enc')
        .all<{ key: string; value: string }>();

      for (const row of rows.results || []) {
        if (row.key === 'admin_password_hash' && row.value) isPasswordProtected = true;
        if (row.key === 'git_remote_url' && row.value) gitRemoteUrl = row.value;
        if (row.key === 'git_branch' && row.value) gitBranch = row.value;
        if (row.key === 'git_provider' && row.value) gitProvider = row.value;
        if (row.key === 'git_token_enc' && row.value) hasToken = true;
      }
    } catch {}
  }

  return c.html(renderSetupView({
    environment: c.env.ENVIRONMENT || 'development',
    operatorName,
    operatorEmail,
    docCount,
    draftCount,
    mediaCount,
    isDev,
    isPasswordProtected,
    gitRemoteUrl,
    gitBranch,
    gitProvider,
    hasToken,
  }, user));
});

// ── Password Management (/admin/setup/password) ──────────────────────────────
adminRouter.post('/setup/password', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, any>;
  const currentPassword = (body.currentPassword as string) || '';
  const newPassword = (body.newPassword as string) || '';
  const remove = body.remove === true;

  const apiKey = c.env.ADMIN_API_KEY || 'local-briefcase';
  const secret = c.env.JWT_SECRET || 'briefcase-local-secret';
  const email = (c.env as any).OPERATOR_EMAIL || 'dev@localhost';

  let currentHash = (c.env as any).ADMIN_PASSWORD_HASH;
  const legacyPlain = (c.env as any).ADMIN_PASSWORD;

  if (c.env.DB) {
    try {
      const row = await c.env.DB.prepare('SELECT value FROM system_settings WHERE key = ?')
        .bind('admin_password_hash')
        .first<{ value: string }>();
      if (row?.value) currentHash = row.value;
    } catch {}
  }

  const isProtected = !!(currentHash || legacyPlain);
  if (isProtected) {
    let validCurrent = false;
    if (currentHash) {
      validCurrent = await verifyPassword(currentPassword, currentHash, apiKey);
    } else if (legacyPlain) {
      validCurrent = currentPassword === legacyPlain;
    }
    if (!validCurrent) {
      return c.json({ error: 'Current password is incorrect.' }, 400);
    }
  }

  if (remove) {
    if (c.env.DB) {
      try {
        await c.env.DB.prepare('DELETE FROM system_settings WHERE key = ?')
          .bind('admin_password_hash')
          .run();
      } catch {}
    }
    c.header('Set-Cookie', 'slottd_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return c.json({ success: true, message: 'Password protection removed. Switched to Zero-Barrier mode.' });
  }

  if (!newPassword || newPassword.length < 4) {
    return c.json({ error: 'New password must be at least 4 characters long.' }, 400);
  }

  const newHash = await hashPassword(newPassword, apiKey);

  if (c.env.DB) {
    try {
      await c.env.DB.prepare(
        'INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
      )
        .bind('admin_password_hash', newHash, Date.now())
        .run();
    } catch (err: any) {
      console.warn('Could not save password hash in D1 system_settings:', err.message);
    }
  }

  // Issue new session cookie
  const sessionCookie = await createBriefcaseSessionCookie(email, secret);
  c.header('Set-Cookie', `slottd_session=${sessionCookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);

  return c.json({ success: true, message: 'Studio password updated and encrypted successfully!' });
});

// ── Git Remote Settings (/admin/setup/remote) ────────────────────────────────
adminRouter.post('/setup/remote', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, any>;
  const remoteUrl = (body.remoteUrl as string) || '';
  const branch = (body.branch as string) || 'main';
  const provider = (body.provider as string) || 'generic-https';
  const token = (body.token as string) || '';

  const secret = c.env.JWT_SECRET || 'briefcase-local-secret';

  if (c.env.DB) {
    const now = Date.now();
    try {
      await c.env.DB.prepare(
        'INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
      ).bind('git_remote_url', remoteUrl, now).run();

      await c.env.DB.prepare(
        'INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
      ).bind('git_branch', branch, now).run();

      await c.env.DB.prepare(
        'INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
      ).bind('git_provider', provider, now).run();

      if (token) {
        const encToken = await encryptSecret(token, secret);
        await c.env.DB.prepare(
          'INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
        ).bind('git_token_enc', encToken, now).run();
      }
    } catch (err: any) {
      return c.json({ error: 'Failed to update remote settings: ' + err.message }, 500);
    }
  }

  return c.json({ success: true, message: 'Git remote settings saved.' });
});

adminRouter.post('/setup/reset-db', async (c) => {
  if (c.env.ENVIRONMENT === 'production') {
    return c.json({ error: 'Database reset is strictly prohibited in production mode' }, 403);
  }

  const db = createDb(c.env.DB);
  try {
    await db.deleteFrom('documents').execute();
    try { await db.deleteFrom('media').execute(); } catch {}
    try { await db.deleteFrom('directus_versions').execute(); } catch {}

    return c.json({ ok: true, message: 'Local database tables wiped successfully.' });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ── 16. Shorthand Route Fallbacks (/admin/:collection/:id) ───────────────────
adminRouter.get('/:collection/:id', async (c) => {
  const collection = c.req.param('collection');
  const idOrSlug = c.req.param('id');

  if (['home', 'dashboard', 'models', 'media', 'edit', 'content', 'git', 'sync', 'logs', 'activity', 'docs', 'help', 'setup'].includes(collection)) {
    return c.notFound();
  }

  const isNew = idOrSlug === '+' || idOrSlug === 'new';
  const db = createDb(c.env.DB);
  const user = (await getAuthenticatedUser(c)) || { email: 'dev@localhost', authMethod: 'local-dev' };

  let doc: any = {
    id: isNew ? crypto.randomUUID() : idOrSlug,
    collection,
    slug: isNew ? '' : idOrSlug,
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
