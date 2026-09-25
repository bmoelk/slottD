import { describe, it, expect, vi } from 'vitest';
import {
  synthesizeCommitFromActivities,
  synthesizeConventionalCommit,
} from '../src/sync/git-sync.js';
import type { ActivityLogRow } from '../src/types.js';
import app from '../src/index.js';

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

