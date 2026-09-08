import { describe, it, expect } from 'vitest';
import { normalizeGitUrl, isSshUrl, getGitDriver } from '../src/sync/driver.js';
import { IsomorphicGitDriver } from '../src/sync/isomorphic-driver.js';

describe('Universal Git Driver: URL Normalizer', () => {
  it('normalizes SCP-style GitHub SSH URLs to HTTPS', () => {
    const scpUrl = 'git@github.com:bmoelk/brainendeavor.com.git';
    expect(normalizeGitUrl(scpUrl)).toBe('https://github.com/bmoelk/brainendeavor.com.git');
  });

  it('normalizes standard ssh:// URLs to HTTPS', () => {
    const sshUrl = 'ssh://git@gitlab.com/group/project.git';
    expect(normalizeGitUrl(sshUrl)).toBe('https://gitlab.com/group/project.git');
  });

  it('preserves existing HTTPS URLs unchanged', () => {
    const httpsUrl = 'https://github.com/bmoelk/brainendeavor.com.git';
    expect(normalizeGitUrl(httpsUrl)).toBe('https://github.com/bmoelk/brainendeavor.com.git');
  });

  it('detects SSH URLs accurately', () => {
    expect(isSshUrl('git@github.com:org/repo.git')).toBe(true);
    expect(isSshUrl('ssh://git@github.com/org/repo.git')).toBe(true);
    expect(isSshUrl('https://github.com/org/repo.git')).toBe(false);
  });
});

describe('IsomorphicGitDriver: Edge Smart HTTP in Memory', () => {
  it('instantiates IsomorphicGitDriver with normalized URL', () => {
    const driver = new IsomorphicGitDriver({
      url: 'git@github.com:bmoelk/brainendeavor.com.git',
      branch: 'main',
    });
    expect(driver.engineName).toContain('isomorphic-git');
  });

  it('lists remote tags over Smart HTTP without requiring a filesystem', async () => {
    const driver = new IsomorphicGitDriver({
      url: 'https://github.com/isomorphic-git/isomorphic-git.git',
    });

    const tags = await driver.listTags();
    expect(Array.isArray(tags)).toBe(true);
    expect(tags.length).toBeGreaterThan(0);
    expect(tags).toContain('v0.0.1');
  }, 15000);

  it('creates in-memory commits and tags using memfs without touching disk', async () => {
    const driver = new IsomorphicGitDriver({
      url: 'https://example.com/virtual/repo.git',
      branch: 'main',
    });

    const result = await driver.createRelease({
      tag: 'release-test-v1',
      message: 'test in-memory release',
      files: [
        { path: 'content/blog_posts/test.json', content: JSON.stringify({ title: 'Test Post' }) },
        { path: 'content/blog_posts/test.md', content: '# Hello World' },
      ],
      push: false,
    });

    expect(result.tagCreated).toBe(true);
    expect(result.commitSha).toBeDefined();
    expect(result.commitSha.length).toBe(40);
    expect(result.pushed).toBe(false);
  });

  it('selects IsomorphicGitDriver for production environment regardless of URL scheme', async () => {
    const driver = await getGitDriver({
      url: 'git@github.com:bmoelk/brainendeavor.com.git',
      isProduction: true,
    });
    expect(driver.engineName).toContain('isomorphic-git');
  });
});

