import { describe, it, expect, vi } from 'vitest';
import app from '../src/index.js';

describe('SlottD Admin Router Deep Links', () => {
  const mockEnv: any = {
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: [], meta: { changes: 0 } }),
        raw: vi.fn().mockResolvedValue([]),
        first: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } }),
      }),
    },
    ENVIRONMENT: 'development',
  };

  it('handles /admin/edit/:idOrSlug universal deep link without 404', async () => {
    const res = await app.fetch(
      new Request('http://localhost:8787/admin/edit/section-home-hero?collection=page_sections&pageSlug=home&sectionKey=hero', {
        headers: { host: 'localhost:8787' },
      }),
      mockEnv
    );

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('SlottD Studio');
    expect(html).toContain('section-home-hero');
  });

  it('handles /admin/content/:collection/:id Directus adapter edit route without 404', async () => {
    const res = await app.fetch(
      new Request('http://localhost:8787/admin/content/page_sections/section-home-hero', {
        headers: { host: 'localhost:8787' },
      }),
      mockEnv
    );

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('SlottD Studio');
    expect(html).toContain('page_sections');
  });

  it('handles /admin/content/:collection/+ Directus adapter create route without 404', async () => {
    const res = await app.fetch(
      new Request('http://localhost:8787/admin/content/page_sections/+?pageSlug=home&sectionKey=hero', {
        headers: { host: 'localhost:8787' },
      }),
      mockEnv
    );

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('SlottD Studio');
    expect(html).toContain('New page_sections');
  });

  it('handles /admin dashboard route', async () => {
    const res = await app.fetch(
      new Request('http://localhost:8787/admin', {
        headers: { host: 'localhost:8787' },
      }),
      mockEnv
    );

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('SlottD Studio');
    expect(html).toContain('Content Collections');
  });

  it('handles /admin/models schema registry route', async () => {
    const res = await app.fetch(
      new Request('http://localhost:8787/admin/models', {
        headers: { host: 'localhost:8787' },
      }),
      mockEnv
    );

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('SlottD Studio');
    expect(html).toContain('Content Models');
  });

  it('handles /admin/media asset library route', async () => {
    const res = await app.fetch(
      new Request('http://localhost:8787/admin/media', {
        headers: { host: 'localhost:8787' },
      }),
      mockEnv
    );

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('SlottD Studio');
    expect(html).toContain('Media');
  });

  it('handles /admin/docs documentation route with recipes and archetypes', async () => {
    const res = await app.fetch(
      new Request('http://localhost:8787/admin/docs', {
        headers: { host: 'localhost:8787' },
      }),
      mockEnv
    );

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('SlottD Studio Guide & Recipes');
    expect(html).toContain('SlotWire Live Preview Synergy');
    expect(html).toContain('Standalone Directus CMS');
    expect(html).toContain('SlotWire Layout Archetypes');
    expect(html).toContain('Directus REST Query Cheat Sheet');
  });

  it('handles /admin/:collection/new shorthand route without 404', async () => {
    const res = await app.fetch(
      new Request('http://localhost:8787/admin/projects/new', {
        headers: { host: 'localhost:8787' },
      }),
      mockEnv
    );

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('SlottD Studio');
    expect(html).toContain('New projects');
  });

  it('serves /admin/vendor/alpine.js without authentication', async () => {
    const res = await app.fetch(
      new Request('http://localhost:8787/admin/vendor/alpine.js', {
        headers: { host: 'localhost:8787' },
      }),
      mockEnv
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/javascript');
    expect(res.headers.get('cache-control')).toContain('max-age=31536000');
    const content = await res.text();
    expect(content.length).toBeGreaterThan(1000);
    expect(content).toContain('Alpine');
  });

  it('redirects to /admin/login with target redirect param when auth is required', async () => {
    const { hashPassword } = await import('../src/auth/guard.js');
    const hash = await hashPassword('testpass', 'testkey');
    const protectedEnv = {
      ...mockEnv,
      ENVIRONMENT: 'development',
      ADMIN_API_KEY: 'testkey',
      JWT_SECRET: 'testsecret',
      ADMIN_PASSWORD_HASH: hash,
    };

    const targetUrl = 'http://localhost:8787/admin/content/pages/section-hero?version=draft';
    const res = await app.fetch(
      new Request(targetUrl, {
        headers: { host: 'localhost:8787' },
      }),
      protectedEnv
    );

    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toContain('/admin/login?redirect=');
    expect(location).toContain(encodeURIComponent('/admin/content/pages/section-hero?version=draft'));
  });

  it('handles login POST with redirect and navigates to target URL', async () => {
    const { hashPassword } = await import('../src/auth/guard.js');
    const hash = await hashPassword('correct-pass', 'testkey');
    const protectedEnv = {
      ...mockEnv,
      ENVIRONMENT: 'development',
      ADMIN_API_KEY: 'testkey',
      JWT_SECRET: 'testsecret',
      ADMIN_PASSWORD_HASH: hash,
    };

    const formData = new URLSearchParams();
    formData.append('password', 'correct-pass');
    formData.append('redirect', '/admin/content/pages/section-hero');

    const res = await app.fetch(
      new Request('http://localhost:8787/admin/login', {
        method: 'POST',
        headers: {
          host: 'localhost:8787',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      }),
      protectedEnv
    );

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/admin/content/pages/section-hero');
    expect(res.headers.get('set-cookie')).toContain('slottd_session=');
  });

  it('sanitizes open-redirect attempts on login POST to /admin/home', async () => {
    const { hashPassword } = await import('../src/auth/guard.js');
    const hash = await hashPassword('correct-pass', 'testkey');
    const protectedEnv = {
      ...mockEnv,
      ENVIRONMENT: 'development',
      ADMIN_API_KEY: 'testkey',
      JWT_SECRET: 'testsecret',
      ADMIN_PASSWORD_HASH: hash,
    };

    // Attempt 1: Protocol-relative URL //evil.com
    const form1 = new URLSearchParams();
    form1.append('password', 'correct-pass');
    form1.append('redirect', '//evil.com');

    const res1 = await app.fetch(
      new Request('http://localhost:8787/admin/login', {
        method: 'POST',
        headers: { host: 'localhost:8787', 'content-type': 'application/x-www-form-urlencoded' },
        body: form1.toString(),
      }),
      protectedEnv
    );
    expect(res1.status).toBe(302);
    expect(res1.headers.get('location')).toBe('/admin/home');

    // Attempt 2: Absolute external URL https://attacker.com
    const form2 = new URLSearchParams();
    form2.append('password', 'correct-pass');
    form2.append('redirect', 'https://attacker.com');

    const res2 = await app.fetch(
      new Request('http://localhost:8787/admin/login', {
        method: 'POST',
        headers: { host: 'localhost:8787', 'content-type': 'application/x-www-form-urlencoded' },
        body: form2.toString(),
      }),
      protectedEnv
    );
    expect(res2.status).toBe(302);
    expect(res2.headers.get('location')).toBe('/admin/home');
  });

  it('handles bulk reorder POST /admin/content/:collection/reorder', async () => {
    const mockDb: any = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({
          id: 'doc-1',
          title: 'Hero Section',
          data: JSON.stringify({ title: 'Hero Section', order: 10 }),
          draft_data: null,
        }),
        all: vi.fn().mockResolvedValue({
          results: [{
            id: 'doc-1',
            title: 'Hero Section',
            data: JSON.stringify({ title: 'Hero Section', order: 10 }),
            draft_data: null,
          }],
          meta: { changes: 0 },
        }),
        run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
      }),
    };

    const res = await app.fetch(
      new Request('http://localhost:8787/admin/content/page_sections/reorder', {
        method: 'POST',
        headers: {
          host: 'localhost:8787',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          orderField: 'order',
          items: [{ id: 'doc-1', order: 25 }],
        }),
      }),
      { ...mockEnv, DB: mockDb }
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toEqual({ ok: true, count: 1 });
  });

  it('auto-discovers scope filter key and renders scope pills for multi-scope collection', async () => {
    const mockGalleryDocs = [
      {
        id: 'gal-hero-1',
        collection: 'gallery',
        slug: 'hero-1',
        title: 'Hero Slide 1',
        status: 'published',
        data: JSON.stringify({ title: 'Hero Slide 1', galleryKey: 'hero_slides', order: 1 }),
        updated_at: 1000,
      },
      {
        id: 'gal-hero-2',
        collection: 'gallery',
        slug: 'hero-2',
        title: 'Hero Slide 2',
        status: 'published',
        data: JSON.stringify({ title: 'Hero Slide 2', galleryKey: 'hero_slides', order: 2 }),
        updated_at: 1001,
      },
      {
        id: 'gal-pottery-1',
        collection: 'gallery',
        slug: 'pottery-1',
        title: 'Pottery Vessel 1',
        status: 'published',
        data: JSON.stringify({ title: 'Pottery Vessel 1', galleryKey: 'pottery', order: 1 }),
        updated_at: 1002,
      },
      {
        id: 'gal-pottery-2',
        collection: 'gallery',
        slug: 'pottery-2',
        title: 'Pottery Vessel 2',
        status: 'published',
        data: JSON.stringify({ title: 'Pottery Vessel 2', galleryKey: 'pottery', order: 2 }),
        updated_at: 1003,
      },
    ];

    const mockDb: any = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: mockGalleryDocs, meta: { changes: 0 } }),
        raw: vi.fn().mockResolvedValue([]),
        first: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } }),
      }),
    };

    // 1. Unscoped request /admin/content/gallery shows all items and scope pills
    const resAll = await app.fetch(
      new Request('http://localhost:8787/admin/content/gallery', {
        headers: { host: 'localhost:8787' },
      }),
      { ...mockEnv, DB: mockDb }
    );
    expect(resAll.status).toBe(200);
    const htmlAll = await resAll.text();
    expect(htmlAll).toContain('scope-filter-container');
    expect(htmlAll).toContain('Gallery:');
    expect(htmlAll).toContain('Hero Slides');
    expect(htmlAll).toContain('Pottery');
    expect(htmlAll).toContain('scope-guard-banner');
    expect(htmlAll).toContain('hero-1');
    expect(htmlAll).toContain('pottery-1');
    // Scope column header, scope badge in rows, and data-scope attribute
    expect(htmlAll).toContain("sortTable('scope')");
    expect(htmlAll).toContain('title="Sort by Gallery"');
    expect(htmlAll).toContain('data-scope="hero_slides"');
    expect(htmlAll).toContain('data-scope="pottery"');
    expect(htmlAll).toContain('hero_slides');
    // Valid JS boolean serialization in tableReorderApp (never `hasScopeFilter: ,`)
    expect(htmlAll).toContain('hasScopeFilter: true');
    expect(htmlAll).not.toContain('hasScopeFilter: ,');

    // 2. Scoped request /admin/content/gallery?galleryKey=pottery shows only pottery items
    const resPottery = await app.fetch(
      new Request('http://localhost:8787/admin/content/gallery?galleryKey=pottery', {
        headers: { host: 'localhost:8787' },
      }),
      { ...mockEnv, DB: mockDb }
    );
    expect(resPottery.status).toBe(200);
    const htmlPottery = await resPottery.text();
    expect(htmlPottery).toContain('Pottery Vessel 1');
    expect(htmlPottery).toContain('Pottery Vessel 2');
    expect(htmlPottery).not.toContain('Hero Slide 1');
    expect(htmlPottery).toContain('galleryKey=pottery');
    expect(htmlPottery).toContain('+ New');
    expect(htmlPottery).toContain('hasScopeFilter: false');
    expect(htmlPottery).not.toContain('hasScopeFilter: ,');
    expect(htmlPottery).toContain('data-scope="pottery"');

    // 3. Auto-reorder request /admin/content/gallery?galleryKey=pottery&reorder=true activates reorder mode
    const resReorder = await app.fetch(
      new Request('http://localhost:8787/admin/content/gallery?galleryKey=pottery&reorder=true', {
        headers: { host: 'localhost:8787' },
      }),
      { ...mockEnv, DB: mockDb }
    );
    expect(resReorder.status).toBe(200);
    const htmlReorder = await resReorder.text();
    expect(htmlReorder).toContain('isReorderMode: true');
    expect(htmlReorder).toContain('Pottery Vessel 1');
    expect(htmlReorder).not.toContain('Hero Slide 1');
  });

  it('discoverScopeFilter correctly handles sectionKey, category, unassigned, and single value scenarios', async () => {
    const { discoverScopeFilter, formatScopeLabel, formatValueLabel } = await import('../src/admin/index.js');

    expect(formatScopeLabel('galleryKey')).toBe('Gallery');
    expect(formatScopeLabel('sectionKey')).toBe('Section');
    expect(formatScopeLabel('pageSlug')).toBe('Page');
    expect(formatScopeLabel('category')).toBe('Category');

    expect(formatValueLabel('hero_slides')).toBe('Hero Slides');
    expect(formatValueLabel('ai-strategy')).toBe('AI Strategy');

    // Scenario 1: sectionKey discriminator with unassigned item
    const featureCardDocs = [
      { id: '1', data: JSON.stringify({ title: 'Card 1', sectionKey: 'services' }) },
      { id: '2', data: JSON.stringify({ title: 'Card 2', sectionKey: 'services' }) },
      { id: '3', data: JSON.stringify({ title: 'Card 3', sectionKey: 'stack' }) },
      { id: '4', data: JSON.stringify({ title: 'Card 4' }) }, // unassigned
    ];
    const sectionScope = discoverScopeFilter(featureCardDocs);
    expect(sectionScope).not.toBeNull();
    expect(sectionScope?.key).toBe('sectionKey');
    expect(sectionScope?.label).toBe('Section');
    expect(sectionScope?.values).toEqual([
      { value: 'services', label: 'Services', count: 2 },
      { value: 'stack', label: 'Stack', count: 1 },
      { value: '__unassigned__', label: 'Unassigned', count: 1 },
    ]);

    // Scenario 2: category discriminator
    const faqDocs = [
      { id: '1', data: JSON.stringify({ title: 'FAQ 1', category: 'advisory' }) },
      { id: '2', data: JSON.stringify({ title: 'FAQ 2', category: 'general' }) },
    ];
    const catScope = discoverScopeFilter(faqDocs);
    expect(catScope?.key).toBe('category');
    expect(catScope?.label).toBe('Category');
    expect(catScope?.values.length).toBe(2);

    // Scenario 3: single value returns null (no disambiguation needed)
    const singleDocs = [
      { id: '1', data: JSON.stringify({ title: 'Doc 1', group: 'alpha' }) },
      { id: '2', data: JSON.stringify({ title: 'Doc 2', group: 'alpha' }) },
    ];
    expect(discoverScopeFilter(singleDocs)).toBeNull();

    // Scenario 4: explicit queryParamKey forces discriminator even if 1 value
    const explicitScope = discoverScopeFilter(singleDocs, 'group');
    expect(explicitScope?.key).toBe('group');
    expect(explicitScope?.values.length).toBe(1);
  });

  it('shows all collection items when sectionKey matches collection name (e.g. /admin/content/projects?pageSlug=home&sectionKey=projects)', async () => {
    const mockProjectsDocs = [
      { id: 'proj-1', collection: 'projects', slug: 'splitphase', title: 'splitphase.io', status: 'published', data: JSON.stringify({ name: 'splitphase.io', category: 'venture' }), updated_at: 100 },
      { id: 'proj-2', collection: 'projects', slug: 'freeformer', title: 'freeformer', status: 'published', data: JSON.stringify({ name: 'freeformer', category: 'oss' }), updated_at: 200 },
    ];

    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: mockProjectsDocs, meta: { changes: 0 } }),
        raw: vi.fn().mockResolvedValue([]),
        first: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } }),
      }),
    };

    const res = await app.fetch(
      new Request('http://localhost:8787/admin/content/projects?pageSlug=home&sectionKey=projects', {
        headers: { host: 'localhost:8787' },
      }),
      { ...mockEnv, DB: mockDb }
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    // Both projects must be displayed (not filtered out by sectionKey or pageSlug)
    expect(html).toContain('splitphase.io');
    expect(html).toContain('freeformer');
    // Context filter banner should not claim it's filtered
    expect(html).not.toContain('Filtered by Context:');
  });

  it('does not filter out collection items when collection documents lack sectionKey or pageSlug attributes', async () => {
    const mockProjectsDocs = [
      { id: 'proj-1', collection: 'projects', slug: 'splitphase', title: 'splitphase.io', status: 'published', data: JSON.stringify({ name: 'splitphase.io', category: 'venture' }), updated_at: 100 },
    ];

    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: mockProjectsDocs, meta: { changes: 0 } }),
        raw: vi.fn().mockResolvedValue([]),
        first: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } }),
      }),
    };

    const res = await app.fetch(
      new Request('http://localhost:8787/admin/content/projects?pageSlug=home&sectionKey=featured_work', {
        headers: { host: 'localhost:8787' },
      }),
      { ...mockEnv, DB: mockDb }
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('splitphase.io');
    expect(html).not.toContain('Filtered by Context:');
  });

  describe('Configurable Editor Suite & Vendor Assets', () => {
    it('serves /admin/vendor/markdown-toolbar.js with correct headers', async () => {
      const res = await app.fetch(
        new Request('http://localhost:8787/admin/vendor/markdown-toolbar.js', {
          headers: { host: 'localhost:8787' },
        }),
        mockEnv
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('javascript');
      const body = await res.text();
      expect(body).toContain('markdown-toolbar');
    });

    it('serves /admin/vendor/pell.js with correct headers', async () => {
      const res = await app.fetch(
        new Request('http://localhost:8787/admin/vendor/pell.js', {
          headers: { host: 'localhost:8787' },
        }),
        mockEnv
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('javascript');
      const body = await res.text();
      expect(body).toContain('pell');
    });

    it('handles POST /admin/setup/editor to persist format and tier', async () => {
      const batchMock = vi.fn().mockResolvedValue([]);
      const prepareMock = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
      });
      const dbMock = { batch: batchMock, prepare: prepareMock };

      const res = await app.fetch(
        new Request('http://localhost:8787/admin/setup/editor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', host: 'localhost:8787' },
          body: JSON.stringify({ format: 'markdown', tier: 'light' }),
        }),
        { ...mockEnv, DB: dbMock }
      );

      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.success).toBe(true);
      expect(json.format).toBe('markdown');
      expect(json.tier).toBe('light');
      expect(batchMock).toHaveBeenCalled();
    });

    it('renders Editor & Authoring Suite preferences card in /admin/setup', async () => {
      const res = await app.fetch(
        new Request('http://localhost:8787/admin/setup', {
          headers: { host: 'localhost:8787' },
        }),
        mockEnv
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Editor & Authoring Suite');
      expect(html).toContain('GitHub Markdown Toolbar');
      expect(html).toContain('Pell');
      expect(html).toContain('Light Tier');
      expect(html).toContain('Heavy Tier');
    });

    it('renders clean 2-tab editor with GitHub Markdown Toolbar in light tier (default)', async () => {
      const mockDoc = {
        id: 'doc-1',
        collection: 'posts',
        slug: 'first-post',
        title: 'First Post',
        status: 'published',
        data: JSON.stringify({ content: '# Hello World' }),
        updated_at: 100,
      };

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue({ results: [], meta: { changes: 0 } }),
          raw: vi.fn().mockResolvedValue([]),
          first: vi.fn().mockResolvedValue(null),
          run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } }),
        }),
        selectFrom: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnThis(),
          selectAll: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          executeTakeFirst: vi.fn().mockResolvedValue(mockDoc),
          execute: vi.fn().mockResolvedValue([mockDoc]),
        }),
      };

      const res = await app.fetch(
        new Request('http://localhost:8787/admin/edit/first-post?collection=posts', {
          headers: { host: 'localhost:8787' },
        }),
        { ...mockEnv, DB: mockDb }
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      // Verifies Option A 2-Tab layout:
      expect(html).toContain('📝 Markdown');
      expect(html).toContain('🔤 Raw Text');
      // Verifies GitHub Markdown Toolbar component is rendered:
      expect(html).toContain('<markdown-toolbar');
      expect(html).toContain('data-md-action="bold"');
      // Verifies vendor scripts are loaded from local isolate:
      expect(html).toContain('/admin/vendor/markdown-toolbar.js');
      expect(html).toContain('/admin/vendor/pell.js');
      // Verifies heavy CDNs are NOT loaded in light tier:
      expect(html).not.toContain('uicdn.toast.com');
      expect(html).not.toContain('unpkg.com/trix');
    });
  });
});
