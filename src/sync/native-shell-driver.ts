import { isSshUrl, type GitDriver, type GitDriverOptions, type GitReleaseResult } from './driver.js';
import type { GitContentItem, SerializedGitFile } from './git-sync.js';

export class NativeShellGitDriver implements GitDriver {
  readonly engineName = 'Native Git CLI (Briefcase Bridge)';
  private readonly repoPath: string;
  private readonly branch: string;
  private readonly url: string;
  private readonly token?: string;
  private readonly contentSubpath?: string;
  private readonly siteId?: string;
  private readonly bridgeUrl: string;

  constructor(options: GitDriverOptions) {
    const globalProc = (globalThis as any).process;
    this.repoPath = options.repoPath || (typeof globalProc !== 'undefined' && globalProc?.cwd ? globalProc.cwd() : '');
    this.branch = options.branch || 'main';
    this.url = options.url || '';
    this.token = options.token;
    this.contentSubpath = options.contentPath || options.contentSubpath || 'content';
    this.siteId = options.siteId;
    this.bridgeUrl = options.bridgeUrl || (typeof globalProc !== 'undefined' && globalProc?.env?.SLOTTD_BRIDGE_URL ? globalProc.env.SLOTTD_BRIDGE_URL : 'http://127.0.0.1:8788');
  }

  async listTags(): Promise<string[]> {
    // 1. Check local Briefcase Bridge
    try {
      const bridgeRes = await fetch(`${this.bridgeUrl}/exec/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath: this.repoPath, url: this.url }),
        signal: AbortSignal.timeout(3000),
      });
      if (bridgeRes.ok) {
        const json: any = await bridgeRes.json();
        if (json.tags && Array.isArray(json.tags)) {
          return json.tags;
        }
      }
    } catch {}

    // 2. Fall back to IsomorphicGitDriver over Smart HTTPS
    const { IsomorphicGitDriver } = await import('./isomorphic-driver.js');
    const iso = new IsomorphicGitDriver({
      url: this.url,
      branch: this.branch,
      token: this.token,
    });
    return await iso.listTags();
  }

  async loadTagContent(tag: string): Promise<GitContentItem[]> {
    if (!tag) {
      throw new Error('Tag name is required to load content.');
    }

    // 1. Check local Briefcase Bridge
    try {
      const bridgeRes = await fetch(`${this.bridgeUrl}/exec/load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tag,
          repoPath: this.repoPath,
          url: this.url,
          contentPath: this.contentSubpath,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (bridgeRes.ok) {
        const json: any = await bridgeRes.json();
        if (json.items && Array.isArray(json.items)) {
          return json.items;
        }
      }
    } catch {}

    // 2. Fall back to IsomorphicGitDriver over Smart HTTPS
    const { IsomorphicGitDriver } = await import('./isomorphic-driver.js');
    const iso = new IsomorphicGitDriver({
      url: this.url,
      branch: this.branch,
      token: this.token,
      contentSubpath: this.contentSubpath,
      siteId: this.siteId,
    });
    return await iso.loadTagContent(tag);
  }

  async createRelease(options: {
    tag: string;
    message: string;
    files: SerializedGitFile[];
    push?: boolean;
    author?: { name: string; email: string };
  }): Promise<GitReleaseResult> {
    // 1. Check local Briefcase Bridge
    try {
      const bridgeRes = await fetch(`${this.bridgeUrl}/exec/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoPath: this.repoPath,
          url: this.url,
          branch: this.branch,
          contentPath: this.contentSubpath,
          tag: options.tag,
          message: options.message,
          push: options.push !== false,
          siteId: this.siteId,
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (bridgeRes.ok) {
        const json: any = await bridgeRes.json();
        return {
          commitSha: json.sha || 'bridge-commit',
          tagCreated: true,
          message: json.message || `Release tagged via Git Bridge.`,
          pushed: options.push !== false,
          contentPath: this.contentSubpath,
        };
      }
    } catch {}

    // 2. Fall back to IsomorphicGitDriver over Smart HTTPS
    const { IsomorphicGitDriver } = await import('./isomorphic-driver.js');
    const iso = new IsomorphicGitDriver({
      url: this.url,
      branch: this.branch,
      token: this.token,
      contentSubpath: this.contentSubpath,
      siteId: this.siteId,
    });
    return await iso.createRelease(options);
  }
}
