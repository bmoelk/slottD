import { describe, it, expect, vi } from 'vitest';
import app from '../src/index.js';

describe('SlottD Admin Router Deep Links', () => {
  const mockEnv: any = {
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: [] }),
        first: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue({ success: true }),
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
    expect(html).toContain('Content Models &amp; Schema Registry');
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
    expect(html).toContain('Media &amp; Assets (Cloudflare R2)');
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
});
