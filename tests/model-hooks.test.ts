import { describe, it, expect, vi } from 'vitest';
import app from '../src/index.js';
import {
  normalizeMediaPath,
  extractMediaKey,
  verifyMediaExists,
  validateUrlFormat,
  autoIncrementOrder,
  validateRequiredFields,
} from '../src/hooks/builtins.js';
import { runItemHook } from '../src/hooks/runner.js';

describe('SlottD Model Lifecycle Hooks & Constraints Engine', () => {
  describe('Path & Key Utilities', () => {
    it('normalizes bare keys to canonical /media/:key format', () => {
      expect(normalizeMediaPath('hero-banner.png')).toBe('/media/hero-banner.png');
      expect(normalizeMediaPath('/media/hero-banner.png')).toBe('/media/hero-banner.png');
      expect(normalizeMediaPath('media/hero-banner.png')).toBe('/media/hero-banner.png');
      expect(normalizeMediaPath('https://example.com/banner.png')).toBe('https://example.com/banner.png');
    });

    it('extracts raw storage keys from canonical paths and URLs', () => {
      expect(extractMediaKey('/media/hero-banner.png')).toBe('hero-banner.png');
      expect(extractMediaKey('hero-banner.png')).toBe('hero-banner.png');
      expect(extractMediaKey('https://cdn.example.com/media/hero-banner.png')).toBe('hero-banner.png');
    });
  });

  describe('URL Format & Protocol Safety', () => {
    it('strictly rejects unsafe protocols (Tier 1 non-bypassable security rejection)', async () => {
      const validator = validateUrlFormat(['linkUrl']);
      const ctx: any = {
        collection: 'feature_cards',
        data: { linkUrl: 'javascript:alert(1)' },
        force: true, // Even with force: true, Tier 1 security checks must fail
        isDraft: false,
      };

      const res = await validator(ctx);
      expect(res.status).toBe('error');
      expect(res.code).toBe('UNSAFE_URL');
      expect(res.bypassable).toBe(false);
    });

    it('accepts root-relative and anchor URLs cleanly', async () => {
      const validator = validateUrlFormat(['primaryCtaUrl', 'secondaryCtaUrl']);
      const ctx: any = {
        collection: 'page_sections',
        data: { primaryCtaUrl: '/pricing', secondaryCtaUrl: '#contact' },
        force: false,
        isDraft: false,
      };

      const res = await validator(ctx);
      expect(res.status).toBe('ok');
    });

    it('auto-prefixes relative paths missing leading slash', async () => {
      const validator = validateUrlFormat(['primaryCtaUrl']);
      const ctx: any = {
        collection: 'page_sections',
        data: { primaryCtaUrl: 'about-us' },
        force: false,
        isDraft: false,
      };

      const res = await validator(ctx);
      expect(res.status).toBe('ok');
      expect(ctx.data.primaryCtaUrl).toBe('/about-us');
    });

    it('flags absolute URLs as bypassable errors on publish unless allowed', async () => {
      const validator = validateUrlFormat(['primaryCtaUrl'], { allowAbsolute: false });
      const ctx: any = {
        collection: 'page_sections',
        data: { primaryCtaUrl: 'https://external-partner.com' },
        force: false,
        isDraft: false,
      };

      const res = await validator(ctx);
      expect(res.status).toBe('error');
      expect(res.code).toBe('ABSOLUTE_URL_DISCOURAGED');
      expect(res.bypassable).toBe(true);

      // Permitted on draft as warning
      const draftRes = await validator({ ...ctx, isDraft: true });
      expect(draftRes.status).toBe('warning');
    });
  });

  describe('Media Existence Verification', () => {
    it('normalizes to /media/:key and rejects missing media on publish', async () => {
      const validator = verifyMediaExists(['imageUrl']);
      const mockDb: any = {
        selectFrom: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              executeTakeFirst: vi.fn().mockResolvedValue(null), // Media does not exist
            }),
          }),
        }),
      };

      const ctx: any = {
        collection: 'gallery',
        data: { imageUrl: 'missing-photo.jpg' },
        db: mockDb,
        env: { MEDIA: { head: vi.fn().mockResolvedValue(null) } },
        force: false,
        isDraft: false,
      };

      const res = await validator(ctx);
      expect(ctx.data.imageUrl).toBe('/media/missing-photo.jpg');
      expect(res.status).toBe('error');
      expect(res.code).toBe('MEDIA_NOT_FOUND');
      expect(res.bypassable).toBe(true);
    });

    it('allows missing media on draft with warning', async () => {
      const validator = verifyMediaExists(['imageUrl']);
      const mockDb: any = {
        selectFrom: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              executeTakeFirst: vi.fn().mockResolvedValue(null),
            }),
          }),
        }),
      };

      const ctx: any = {
        collection: 'gallery',
        data: { imageUrl: 'draft-wip.jpg' },
        db: mockDb,
        env: { MEDIA: { head: vi.fn().mockResolvedValue(null) } },
        force: false,
        isDraft: true,
      };

      const res = await validator(ctx);
      expect(res.status).toBe('warning');
      expect(res.code).toBe('MEDIA_NOT_FOUND');
    });

    it('passes cleanly when media exists in D1 or R2', async () => {
      const validator = verifyMediaExists(['imageUrl']);
      const mockDb: any = {
        selectFrom: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              executeTakeFirst: vi.fn().mockResolvedValue({ id: 'm-1', key: 'found.jpg' }),
            }),
          }),
        }),
      };

      const ctx: any = {
        collection: 'gallery',
        data: { imageUrl: '/media/found.jpg' },
        db: mockDb,
        env: {},
        force: false,
        isDraft: false,
      };

      const res = await validator(ctx);
      expect(res.status).toBe('ok');
    });
  });

  describe('Auto-Increment Order', () => {
    it('calculates order: 10 for first item and order: 20 for second', async () => {
      const orderTrigger = autoIncrementOrder({ groupField: 'pageSlug', step: 10 });
      let maxReturned: any = null;

      const mockDb: any = {
        selectFrom: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                executeTakeFirst: vi.fn().mockImplementation(async () => ({ maxOrder: maxReturned })),
              }),
            }),
          }),
        }),
      };

      // 1. First item: max is null -> defaults to 10
      const ctx1: any = {
        collection: 'page_sections',
        data: { pageSlug: 'home', title: 'Hero' },
        db: mockDb,
      };
      await orderTrigger(ctx1);
      expect(ctx1.data.order).toBe(10);

      // 2. Second item: max is 10 -> increments to 20
      maxReturned = 10;
      const ctx2: any = {
        collection: 'page_sections',
        data: { pageSlug: 'home', title: 'Features' },
        db: mockDb,
      };
      await orderTrigger(ctx2);
      expect(ctx2.data.order).toBe(20);
    });

    it('preserves manually specified order', async () => {
      const orderTrigger = autoIncrementOrder({ groupField: 'pageSlug' });
      const ctx: any = {
        collection: 'page_sections',
        data: { pageSlug: 'home', order: 99 },
        db: {},
      };
      await orderTrigger(ctx);
      expect(ctx.data.order).toBe(99);
    });
  });

  describe('Required Fields & Draft Telemetry', () => {
    it('fails hard on publish when a required field is missing', async () => {
      const required = validateRequiredFields(['title', 'sectionKey']);
      const ctx: any = {
        collection: 'page_sections',
        data: { title: 'Valid Title' }, // sectionKey is missing
        isDraft: false,
        force: false,
      };

      const res = await required(ctx);
      expect(res.status).toBe('error');
      expect(res.code).toBe('REQUIRED_FIELD_MISSING');
      expect(res.field).toBe('sectionKey');
      expect(res.bypassable).toBe(true);
    });

    it('allows saving draft with warning when required field is missing', async () => {
      const required = validateRequiredFields(['title', 'sectionKey']);
      const ctx: any = {
        collection: 'page_sections',
        data: { title: 'Draft WIP' },
        isDraft: true,
        force: false,
      };

      const res = await required(ctx);
      expect(res.status).toBe('warning');
      expect(res.code).toBe('REQUIRED_FIELD_MISSING');
    });
  });

  describe('HTTP REST API Integration & Directus Error Contract', () => {
    const createMockEnv = (overrides: any = {}) => {
      const mockQueryBuilder = {
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: [], meta: { changes: 0 } }),
        raw: vi.fn().mockResolvedValue([]),
        first: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
      };

      return {
        DB: {
          prepare: vi.fn().mockReturnValue(mockQueryBuilder),
        },
        MEDIA: {
          head: vi.fn().mockResolvedValue(null),
          get: vi.fn().mockResolvedValue(null),
        },
        ENVIRONMENT: 'production',
        ADMIN_API_KEY: 'test-admin-secret',
        ...overrides,
      };
    };

    it('rejects POST with unsafe protocol returning 400 Bad Request', async () => {
      const env = createMockEnv();
      const res = await app.fetch(
        new Request('https://cms.brainendeavor.com/items/feature_cards', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-admin-secret',
          },
          body: JSON.stringify({
            title: 'Malicious Card',
            pageSlug: 'home',
            sectionKey: 'hero',
            linkUrl: 'javascript:alert(document.cookie)',
          }),
        }),
        env
      );

      expect(res.status).toBe(400);
      const json: any = await res.json();
      expect(json.error).toBe('ValidationFailed');
      expect(json.errors[0].extensions.code).toBe('UNSAFE_URL');
      expect(json.errors[0].extensions.bypassable).toBe(false);
    });

    it('rejects POST with missing media returning 422 Unprocessable Entity', async () => {
      const env = createMockEnv();
      const res = await app.fetch(
        new Request('https://cms.brainendeavor.com/items/gallery', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-admin-secret',
          },
          body: JSON.stringify({
            title: 'Studio Photo',
            galleryKey: 'pottery',
            alt: 'Studio Photo',
            imageUrl: 'missing-asset.png',
            status: 'published',
          }),
        }),
        env
      );

      expect(res.status).toBe(422);
      const json: any = await res.json();
      expect(json.error).toBe('ValidationFailed');
      expect(json.errors[0].extensions.code).toBe('MEDIA_NOT_FOUND');
      expect(json.errors[0].extensions.bypassable).toBe(true);
    });

    it('allows publishing missing media when force: true is passed', async () => {
      const env = createMockEnv();
      const res = await app.fetch(
        new Request('https://cms.brainendeavor.com/items/gallery', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-admin-secret',
          },
          body: JSON.stringify({
            title: 'Studio Photo',
            galleryKey: 'pottery',
            alt: 'Studio Photo',
            imageUrl: 'missing-asset.png',
            status: 'published',
            force: true,
          }),
        }),
        env
      );

      expect(res.status).toBe(201);
      const json: any = await res.json();
      expect(json.data.imageUrl).toBe('/media/missing-asset.png');
      expect(json.data.order).toBe(10);
    });

    it('rejects POST to page_sections when parent page does not exist (Tier 2 constraint)', async () => {
      const env = createMockEnv();
      const res = await app.fetch(
        new Request('https://cms.brainendeavor.com/items/page_sections', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-admin-secret',
          },
          body: JSON.stringify({
            title: 'About Hero',
            pageSlug: 'non-existent-page',
            sectionKey: 'hero',
            status: 'published',
          }),
        }),
        env
      );

      expect(res.status).toBe(422);
      const json: any = await res.json();
      expect(json.error).toBe('ValidationFailed');
      expect(json.errors[0].extensions.code).toBe('PARENT_NOT_FOUND');
    });

    it('allows saving page_section draft even when parent page does not exist', async () => {
      const env = createMockEnv();
      const res = await app.fetch(
        new Request('https://cms.brainendeavor.com/items/page_sections', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-admin-secret',
          },
          body: JSON.stringify({
            title: 'About Hero Draft',
            pageSlug: 'non-existent-page',
            sectionKey: 'hero',
            draft: true,
          }),
        }),
        env
      );

      expect(res.status).toBe(201);
      const json: any = await res.json();
      expect(json.data.draft_status).toBe('new');
    });

    it('blocks DELETE on pages when child records exist unless force: true is passed', async () => {
      const env = createMockEnv();
      // Mock existing page record and active child record
      env.DB.prepare = vi.fn().mockImplementation((query: string) => {
        return {
          bind: vi.fn().mockReturnThis(),
          all: vi.fn().mockImplementation(async () => {
            if (query.toLowerCase().includes('documents')) {
              return {
                results: [{ id: 'page-1', slug: 'home', title: 'Home Page', collection: 'pages', data: '{}' }],
                meta: { changes: 0 },
              };
            }
            return { results: [], meta: { changes: 0 } };
          }),
          raw: vi.fn().mockResolvedValue([]),
          first: vi.fn().mockResolvedValue({ id: 'page-1', slug: 'home', title: 'Home Page' }),
          run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
        };
      });

      // 1. Without force: rejected with 422
      const res1 = await app.fetch(
        new Request('https://cms.brainendeavor.com/items/pages/home', {
          method: 'DELETE',
          headers: {
            Authorization: 'Bearer test-admin-secret',
          },
        }),
        env
      );

      expect(res1.status).toBe(422);
      const json: any = await res1.json();
      expect(json.error).toBe('ValidationFailed');
      expect(json.errors[0].extensions.code).toBe('REFERENTIAL_INTEGRITY_VIOLATION');

      // 2. With force=true: allowed with 204
      const res2 = await app.fetch(
        new Request('https://cms.brainendeavor.com/items/pages/home?force=true', {
          method: 'DELETE',
          headers: {
            Authorization: 'Bearer test-admin-secret',
          },
        }),
        env
      );

      expect(res2.status).toBe(204);
    });

    it('enforces hooks on PATCH /items/:collection/:id', async () => {
      const env = createMockEnv();
      env.DB.prepare = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({
          results: [
            {
              id: 'card-1',
              collection: 'feature_cards',
              slug: 'bento-grid',
              title: 'Bento Grid',
              status: 'published',
              data: JSON.stringify({ pageSlug: 'home', sectionKey: 'hero' }),
            },
          ],
          meta: { changes: 0 },
        }),
        raw: vi.fn().mockResolvedValue([]),
        first: vi.fn().mockResolvedValue({
          id: 'card-1',
          collection: 'feature_cards',
          slug: 'bento-grid',
          title: 'Bento Grid',
          status: 'published',
          data: JSON.stringify({ pageSlug: 'home', sectionKey: 'hero' }),
        }),
        run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
      });

      // Attempt patch with unsafe URL
      const res = await app.fetch(
        new Request('https://cms.brainendeavor.com/items/feature_cards/card-1', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-admin-secret',
          },
          body: JSON.stringify({
            linkUrl: 'javascript:stealCredentials()',
          }),
        }),
        env
      );

      expect(res.status).toBe(400);
      const json: any = await res.json();
      expect(json.error).toBe('ValidationFailed');
      expect(json.errors[0].extensions.code).toBe('UNSAFE_URL');
    });
  });
});

