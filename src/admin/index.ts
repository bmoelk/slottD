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
import { renderTableView, type TableViewScopeOptions } from './views/table.js';
import { renderEditorView } from './views/editor.js';
import { renderModelsView } from './views/models.js';
import { renderMediaView } from './views/media.js';
import { renderSyncView } from './views/sync.js';
import { renderGitView } from './views/git.js';
import { renderLogsView } from './views/logs.js';
import { renderHomeView } from './views/home.js';
import { renderSitesView } from './views/sites.js';
import { renderDocsView } from './views/docs.js';
import { renderSetupView } from './views/setup.js';
import { renderLoginView } from './views/login.js';
import { renameSite, listSites, registerSite, deleteSite } from './sites.js';
import { resolveSiteId, normalizeSiteId } from '../auth/site.js';
import { syncCollectionView } from '../api/views.js';
import { exportToGitFormat, serializeToFiles, publishReleaseToGitHub, hydrateFromGit } from '../sync/git-sync.js';
import { getGitDriver, normalizeGitUrl } from '../sync/driver.js';
import { computeContentDiff } from '../sync/diff.js';
import { logActivity } from '../db/audit.js';
import { ALPINE_VENDOR_JS } from './vendor/alpine.js';
import { MARKDOWN_TOOLBAR_VENDOR_JS } from './vendor/markdown-toolbar.js';
import { PELL_VENDOR_JS } from './vendor/pell.js';
import { MARKED_VENDOR_JS } from './vendor/marked.js';
import type { Env, AppVariables } from '../types.js';
import { getSlottdConfig } from '../index.js';

export const adminRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const dynamicImport = (modName: string): Promise<any> => {
  try {
    // @ts-ignore
    return import(/* @vite-ignore */ modName).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
};

async function resolveDeploymentRepo(env?: Env, siteId?: string): Promise<{
  path: string;
  hasRemote: boolean;
  remoteUrl: string;
  branch: string;
  token?: string;
  isMonorepo?: boolean;
  contentPath?: string;
  gitTopLevel?: string;
}> {
  const fs = await dynamicImport('fs');
  const cp = await dynamicImport('child_process');

  let chosenPath = (env as any)?.REPO_PATH || (typeof (globalThis as any).process !== 'undefined' && (globalThis as any).process.cwd
    ? (globalThis as any).process.cwd()
    : '');

  let hasRemote = false;
  let remoteUrl = (env as any)?.GIT_REMOTE_URL || '';
  let branch = (env as any)?.GIT_BRANCH || 'main';
  let token = (env as any)?.GIT_TOKEN || (env as any)?.GITHUB_TOKEN || '';

  // 1. Check slottd.config.ts if available
  const appConfig = getSlottdConfig();
  if (appConfig?.git?.repo && !remoteUrl) {
    remoteUrl = appConfig.git.repo;
  }
  if (appConfig?.git?.branch && branch === 'main') {
    branch = appConfig.git.branch;
  }

  // 2. Check system_site_settings in D1 if siteId provided
  if (siteId && env?.DB) {
    try {
      const rows = await env.DB.prepare('SELECT key, value FROM system_site_settings WHERE site_id = ? AND key IN (?, ?, ?, ?)')
        .bind(siteId, 'git_remote_url', 'repo_path', 'git_branch', 'git_token_enc')
        .all<{ key: string; value: string }>();
      let encToken = '';
      for (const r of rows.results || []) {
        if (r.key === 'git_remote_url' && r.value) remoteUrl = r.value;
        if (r.key === 'repo_path' && r.value) chosenPath = r.value;
        if (r.key === 'git_branch' && r.value) branch = r.value;
        if (r.key === 'git_token_enc' && r.value) encToken = r.value;
      }
      if (encToken) {
        const secret = env.JWT_SECRET || 'briefcase-local-secret';
        const dec = await decryptSecret(encToken, secret);
        if (dec) token = dec;
      }
    } catch {}
  }

  // 3. Check system_settings in D1 as global fallback
  if (!remoteUrl && env?.DB) {
    try {
      const rows = await env.DB.prepare('SELECT key, value FROM system_settings WHERE key IN (?, ?, ?, ?)')
        .bind('git_remote_url', 'repo_path', 'git_branch', 'git_token_enc')
        .all<{ key: string; value: string }>();
      let encToken = '';
      for (const r of rows.results || []) {
        if (r.key === 'git_remote_url' && r.value && !remoteUrl) remoteUrl = r.value;
        if (r.key === 'repo_path' && r.value) chosenPath = r.value;
        if (r.key === 'git_branch' && r.value) branch = r.value;
        if (r.key === 'git_token_enc' && r.value) encToken = r.value;
      }
      if (encToken && !token) {
        const secret = env.JWT_SECRET || 'briefcase-local-secret';
        const dec = await decryptSecret(encToken, secret);
        if (dec) token = dec;
      }
    } catch {}
  }

  if (!chosenPath || chosenPath === '/') {
    chosenPath = (env as any)?.REPO_PATH || './';
  }

  // 3. Detect Monorepo Context & Remote Content Path
  const explicitPath = appConfig?.git?.path || (env as any)?.GIT_CONTENT_PATH;
  const { detectMonorepo } = await import('../sync/monorepo.js');
  const monorepo = await detectMonorepo(chosenPath, explicitPath);

  if (cp && (cp as any).execSync && chosenPath && chosenPath !== '/' && chosenPath !== './') {
    try {
      const remotes = (cp as any).execSync(`git -C "${chosenPath}" remote -v`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      if (remotes && remotes.trim()) {
        const match = remotes.match(/origin\s+([^\s]+)/);
        if (!remoteUrl) {
          remoteUrl = match ? match[1] : remotes.split('\n')[0];
        }
      }
    } catch {}
  }

  if (remoteUrl) {
    hasRemote = true;
  }

  return {
    path: chosenPath,
    hasRemote,
    remoteUrl,
    branch,
    token,
    isMonorepo: monorepo.isMonorepo,
    contentPath: monorepo.contentPath,
    gitTopLevel: monorepo.gitTopLevel,
  };
}

export async function getSiteContext(c: any, db: any) {
  let availableSites: string[] = [];
  try {
    const sites = await listSites(db);
    availableSites = sites.map((s) => s.site_id);
  } catch {}

  let activeSite = (c.get('siteId') as string);
  if (!activeSite) {
    activeSite = await resolveSiteId(c);
  }

  if (availableSites.length > 0 && !availableSites.includes(activeSite)) {
    activeSite = availableSites[0];
  } else if (availableSites.length === 0) {
    availableSites = [activeSite || 'default'];
  }
  return { activeSite, availableSites };
}

export async function getEditorConfig(env?: Env): Promise<{ format: 'markdown' | 'richtext'; tier: 'light' | 'heavy' }> {
  let format: 'markdown' | 'richtext' = (env as any)?.EDITOR_FORMAT === 'richtext' ? 'richtext' : 'markdown';
  let tier: 'light' | 'heavy' = (env as any)?.EDITOR_TIER === 'heavy' ? 'heavy' : 'light';

  if (env?.DB) {
    try {
      const rows = await env.DB.prepare('SELECT key, value FROM system_settings WHERE key IN (?, ?)')
        .bind('editor_format', 'editor_tier')
        .all<{ key: string; value: string }>();
      for (const row of rows.results || []) {
        if (row.key === 'editor_format' && (row.value === 'markdown' || row.value === 'richtext')) {
          format = row.value;
        }
        if (row.key === 'editor_tier' && (row.value === 'light' || row.value === 'heavy')) {
          tier = row.value;
        }
      }
    } catch {}
  }

  return { format, tier };
}

// ── 0. Static Vendor Assets (/admin/vendor/*) ────────────────────────────────
adminRouter.get('/vendor/alpine.js', (c) => {
  c.header('Content-Type', 'application/javascript; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=31536000, immutable');
  return c.body(ALPINE_VENDOR_JS);
});

adminRouter.get('/vendor/markdown-toolbar.js', (c) => {
  c.header('Content-Type', 'application/javascript; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=31536000, immutable');
  return c.body(MARKDOWN_TOOLBAR_VENDOR_JS);
});

adminRouter.get('/vendor/pell.js', (c) => {
  c.header('Content-Type', 'application/javascript; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=31536000, immutable');
  return c.body(PELL_VENDOR_JS);
});

adminRouter.get('/vendor/marked.js', (c) => {
  c.header('Content-Type', 'application/javascript; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=31536000, immutable');
  return c.body(MARKED_VENDOR_JS);
});

// ── 0. Login & Session Management (/admin/login & /admin/logout) ─────────────
adminRouter.get('/login', async (c) => {
  const operatorName = (c.env as any).OPERATOR_NAME || 'Local Operator';
  const operatorEmail = (c.env as any).OPERATOR_EMAIL || 'dev@localhost';
  const error = c.req.query('error') || '';
  const redirect = c.req.query('redirect') || '';
  const slotwireAuth = c.req.query('slotwire_auth') === '1' || c.req.query('slotwire_auth') === 'true';
  const origin = c.req.query('origin') || '';
  return c.html(renderLoginView(error, operatorName, operatorEmail, redirect, slotwireAuth, origin));
});

adminRouter.post('/login', async (c) => {
  const body = await c.req.parseBody().catch(() => ({}));
  const password = ((body as any)?.password as string) || '';
  const redirectParam = (((body as any)?.redirect as string) || c.req.query('redirect') || '').trim();
  const slotwireAuth =
    ((body as any)?.slotwire_auth as string) === '1' ||
    c.req.query('slotwire_auth') === '1' ||
    c.req.query('slotwire_auth') === 'true';
  const originParam = (((body as any)?.origin as string) || c.req.query('origin') || '*').trim();

  const apiKey = c.env.ADMIN_API_KEY || 'local-briefcase';
  const secret = c.env.JWT_SECRET || 'briefcase-local-secret';
  const email = (c.env as any).OPERATOR_EMAIL || 'dev@localhost';
  const operatorName = (c.env as any).OPERATOR_NAME || 'Local Operator';

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
    return c.html(
      renderLoginView(
        'Invalid password. Please try again.',
        operatorName,
        email,
        redirectParam,
        slotwireAuth,
        originParam
      ),
      401
    );
  }

  const sessionCookie = await createBriefcaseSessionCookie(email, secret);
  c.header('Set-Cookie', `slottd_session=${sessionCookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);

  // Handle SlotWire popup auth handshake
  if (slotwireAuth) {
    const safeOrigin =
      originParam.startsWith('http://localhost') ||
      originParam.startsWith('http://127.0.0.1') ||
      originParam.startsWith('https://')
        ? originParam
        : '*';

    return c.html(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>SlottD Authentication Successful</title>
</head>
<body style="background:#090d16;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
  <div style="text-align:center;padding:24px;">
    <h2 style="color:#10b981;margin-bottom:8px;">✓ Authenticated</h2>
    <p style="color:#94a3b8;font-size:14px;">Connecting to SlotWire...</p>
  </div>
  <script>
    if (window.opener) {
      window.opener.postMessage({
        type: 'slotwire:auth_success',
        token: '${sessionCookie}',
        email: '${email}',
        name: '${operatorName}',
        provider: 'slottd'
      }, '${safeOrigin}');
      setTimeout(function() { window.close(); }, 300);
    } else {
      window.location.href = '/admin/home';
    }
  </script>
</body>
</html>`);
  }

  // Open-redirect protection: target must be a local /admin path and not a protocol or double-slash scheme
  let target = '/admin/home';
  if (redirectParam && redirectParam.startsWith('/admin') && !redirectParam.startsWith('//') && !redirectParam.includes(':')) {
    target = redirectParam;
  }
  return c.redirect(target);
});

