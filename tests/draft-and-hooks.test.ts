import { describe, it, expect, vi } from 'vitest';
import app, { setSlottdConfig } from '../src/index.js';
import { runCheckPipeline, terminologyCheck, slotwireContractCheck } from '../src/checks/index.js';

describe('SlottD Dual-State Drafts & Standardized Lifecycle Hooks', () => {
  const mockEnv: any = {
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({
          results: [
            {
              id: 'doc-1',
              collection: 'projects',
              slug: 'freeformer',
              title: 'FreeFormer',
              status: 'published',
              draft_status: 'modified',
              data: JSON.stringify({ title: 'FreeFormer Live', description: 'Original description' }),
              draft_data: JSON.stringify({ title: 'FreeFormer Draft', description: 'Updated working draft' }),
              draft_updated_at: 1700000000000,
              created_at: 1690000000000,
              updated_at: 1690000000000,
            },
          ],
          meta: { changes: 0 },
        }),
        raw: vi.fn().mockResolvedValue([]),
        first: vi.fn().mockResolvedValue({
          id: 'doc-1',
          collection: 'projects',
          slug: 'freeformer',
          title: 'FreeFormer',
          status: 'published',
          draft_status: 'modified',
          data: JSON.stringify({ title: 'FreeFormer Live', description: 'Original description' }),
          draft_data: JSON.stringify({ title: 'FreeFormer Draft', description: 'Updated working draft' }),
          draft_updated_at: 1700000000000,
          created_at: 1690000000000,
          updated_at: 1690000000000,
        }),
        run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
      }),
    },
    ENVIRONMENT: 'production',
    ADMIN_API_KEY: 'test-admin-secret',
  };

  it('rejects unauthenticated requests querying drafts or versions', async () => {
    const res = await app.fetch(
      new Request('https://cms.brainendeavor.com/items/projects?version=draft'),
      mockEnv
    );
    expect(res.status).toBe(401);
    const json: any = await res.json();
    expect(json.error).toBe('Unauthorized');
  });

  it('allows authenticated requests with version=draft and overlays working copy', async () => {
    const res = await app.fetch(
      new Request('https://cms.brainendeavor.com/items/projects?version=draft', {
        headers: {
          Authorization: 'Bearer test-admin-secret',
        },
      }),
      mockEnv
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data[0].title).toBe('FreeFormer Draft');
    expect(json.data[0].draft_status).toBe('modified');
  });

  it('terminolgyCheck flags prohibited terms with origin attribution', async () => {
    const check = terminologyCheck({
      flaggedTerms: ['badword', 'legacy-tool'],
      severity: 'error',
    });

    const ctx = {
      changedItems: [
        {
          collection: 'projects',
          slug: 'freeformer',
          status: 'modified' as const,
          modifiedFields: ['description'],
          delta: { description: 'This uses a legacy-tool to process forms.' },
        },
      ],
    };

    const res = await check(ctx as any);
    expect(res.passed).toBe(false);
    expect(res.errors.length).toBe(1);
    expect(res.errors[0]).toContain("Found discouraged phrase 'legacy-tool'");

    const report = await runCheckPipeline([check], ctx as any);
    expect(report.status).toBe('error');
    expect(report.data?.errors[0]).toBe(
      "[Brand & Terminology Linter] Found discouraged phrase 'legacy-tool' in projects/freeformer.description"
    );
  });

  it('terminolgyCheck passes cleanly when no flagged terms exist', async () => {
    const check = terminologyCheck({
      flaggedTerms: ['badword'],
      severity: 'error',
    });

    const ctx = {
      changedItems: [
        {
          collection: 'projects',
          slug: 'freeformer',
          status: 'modified' as const,
          modifiedFields: ['description'],
          delta: { description: 'Clean architecture implementation.' },
        },
      ],
    };

    const report = await runCheckPipeline([check], ctx as any);
    expect(report.status).toBe('ok');
    expect(report.data?.summary.passed).toBe(1);
    expect(report.data?.errors.length).toBe(0);
  });

  it('runs /ext/bundle/validate and reports check pipeline results', async () => {
    setSlottdConfig({
      hooks: {
        onBeforePublish: async (ctx) => {
          return {
            status: 'warning',
            message: 'Completed with warnings',
            data: {
              summary: { totalChecks: 1, passed: 1, failed: 0, warningCount: 1 },
              checks: [],
              errors: [],
              warnings: ['[TestCheck] Notice only'],
            },
          };
        },
      },
    });

    const res = await app.fetch(
      new Request('https://cms.brainendeavor.com/ext/bundle/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-admin-secret',
        },
        body: JSON.stringify({ bundleSlug: 'q4-ventures' }),
      }),
      mockEnv
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.status).toBe('warning');
    expect(json.message).toBe('Completed with warnings');
  });

  it('serves /ext/briefcase/status with counts', async () => {
    const res = await app.fetch(
      new Request('https://cms.brainendeavor.com/ext/briefcase/status', {
        headers: {
          Authorization: 'Bearer test-admin-secret',
        },
      }),
      mockEnv
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.offline).toBe(false);
    expect(json).toHaveProperty('dirtyDraftCount');
  });
});
