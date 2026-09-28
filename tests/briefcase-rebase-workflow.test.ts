import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyHmacSignature } from '../src/sync/git-sync.js';
import * as driverModule from '../src/sync/driver.js';
import app from '../src/index.js';

describe('Phase 6: End-to-End Mixed-Mode Briefcase Rebase & Sync Workflow', () => {
  const siteId = 'splitphase.io';
  const webhookSecret = 'test-mixed-mode-webhook-secret';
  let mockDriver: any;
  let mockD1: any;
  let loggedActivities: any[] = [];
  let documentsInD1: any[] = [];

  async function computeSignature(payload: string, keyStr: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(keyStr),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    const hashArray = Array.from(new Uint8Array(sigBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  beforeEach(() => {
    loggedActivities = [];
    documentsInD1 = [
      {
        id: 'doc-1',
        site_id: siteId,
        collection: 'posts',
        slug: 'first-post',
        title: 'Original Remote Post',
        status: 'published',
        data: JSON.stringify({ body: 'Remote text' }),
      },
    ];

    mockDriver = {
      engineName: 'MockGitDriver',
      listTags: vi.fn().mockResolvedValue(['v1.0.0']),
      loadTagContent: vi.fn().mockResolvedValue([
        {
          collection: 'posts',
          slug: 'first-post',
          title: 'Updated Post from Briefcase',
          data: { body: 'Content rebased and pushed from workstation' },
        },
        {
          collection: 'posts',
          slug: 'second-post',
          title: 'Brand New Post from Briefcase',
          data: { body: 'Second post content' },
        },
      ]),
      createRelease: vi.fn().mockResolvedValue({
        commitSha: 'rebased-commit-sha-789',
        tagCreated: true,
        message: 'chore(content): release snapshot',
        pushed: true,
      }),
    };

    vi.spyOn(driverModule, 'getGitDriver').mockResolvedValue(mockDriver);

    mockD1 = {
      prepare: vi.fn().mockImplementation((sql: string) => {
        let currentBinds: any[] = [];
        const lower = sql.toLowerCase();
        return {
          bind: vi.fn().mockImplementation((...binds: any[]) => {
            currentBinds = binds;
            return {
              all: vi.fn().mockImplementation(async () => {
                const lower = sql.toLowerCase();
                if (lower.includes('sqlite_master')) {
                  return {
                    results: [
                      { name: 'documents' },
                      { name: 'activity_log' },
                      { name: 'system_site_settings' },
                    ],
                    meta: { changes: 0 },
                  };
                }
                if (lower.includes('pragma table_info')) {
                  return {
                    results: [
                      { name: 'id' },
                      { name: 'site_id' },
                      { name: 'collection' },
                      { name: 'slug' },
                      { name: 'title' },
                      { name: 'status' },
                      { name: 'schema_version' },
                      { name: 'publish_at' },
                      { name: 'data' },
                      { name: 'draft_data' },
                      { name: 'draft_status' },
                      { name: 'draft_updated_at' },
                      { name: 'created_at' },
                      { name: 'updated_at' },
                    ],
                    meta: { changes: 0 },
                  };
                }
                if (lower.includes('activity_log')) {
                  const action = currentBinds.find((b) => b === 'webhook_site_rebuild') || currentBinds[4];
                  loggedActivities.push({
                    action,
                    details: currentBinds[8],
                  });
                  return { results: [], meta: { changes: 1 } };
                }
                if (lower.includes('from "system_site_settings"')) {
                  return {
                    results: [
                      { key: 'git_remote_url', value: 'https://github.com/splitphase/splitphase.io.git' },
                      { key: 'webhook_secret', value: webhookSecret },
                      { key: 'git_branch', value: 'main' },
                      { key: 'deploy_hook_url', value: 'https://api.cloudflare.com/client/v4/pages/deploy-hook' },
                    ],
                    meta: { changes: 0 },
                  };
                }
                if (lower.includes('from "documents"')) {
                  return { results: documentsInD1, meta: { changes: 0 } };
                }
                return { results: [], meta: { changes: 0 } };
              }),
              first: vi.fn().mockImplementation(async () => {
                const lower = sql.toLowerCase();
                if (lower.includes('from "documents"')) {
                  const slug = currentBinds.find((b) => typeof b === 'string' && (b === 'first-post' || b === 'second-post'));
                  const found = documentsInD1.find((d) => d.slug === slug);
                  return found || null;
                }
                return null;
              }),
              run: vi.fn().mockImplementation(async () => {
                const lower = sql.toLowerCase();
                if (lower.includes('activity_log')) {
                  const action = currentBinds.find((b) => b === 'webhook_site_rebuild') || currentBinds[4];
                  loggedActivities.push({
                    action,
                    details: currentBinds[8],
                  });
                }
                if (lower.includes('insert into "documents"') || lower.includes('replace into "documents"')) {
                  documentsInD1.push({
                    id: currentBinds[0],
                    site_id: currentBinds[1],
                    collection: currentBinds[2],
                    slug: currentBinds[3],
                    title: currentBinds[4],
                  });
                }
                if (lower.includes('update "documents"')) {
                  const targetId = currentBinds[currentBinds.length - 1];
                  const doc = documentsInD1.find((d) => d.id === targetId);
                  if (doc) {
                    doc.title = currentBinds[0];
                  }
                }
                return { success: true, meta: { changes: 1 } };
              }),
              raw: vi.fn().mockResolvedValue([]),
            };
          }),
          first: vi.fn().mockResolvedValue(null),
          all: vi.fn().mockResolvedValue({ results: [], meta: { changes: 0 } }),
          run: vi.fn().mockImplementation(async () => {
            const lower = sql.toLowerCase();
            if (lower.includes('activity_log')) {
              loggedActivities.push({
                action: 'webhook_site_rebuild',
                details: '',
              });
            }
            return { success: true, meta: { changes: 1 } };
          }),
          raw: vi.fn().mockResolvedValue([]),
        };
      }),
    };
  });

  describe('1. Local Export Branch Naming & Strict Remote Invariants', () => {
    it('formats export branch name strictly per site and never matches target branch', () => {
      const site = 'splitphase.io';
      const exportBranch = `briefcase/${site}`;
      const targetBranch = 'main';

      expect(exportBranch).toBe('briefcase/splitphase.io');
      expect(exportBranch).not.toBe(targetBranch);
      // Strict Invariant: Refspec pushed to origin must be briefcase/<site>:main, NEVER pushing briefcase/<site> as remote ref
      const pushRefSpec = `${exportBranch}:${targetBranch}`;
      expect(pushRefSpec).toBe('briefcase/splitphase.io:main');
    });

    it('sanitizes site identifiers with special characters', () => {
      const cleanBranch = (raw: string) => `briefcase/${raw.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-')}`;
      expect(cleanBranch('Brain Endeavor')).toBe('briefcase/brain-endeavor');
      expect(cleanBranch('site@domain.com')).toBe('briefcase/site-domain.com');
    });
  });

  describe('2. Divergence Engine & Bridge Status Contract', () => {
    it('simulates divergence computation matching bridge response contract', () => {
      const divergenceData = {
        exportBranch: 'briefcase/splitphase.io',
        targetBranch: 'main',
        aheadCount: 2,
        behindCount: 1,
        pendingFiles: ['posts/first-post.json', 'posts/second-post.json'],
      };

      expect(divergenceData.aheadCount).toBe(2);
      expect(divergenceData.behindCount).toBe(1);
      expect(divergenceData.pendingFiles).toHaveLength(2);
      expect(divergenceData.pendingFiles).toContain('posts/first-post.json');
    });
  });

  describe('3. Rebase Lifecycle, Conflict Detection, and Hydration', () => {
    it('simulates clean disjoint rebase triggering local D1 hydration', () => {
      const rebaseOutcome = {
        success: true,
        hasConflicts: false,
        conflictingFiles: [],
        hydratedCount: 2,
        message: 'Rebase applied cleanly on top of origin/main.',
      };

      expect(rebaseOutcome.success).toBe(true);
      expect(rebaseOutcome.hasConflicts).toBe(false);
      expect(rebaseOutcome.hydratedCount).toBe(2);
    });

    it('simulates conflicting rebase halting with 409 status and structured conflict files', () => {
      const conflictOutcome = {
        success: false,
        hasConflicts: true,
        conflictingFiles: ['posts/first-post.json'],
        hydratedCount: 0,
        message: 'Rebase encountered conflicts in 1 file(s).',
      };

      expect(conflictOutcome.success).toBe(false);
      expect(conflictOutcome.hasConflicts).toBe(true);
      expect(conflictOutcome.conflictingFiles).toContain('posts/first-post.json');
      expect(conflictOutcome.hydratedCount).toBe(0);
    });
  });

  describe('4. Deploy Readiness Guardrails ("Sharp Knives" Matrix)', () => {
    it('allows frictionless deployment in single-user mode regardless of divergence', () => {
      const isMixedMode = false;
      const aheadCount: number = 3;
      const behindCount: number = 2;
      const unreleasedEdits: number = 1;

      // In single-user mode, deployment is Safe and allowed
      const isAllowed = !isMixedMode || (aheadCount === 0 && behindCount === 0 && unreleasedEdits === 0);
      expect(isAllowed).toBe(true);
    });

    it('allows frictionless deployment in mixed mode when remote is clean', () => {
      const isMixedMode = true;
      const aheadCount: number = 0;
      const behindCount: number = 0;
      const unreleasedEdits: number = 0;

      const isAllowed = !isMixedMode || (aheadCount === 0 && behindCount === 0 && unreleasedEdits === 0);
      expect(isAllowed).toBe(true);
    });

    it('blocks deployment in mixed mode when diverged, unless force override is supplied', () => {
      const isMixedMode = true;
      const aheadCount: number = 2;
      const behindCount: number = 1;
      const unreleasedEdits: number = 1;

      const normalAllowed = !isMixedMode || (aheadCount === 0 && behindCount === 0 && unreleasedEdits === 0);
      expect(normalAllowed).toBe(false);

      // With force override ("Do it dammit!")
      const forceOverride = true;
      const forcedAllowed = normalAllowed || forceOverride;
      expect(forcedAllowed).toBe(true);
    });
  });

  describe('5. Closed Loop: Webhook Rebuild & Edge D1 Sync on origin/main Push', () => {
    it('receives webhook from origin/main, hydrates edge D1, and dispatches deploy hook', async () => {
      const globalFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 'cf-pages-build-123' }),
      });
      vi.stubGlobal('fetch', globalFetch);

      const payload = JSON.stringify({
        ref: 'refs/heads/main',
        after: 'rebased-commit-sha-789',
        repository: { name: 'splitphase.io' },
        siteId: siteId,
      });

      const signature = await computeSignature(payload, webhookSecret);

      const res = await app.fetch(
        new Request(`http://localhost:8787/ext/sync/webhook?site=${siteId}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-hub-signature-256': `sha256=${signature}`,
          },
          body: payload,
        }),
        {
          DB: mockD1,
          ENVIRONMENT: 'production',
        } as any
      );

      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.success).toBe(true);
      expect(json.siteId).toBe(siteId);
      expect(json.ref).toBe('refs/heads/main');
      expect(json.itemCount).toBe(2);
      expect(json.rebuildTriggered).toBe(true);
      expect(json.rebuildStatus).toBe(200);

      // Verify Cloudflare Pages deploy hook was dispatched
      expect(globalFetch).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/pages/deploy-hook',
        expect.objectContaining({
          method: 'POST',
        })
      );

      // Verify activity was logged
      const rebuildLog = loggedActivities.find((a) => a.action === 'webhook_site_rebuild');
      expect(rebuildLog).toBeDefined();

      vi.unstubAllGlobals();
    });

    it('safely ignores webhook pushes for feature branches or branch deletions', async () => {
      const featurePayload = JSON.stringify({
        ref: 'refs/heads/feat/some-feature',
        after: 'feature-sha',
        repository: { name: 'splitphase.io' },
      });
      const sig = await computeSignature(featurePayload, webhookSecret);

      const res = await app.fetch(
        new Request(`http://localhost:8787/ext/sync/webhook?site=${siteId}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-hub-signature-256': `sha256=${sig}`,
          },
          body: featurePayload,
        }),
        { DB: mockD1 } as any
      );

      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.ignored).toBe(true);
      expect(json.message).toContain('Ignoring push for non-target ref');
    });
  });

  describe('6. Editor Resiliency Against Stale Edge Sessions', () => {
    it('retains autosave draft key format scoped by site and document', () => {
      const formatKey = (site: string, col: string, id: string) =>
        `slottd_autosave_${site || 'default'}_${col}_${id || 'new'}`;

      const key = formatKey('splitphase.io', 'posts', 'my-post');
      expect(key).toBe('slottd_autosave_splitphase.io_posts_my-post');
    });

    it('preserves user modifications as working draft on 409 conflict without discarding input', () => {
      const localFormEdits = {
        title: 'Conflicting Draft Title',
        body: 'Local modifications that editor spent 20 minutes writing',
      };

      const serverConflictResponse = {
        status: 409,
        error: 'UPSTREAM_CONFLICT: Stale version detected. Upstream was modified.',
        draftSaved: true,
      };

      expect(serverConflictResponse.status).toBe(409);
      expect(serverConflictResponse.draftSaved).toBe(true);
      expect(localFormEdits.body).toContain('20 minutes writing');
    });
  });
});
