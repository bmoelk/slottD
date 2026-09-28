import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyHmacSignature } from '../src/sync/git-sync.js';
import * as driverModule from '../src/sync/driver.js';
import app from '../src/index.js';

describe('Phase 3: Inbound Webhook (POST /ext/sync/webhook) & HMAC Verification', () => {
  const secret = 'super-secret-webhook-key-123';
  const payloadStr = JSON.stringify({
    ref: 'refs/heads/main',
    after: 'abc123def456',
    repository: { name: 'my-site' },
  });

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

  describe('verifyHmacSignature helper', () => {
    it('verifies valid signature with and without sha256= prefix', async () => {
      const sig = await computeSignature(payloadStr, secret);

      const isValidWithoutPrefix = await verifyHmacSignature(payloadStr, sig, secret);
      expect(isValidWithoutPrefix).toBe(true);

      const isValidWithPrefix = await verifyHmacSignature(payloadStr, `sha256=${sig}`, secret);
      expect(isValidWithPrefix).toBe(true);
    });

    it('rejects invalid signature', async () => {
      const isValid = await verifyHmacSignature(payloadStr, 'sha256=badbadbadbadbadbadbadbadbadbad', secret);
      expect(isValid).toBe(false);
    });

    it('rejects wrong secret', async () => {
      const sig = await computeSignature(payloadStr, 'wrong-secret');
      const isValid = await verifyHmacSignature(payloadStr, `sha256=${sig}`, secret);
      expect(isValid).toBe(false);
    });

    it('rejects tampered payload', async () => {
      const sig = await computeSignature(payloadStr, secret);
      const isValid = await verifyHmacSignature(payloadStr + ' ', `sha256=${sig}`, secret);
      expect(isValid).toBe(false);
    });

    it('rejects empty or missing signature/secret', async () => {
      expect(await verifyHmacSignature(payloadStr, '', secret)).toBe(false);
      expect(await verifyHmacSignature(payloadStr, null, secret)).toBe(false);
      expect(await verifyHmacSignature(payloadStr, 'sig', '')).toBe(false);
    });
  });

  describe('POST /ext/sync/webhook route', () => {
    let mockDriver: any;
    let mockD1: any;
    let loggedActivities: any[] = [];

    beforeEach(() => {
      loggedActivities = [];
      mockDriver = {
        loadTagContent: vi.fn().mockResolvedValue([
          {
            collection: 'articles',
            slug: 'webhook-article',
            title: 'Webhook Article',
            data: { body: 'Fresh content from webhook' },
          },
        ]),
        listTags: vi.fn().mockResolvedValue(['v1.0.0']),
      };

      vi.spyOn(driverModule, 'getGitDriver').mockResolvedValue(mockDriver as any);

      // In-memory mock D1 SQLite database
      mockD1 = {
        prepare: vi.fn().mockImplementation((sql: string) => {
          let currentBinds: any[] = [];
          return {
            bind: vi.fn().mockImplementation((...binds: any[]) => {
              currentBinds = binds;
              return {
                first: vi.fn().mockImplementation(async () => {
                  return null;
                }),
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
                  if (lower.includes('system_site_settings')) {
                    return {
                      results: [
                        { key: 'git_remote_url', value: 'https://github.com/example/site.git' },
                        { key: 'git_branch', value: 'main' },
                      ],
                      meta: { changes: 0 },
                    };
                  }
                  return { results: [], meta: { changes: 0 } };
                }),
                run: vi.fn().mockImplementation(async () => {
                  const lower = sql.toLowerCase();
                  if (lower.includes('insert into activity_log') || lower.includes('activity_log')) {
                    loggedActivities.push({ sql, binds: currentBinds });
                  }
                  return { success: true, meta: { changes: 1 } };
                }),
                raw: vi.fn().mockResolvedValue([]),
              };
            }),
            first: vi.fn().mockResolvedValue(null),
            all: vi.fn().mockResolvedValue({ results: [], meta: { changes: 0 } }),
            run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
            raw: vi.fn().mockResolvedValue([]),
          };
        }),
      };
    });

    it('returns 401 Unauthorized if neither signature nor auth is provided', async () => {
      const mockEnv: any = {
        DB: mockD1,
        GITHUB_WEBHOOK_SECRET: secret,
      };

      const res = await app.fetch(
        new Request('http://localhost:8787/ext/sync/webhook?site=my-site', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payloadStr,
        }),
        mockEnv
      );

      expect(res.status).toBe(401);
      const json: any = await res.json();
      expect(json.error).toContain('Unauthorized');
    });

    it('returns 401 Unauthorized if signature does not match secret', async () => {
      const mockEnv: any = {
        DB: mockD1,
        GITHUB_WEBHOOK_SECRET: secret,
      };

      const res = await app.fetch(
        new Request('http://localhost:8787/ext/sync/webhook?site=my-site', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Hub-Signature-256': 'sha256=invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid',
          },
          body: payloadStr,
        }),
        mockEnv
      );

      expect(res.status).toBe(401);
      const json: any = await res.json();
      expect(json.error).toContain('Unauthorized');
    });

    it('returns 200 and ignores push if branch does not match target ref', async () => {
      const featurePayload = JSON.stringify({
        ref: 'refs/heads/feature-branch',
        after: 'fea123',
      });
      const sig = await computeSignature(featurePayload, secret);

      const mockEnv: any = {
        DB: mockD1,
        GITHUB_WEBHOOK_SECRET: secret,
        GIT_REMOTE_URL: 'https://github.com/example/site.git',
      };

      const res = await app.fetch(
        new Request('http://localhost:8787/ext/sync/webhook?site=my-site', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Hub-Signature-256': `sha256=${sig}`,
          },
          body: featurePayload,
        }),
        mockEnv
      );

      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.success).toBe(true);
      expect(json.ignored).toBe(true);
      expect(json.message).toContain("Ignoring push for non-target ref 'refs/heads/feature-branch'");
      expect(mockDriver.loadTagContent).not.toHaveBeenCalled();
    });

    it('returns 200 and ignores push if branch was deleted', async () => {
      const deletePayload = JSON.stringify({
        ref: 'refs/heads/main',
        deleted: true,
      });
      const sig = await computeSignature(deletePayload, secret);

      const mockEnv: any = {
        DB: mockD1,
        GITHUB_WEBHOOK_SECRET: secret,
      };

      const res = await app.fetch(
        new Request('http://localhost:8787/ext/sync/webhook?site=my-site', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Hub-Signature-256': `sha256=${sig}`,
          },
          body: deletePayload,
        }),
        mockEnv
      );

      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.success).toBe(true);
      expect(json.ignored).toBe(true);
      expect(json.message).toContain("Ignoring branch deletion");
      expect(mockDriver.loadTagContent).not.toHaveBeenCalled();
    });

    it('successfully ingests HEAD content and dispatches DEPLOY_HOOK_URL when signature is valid', async () => {
      const sig = await computeSignature(payloadStr, secret);

      // Mock global fetch for deploy hook
      const globalFetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (info: any) => {
        const urlStr = typeof info === 'string' ? info : info.url;
        if (urlStr === 'https://api.cloudflare.com/client/v4/pages/deploy-hook') {
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        return new Response('Not Found', { status: 404 });
      });

      const mockEnv: any = {
        DB: mockD1,
        GITHUB_WEBHOOK_SECRET: secret,
        GIT_REMOTE_URL: 'https://github.com/example/site.git',
        DEPLOY_HOOK_URL: 'https://api.cloudflare.com/client/v4/pages/deploy-hook',
      };

      const res = await app.fetch(
        new Request('http://localhost:8787/ext/sync/webhook?site=my-site', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Hub-Signature-256': `sha256=${sig}`,
          },
          body: payloadStr,
        }),
        mockEnv
      );

      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.success).toBe(true);
      expect(json.siteId).toBe('my-site');
      expect(json.ref).toBe('refs/heads/main');
      expect(json.itemCount).toBe(1);
      expect(json.rebuildTriggered).toBe(true);
      expect(json.rebuildStatus).toBe(200);

      expect(mockDriver.loadTagContent).toHaveBeenCalledWith('abc123def456');

      // Verify deploy hook call
      expect(globalFetchSpy).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/pages/deploy-hook',
        expect.objectContaining({
          method: 'POST',
        })
      );

      globalFetchSpy.mockRestore();
    });

    it('accepts authorization via ADMIN_API_KEY when no signature header is sent', async () => {
      const mockEnv: any = {
        DB: mockD1,
        ADMIN_API_KEY: 'admin-secret-token-xyz',
        GIT_REMOTE_URL: 'https://github.com/example/site.git',
      };

      const res = await app.fetch(
        new Request('http://localhost:8787/ext/sync/webhook?site=my-site', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer admin-secret-token-xyz',
          },
          body: payloadStr,
        }),
        mockEnv
      );

      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.success).toBe(true);
      expect(json.siteId).toBe('my-site');
    });
  });
});