describe('Content Diff Engine: computeContentDiff', () => {
  it('detects added, removed, modified, and unchanged items', async () => {
    const { computeContentDiff } = await import('../src/sync/diff.js');

    const activeItems = [
      {
        id: '1',
        collection: 'blog_posts',
        slug: 'post-1',
        title: 'Post 1 (Updated)',
        status: 'published' as const,
        data: { author: 'Brian', content: 'Updated content' },
        createdAt: 1000,
        updatedAt: 2000,
      },
      {
        id: '2',
        collection: 'blog_posts',
        slug: 'post-new',
        title: 'Brand New Post',
        status: 'draft' as const,
        data: { author: 'Brian' },
        createdAt: 3000,
        updatedAt: 3000,
      },
    ];

    const tagItems = [
      {
        id: '1',
        collection: 'blog_posts',
        slug: 'post-1',
        title: 'Post 1 (Old)',
        status: 'published' as const,
        data: { author: 'Brian', content: 'Original content' },
        createdAt: 1000,
        updatedAt: 1000,
      },
      {
        id: '3',
        collection: 'blog_posts',
        slug: 'post-deleted',
        title: 'Deleted Post',
        status: 'published' as const,
        data: {},
        createdAt: 500,
        updatedAt: 500,
      },
    ];

    const report = computeContentDiff(activeItems, tagItems, 'v1.0.0');
    expect(report.modified).toBe(1);
    expect(report.added).toBe(1);
    expect(report.removed).toBe(1);
    expect(report.unchanged).toBe(0);
    expect(report.formattedOutput).toContain('Post 1 (Updated)');
    expect(report.formattedOutput).toContain('NEW in D1');
    expect(report.formattedOutput).toContain('DELETED in D1');
  });
});

describe('NativeShellGitDriver: Root Collection Tag Loading', () => {
  it('loads content from git tag with root-level collections', async () => {
    const { NativeShellGitDriver } = await import('../src/sync/native-shell-driver.js');
    const driver = new NativeShellGitDriver({
      url: 'git@github.com:bmoelk/brainendeavor.com.git',
      repoPath: '/Users/bmo/code/websites-deployed/brainendeavor.com',
    });

    const items = await driver.loadTagContent('release-2026.09.08-v1');
    expect(items.length).toBeGreaterThan(50);
    const blogPost = items.find((i) => i.collection === 'blog_posts');
    expect(blogPost).toBeDefined();
    expect(blogPost?.slug).toBeTruthy();
  });
});

describe('D1 Database Hydration: hydrateFromGit ID collision safety', () => {
  it('handles targetId collisions by re-assigning UUID and avoiding primary key constraint errors', async () => {
    const { hydrateFromGit } = await import('../src/sync/git-sync.js');

    // In-memory mock database tracking documents table
    const table: any[] = [
      {
        id: 'gal-pottery-1',
        collection: 'gallery',
        slug: 'gargoyle-fountain',
        title: 'Gargoyle Fountain',
      },
    ];

    const mockDb: any = {
      selectFrom: () => ({
        select: () => ({
          where: (col: string, op: string, val: any) => ({
            where: (col2: string, op2: string, val2: any) => ({
              executeTakeFirst: async () => table.find((r) => r[col] === val && r[col2] === val2) || null,
            }),
            executeTakeFirst: async () => table.find((r) => r[col] === val) || null,
          }),
        }),
      }),
      insertInto: () => ({
        values: (vals: any) => ({
          execute: async () => {
            if (table.some((r) => r.id === vals.id)) {
              throw new Error(`UNIQUE constraint failed: documents.id (id=${vals.id})`);
            }
            table.push(vals);
          },
        }),
      }),
      updateTable: () => ({
        set: (sets: any) => ({
          where: (col: string, op: string, val: any) => ({
            execute: async () => {
              const row = table.find((r) => r[col] === val);
              if (row) Object.assign(row, sets);
            },
          }),
        }),
      }),
    };

    // Incoming item with identical ID 'gal-pottery-1', but different slug 'pottery-1'
    const incomingItems = [
      {
        id: 'gal-pottery-1',
        collection: 'gallery',
        slug: 'pottery-1',
        title: 'Hand-Built Ceramic Vessel 1',
        status: 'published' as const,
        data: { order: 1 },
      },
    ];

    const result = await hydrateFromGit(mockDb, incomingItems);
    expect(result.inserted).toBe(1);
    expect(table.length).toBe(2);

    // Existing 'gargoyle-fountain' preserved its original ID 'gal-pottery-1'
    const orig = table.find((r) => r.slug === 'gargoyle-fountain');
    expect(orig?.id).toBe('gal-pottery-1');

    // New 'pottery-1' was assigned a new UUID and didn't crash
    const restored = table.find((r) => r.slug === 'pottery-1');
    expect(restored).toBeDefined();
    expect(restored?.id).not.toBe('gal-pottery-1');
  });
});
