import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  synthesizeCommitFromActivities,
  synthesizeConventionalCommit,
} from '../src/sync/git-sync.js';
import type { ActivityLogRow } from '../src/types.js';
import app from '../src/index.js';
import * as driverModule from '../src/sync/driver.js';

describe('Audit-Driven Conventional Commit Synthesis', () => {
  it('handles empty activity log gracefully', () => {
    const res = synthesizeCommitFromActivities([], {
      nextTag: 'release-2026.09.24-1200',
    });

    expect(res.hasUnreleased).toBe(false);
    expect(res.itemsCount).toBe(0);
    expect(res.collectionsCount).toBe(0);
    expect(res.commitMessage).toContain('chore(content): release snapshot release-2026.09.24-1200');
    expect(res.commitMessage).toContain('Zero unreleased database activity logged');
  });

  it('aggregates create followed by updates into a single feat line', () => {
    const activities: ActivityLogRow[] = [
      {
        id: 'act-1',
        site_id: 'test.io',
        timestamp: 1000,
        actor: 'alice@test.io',
        action: 'create',
        collection: 'projects',
        document_id: 'proj-1',
        document_title: 'SlottD Engine',
      },
      {
        id: 'act-2',
        site_id: 'test.io',
        timestamp: 1050,
        actor: 'bob@test.io',
        action: 'update',
        collection: 'projects',
        document_id: 'proj-1',
        document_title: 'SlottD Engine v2',
      },
    ];

    const res = synthesizeCommitFromActivities(activities, {
      lastReleaseTag: 'release-2026.09.24-1000',
      lastReleaseSha: 'a1b2c3d',
      nextTag: 'release-2026.09.24-1100',
    });

    expect(res.hasUnreleased).toBe(true);
    expect(res.itemsCount).toBe(1);
    expect(res.collectionsCount).toBe(1);
    expect(res.commitMessage).toContain("feat(projects): created 'SlottD Engine v2' (by alice, bob)");
    expect(res.commitMessage).toContain('Changes since release-2026.09.24-1000 (1 item across 1 collection):');
    expect(res.commitMessage).toContain('Audit-Checkpoint: a1b2c3d..HEAD');
  });

  it('aggregates multiple updates into a single fix line', () => {
    const activities: ActivityLogRow[] = [
      {
        id: 'act-1',
        site_id: 'test.io',
        timestamp: 1000,
        actor: 'editor',
        action: 'update',
        collection: 'pages',
        document_id: 'home',
        document_title: 'Home Page',
      },
      {
        id: 'act-2',
        site_id: 'test.io',
        timestamp: 1010,
        actor: 'editor',
        action: 'update',
        collection: 'pages',
        document_id: 'home',
        document_title: 'Home Page',
      },
      {
        id: 'act-3',
        site_id: 'test.io',
        timestamp: 1020,
        actor: 'editor',
        action: 'update',
        collection: 'pages',
        document_id: 'home',
        document_title: 'Home Page',
      },
    ];

    const res = synthesizeCommitFromActivities(activities);
    expect(res.itemsCount).toBe(1);
    expect(res.changes[0].action).toBe('fix');
    expect(res.commitMessage).toContain("fix(pages): updated 'Home Page' (by editor)");
  });

  it('omits documents that were created and then deleted within the same unreleased window', () => {
    const activities: ActivityLogRow[] = [
      {
        id: 'act-1',
        site_id: 'test.io',
        timestamp: 1000,
        actor: 'alice',
        action: 'create',
        collection: 'temp',
        document_id: 'scratch',
        document_title: 'Temporary Scratch',
      },
      {
        id: 'act-2',
        site_id: 'test.io',
        timestamp: 1010,
        actor: 'alice',
        action: 'delete',
        collection: 'temp',
        document_id: 'scratch',
        document_title: 'Temporary Scratch',
      },
    ];

    const res = synthesizeCommitFromActivities(activities);
    expect(res.hasUnreleased).toBe(false);
    expect(res.itemsCount).toBe(0);
    expect(res.changes).toHaveLength(0);
  });

  it('records chore for deletions of pre-existing documents', () => {
    const activities: ActivityLogRow[] = [
      {
        id: 'act-1',
        site_id: 'test.io',
        timestamp: 1000,
        actor: 'bmo',
        action: 'delete',
        collection: 'faq_items',
        document_id: 'deprecated-faq',
        document_title: 'Legacy Architecture FAQ',
      },
    ];

    const res = synthesizeCommitFromActivities(activities);
    expect(res.itemsCount).toBe(1);
    expect(res.changes[0].action).toBe('chore');
    expect(res.commitMessage).toContain("chore(faq_items): deleted 'Legacy Architecture FAQ' (by bmo)");
  });

  it('records feat for version promotions', () => {
    const activities: ActivityLogRow[] = [
      {
        id: 'act-1',
        site_id: 'test.io',
        timestamp: 1000,
        actor: 'bmo',
        action: 'version_promote',
        collection: 'blog_posts',
        document_id: 'post-1',
        document_title: 'Applying MVP in IT',
      },
    ];

    const res = synthesizeCommitFromActivities(activities);
    expect(res.itemsCount).toBe(1);
    expect(res.changes[0].action).toBe('feat');
    expect(res.commitMessage).toContain("feat(blog_posts): promoted draft 'Applying MVP in IT' (by bmo)");
  });

  it('ignores internal _git and git_release activities from the changelog items', () => {
    const activities: ActivityLogRow[] = [
      {
        id: 'act-1',
        site_id: 'test.io',
        timestamp: 1000,
        actor: 'bmo',
        action: 'create',
        collection: 'projects',
        document_id: 'proj-1',
        document_title: 'SpectraFlux',
      },
      {
        id: 'act-2',
        site_id: 'test.io',
        timestamp: 1050,
        actor: 'system',
        action: 'git_release',
        collection: '_git',
        document_id: 'release-2026.09.24',
        document_title: 'Release release-2026.09.24',
      },
    ];

    const res = synthesizeCommitFromActivities(activities);
    expect(res.itemsCount).toBe(1);
    expect(res.commitMessage).toContain("feat(projects): created 'SpectraFlux' (by bmo)");
    expect(res.commitMessage).not.toContain('_git');
  });

  it('serves GET /admin/git/suggest-commit via API', async () => {
    const mockEnv: any = {
      DB: {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue({
            results: [
              {
                id: 'act-1',
                site_id: 'test.io',
                timestamp: Date.now(),
                actor: 'bmo',
                action: 'create',
                collection: 'projects',
                document_id: 'p-1',
                document_title: 'Test Project',
              },
            ],
            meta: { changes: 0 },
          }),
          raw: vi.fn().mockResolvedValue([]),
          first: vi.fn().mockResolvedValue(null),
          run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } }),
        }),
      },
      ENVIRONMENT: 'development',
    };

    const res = await app.fetch(
      new Request('http://localhost:8787/admin/git/suggest-commit?site_id=test.io&tag=release-test-v1', {
        headers: { host: 'localhost:8787' },
      }),
      mockEnv
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);
    expect(json.siteId).toBe('test.io');
    expect(json.nextTag).toBe('release-test-v1');
    expect(json.commitMessage).toContain('chore(content): release snapshot release-test-v1');
  });

  it('serializes activity logs into .slottd/activity.jsonl in serializeToFiles', async () => {
    const { serializeToFiles } = await import('../src/sync/git-sync.js');
    const items = [
      {
        id: 'doc-1',
        collection: 'projects',
        slug: 'slottd',
        title: 'SlottD',
        data: { summary: 'Headless CMS' },
      },
    ];

    const activities: ActivityLogRow[] = [
      {
        id: 'act-100',
        site_id: 'test.io',
        timestamp: 1700000000,
        actor: 'bmo',
        action: 'create',
        collection: 'projects',
        document_id: 'doc-1',
        document_title: 'SlottD',
      },
    ];

    const files = serializeToFiles(items, 'content', 'test.io', false, true, activities);
    const activityFile = files.find((f) => f.path.endsWith('.slottd/activity.jsonl'));
    expect(activityFile).toBeDefined();
    expect(activityFile?.content).toContain('"id":"act-100"');
    expect(activityFile?.content).toContain('"actor":"bmo"');
  });

  it('hydrates activity logs idempotently via hydrateActivityLogs', async () => {
    const { hydrateActivityLogs } = await import('../src/sync/git-sync.js');

    const insertedRows: any[] = [];
    const mockDb: any = {
      selectFrom: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockResolvedValue(null),
        }),
      }),
      insertInto: vi.fn().mockReturnValue({
        values: vi.fn().mockImplementation((val) => {
          insertedRows.push(val);
          return { execute: vi.fn().mockResolvedValue({}) };
        }),
      }),
    };

    const jsonl = '{"id":"act-1","site_id":"test.io","timestamp":1000,"actor":"bmo","action":"create","collection":"p","document_id":"d1"}\n{"id":"act-2","site_id":"test.io","timestamp":1001,"actor":"bmo","action":"update","collection":"p","document_id":"d1"}';

    const result = await hydrateActivityLogs(mockDb, jsonl, 'test.io');
    expect(result.restored).toBe(2);
    expect(result.skipped).toBe(0);
    expect(insertedRows).toHaveLength(2);
    expect(insertedRows[0].id).toBe('act-1');
    expect(insertedRows[1].id).toBe('act-2');
  });
});

