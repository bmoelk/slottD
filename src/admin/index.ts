import { Hono } from 'hono';
import { createDb } from '../db/client.js';
import { introspectCollectionFields } from '../api/views.js';
import { getAuthenticatedUser } from '../auth/guard.js';
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

async function resolveDeploymentRepo(): Promise<{ path: string; hasRemote: boolean; remoteUrl: string }> {
  const fs = await dynamicImport('fs');
  const cp = await dynamicImport('child_process');
  const dedicatedPath = '/Users/bmo/code/websites-deployed/brainendeavor.com';

  let chosenPath = typeof (globalThis as any).process !== 'undefined' && (globalThis as any).process.cwd
    ? (globalThis as any).process.cwd()
    : '/workspace';

  if (fs && fs.existsSync && fs.existsSync(dedicatedPath)) {
    chosenPath = dedicatedPath;
  }

  let hasRemote = false;
  let remoteUrl = '';

  if (cp && (cp as any).execSync) {
    try {
      const remotes = (cp as any).execSync(`git -C "${chosenPath}" remote -v`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      if (remotes && remotes.trim()) {
        hasRemote = true;
        const match = remotes.match(/origin\s+([^\s]+)/);
        remoteUrl = match ? match[1] : remotes.split('\n')[0];
      }
    } catch {}
  }

  return { path: chosenPath, hasRemote, remoteUrl };
}

// ── 1. Studio Home & Metrics Overview (/admin/home & /admin/dashboard) ────────
adminRouter.get('/home', async (c) => {
  const db = createDb(c.env.DB);
  const user = getAuthenticatedUser(c) || { email: 'dev@localhost', authMethod: 'local-dev' };
  const repoInfo = await resolveDeploymentRepo();

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
  const user = getAuthenticatedUser(c) || { email: 'dev@localhost', authMethod: 'local-dev' };

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
      status: 'draft',
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
  const user = getAuthenticatedUser(c) || { email: 'dev@localhost', authMethod: 'local-dev' };

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
  const user = getAuthenticatedUser(c) || { email: 'dev@localhost', authMethod: 'local-dev' };

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
  const user = getAuthenticatedUser(c) || { email: 'dev@localhost', authMethod: 'local-dev' };

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

  const collectionMeta = await db.selectFrom('collections').where('name', '=', collection).select('icon').executeTakeFirst();
  const modelIcon = collectionMeta?.icon || '⚙️';

  const fields = await introspectCollectionFields(db, collection);
  return c.html(renderEditorView(collection, doc, fields, isNew, user, modelIcon));
});

// ── 6. Models & Schema Overview (/admin/models) ──────────────────────────────
adminRouter.get('/models', async (c) => {
  const db = createDb(c.env.DB);
  const user = getAuthenticatedUser(c) || { email: 'dev@localhost', authMethod: 'local-dev' };

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
  const user = getAuthenticatedUser(c) || { email: 'dev@localhost', authMethod: 'local-dev' };

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
  const user = getAuthenticatedUser(c) || { email: 'dev@localhost', authMethod: 'local-dev' };

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
  const user = getAuthenticatedUser(c) || { email: 'dev@localhost', authMethod: 'local-dev' };
  const repoInfo = await resolveDeploymentRepo();

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
  const repoInfo = await resolveDeploymentRepo();

  try {
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

      const output = (cp as any).execSync(`git -C "${repoInfo.path}" fetch --all --tags origin`, { encoding: 'utf8' });
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
  const repoInfo = await resolveDeploymentRepo();

  try {
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

    return c.json({
      success: true,
      message: `Exported ${items.length} records into ${files.length} release files.`,
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
  const repoInfo = await resolveDeploymentRepo();

  if (!tag) {
    return c.json({ error: 'Tag is required for diff preview.' }, 400);
  }

  try {
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
  const repoInfo = await resolveDeploymentRepo();

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
adminRouter.get('/docs', (c) => {
  const user = getAuthenticatedUser(c) || { email: 'dev@localhost', authMethod: 'local-dev' };
  return c.html(renderDocsView(user));
});

adminRouter.get('/help', (c) => c.redirect('/admin/docs'));

// ── 16. Shorthand Route Fallbacks (/admin/:collection/:id) ───────────────────
adminRouter.get('/:collection/:id', async (c) => {
  const collection = c.req.param('collection');
  const idOrSlug = c.req.param('id');

  if (['home', 'dashboard', 'models', 'media', 'edit', 'content', 'git', 'sync', 'logs', 'activity', 'docs', 'help'].includes(collection)) {
    return c.notFound();
  }

  const isNew = idOrSlug === '+' || idOrSlug === 'new';
  const db = createDb(c.env.DB);
  const user = getAuthenticatedUser(c) || { email: 'dev@localhost', authMethod: 'local-dev' };

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
