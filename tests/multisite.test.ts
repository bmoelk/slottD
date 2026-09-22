import { describe, it, expect, vi } from 'vitest';
import app from '../src/index.js';
import { resolveSiteId, normalizeSiteId } from '../src/auth/site.js';
import { renameSite, listSites, registerSite } from '../src/admin/sites.js';
import { hydrateFromGit } from '../src/sync/git-sync.js';
import { createDb } from '../src/db/client.js';

describe('SlottD Multi-Site Architecture & Tenancy', () => {
  describe('Site ID Normalization & Resolution Priority', () => {
    it('normalizes domain identifiers to clean lowercase URL-safe slugs', () => {
      expect(normalizeSiteId('Example.COM')).toBe('example.com');
      expect(normalizeSiteId('https://sub.domain.org:8787/path?query=1')).toBe('sub.domain.org');
      expect(normalizeSiteId('  my-site.dev  ')).toBe('my-site.dev');
      expect(normalizeSiteId('')).toBe('default');
    });

    it('resolves site ID with strict precedence (header > query > cookie > host > default)', async () => {
      // 1. Header precedence over query and host
      const req1 = new Request('http://host-domain.com/items/posts?site=query-site.com', {
        headers: {
          'x-slottd-site': 'header-site.com',
          'cookie': 'slottd_site=cookie-site.com',
        },
      });
      const site1 = await resolveSiteId({ req: { header: (k: string) => req1.headers.get(k), query: (k: string) => new URL(req1.url).searchParams.get(k), raw: req1 }, env: {} } as any);
      expect(site1).toBe('header-site.com');

      // 2. Query param precedence over cookie and host
      const req2 = new Request('http://host-domain.com/items/posts?site=query-site.com', {
        headers: {
          'cookie': 'slottd_site=cookie-site.com',
        },
      });
      const site2 = await resolveSiteId({ req: { header: (k: string) => req2.headers.get(k), query: (k: string) => new URL(req2.url).searchParams.get(k), raw: req2 }, env: {} } as any);
      expect(site2).toBe('query-site.com');

      // 3. Cookie precedence over host
      const req3 = new Request('http://host-domain.com/items/posts', {
        headers: {
          'cookie': 'slottd_site=cookie-site.com',
        },
      });
      const site3 = await resolveSiteId({ req: { header: (k: string) => req3.headers.get(k), query: (k: string) => new URL(req3.url).searchParams.get(k), raw: req3 }, env: {} } as any);
      expect(site3).toBe('cookie-site.com');

      // 4. Fallback to DEFAULT_SITE_ID env variable
      const req4 = new Request('http://localhost:8787/items/posts');
      const site4 = await resolveSiteId({ req: { header: (k: string) => req4.headers.get(k), query: (k: string) => new URL(req4.url).searchParams.get(k), raw: req4 }, env: { DEFAULT_SITE_ID: 'configured-default.org' } } as any);
      expect(site4).toBe('configured-default.org');

      // 5. Fallback to 'default' when no env var is set
      const site5 = await resolveSiteId({ req: { header: () => null, query: () => null, raw: req4 }, env: {} } as any);
      expect(site5).toBe('default');
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
      expect(result.updatedSystemTables).toContain('site_settings');
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
      expect(html).toContain('Atomic Domain Rename');
    });

    it('handles switching active site via cookie set on redirect', async () => {
      const res = await app.fetch(
        new Request('http://localhost:8787/admin/sites/switch?site=beta.dev&redirect=/admin', {
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
});