describe('Git Tag Details Resolution & Admin View', () => {
  let driverSpy: any;
  beforeEach(() => {
    driverSpy = vi.spyOn(driverModule, 'getGitDriver').mockResolvedValue({
      engineName: 'MockGitDriver',
      listTags: vi.fn().mockResolvedValue(['v1.2.0']),
      loadTagContent: vi.fn().mockResolvedValue([]),
      createRelease: vi.fn().mockResolvedValue({ commitSha: 'sha', tagCreated: true, message: 'ok', pushed: false }),
    } as any);
  });

  afterEach(() => {
    driverSpy?.mockRestore();
  });

  it('GET /admin/git/tag-details requires tag parameter', async () => {
    const mockEnv: any = {
      DB: {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue(null),
          all: vi.fn().mockResolvedValue({ results: [] }),
        }),
      },
      ENVIRONMENT: 'development',
    };

    const res = await app.fetch(
      new Request('http://localhost:8787/admin/git/tag-details?site_id=test.io'),
      mockEnv
    );

    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('Tag parameter is required');
  });

  it('GET /admin/git/tag-details returns commit details from activity_log', async () => {
    const activityRow = {
      id: 'act-release-1',
      site_id: 'test.io',
      timestamp: 1700000000000,
      actor: 'brian@slottd.dev',
      action: 'git_release',
      collection: '_git',
      document_id: 'v1.2.0',
      document_title: 'Release v1.2.0',
      details: JSON.stringify({
        tag: 'v1.2.0',
        commitSha: 'c0ffee1234567890',
        commitMessage: 'feat(core): synthesized conventional release notes\n\n- feat(posts): added post-1',
      }),
    };

    const mockEnv: any = {
      DB: {
        prepare: vi.fn().mockImplementation((sql: string) => {
          const stmt: any = {
            bind: vi.fn().mockImplementation(() => stmt),
            first: vi.fn().mockResolvedValue(activityRow),
            all: vi.fn().mockResolvedValue({ results: [activityRow], meta: { changes: 0 } }),
            run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } }),
            raw: vi.fn().mockResolvedValue([activityRow]),
          };
          return stmt;
        }),
      },
      ENVIRONMENT: 'development',
    };

    const res = await app.fetch(
      new Request('http://localhost:8787/admin/git/tag-details?tag=v1.2.0&site_id=test.io'),
      mockEnv
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);
    expect(json.tagDetails.tag).toBe('v1.2.0');
    expect(json.tagDetails.commitSha).toBe('c0ffee1234567890');
    expect(json.tagDetails.message).toContain('feat(core): synthesized conventional release notes');
    expect(json.tagDetails.author).toBe('brian@slottd.dev');
  });

  it('GET /admin/git renders Import & Restore tab with Tag Commit Message box', async () => {
    const mockEnv: any = {
      DB: {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue(null),
          all: vi.fn().mockResolvedValue({ results: [] }),
        }),
      },
      ENVIRONMENT: 'development',
    };

    const res = await app.fetch(
      new Request('http://localhost:8787/admin/git?site_id=test.io'),
      mockEnv
    );

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Tag Commit Message');
    expect(html).toContain('tagMessageContent');
    expect(html).toContain('tagDetailsBadge');
    expect(html).toContain('tagShaBadge');
    expect(html).toContain('tagAuthorDateBadge');
    expect(html).toContain('btnCopyTagMsg');
  }, 10000);

  it('renderGitView produces valid clientScript syntax without parse errors', async () => {
    const { renderGitView } = await import('../src/admin/views/git.js');
    const htmlObj = renderGitView({
      environment: 'development',
      d1DatabaseId: 'local',
      repoPath: '/Users/bmo/code/websites-git-repos/brainendeavor.com',
      hasRemote: true,
      remoteUrl: 'git@github.com:bmoelk/brainendeavor.com.git',
      docCount: 10,
      collectionCount: 3,
      mediaCount: 2,
      tags: ['release-2026.09.27-1224'],
      initialTagDetails: {
        tag: 'release-2026.09.27-1224',
        commitSha: 'cfcd944123456789',
        message: "chore(content): release snapshot release-2026.09.27-1224\n\n- feat(articles): updated 'Hello World'\n- fix(authors): updated",
        author: 'Brian Moelk <brian@slottd.dev>',
        date: '2026-09-27T19:24:00Z',
      },
    }, { email: 'dev@localhost' }, { activeSite: 'brainendeavor.com' });

    const html = String(htmlObj);
    const scriptMatches = [...html.matchAll(/<script[\s\S]*?>([\s\S]*?)<\/script>/gi)];
    expect(scriptMatches.length).toBeGreaterThan(0);

    for (const match of scriptMatches) {
      const scriptCode = match[1].trim();
      if (!scriptCode || scriptCode.includes('window.switchSite')) continue;
      let err: any = null;
      try {
        new Function(scriptCode);
      } catch (e: any) {
        err = e;
        console.error('SCRIPT SYNTAX ERROR IN TEST:', e.message);
        const lines = scriptCode.split('\n');
        lines.forEach((l, idx) => console.log(`${idx + 1}: ${l}`));
      }
      expect(err).toBeNull();
    }
  });
});

