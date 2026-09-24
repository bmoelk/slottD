import { describe, it, expect, vi } from 'vitest';
import app from '../src/index.js';
import { resolveSiteId, normalizeSiteId, SiteResolutionError } from '../src/auth/site.js';
import { renameSite, listSites, registerSite } from '../src/admin/sites.js';
import { hydrateFromGit } from '../src/sync/git-sync.js';
import { createDb } from '../src/db/client.js';

describe('SlottD Multi-Site Architecture & Tenancy', () => {
  describe('Site ID Normalization & Resolution Priority', () => {
    it('normalizes domain identifiers to clean lowercase URL-safe slugs', () => {
      expect(normalizeSiteId('Example.COM')).toBe('example.com');
      expect(normalizeSiteId('https://sub.domain.org:8787/path?query=1')).toBe('sub.domain.org');
      expect(normalizeSiteId('  my-site.dev  ')).toBe('my-site.dev');
      expect(() => normalizeSiteId('')).toThrow(SiteResolutionError);
    });

    it('resolves site ID with strict precedence (user siteId > directus filter > query ?site > cookie > host > default)', async () => {
      // 1. Authenticated User siteId precedence over query and host
      const mockUserCtx: any = {
        get: (k: string) => (k === 'user' ? { email: 'token@user-site.com', siteId: 'user-site.com' } : null),
        req: {
          header: () => null,
          query: () => 'filter-site.com',
          raw: new Request('http://host-domain.com/items/posts?filter[site_id][_eq]=filter-site.com'),
        },
        env: {},
      };
      const site1 = await resolveSiteId(mockUserCtx);
      expect(site1).toBe('user-site.com');

      // 2. Directus query filter (filter[site_id][_eq]) precedence over ?site_id and cookie
      const req2 = new Request('http://host-domain.com/items/posts?filter[site_id][_eq]=directus-filter.com&site_id=query-site.com', {
        headers: {
          cookie: 'slottd_site=cookie-site.com',
        },
      });
      const site2 = await resolveSiteId({
        get: () => null,
        req: {
          header: (k: string) => req2.headers.get(k),
          query: (k: string) => new URL(req2.url).searchParams.get(k),
          raw: req2,
        },
        env: {},
      } as any);
      expect(site2).toBe('directus-filter.com');

      // 3. Directus JSON filter precedence
      const req3 = new Request('http://host-domain.com/items/posts?filter=' + encodeURIComponent('{"site_id":{"_eq":"json-site.com"}}'), {
        headers: {
          cookie: 'slottd_site=cookie-site.com',
        },
      });
      const site3 = await resolveSiteId({
        get: () => null,
        req: {
          header: (k: string) => req3.headers.get(k),
          query: (k: string) => new URL(req3.url).searchParams.get(k),
          raw: req3,
        },
        env: {},
      } as any);
      expect(site3).toBe('json-site.com');

      // 4. Query param (?site_id=) precedence over cookie and host
      const req4 = new Request('http://host-domain.com/items/posts?site_id=query-site.com', {
        headers: {
          cookie: 'slottd_site=cookie-site.com',
        },
      });
      const site4 = await resolveSiteId({
        get: () => null,
        req: {
          header: (k: string) => req4.headers.get(k),
          query: (k: string) => new URL(req4.url).searchParams.get(k),
          raw: req4,
        },
        env: {},
      } as any);
      expect(site4).toBe('query-site.com');

      // 5. Deprecated custom header x-slottd-site is ignored
      const req5 = new Request('http://host-domain.com/items/posts', {
        headers: {
          'x-slottd-site': 'ignored-header.com',
          cookie: 'slottd_site=cookie-site.com',
        },
      });
      const site5 = await resolveSiteId({
        get: () => null,
        req: {
          header: (k: string) => req5.headers.get(k),
          query: (k: string) => new URL(req5.url).searchParams.get(k),
          raw: req5,
        },
        env: {},
      } as any);
      expect(site5).toBe('cookie-site.com'); // Fell through to cookie because header was ignored

      // 6. Cookie precedence over host
      const req6 = new Request('http://host-domain.com/items/posts', {
        headers: {
          cookie: 'slottd_site=cookie-site.com',
        },
      });
      const site6 = await resolveSiteId({
        get: () => null,
        req: {
          header: (k: string) => req6.headers.get(k),
          query: (k: string) => new URL(req6.url).searchParams.get(k),
          raw: req6,
        },
        env: {},
      } as any);
      expect(site6).toBe('cookie-site.com');

      // 7. Fallback to DEFAULT_SITE_ID env variable
      const req7 = new Request('http://localhost:8787/items/posts');
      const site7 = await resolveSiteId({
        get: () => null,
        req: {
          header: (k: string) => req7.headers.get(k),
          query: (k: string) => new URL(req7.url).searchParams.get(k),
          raw: req7,
        },
        env: { DEFAULT_SITE_ID: 'configured-default.org' },
      } as any);
      expect(site7).toBe('configured-default.org');

      // 8. Rejects with SiteResolutionError when no site context or env var is set
      await expect(
        resolveSiteId({
          get: () => null,
          req: {
            header: () => null,
            query: () => null,
            raw: req7,
          },
          env: {},
        } as any)
      ).rejects.toThrow(SiteResolutionError);
    });

    it('honors domain referral alias when ALLOW_DOMAIN_REFERRAL_FALLBACK is enabled', async () => {
      const mockEnv: any = {
        ALLOW_DOMAIN_REFERRAL_FALLBACK: true,
        DB: {
          prepare: vi.fn().mockImplementation((sql: string) => ({
            bind: vi.fn().mockReturnThis(),
            first: vi.fn().mockImplementation(async () => {
              if (sql.includes('site_domain_referrals')) {
                return { target_site_id: 'primary-brand.com' };
              }
              return null;
            }),
          })),
        },
      };

      const req = new Request('http://alias-brand.io/items/posts', {
        headers: { host: 'alias-brand.io' },
      });
      const site = await resolveSiteId({ req: { header: (k: string) => req.headers.get(k), query: () => null, raw: req }, env: mockEnv } as any);
      expect(site).toBe('primary-brand.com');
    });
  });

  describe('Rigid Slot Isolation & Duplicate Slug Coexistence', () => {
    it('allows identical slugs across different sites without collisions during Git hydration', async () => {
      const dbTable: any[] = [];

      const mockDb: any = {
        selectFrom: () => ({
          select: () => {
            const conditions: Array<[string, any]> = [];
            const queryObj = {
              where: (col: string, _op: string, val: any) => {
                conditions.push([col, val]);
                return queryObj;
              },
              executeTakeFirst: async () => {
                return dbTable.find((r) => conditions.every(([c, v]) => r[c] === v)) || null;
              },
            };
            return queryObj;
          },
        }),
        insertInto: () => ({
          values: (vals: any) => ({
            execute: async () => {
              // Enforce UNIQUE(site_id, collection, slug)
              if (dbTable.some((r) => r.site_id === vals.site_id && r.collection === vals.collection && r.slug === vals.slug)) {
                throw new Error(`UNIQUE constraint failed: (site_id, collection, slug)`);
              }
              dbTable.push(vals);
            },
          }),
        }),
        updateTable: () => ({
          set: (sets: any) => ({
            where: (col: string, _op: string, val: any) => ({
              execute: async () => {
                const row = dbTable.find((r) => r[col] === val);
                if (row) Object.assign(row, sets);
              },
            }),
          }),
        }),
      };

      // Site A hydrations
      const siteAItems = [
        { id: 'uuid-1', collection: 'posts', slug: 'welcome', title: 'Site A Welcome', status: 'published' as const, data: {} },
      ];
      const resultA = await hydrateFromGit(mockDb, siteAItems, 1, 'site-alpha.com');
      expect(resultA.inserted).toBe(1);

      // Site B hydrations with identical collection and slug
      const siteBItems = [
        { id: 'uuid-2', collection: 'posts', slug: 'welcome', title: 'Site B Welcome', status: 'published' as const, data: {} },
      ];
      const resultB = await hydrateFromGit(mockDb, siteBItems, 1, 'site-beta.com');
      expect(resultB.inserted).toBe(1);

      // Verify both coexist in the database under distinct site_id
      expect(dbTable.length).toBe(2);
      const alphaDoc = dbTable.find((r) => r.site_id === 'site-alpha.com' && r.slug === 'welcome');
      const betaDoc = dbTable.find((r) => r.site_id === 'site-beta.com' && r.slug === 'welcome');
      expect(alphaDoc).toBeDefined();
      expect(betaDoc).toBeDefined();
      expect(alphaDoc?.title).toBe('Site A Welcome');
      expect(betaDoc?.title).toBe('Site B Welcome');
    });
  });

  describe('Hybrid Atomic Site Renaming Engine', () => {
    it('renames site atomically across site_settings, referrals, media, versions, and physical tables', async () => {
      const executedStatements: Array<{ sql: string; binds: any[] }> = [];

      const mockD1: any = {
        prepare: vi.fn().mockImplementation((sql: string) => {
          let currentBinds: any[] = [];
          return {
            bind: vi.fn().mockImplementation((...binds: any[]) => {
              currentBinds = binds;
              return {
                all: vi.fn().mockImplementation(async () => {
                  executedStatements.push({ sql, binds: currentBinds });
                  if (sql.includes('sqlite_master')) {
                    return { results: [{ name: 'documents' }, { name: 'blog_posts' }], meta: { changes: 0 } };
                  }
                  if (sql.includes('PRAGMA table_info')) {
                    return { results: [{ name: 'id' }, { name: 'site_id' }, { name: 'title' }], meta: { changes: 0 } };
                  }
                  return { results: [], meta: { changes: 0 } };
                }),
                run: vi.fn().mockImplementation(async () => {
                  executedStatements.push({ sql, binds: currentBinds });
                  return { success: true, meta: { changes: 1 } };
                }),
                first: vi.fn().mockImplementation(async () => {
                  executedStatements.push({ sql, binds: currentBinds });
                  return null;
                }),
                raw: vi.fn().mockImplementation(async () => {
                  executedStatements.push({ sql, binds: currentBinds });
                  if (sql.includes('sqlite_master')) {
                    return [['documents'], ['blog_posts']];
                  }
                  return [];
                }),
              };
            }),
          };
        }),
        batch: vi.fn().mockImplementation(async (statements: any[]) => {
          return statements.map(() => ({ success: true }));
        }),
      };

      const db = createDb(mockD1);
      const result = await renameSite(db, 'old-site.com', 'new-site.com');
      expect(result.success).toBe(true);
      expect(result.oldSiteId).toBe('old-site.com');
      expect(result.newSiteId).toBe('new-site.com');
      expect(result.updatedSystemTables).toContain('system_site_settings');
      expect(result.updatedSystemTables).toContain('media');
      expect(result.updatedSystemTables).toContain('site_domain_referrals');
      expect(result.updatedSystemTables).toContain('directus_versions');
      expect(result.updatedContentTables).toContain('documents');
      expect(result.updatedContentTables).toContain('blog_posts');

      // Verify that media R2 prefix replacement SQL was executed
      const mediaUpdate = executedStatements.find((s) => s.sql.includes('UPDATE media'));
      expect(mediaUpdate).toBeDefined();
      expect(mediaUpdate?.sql).toContain("WHEN key LIKE 'old-site.com/%'");
    });
  });

  describe('Admin Studio Multi-Site Navigation & Views', () => {
    const mockEnv: any = {
      DB: {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue({ results: [{ site_id: 'alpha.dev', name: 'Alpha Site' }], meta: { changes: 0 } }),
          raw: vi.fn().mockResolvedValue([]),
          first: vi.fn().mockResolvedValue({ site_id: 'alpha.dev', name: 'Alpha Site' }),
          run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } }),
        }),
      },
      ENVIRONMENT: 'development',
    };

    it('renders Sites navigation tab and active site dropdown switcher in Studio UI', async () => {
      const res = await app.fetch(
        new Request('http://localhost:8787/admin/sites?site=alpha.dev', {
          headers: { host: 'localhost:8787' },
        }),
        mockEnv
      );

      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Websites & Domains');
      expect(html).toContain('alpha.dev');
      expect(html).toContain('/admin/sites');
      expect(html).toContain('System');
      expect(html).toContain('Sign Out');
      expect(html).toContain('/admin/logout');
      expect(html).toContain('nav-dropdown-menu-right');
      expect(html).toContain('data-site-favicon="alpha.dev"');
      expect(html).toContain('https://alpha.dev/favicon.svg');
      expect(html).toContain('Git Remote:');
      expect(html).toContain('Local Clone Path:');
      expect(html).toContain('Atomic Domain Rename');
      expect(html).toContain('Delete / Unregister Site');
    });

    it('renders Git view with segmented tabs, inline fetch tags button, and execute import button', async () => {
      const res = await app.fetch(
        new Request('http://localhost:8787/admin/git?site=alpha.dev', {
          headers: { host: 'localhost:8787' },
        }),
        mockEnv
      );

      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('git-tab-bar');
      expect(html).toContain('git-tab-btn');
      expect(html).toContain('Export & Releases');
      expect(html).toContain('Import & Restore');
      expect(html).toContain('Fetch Remote Tags');
      expect(html).toContain('Execute Import (Restore D1)');
      expect(html).toContain('Export Files as ZIP');
    });

    it('handles switching active site via cookie set on redirect', async () => {
      const res = await app.fetch(
        new Request('http://localhost:8787/admin/sites/switch?site_id=beta.dev&redirect=/admin', {
          headers: { host: 'localhost:8787' },
        }),
        mockEnv
      );

      expect(res.status).toBe(302);
      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toContain('slottd_site=beta.dev');
      expect(res.headers.get('location')).toBe('/admin');
    });
  });

  describe('Site Deletion & Lifecycle Safeguards', () => {
    it('unregisters site configuration without purging content by default', async () => {
      const executed: string[] = [];
      const mockDb: any = {
        DB: {},
      };
      // Test deleteSite with purgeData = false
      const { deleteSite } = await import('../src/admin/sites.js');
      const mockD1: any = {
        prepare: vi.fn().mockImplementation((sql: string) => {
          executed.push(sql);
          return {
            bind: vi.fn().mockReturnThis(),
            all: vi.fn().mockResolvedValue({ results: [], meta: {} }),
            first: vi.fn().mockResolvedValue(null),
            raw: vi.fn().mockResolvedValue([]),
          };
        }),
      };
      const db = createDb(mockD1);
      const res = await deleteSite(db, 'old-site.com', false);
      expect(res.success).toBe(true);
      expect(res.siteId).toBe('old-site.com');
      expect(res.purged).toBe(false);
      expect(executed.some((s) => s.includes('DELETE FROM system_site_settings'))).toBe(true);
      expect(executed.some((s) => s.includes('DELETE FROM "documents"'))).toBe(false);
    });

    it('purges all documents, media, and versions when purgeData is true', async () => {
      const executed: string[] = [];
      const { deleteSite } = await import('../src/admin/sites.js');
      const mockD1: any = {
        prepare: vi.fn().mockImplementation((sql: string) => {
          executed.push(sql);
          return {
            bind: vi.fn().mockReturnThis(),
            all: vi.fn().mockResolvedValue({ results: [], meta: {} }),
            first: vi.fn().mockResolvedValue(null),
            raw: vi.fn().mockResolvedValue([]),
          };
        }),
      };
      const db = createDb(mockD1);
      const res = await deleteSite(db, 'obsolete.dev', true);
      expect(res.success).toBe(true);
      expect(res.purged).toBe(true);
      expect(executed.some((s) => s.includes('DELETE FROM system_site_settings'))).toBe(true);
      expect(executed.some((s) => s.includes('DELETE FROM "documents" WHERE site_id = \'obsolete.dev\''))).toBe(true);
      expect(executed.some((s) => s.includes('DELETE FROM "media" WHERE site_id = \'obsolete.dev\''))).toBe(true);
    });
  });
});
