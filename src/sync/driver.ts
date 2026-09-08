import type { GitContentItem, SerializedGitFile } from './git-sync.js';

export interface GitDriverOptions {
  url: string;
  branch?: string;
  token?: string;
  repoPath?: string;
  isProduction?: boolean;
}

export interface GitReleaseResult {
  commitSha: string;
  tagCreated: boolean;
  message: string;
  pushed: boolean;
}

export interface GitDriver {
  readonly engineName: string;
  listTags(): Promise<string[]>;
  loadTagContent(tag: string): Promise<GitContentItem[]>;
  createRelease(options: {
    tag: string;
    message: string;
    files: SerializedGitFile[];
    push?: boolean;
    author?: { name: string; email: string };
  }): Promise<GitReleaseResult>;
}

/**
 * Automatically normalizes SSH / SCP Git URLs to Smart HTTPS URLs.
 * e.g. git@github.com:bmoelk/brainendeavor.com.git -> https://github.com/bmoelk/brainendeavor.com.git
 * e.g. ssh://git@gitlab.com/group/repo.git -> https://gitlab.com/group/repo.git
 */
export function normalizeGitUrl(url: string): string {
  if (!url) return '';
  const trimmed = url.trim();

  // git@host:owner/repo.git
  const scpMatch = trimmed.match(/^git@([^:]+):(.+)$/);
  if (scpMatch) {
    return `https://${scpMatch[1]}/${scpMatch[2]}`;
  }

  // ssh://git@host/owner/repo.git
  const sshMatch = trimmed.match(/^ssh:\/\/git@([^/]+)\/(.+)$/);
  if (sshMatch) {
    return `https://${sshMatch[1]}/${sshMatch[2]}`;
  }

  return trimmed;
}

export function isSshUrl(url: string): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  return trimmed.startsWith('git@') || trimmed.startsWith('ssh://');
}

/**
 * Universal Driver Factory:
 * - Briefcase with SSH URL -> NativeShellGitDriver (uses local SSH agent)
 * - Cloudflare Workers or HTTPS -> IsomorphicGitDriver (pure Smart HTTP in memory)
 */
export async function getGitDriver(options: GitDriverOptions): Promise<GitDriver> {
  const globalProc = (globalThis as any).process;
  const isProd = options.isProduction ?? (typeof globalProc !== 'undefined' && globalProc?.env?.ENVIRONMENT === 'production');

  // If local Briefcase / workstation with local filesystem repo or SSH URL, use native shell
  if (!isProd && (options.repoPath || isSshUrl(options.url))) {
    const { NativeShellGitDriver } = await import('./native-shell-driver.js');
    return new NativeShellGitDriver(options);
  }

  // Default universal driver: isomorphic-git + memfs over Smart HTTPS
  const { IsomorphicGitDriver } = await import('./isomorphic-driver.js');
  return new IsomorphicGitDriver(options);
}
