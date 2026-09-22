import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { detectMonorepo, isTargetMonorepoRemote, scopeReleaseTag } from '../src/sync/monorepo.js';

describe('Monorepo Detection & Remote Verifier', () => {
  it('identifies identical remote URLs across git@ SSH and HTTPS schemes', () => {
    const sshRemote = 'git@github.com:bmoelk/websites.git';
    const httpsRemote = 'https://github.com/bmoelk/websites.git';
    expect(isTargetMonorepoRemote(sshRemote, httpsRemote)).toBe(true);

    const scpRemote = 'git@github.com:bmoelk/brainendeavor.com.git';
    expect(isTargetMonorepoRemote(scpRemote, sshRemote)).toBe(false);
  });

  it('scopes release tags cleanly by siteId in monorepo mode', () => {
    expect(scopeReleaseTag('release-2026.09.21', 'brainendeavor', true)).toBe('brainendeavor/release-2026.09.21');
    // Does not double-prefix
    expect(scopeReleaseTag('brainendeavor/release-2026.09.21', 'brainendeavor', true)).toBe('brainendeavor/release-2026.09.21');
    expect(scopeReleaseTag('brainendeavor-release-2026.09.21', 'brainendeavor', true)).toBe('brainendeavor-release-2026.09.21');
    // Ignores if not in monorepo mode
    expect(scopeReleaseTag('release-2026.09.21', 'brainendeavor', false)).toBe('release-2026.09.21');
    // Ignores if siteId is default
    expect(scopeReleaseTag('release-2026.09.21', 'default', true)).toBe('release-2026.09.21');
  });

  it('detects workspace markers (pnpm-workspace.yaml, lerna.json) in project root', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slottd-mono-test-'));
    try {
      fs.writeFileSync(path.join(tempDir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
      const ctx = await detectMonorepo(tempDir);
      expect(ctx.isMonorepo).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('detects package.json workspaces array in project root', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slottd-mono-pkg-'));
    try {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'my-monorepo', workspaces: ['apps/*', 'packages/*'] })
      );
      const ctx = await detectMonorepo(tempDir);
      expect(ctx.isMonorepo).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('IsomorphicGitDriver with Monorepo Subpath', () => {
  it('routes serialized content into subpath in memory when in monorepo mode', async () => {
    const { IsomorphicGitDriver } = await import('../src/sync/isomorphic-driver.js');
    const driver = new IsomorphicGitDriver({
      url: 'https://example.com/virtual/monorepo.git',
      branch: 'main',
      isMonorepo: true,
      contentSubpath: 'brainendeavor-slottd-cms/content',
      siteId: 'brainendeavor',
    });

    const result = await driver.createRelease({
      tag: 'release-2026.09.21-01',
      message: 'test scoped monorepo release',
      files: [
        { path: 'content/blog_posts/test.json', content: JSON.stringify({ title: 'Test Post' }) },
      ],
      push: false,
    });

    expect(result.tagCreated).toBe(true);
    expect(result.isMonorepo).toBe(true);
    expect(result.contentSubpath).toBe('brainendeavor-slottd-cms/content');
    expect(result.message).toContain('brainendeavor/release-2026.09.21-01');
  });
});

describe('NativeShellGitDriver: Briefcase Bridge Delegation & Fallback', () => {
  it('delegates release, tag listing, and tag loading to Briefcase Bridge when active', async () => {
    const http = await import('http');
    const { NativeShellGitDriver } = await import('../src/sync/native-shell-driver.js');

    // Create a mock Briefcase Bridge on dynamic port
    let releasePayload: any = null;
    let fetchCalled = false;
    let loadCalled = false;

    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const parsed = body ? JSON.parse(body) : {};
        if (req.url === '/exec/release') {
          releasePayload = parsed;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, sha: 'bridge-test-sha-12345', message: 'Release tagged via mock bridge' }));
        } else if (req.url === '/exec/fetch') {
          fetchCalled = true;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, tags: ['v2.0.0', 'v1.0.0'] }));
        } else if (req.url === '/exec/load') {
          loadCalled = true;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            items: [
              { id: '1', collection: 'posts', slug: 'mock-post', title: 'Mock Post', status: 'published', data: {} }
            ]
          }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as any).port;

    try {
      const driver = new NativeShellGitDriver({
        url: 'git@github.com:bmoelk/brainendeavor.com.git',
        branch: 'main',
        repoPath: '/mock/monorepo/path',
        contentPath: 'brainendeavor-slottd-cms/content',
        siteId: 'brainendeavor',
        bridgeUrl: `http://127.0.0.1:${port}`,
      });

      // 1. Test release delegation
      const relResult = await driver.createRelease({
        tag: 'release-2026.09.21',
        message: 'test bridge release',
        files: [],
        push: true,
      });

      expect(relResult.commitSha).toBe('bridge-test-sha-12345');
      expect(releasePayload).not.toBeNull();
      expect(releasePayload.url).toBe('git@github.com:bmoelk/brainendeavor.com.git');
      expect(releasePayload.tag).toBe('release-2026.09.21');
      expect(releasePayload.contentPath).toBe('brainendeavor-slottd-cms/content');
      expect(releasePayload.siteId).toBe('brainendeavor');

      // 2. Test tag listing delegation
      const tags = await driver.listTags();
      expect(fetchCalled).toBe(true);
      expect(tags).toEqual(['v2.0.0', 'v1.0.0']);

      // 3. Test tag loading delegation
      const items = await driver.loadTagContent('v2.0.0');
      expect(loadCalled).toBe(true);
      expect(items.length).toBe(1);
      expect(items[0].slug).toBe('mock-post');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('falls back to IsomorphicGitDriver over HTTPS when Briefcase Bridge is offline', async () => {
    const { NativeShellGitDriver } = await import('../src/sync/native-shell-driver.js');

    // Bridge is offline on closed port
    const driver = new NativeShellGitDriver({
      url: 'https://example.com/virtual/repo.git',
      branch: 'main',
      contentPath: 'content',
      bridgeUrl: 'http://127.0.0.1:59999',
    });

    const result = await driver.createRelease({
      tag: 'release-offline-fallback',
      message: 'test offline fallback release',
      files: [
        { path: 'content/posts/offline.json', content: JSON.stringify({ title: 'Offline Post' }) }
      ],
      push: false,
    });

    expect(result.tagCreated).toBe(true);
    expect(result.commitSha).toBeDefined();
    expect(result.commitSha.length).toBe(40);
  });
});
