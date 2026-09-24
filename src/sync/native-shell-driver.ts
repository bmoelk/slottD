import { isSshUrl, type GitDriver, type GitDriverOptions, type GitReleaseResult } from './driver.js';
import type { GitContentItem, SerializedGitFile } from './git-sync.js';

export class NativeShellGitDriver implements GitDriver {
  readonly engineName = 'Native Git CLI (Briefcase Bridge)';
  private readonly repoPath: string;
  private readonly branch: string;
  private readonly url: string;
  private readonly token?: string;
  private readonly contentSubpath: string;
  private readonly siteId: string;
  private readonly bridgeUrl: string;

  constructor(options: GitDriverOptions) {
    const globalProc = (globalThis as any).process;
    this.repoPath = options.repoPath || (typeof globalProc !== 'undefined' && globalProc?.cwd ? globalProc.cwd() : '');
    this.branch = options.branch || 'main';
    this.url = options.url || '';
    this.token = options.token;
    this.contentSubpath = options.contentPath ?? options.contentSubpath ?? '';
    this.siteId = options.siteId;
    this.bridgeUrl = options.bridgeUrl || (typeof globalProc !== 'undefined' && globalProc?.env?.SLOTTD_BRIDGE_URL ? globalProc.env.SLOTTD_BRIDGE_URL : 'http://127.0.0.1:8788');
  }

  async listTags(): Promise<string[]> {
    let bridgeRes: Response;
    try {
      bridgeRes = await fetch(`${this.bridgeUrl}/exec/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath: this.repoPath, url: this.url, siteId: this.siteId }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (e: any) {
      throw new Error(
        `Git Bridge is unreachable at ${this.bridgeUrl} (${e.message}). Ensure SlottD Briefcase or Git Bridge is running on port 8788.`
      );
    }

    if (bridgeRes.ok) {
      const json: any = await bridgeRes.json();
      if (json.tags && Array.isArray(json.tags)) {
        return json.tags;
      }
      return [];
    }

    const errJson: any = await bridgeRes.json().catch(() => ({}));
    throw new Error(
      errJson.error || errJson.message || `Git Bridge fetch failed with HTTP ${bridgeRes.status} ${bridgeRes.statusText}`
    );
  }

  async loadTagContent(tag: string): Promise<GitContentItem[]> {
    if (!tag) {
      throw new Error('Tag name is required to load content.');
    }

    let bridgeRes: Response;
    try {
      bridgeRes = await fetch(`${this.bridgeUrl}/exec/load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tag,
          repoPath: this.repoPath,
          url: this.url,
          contentPath: this.contentSubpath,
          siteId: this.siteId,
        }),
        signal: AbortSignal.timeout(15000),
      });
    } catch (e: any) {
      throw new Error(
        `Git Bridge is unreachable at ${this.bridgeUrl} (${e.message}). Ensure SlottD Briefcase or Git Bridge is running on port 8788.`
      );
    }

    if (bridgeRes.ok) {
      const json: any = await bridgeRes.json();
      if (json.items && Array.isArray(json.items)) {
        return json.items;
      }
      return [];
    }

    const errJson: any = await bridgeRes.json().catch(() => ({}));
    throw new Error(
      errJson.error || errJson.message || `Git Bridge load failed with HTTP ${bridgeRes.status} ${bridgeRes.statusText}`
    );
  }

  async createRelease(options: {
    tag?: string;
    message: string;
    files: SerializedGitFile[];
    push?: boolean;
    author?: { name: string; email: string };
  }): Promise<GitReleaseResult> {
    let bridgeRes: Response;
    try {
      bridgeRes = await fetch(`${this.bridgeUrl}/exec/release`, {
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
    } catch (e: any) {
      throw new Error(
        `Git Bridge is unreachable at ${this.bridgeUrl} (${e.message}). Ensure SlottD Briefcase or Git Bridge is running on port 8788.`
      );
    }

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

    const errJson: any = await bridgeRes.json().catch(() => ({}));
    throw new Error(
      errJson.error || errJson.message || `Git Bridge release failed with HTTP ${bridgeRes.status} ${bridgeRes.statusText}`
    );
  }
}