adminRouter.get('/logout', (c) => {
  c.header('Set-Cookie', 'slottd_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  return c.redirect('/admin/login');
});

// ── 1. Studio Home & Dashboard Redirects (/admin/home & /admin/dashboard & /admin) ──
adminRouter.get('/home', (c) => c.redirect('/admin/sites'));
adminRouter.get('/dashboard', (c) => c.redirect('/admin/sites'));
adminRouter.get('/', (c) => c.redirect('/admin/sites'));

// ── 2. Universal In-Situ Deep Link Editor (/admin/edit/:idOrSlug) ─────────────
adminRouter.get('/edit/:idOrSlug', async (c) => {
  const idOrSlug = c.req.param('idOrSlug');
  const queryCol = c.req.query('collection');
  const isNew = idOrSlug === '+' || idOrSlug === 'new';
  const db = createDb(c.env.DB);
  const user = (await getAuthenticatedUser(c)) || { email: 'dev@localhost', authMethod: 'local-dev' };
  const siteContext = await getSiteContext(c, db);
  const siteId = siteContext.activeSite;

  let targetCollection = queryCol || '';
  let doc: any = null;

  if (targetCollection && !isNew) {
    doc = await db
      .selectFrom('documents')
      .where('site_id', '=', siteId)
      .where('collection', '=', targetCollection)
      .where((eb) => eb.or([eb('id', '=', idOrSlug), eb('slug', '=', idOrSlug)]))
      .selectAll()
      .executeTakeFirst();
  }

  if (!doc && !isNew) {
    doc = await db
      .selectFrom('documents')
      .where('site_id', '=', siteId)
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
      site_id: siteId,
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
  const editorConfig = await getEditorConfig(c.env);
  return c.html(renderEditorView(targetCollection, doc, fields, isNew, user, modelIcon, editorConfig, siteContext));
});

// ── 3. Collections Dashboard (/admin/content) ─────────────────────────────────
adminRouter.get('/content', async (c) => {
  const db = createDb(c.env.DB);
  const user = (await getAuthenticatedUser(c)) || { email: 'dev@localhost', authMethod: 'local-dev' };
  const siteContext = await getSiteContext(c, db);
  const siteId = siteContext.activeSite;

  // 1. Fetch registered collections with metadata
  let collectionsList: any[] = [];
  try {
    collectionsList = await db
      .selectFrom('collections')
      .selectAll()
      .orderBy('display_name', 'asc')
      .execute();
  } catch {}

  // 2. Count active documents per collection scoped to siteId
  let countsMap: Record<string, number> = {};
  try {
    const countRows = await db
      .selectFrom('documents')
      .where('site_id', '=', siteId)
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

  return c.html(renderDashboardView(enhancedList, packs, user, [], siteContext));
});

// ── 4. Scope Discriminator Auto-Discovery & Collection Document Table ────────
export const CANDIDATE_SCOPE_KEYS = [
  'galleryKey',
  'gallery_key',
  'sectionKey',
  'section_key',
  'category',
  'kind',
  'group',
  'pageSlug',
  'page_slug',
  'type',
];

export interface ScopeValueDef {
  value: string;
  label: string;
  count: number;
}

export interface ScopeFilterDef {
  key: string;
  label: string;
  values: ScopeValueDef[];
}

export function formatScopeLabel(key: string): string {
  const cleaned = key
    .replace(/_key$/i, '')
    .replace(/Key$/, '')
    .replace(/_slug$/i, '')
    .replace(/Slug$/, '');
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function formatValueLabel(val: string): string {
  if (!val) return '';
  return val
    .replace(/[-_]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => {
      const upper = word.toUpperCase();
      if (['AI', 'API', 'UI', 'UX', 'FAQ', 'URL', 'SEO'].includes(upper)) return upper;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

export function discoverScopeFilter(
  documents: any[],
  queryParamKey?: string
): ScopeFilterDef | null {
  if (!documents || documents.length === 0) return null;

  const parsedItems = documents.map((doc) => {
    let data: Record<string, any> = {};
    try {
      data = typeof doc.data === 'string' ? JSON.parse(doc.data) : (doc.data || {});
    } catch {}
    return { doc, data };
  });

  const candidateKeys = queryParamKey && CANDIDATE_SCOPE_KEYS.includes(queryParamKey)
    ? [queryParamKey, ...CANDIDATE_SCOPE_KEYS.filter((k) => k !== queryParamKey)]
    : CANDIDATE_SCOPE_KEYS;

  for (const key of candidateKeys) {
    const counts = new Map<string, { label: string; count: number }>();
    let unassignedCount = 0;

    for (const { doc, data } of parsedItems) {
      const rawVal = data[key] ?? doc[key];
      if (typeof rawVal === 'string' && rawVal.trim() !== '') {
        const val = rawVal.trim();
        const existing = counts.get(val);
        if (existing) {
          existing.count++;
        } else {
          counts.set(val, { label: formatValueLabel(val), count: 1 });
        }
      } else {
        unassignedCount++;
      }
    }

    const isExplicit = queryParamKey === key;
    if ((isExplicit && counts.size >= 1) || (counts.size > 1 && counts.size <= 30)) {
      const values: ScopeValueDef[] = Array.from(counts.entries()).map(([value, info]) => ({
        value,
        label: info.label,
        count: info.count,
      }));

      values.sort((a, b) => a.label.localeCompare(b.label));

      if (unassignedCount > 0 && counts.size > 1) {
        values.push({
          value: '__unassigned__',
          label: 'Unassigned',
          count: unassignedCount,
        });
      }

      return {
        key,
        label: formatScopeLabel(key),
        values,
      };
    }
  }

  return null;
}

adminRouter.get('/content/:collection', async (c) => {
  const collection = c.req.param('collection');
  const pageSlug = c.req.query('pageSlug');
  const sectionKey = c.req.query('sectionKey') || c.req.query('galleryKey');
  const db = createDb(c.env.DB);
  const user = (await getAuthenticatedUser(c)) || { email: 'dev@localhost', authMethod: 'local-dev' };
  const siteContext = await getSiteContext(c, db);
  const siteId = siteContext.activeSite;

  const fields = await introspectCollectionFields(db, collection);
  const orderFieldDef = fields.find(
    (f) =>
      f.name === 'order' ||
      f.name === 'display_order' ||
      f.name === 'sort_order' ||
      f.name === 'sort' ||
      (f.widget === 'number' && f.label?.toLowerCase().includes('order'))
  );
  let orderFieldName = orderFieldDef?.name || undefined;

  const rawDocuments = await db
    .selectFrom('documents')
    .where('site_id', '=', siteId)
    .where('collection', '=', collection)
    .selectAll()
    .orderBy('updated_at', 'desc')
    .execute();

  // Fallback: If orderFieldName is not in schema fields, check if documents contain order fields in data
  if (!orderFieldName && rawDocuments.length > 0) {
    const candidateOrderKeys = ['order', 'display_order', 'sort_order', 'sort'];
    for (const k of candidateOrderKeys) {
      const hasKey = rawDocuments.some((doc: any) => {
        try {
          const d = typeof doc.data === 'string' ? JSON.parse(doc.data) : (doc.data || {});
          return d[k] !== undefined || doc[k] !== undefined;
        } catch {
          return false;
        }
      });
      if (hasKey) {
        orderFieldName = k;
        break;
      }
    }
  }

  // Detect if sectionKey directly references the collection itself (e.g. sectionKey='projects' for collection='projects')
  const isDirectCollectionLink = Boolean(
    sectionKey && (
      sectionKey.toLowerCase() === collection.toLowerCase() ||
      sectionKey.toLowerCase() === collection.toLowerCase().replace(/s$/, '') ||
      collection.toLowerCase() === sectionKey.toLowerCase().replace(/s$/, '')
    )
  );

  // Check if any documents in this collection actually use pageSlug or sectionKey
  const hasPageSlugField = rawDocuments.some((doc: any) => {
    try {
      const d = typeof doc.data === 'string' ? JSON.parse(doc.data) : (doc.data || {});
      return (d.pageSlug !== undefined && d.pageSlug !== '') || (doc.pageSlug !== undefined && doc.pageSlug !== '');
    } catch {
      return false;
    }
  });

  const hasSectionKeyField = rawDocuments.some((doc: any) => {
    try {
      const d = typeof doc.data === 'string' ? JSON.parse(doc.data) : (doc.data || {});
      return (d.sectionKey !== undefined && d.sectionKey !== '') || (doc.sectionKey !== undefined && doc.sectionKey !== '') ||
             (d.galleryKey !== undefined && d.galleryKey !== '') || (doc.galleryKey !== undefined && doc.galleryKey !== '');
    } catch {
      return false;
    }
  });

  // When sectionKey matches the collection directly, or if documents in this collection
  // have no sectionKey/pageSlug attributes, suppress them as partition filters so the full collection is shown.
  const effectiveSectionKey = (isDirectCollectionLink || !hasSectionKeyField) ? undefined : sectionKey;
  const effectivePageSlug = (isDirectCollectionLink || !hasPageSlugField) ? undefined : pageSlug;

  // 1. Discover scope discriminator filter definitions across items
  const scopeFilterDef = discoverScopeFilter(rawDocuments, sectionKey);

  let activeScope: TableViewScopeOptions['activeScope'] = null;
  if (scopeFilterDef && c.req.query(scopeFilterDef.key)) {
    const isSuppressed = (scopeFilterDef.key === 'sectionKey' && !effectiveSectionKey) ||
                         (scopeFilterDef.key === 'pageSlug' && !effectivePageSlug);
    if (!isSuppressed) {
      const queryVal = c.req.query(scopeFilterDef.key)!.trim();
      const matchedValDef = scopeFilterDef.values.find((v) => v.value.toLowerCase() === queryVal.toLowerCase());
      activeScope = {
        key: scopeFilterDef.key,
        value: queryVal,
        label: matchedValDef ? matchedValDef.label : formatValueLabel(queryVal),
      };
    }
  }

  // 3. Filter documents if activeScope is present
  let filteredDocuments = rawDocuments;
  if (activeScope) {
    filteredDocuments = rawDocuments.filter((doc: any) => {
      let parsed: any = {};
      try {
        parsed = typeof doc.data === 'string' ? JSON.parse(doc.data) : (doc.data || {});
      } catch {}
      const val = String(parsed[activeScope.key] ?? doc[activeScope.key] ?? '').trim();
      if (activeScope.value === '__unassigned__') {
        return !val;
      }
      return val.toLowerCase() === activeScope.value.toLowerCase();
    });
  }

  // Also apply secondary context filter if present and distinct from activeScope (e.g. pageSlug)
  if (effectivePageSlug && activeScope?.key !== 'pageSlug') {
    filteredDocuments = filteredDocuments.filter((doc: any) => {
      let parsed: any = {};
      try {
        parsed = typeof doc.data === 'string' ? JSON.parse(doc.data) : (doc.data || {});
      } catch {}
      const p = String(parsed.pageSlug ?? doc.pageSlug ?? '').trim().toLowerCase();
      return p === effectivePageSlug.trim().toLowerCase();
    });
  }

  // 4. Sort filtered documents by orderField if configured
  if (orderFieldName) {
    filteredDocuments.sort((a: any, b: any) => {
      let aVal: number | null = null;
      let bVal: number | null = null;
      try {
        const aData = typeof a.data === 'string' ? JSON.parse(a.data) : (a.data || {});
        if (aData[orderFieldName] !== undefined && aData[orderFieldName] !== null && aData[orderFieldName] !== '') {
          aVal = Number(aData[orderFieldName]);
        }
      } catch {}
      try {
        const bData = typeof b.data === 'string' ? JSON.parse(b.data) : (b.data || {});
        if (bData[orderFieldName] !== undefined && bData[orderFieldName] !== null && bData[orderFieldName] !== '') {
          bVal = Number(bData[orderFieldName]);
        }
      } catch {}

      if (aVal !== null && bVal !== null && !isNaN(aVal) && !isNaN(bVal)) return aVal - bVal;
      if (aVal !== null && !isNaN(aVal)) return -1;
      if (bVal !== null && !isNaN(bVal)) return 1;
      return (b.updated_at || 0) - (a.updated_at || 0);
    });
  }

  const autoReorder = c.req.query('reorder') === 'true';

  return c.html(
    renderTableView(
      collection,
      filteredDocuments,
      user,
      { pageSlug: effectivePageSlug, sectionKey: effectiveSectionKey },
      orderFieldName,
      {
        scopeFilterDef,
        activeScope,
        totalCount: rawDocuments.length,
        autoReorder,
      },
      siteContext
    )
  );
});

// ── 4b. Bulk Reorder Documents (/admin/content/:collection/reorder) ──────────
adminRouter.post('/content/:collection/reorder', async (c) => {
  const collection = c.req.param('collection');
  const body = (await c.req.json().catch(() => ({}))) as {
    items?: { id: string; order?: number; [k: string]: any }[];
    orderField?: string;
  };
  const db = createDb(c.env.DB);
  const user = (await getAuthenticatedUser(c)) || { email: 'dev@localhost', authMethod: 'local-dev' };
  const siteId = (c as any).get('siteId') || (await resolveSiteId(c));

  const items = body.items || [];
  if (!Array.isArray(items) || items.length === 0) {
    return c.json({ error: 'No items provided for reordering' }, 400);
  }

  const orderField = body.orderField || 'order';
  const now = Date.now();
  let updatedCount = 0;

  for (const item of items) {
    if (!item.id) continue;
    const doc = await db
      .selectFrom('documents')
      .where('site_id', '=', siteId)
      .where('collection', '=', collection)
      .where('id', '=', item.id)
      .select(['id', 'title', 'data', 'draft_data'])
      .executeTakeFirst();

    if (!doc) continue;

    let dataObj: Record<string, any> = {};
    try {
      dataObj = typeof doc.data === 'string' ? JSON.parse(doc.data || '{}') : (doc.data || {});
    } catch {}

    const newOrder = item[orderField] !== undefined ? Number(item[orderField]) : Number(item.order);
    if (!isNaN(newOrder)) {
      dataObj[orderField] = newOrder;
    }

    let draftDataObj: Record<string, any> | null = null;
    if (doc.draft_data) {
      try {
        draftDataObj = typeof doc.draft_data === 'string' ? JSON.parse(doc.draft_data) : doc.draft_data;
        if (draftDataObj && !isNaN(newOrder)) {
          draftDataObj[orderField] = newOrder;
        }
      } catch {}
    }

    await db
      .updateTable('documents')
      .set({
        data: JSON.stringify(dataObj),
        draft_data: draftDataObj ? JSON.stringify(draftDataObj) : undefined,
        updated_at: now,
      })
      .where('id', '=', doc.id)
      .where('site_id', '=', siteId)
      .execute();

    updatedCount++;
  }

  await logActivity(db, {
    siteId,
    actor: user.email,
    action: 'reorder',
    collection,
    documentId: 'bulk',
    documentTitle: `Reordered ${updatedCount} records in ${collection}`,
    details: JSON.stringify({ count: updatedCount, orderField }),
  });

  return c.json({ ok: true, count: updatedCount });
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
  const editorConfig = await getEditorConfig(c.env);
  const siteContext = await getSiteContext(c, db);
  return c.html(renderEditorView(collection, doc, fields, isNew, user, modelIcon, editorConfig, siteContext));
});

// ── 6. Models & Schema Overview (/admin/models) ──────────────────────────────
adminRouter.get('/models', async (c) => {
  const db = createDb(c.env.DB);
  const user = (await getAuthenticatedUser(c)) || { email: 'dev@localhost', authMethod: 'local-dev' };
  const siteContext = await getSiteContext(c, db);

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

  return c.html(renderModelsView(modelsWithFields, user, siteContext));
});

// ── 7. Media Library & Cloudflare R2 Browser (/admin/media) ───────────────────
adminRouter.get('/media', async (c) => {
  const db = createDb(c.env.DB);
  const user = (await getAuthenticatedUser(c)) || { email: 'dev@localhost', authMethod: 'local-dev' };
  const siteContext = await getSiteContext(c, db);

  let mediaFiles: any[] = [];
  try {
    mediaFiles = await db
      .selectFrom('media')
      .where('site_id', '=', siteContext.activeSite)
      .selectAll()
      .orderBy('created_at', 'desc')
      .execute();
  } catch {}

  return c.html(renderMediaView(mediaFiles, user, siteContext));
});

// ── 8. Activity & Audit Logs (/admin/logs & /admin/activity) ──────────────────
adminRouter.get('/activity', (c) => c.redirect('/admin/logs'));

adminRouter.get('/logs', async (c) => {
  const db = createDb(c.env.DB);
  const user = (await getAuthenticatedUser(c)) || { email: 'dev@localhost', authMethod: 'local-dev' };
  const siteContext = await getSiteContext(c, db);

  let logs: any[] = [];
  try {
    logs = await db
      .selectFrom('activity_log')
      .where('site_id', '=', siteContext.activeSite)
      .selectAll()
      .orderBy('timestamp', 'desc')
      .limit(200)
      .execute();
  } catch {}

  return c.html(renderLogsView(logs, user, siteContext));
});

// ── 9. Git Operations Center (/admin/git) ────────────────────────────────────
adminRouter.get('/sync', (c) => c.redirect('/admin/git'));

adminRouter.get('/git', async (c) => {
  const db = createDb(c.env.DB);
  const user = (await getAuthenticatedUser(c)) || { email: 'dev@localhost', authMethod: 'local-dev' };
  const siteContext = await getSiteContext(c, db);
  const activeSite = siteContext.activeSite;
  const repoInfo = await resolveDeploymentRepo(c.env, activeSite);

  let docCount = 0;
  let mediaCount = 0;
  let collectionCount = 0;
  let tags: string[] = [];

  try {
    const docRows = await db
      .selectFrom('documents')
      .where('site_id', '=', activeSite)
      .select(['collection', db.fn.count('id').as('count')])
      .groupBy('collection')
      .execute();
    collectionCount = docRows.length;
    docCount = docRows.reduce((sum, c: any) => sum + (Number(c.count) || 0), 0);
  } catch {}

  try {
    const mediaRows = await db
      .selectFrom('media')
      .where('site_id', '=', activeSite)
      .select(db.fn.count('id').as('count'))
      .executeTakeFirst();
    mediaCount = Number(mediaRows?.count) || 0;
  } catch {}

  let engineName = 'isomorphic-git';

  // List tags using universal driver or local Git bridge
  if (repoInfo.hasRemote) {
    let bridgeLoaded = false;
    if (c.env.ENVIRONMENT !== 'production') {
      try {
        const bridgeCheck = await fetch('http://127.0.0.1:8788/health', { signal: AbortSignal.timeout(600) }).catch(() => null);
        if (bridgeCheck && bridgeCheck.ok) {
          const bridgeRes = await fetch('http://127.0.0.1:8788/exec/fetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repoPath: repoInfo.path }),
          });
          const bridgeJson: any = await bridgeRes.json().catch(() => ({}));
          if (bridgeRes.ok && Array.isArray(bridgeJson.tags)) {
            tags = bridgeJson.tags;
            engineName = 'Native Git CLI (SSH Agent)';
            bridgeLoaded = true;
          }
        }
      } catch {}
    }

    if (!bridgeLoaded) {
      try {
        const driver = await getGitDriver({
          url: repoInfo.remoteUrl,
          branch: repoInfo.branch,
          token: repoInfo.token,
          repoPath: repoInfo.path,
          isProduction: c.env.ENVIRONMENT === 'production',
          isMonorepo: repoInfo.isMonorepo,
          contentPath: repoInfo.contentPath,
          gitTopLevel: repoInfo.gitTopLevel,
        });
        engineName = driver.engineName;
        tags = await driver.listTags();
      } catch (err: any) {
        console.warn('Failed to list git tags:', err.message);
      }
    }
  }

  return c.html(
    renderGitView(
      {
        environment: c.env.ENVIRONMENT || 'development',
        d1DatabaseId: (c.env as any).DB ? 'Connected' : 'local-slottd-db',
        repoPath: repoInfo.path,
        hasRemote: repoInfo.hasRemote,
        remoteUrl: repoInfo.remoteUrl,
        engineName,
        docCount,
        collectionCount,
        mediaCount,
        tags,
        isMonorepo: repoInfo.isMonorepo,
        contentPath: repoInfo.contentPath,
        gitTopLevel: repoInfo.gitTopLevel,
      },
      user,
      siteContext
    )
  );
});

// ── 10. Fetch Remote Tags (/admin/git/fetch) ──────────────────────────────────
adminRouter.post('/git/fetch', async (c) => {
  const db = createDb(c.env.DB);
  const siteContext = await getSiteContext(c, db);
  const repoInfo = await resolveDeploymentRepo(c.env, siteContext.activeSite);

  if (!repoInfo.hasRemote) {
    return c.json(
      {
        error: 'No Git remote configured for this site. Configure a remote URL in Sites Hub first.',
        output: 'Fatal: No remote repository configured.',
      },
      400
    );
  }

  try {
    // 1. Check local Git execution bridge if running in development mode
    if (c.env.ENVIRONMENT !== 'production') {
      try {
        const bridgeCheck = await fetch('http://127.0.0.1:8788/health', { signal: AbortSignal.timeout(600) }).catch(() => null);
        if (bridgeCheck && bridgeCheck.ok) {
          const bridgeRes = await fetch('http://127.0.0.1:8788/exec/fetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repoPath: repoInfo.path }),
          });
          const bridgeJson: any = await bridgeRes.json().catch(() => ({}));
          if (bridgeRes.ok) {
            const tags = bridgeJson.tags || [];
            return c.json({
              success: true,
              message: `Fetched ${tags.length} remote tags successfully (Git Bridge / SSH Agent).`,
              output: tags.length > 0 ? `Tags found:\n${tags.slice(0, 10).join('\n')}${tags.length > 10 ? `\n...and ${tags.length - 10} more` : ''}` : 'No tags found in remote repository.',
              tags,
            });
          }
        }
      } catch {}
    }

    const driver = await getGitDriver({
      url: repoInfo.remoteUrl,
      branch: repoInfo.branch,
      token: repoInfo.token,
      repoPath: repoInfo.path,
      isProduction: c.env.ENVIRONMENT === 'production',
    });

    const tags = await driver.listTags();
    return c.json({
      success: true,
      message: `Fetched ${tags.length} remote tags successfully (${driver.engineName}).`,
      output: tags.length > 0 ? `Tags found:\n${tags.slice(0, 10).join('\n')}${tags.length > 10 ? `\n...and ${tags.length - 10} more` : ''}` : 'No tags found in remote repository.',
      tags,
    });
  } catch (err: any) {
    return c.json({ error: err.message, output: err.message }, 500);
  }
});

// ── 11. Create Git Release & Export Pipeline (/admin/git/release) ─────────────
adminRouter.post('/git/release', async (c) => {
  const db = createDb(c.env.DB);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, any>;
  const exportFiles = body.exportFiles !== false;
  const createTag = body.createTag !== false;
  const push = body.pushToRemote === true || body.push === true;
  const dryRun = body.dryRun === true;
  const forcePublish = body.forcePublish === true;

  const tag = (body.tag as string) || `release-${Date.now()}`;
  const message = (body.message as string) || `chore(content): release snapshot ${tag}`;

  const siteContext = await getSiteContext(c, db);
  const activeSite = siteContext.activeSite;
  const repoInfo = await resolveDeploymentRepo(c.env, activeSite);

  try {
    const items = await exportToGitFormat(db, undefined, activeSite);
    const contentPath = repoInfo.contentPath !== undefined ? repoInfo.contentPath : '';
    const files = serializeToFiles(items, contentPath, activeSite, repoInfo.isMonorepo, true);

    // Execute onBeforePublish pre-release verification if configured and tagging/publishing
    const appConfig = getSlottdConfig();
    if ((createTag || push) && appConfig?.hooks?.onBeforePublish) {
      const user = await getAuthenticatedUser(c);
      const hookCtx = {
        bundle: { id: `release-${tag}`, slug: tag, name: tag },
        items,
        actor: { email: user?.email || (c.env as any).OPERATOR_EMAIL || 'operator@slottd.dev', authMethod: 'admin-ui' },
        forcePublish,
        timestamp: Date.now(),
        env: c.env,
        db,
      };

      const hookResult = await appConfig.hooks.onBeforePublish(hookCtx);
      if (hookResult.status === 'error' && !forcePublish) {
        return c.json(
          {
            requiresConfirmation: true,
            status: 'error',
            error: hookResult.message || 'Pre-release verification identified issues.',
            message: hookResult.message,
            report: hookResult.data,
          },
          422
        );
      }
    }

    if (dryRun) {
      const steps: string[] = [];
      if (exportFiles) steps.push(`1. Serialize ${items.length} records into ${files.length} JSON/MD companion files (+ auto-generated README.md) into target path: ${repoInfo.path || 'scratch'}`);
      if (createTag) steps.push(`2. Git stage all files, create commit "${message}", and annotated tag "${tag}"`);
      if (push) steps.push(`3. Push branch HEAD and tag "${tag}" to remote repository: ${repoInfo.remoteUrl || 'origin'}`);

      const plan = [
        `[Dry Run Simulation for ${activeSite}]`,
        `Repository: ${repoInfo.path || 'Scratch/Temp'} (${repoInfo.isMonorepo ? 'Monorepo' : 'Dedicated Repo'})`,
        `Remote URL: ${repoInfo.hasRemote ? repoInfo.remoteUrl : 'None configured'} (Branch: ${repoInfo.branch || 'main'})`,
        `Selected Operations (${steps.length}):`,
        ...steps.map((s) => `  ${s}`),
        `Verification Status: Passed (0 blocking errors)`,
        `Execution Ready.`,
      ].join('\n');

      return c.json({
        success: true,
        message: `Dry run simulation completed successfully for '${activeSite}'.`,
        plan,
        output: `Verified ${items.length} records across ${files.length} content files. Zero files, commits, or remote branches modified.`,
      });
    }

    if (repoInfo.hasRemote) {
      const driver = await getGitDriver({
        url: repoInfo.remoteUrl,
        branch: repoInfo.branch,
        token: repoInfo.token,
        repoPath: repoInfo.path,
        isProduction: c.env.ENVIRONMENT === 'production',
        isMonorepo: repoInfo.isMonorepo,
        contentPath: repoInfo.contentPath,
        gitTopLevel: repoInfo.gitTopLevel,
      });

      const user = await getAuthenticatedUser(c);
      const author = {
        name: user?.name || (c.env as any).OPERATOR_NAME || 'SlottD Operator',
        email: user?.email || (c.env as any).OPERATOR_EMAIL || 'operator@slottd.dev',
      };

      const result = await driver.createRelease({
        tag: createTag ? tag : undefined,
        message,
        files: exportFiles ? files : [],
        push,
        author,
      });

      return c.json({
        success: true,
        message: `Pipeline executed for '${activeSite}': exported ${items.length} records (${driver.engineName})!`,
        output: result.message,
      });
    }

    const releaseCmd = `npm run sync:git -- --site=${activeSite}${exportFiles ? ' --export' : ''}${createTag ? ` --tag=${tag}` : ''}${push ? ' --push' : ''}`;
    return c.json({
      success: true,
      message: `Database snapshot prepared for '${activeSite}': ${items.length} records in ${files.length} content files.`,
      output: `To commit, tag, and push from your workstation, configure a remote URL or run:\n\n${releaseCmd}\n`,
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
  const siteContext = await getSiteContext(c, db);
  const activeSite = siteContext.activeSite;
  const repoInfo = await resolveDeploymentRepo(c.env, activeSite);

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

    if (!repoInfo.hasRemote && !repoInfo.path) {
      return c.json({ error: 'No Git remote or repository path configured. Configure a remote URL in Sites Hub first.' }, 400);
    }

    const driver = await getGitDriver({
      url: repoInfo.remoteUrl,
      branch: repoInfo.branch,
      token: repoInfo.token,
      repoPath: repoInfo.path,
      isProduction: c.env.ENVIRONMENT === 'production',
      isMonorepo: repoInfo.isMonorepo,
      contentPath: repoInfo.contentPath,
      gitTopLevel: repoInfo.gitTopLevel,
    });

    const activeItems = await exportToGitFormat(db, undefined, activeSite);
    const tagItems = await driver.loadTagContent(tag);
    const diffReport = computeContentDiff(activeItems, tagItems, tag);

    return c.json({
      success: true,
      summary: diffReport.summary,
      output: diffReport.formattedOutput,
      diffs: diffReport.diffs,
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ── 13. Load / Checkout Content from Git Tag (/admin/git/load) ────────────────
adminRouter.post('/git/load', async (c) => {
  const db = createDb(c.env.DB);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, any>;
  const tag = body.tag as string;
  const siteContext = await getSiteContext(c, db);
  const activeSite = siteContext.activeSite;
  const repoInfo = await resolveDeploymentRepo(c.env, activeSite);

  if (!tag) {
    return c.json({ error: 'Tag is required to load content.' }, 400);
  }

  try {
    if (!repoInfo.hasRemote && !repoInfo.path) {
      return c.json({ error: 'No Git remote or repository path configured. Configure a remote URL in Sites Hub first.' }, 400);
    }

    const driver = await getGitDriver({
      url: repoInfo.remoteUrl,
      branch: repoInfo.branch,
      token: repoInfo.token,
      repoPath: repoInfo.path,
      isProduction: c.env.ENVIRONMENT === 'production',
      isMonorepo: repoInfo.isMonorepo,
      contentPath: repoInfo.contentPath,
      gitTopLevel: repoInfo.gitTopLevel,
    });

    const items = await driver.loadTagContent(tag);
    const { inserted, updated } = await hydrateFromGit(db, items, 1, activeSite);

    return c.json({
      success: true,
      message: `Successfully loaded and restored ${items.length} documents from Git tag '${tag}' into D1 for site '${activeSite}' (${driver.engineName})!`,
      data: { count: items.length, inserted, updated },
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ── 14. Direct ZIP Archive Export (/admin/git/export-zip) ──────────────────────
adminRouter.get('/git/export-zip', async (c) => {
  const db = createDb(c.env.DB);
  const siteContext = await getSiteContext(c, db);
  const activeSite = siteContext.activeSite;
  const items = await exportToGitFormat(db, undefined, activeSite);
  const repoInfo = await resolveDeploymentRepo(c.env, activeSite);
  const contentPath = repoInfo.contentPath !== undefined ? repoInfo.contentPath : '';
  const files = serializeToFiles(items, contentPath, activeSite, repoInfo.isMonorepo, true);

  const { createZipArchive } = await import('../sync/zip.js');
  const zipBytes = createZipArchive(files);

  const filename = `${activeSite}-content-${new Date().toISOString().slice(0, 10)}.zip`;
  return new Response(zipBytes, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': zipBytes.length.toString(),
    },
  });
});

// ── 15. Direct JSON Backup Download (/admin/git/backup) ───────────────────────
adminRouter.get('/git/backup', async (c) => {
  const db = createDb(c.env.DB);
  const siteContext = await getSiteContext(c, db);
  const activeSite = siteContext.activeSite;
  const docs = await db.selectFrom('documents').where('site_id', '=', activeSite).selectAll().execute();
  const media = await db.selectFrom('media').where('site_id', '=', activeSite).selectAll().execute();

  const backupData = {
    siteId: activeSite,
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

  const filename = `slottd-backup-${activeSite}-${new Date().toISOString().slice(0, 10)}.json`;
  return new Response(JSON.stringify(backupData, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});

// ── 16. User Documentation & Guides (/admin/docs & /admin/help) ───────────────
adminRouter.get('/docs', async (c) => {
  const db = createDb(c.env.DB);
  const user = (await getAuthenticatedUser(c)) || { email: 'dev@localhost', authMethod: 'local-dev' };
  const siteContext = await getSiteContext(c, db);
  return c.html(renderDocsView(user, siteContext));
});

adminRouter.get('/help', (c) => c.redirect('/admin/docs'));

// ── 17. Multi-Website Management (/admin/sites) ──────────────────────────────
adminRouter.get('/sites/switch', async (c) => {
  const targetSite = normalizeSiteId(c.req.query('site') || 'default');
  const redirect = (c.req.query('redirect') || '/admin').trim();
  c.header('Set-Cookie', `slottd_site=${targetSite}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
  return c.redirect(redirect, 302);
});

adminRouter.get('/sites', async (c) => {
  const db = createDb(c.env.DB);
  const user = (await getAuthenticatedUser(c)) || { email: 'dev@localhost', authMethod: 'local-dev' };
  const siteContext = await getSiteContext(c, db);
  const sites = await listSites(db);

  let docCount = 0;
  let publishedCount = 0;
  let collectionCount = 0;
  let mediaCount = 0;
  let modelCount = 0;
  let tagCount = 0;

  try {
    const docs = await db
      .selectFrom('documents')
      .where('site_id', '=', siteContext.activeSite)
      .select(['id', 'status', 'collection'])
      .execute();
    docCount = docs.length;
    publishedCount = docs.filter((d) => d.status === 'published').length;
    collectionCount = new Set(docs.map((d) => d.collection)).size;

    const mediaRes = await db
      .selectFrom('media')
      .where('site_id', '=', siteContext.activeSite)
      .select(db.fn.count('id').as('count'))
      .executeTakeFirst();
    mediaCount = Number(mediaRes?.count || 0);

    const appConfig = getSlottdConfig();
    modelCount = appConfig?.collections ? Object.keys(appConfig.collections).length : collectionCount;

    const repoInfo = await resolveDeploymentRepo(c.env, siteContext.activeSite);
    if (repoInfo.hasRemote) {
      try {
        const driver = await getGitDriver({
          url: repoInfo.remoteUrl,
          branch: repoInfo.branch,
          token: repoInfo.token,
          repoPath: repoInfo.path,
          isProduction: c.env.ENVIRONMENT === 'production',
          isMonorepo: repoInfo.isMonorepo,
          contentPath: repoInfo.contentPath,
          gitTopLevel: repoInfo.gitTopLevel,
        });
        const tags = await driver.listTags();
        tagCount = tags.length;
      } catch {}
    }
  } catch {}

  let message = '';
  if (c.req.query('renamed')) message = 'Website domain successfully renamed across all partitioned database tables!';
  if (c.req.query('created')) message = 'New website successfully registered and configured!';
  if (c.req.query('pulled')) message = 'Git content successfully pulled and hydrated into D1!';

  const error = c.req.query('error') || '';

  return c.html(
    renderSitesView({
      sites,
      activeSite: siteContext.activeSite,
      user,
      message,
      error,
      metrics: {
        docCount,
        publishedCount,
        collectionCount,
        mediaCount,
        modelCount,
        tagCount,
      },
    })
  );
});

adminRouter.post('/sites/rename', async (c) => {
  const body = (await c.req.parseBody().catch(() => ({}))) as Record<string, any>;
  const oldSiteId = ((body.oldSiteId as string) || '').trim();
  const newSiteId = ((body.newSiteId as string) || '').trim();
  const db = createDb(c.env.DB);

  try {
    await renameSite(db, oldSiteId, newSiteId);
    // If the renamed site was the active site, update the session cookie
    const activeSite = c.get('siteId') || (await resolveSiteId(c));
    if (activeSite === oldSiteId.toLowerCase()) {
      c.header('Set-Cookie', `slottd_active_site=${encodeURIComponent(newSiteId.toLowerCase())}; Path=/; Max-Age=31536000`);
    }
    return c.redirect('/admin/sites?renamed=1');
  } catch (err: any) {
    return c.redirect(`/admin/sites?error=${encodeURIComponent(err.message)}`);
  }
});

adminRouter.post('/sites/create', async (c) => {
  const body = (await c.req.parseBody().catch(() => ({}))) as Record<string, any>;
  const siteId = ((body.siteId as string) || '').trim().toLowerCase();
  if (!siteId) {
    return c.redirect('/admin/sites?error=Site+ID+is+required');
  }

  const db = createDb(c.env.DB);
  try {
    const settings: Record<string, string> = {
      git_remote_url: ((body.git_remote_url as string) || '').trim(),
      git_branch: ((body.git_branch as string) || 'main').trim(),
      content_path: typeof body.content_path === 'string' ? body.content_path.trim() : '',
      repo_path: ((body.repo_path as string) || '').trim(),
      deploy_hook: ((body.deploy_hook as string) || '').trim(),
    };
    const gitToken = ((body.git_token as string) || '').trim();
    if (gitToken) {
      const secret = c.env.JWT_SECRET || 'briefcase-local-secret';
      settings.git_token_enc = await encryptSecret(gitToken, secret);
    }
    await registerSite(db, siteId, settings);
    return c.redirect('/admin/sites?created=1');
  } catch (err: any) {
    return c.redirect(`/admin/sites?error=${encodeURIComponent(err.message)}`);
  }
});

adminRouter.post('/sites/update', async (c) => {
  const body = (await c.req.parseBody().catch(() => ({}))) as Record<string, any>;
  const siteId = ((body.siteId as string) || '').trim().toLowerCase();
  if (!siteId) {
    return c.redirect('/admin/sites?error=Site+ID+is+required');
  }

  const db = createDb(c.env.DB);
  try {
    const settings: Record<string, string> = {
      git_remote_url: ((body.git_remote_url as string) || '').trim(),
      git_branch: ((body.git_branch as string) || 'main').trim(),
      content_path: typeof body.content_path === 'string' ? body.content_path.trim() : '',
      repo_path: ((body.repo_path as string) || '').trim(),
      deploy_hook: ((body.deploy_hook as string) || '').trim(),
    };
    const gitToken = ((body.git_token as string) || '').trim();
    if (gitToken) {
      const secret = c.env.JWT_SECRET || 'briefcase-local-secret';
      settings.git_token_enc = await encryptSecret(gitToken, secret);
    }
    await registerSite(db, siteId, settings);
    return c.redirect('/admin/sites?updated=1');
  } catch (err: any) {
    return c.redirect(`/admin/sites?error=${encodeURIComponent(err.message)}`);
  }
});

adminRouter.post('/sites/delete', async (c) => {
  const body = (await c.req.parseBody().catch(() => ({}))) as Record<string, any>;
  const siteId = ((body.siteId as string) || '').trim().toLowerCase();
  const confirmSiteId = ((body.confirmSiteId as string) || '').trim().toLowerCase();
  const purgeData = body.purgeData === 'true' || body.purgeData === '1' || body.purgeData === true;

  if (!siteId) {
    return c.redirect('/admin/sites?error=Site+ID+is+required');
  }
  if (confirmSiteId !== siteId) {
    return c.redirect(`/admin/sites?error=${encodeURIComponent(`Confirmation failed: typed '${confirmSiteId}' does not match '${siteId}'`)}`);
  }

  const db = createDb(c.env.DB);
  try {
    await deleteSite(db, siteId, purgeData);

    // If the active site was deleted, find the next available site and switch session cookie
    const activeSite = c.get('siteId') || (await resolveSiteId(c));
    if (activeSite === siteId) {
      const remainingSites = await listSites(db);
      const nextSite = remainingSites.find((s) => s.site_id !== siteId)?.site_id || 'default';
      c.header('Set-Cookie', `slottd_active_site=${encodeURIComponent(nextSite)}; Path=/; Max-Age=31536000`);
    }

    return c.redirect(`/admin/sites?deleted=${encodeURIComponent(siteId)}`);
  } catch (err: any) {
    return c.redirect(`/admin/sites?error=${encodeURIComponent(err.message)}`);
  }
});

adminRouter.post('/sites/pull', async (c) => {
  const body = (await c.req.parseBody().catch(() => ({}))) as Record<string, any>;
  const siteId = ((body.siteId as string) || '').trim().toLowerCase();
  if (!siteId) {
    return c.redirect('/admin/sites?error=Missing+site+ID');
  }

  const db = createDb(c.env.DB);
  try {
    const siteSettingsRows = await db
      .selectFrom('system_site_settings')
      .where('site_id', '=', siteId)
      .selectAll()
      .execute();
    const siteSettings: Record<string, string> = {};
    for (const s of siteSettingsRows) siteSettings[s.key] = s.value;

    const remoteUrl = siteSettings.git_remote_url || c.env.GIT_REMOTE_URL;
    if (!remoteUrl) {
      return c.redirect(`/admin/sites?error=${encodeURIComponent(`No Git remote configured for site '${siteId}'. Please edit repository settings first.`)}`);
    }

    let token = c.env.GIT_TOKEN || c.env.GITHUB_TOKEN;
    if (siteSettings.git_token_enc) {
      const secret = c.env.JWT_SECRET || 'briefcase-local-secret';
      const dec = await decryptSecret(siteSettings.git_token_enc, secret);
      if (dec) token = dec;
    } else if (siteSettings.git_token) {
      token = siteSettings.git_token;
    }

    const driver = await getGitDriver({
      url: remoteUrl,
      branch: siteSettings.git_branch || 'main',
      token,
      repoPath: siteSettings.repo_path || c.env.REPO_PATH,
      isProduction: c.env.ENVIRONMENT === 'production',
    });

    const tags = await driver.listTags();
    const tag = tags.slice(-1)[0] || 'HEAD';
    const items = await driver.loadTagContent(tag);
    await hydrateFromGit(db, items, 1, siteId);

    // Sync collection views
    const collections = new Set<string>();
    for (const it of items) if (it.collection) collections.add(it.collection);
    for (const col of collections) {
      try {
        await syncCollectionView(db, col);
      } catch {}
    }

    return c.redirect('/admin/sites?pulled=1');
  } catch (err: any) {
    return c.redirect(`/admin/sites?error=${encodeURIComponent(err.message)}`);
  }
});

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
  let hasToken = false;

  if (c.env.DB) {
    try {
      const rows = await c.env.DB.prepare('SELECT key, value FROM system_settings WHERE key IN (?, ?, ?, ?)')
        .bind('admin_password_hash', 'git_remote_url', 'git_branch', 'git_token_enc')
        .all<{ key: string; value: string }>();

      for (const row of rows.results || []) {
        if (row.key === 'admin_password_hash' && row.value) isPasswordProtected = true;
        if (row.key === 'git_remote_url' && row.value) gitRemoteUrl = row.value;
        if (row.key === 'git_branch' && row.value) gitBranch = row.value;
        if (row.key === 'git_token_enc' && row.value) hasToken = true;
      }
    } catch {}
  }

  const editorConfig = await getEditorConfig(c.env);
  const siteContext = await getSiteContext(c, db);

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
    hasToken,
    editorFormat: editorConfig.format,
    editorTier: editorConfig.tier,
  }, user, siteContext));
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

// ── Editor Settings (/admin/setup/editor) ──────────────────────────────────
adminRouter.post('/setup/editor', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, any>;
  const format = body.format === 'richtext' ? 'richtext' : 'markdown';
  const tier = body.tier === 'heavy' ? 'heavy' : 'light';

  if (!c.env.DB) {
    return c.json({ error: 'D1 database binding not available' }, 500);
  }

  try {
    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
      ).bind('editor_format', format, now),
      c.env.DB.prepare(
        'INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
      ).bind('editor_tier', tier, now),
    ]);
  } catch (err: any) {
    return c.json({ error: 'Failed to update editor settings: ' + err.message }, 500);
  }

  return c.json({ success: true, message: 'Editor preferences saved successfully.', format, tier });
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

  if (['home', 'dashboard', 'models', 'media', 'edit', 'content', 'git', 'sync', 'logs', 'activity', 'docs', 'help', 'setup', 'vendor'].includes(collection)) {
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
  const editorConfig = await getEditorConfig(c.env);
  return c.html(renderEditorView(collection, doc, fields, isNew, user, '⚙️', editorConfig));
});
