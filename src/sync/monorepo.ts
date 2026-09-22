import path from 'path';

export interface MonorepoContext {
  isMonorepo: boolean;
  gitTopLevel?: string;
  projectDir: string;
  relativeSubpath: string;
  contentPath: string;
  originRemoteUrl?: string;
}

/**
 * Validates the remote content path to ensure content is never placed in the repository root.
 */
export function validateContentPath(contentPath: string, requireSubdir: boolean = false): string {
  const trimmed = (contentPath || '').trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (requireSubdir && (!trimmed || trimmed === '.' || trimmed === '/')) {
    throw new Error(
      "Invalid Git content path: refusing to use root repository directory in monorepo context. Please specify a dedicated subdirectory (e.g. 'content')."
    );
  }
  return trimmed === '.' ? '' : trimmed;
}

const dynamicImport = (modName: string): Promise<any> => {
  try {
    // @ts-ignore
    return import(/* @vite-ignore */ modName).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
};

/**
 * Detects whether the given directory operates within a parent Git monorepo.
 * Allows explicit override of the remote content path.
 */
export async function detectMonorepo(projectDir: string, explicitContentPath?: string): Promise<MonorepoContext> {
  const resolvedProjectDir = path.resolve(projectDir || (typeof process !== 'undefined' && process.cwd ? process.cwd() : '.'));
  const finalExplicitPath = explicitContentPath !== undefined ? validateContentPath(explicitContentPath, false) : undefined;
  
  const defaultCtx: MonorepoContext = {
    isMonorepo: false,
    projectDir: resolvedProjectDir,
    relativeSubpath: '',
    contentPath: finalExplicitPath || 'content',
  };

  const cp = await dynamicImport('child_process');
  const fs = await dynamicImport('fs');

  if (!cp || !cp.execSync || !fs) {
    return defaultCtx;
  }

  let gitTopLevel: string | undefined;
  let originRemoteUrl = '';

  try {
    const gitTopLevelRaw = cp.execSync('git rev-parse --show-toplevel', {
      cwd: resolvedProjectDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    if (gitTopLevelRaw) {
      gitTopLevel = path.resolve(gitTopLevelRaw);
    }
  } catch {}

  if (gitTopLevel) {
    try {
      originRemoteUrl = cp.execSync('git remote get-url origin', {
        cwd: resolvedProjectDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {}

    // If projectDir is a subdirectory inside the Git repository
    if (gitTopLevel !== resolvedProjectDir && resolvedProjectDir.startsWith(gitTopLevel)) {
      const relSubpath = path.relative(gitTopLevel, resolvedProjectDir).replace(/\\/g, '/');
      const contentPath = finalExplicitPath || `${relSubpath}/content`;

      return {
        isMonorepo: true,
        gitTopLevel,
        projectDir: resolvedProjectDir,
        relativeSubpath: relSubpath,
        contentPath,
        originRemoteUrl: originRemoteUrl || undefined,
      };
    }
  }

  // Check for workspace root markers in projectDir
  const workspaceMarkers = ['pnpm-workspace.yaml', 'lerna.json', 'turbo.json', 'nx.json'];
  for (const marker of workspaceMarkers) {
    if (fs.existsSync(path.join(resolvedProjectDir, marker))) {
      return {
        isMonorepo: true,
        gitTopLevel,
        projectDir: resolvedProjectDir,
        relativeSubpath: '',
        contentPath: finalExplicitPath || 'content',
        originRemoteUrl: originRemoteUrl || undefined,
      };
    }
  }

  // Check package.json for workspaces field
  const pkgPath = path.join(resolvedProjectDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.workspaces) {
        return {
          isMonorepo: true,
          gitTopLevel,
          projectDir: resolvedProjectDir,
          relativeSubpath: '',
          contentPath: finalExplicitPath || 'content',
          originRemoteUrl: originRemoteUrl || undefined,
        };
      }
    } catch {}
  }

  return {
    isMonorepo: false,
    gitTopLevel,
    projectDir: resolvedProjectDir,
    relativeSubpath: '',
    contentPath: finalExplicitPath !== undefined ? finalExplicitPath : '',
    originRemoteUrl: originRemoteUrl || undefined,
  };
}

/**
 * Normalizes and verifies whether a target remote URL matches the monorepo root remote.
 * Returns true if the target remote is the monorepo itself, false if it's a dedicated content repo.
 */
export function isTargetMonorepoRemote(targetRemoteUrl: string | undefined, originRemoteUrl: string | undefined): boolean {
  if (!targetRemoteUrl || !originRemoteUrl) return false;

  const clean = (url: string) =>
    url
      .trim()
      .toLowerCase()
      .replace(/\.git$/, '')
      .replace(/^https?:\/\//, '')
      .replace(/^git@([^:]+):/, '$1/')
      .replace(/^ssh:\/\/git@([^/]+)\//, '$1/');

  return clean(targetRemoteUrl) === clean(originRemoteUrl);
}

/**
 * Formats a release tag to prevent cross-site collisions in monorepos.
 * If in monorepo and siteId is present, ensures tag is prefixed: `${siteId}/release-...`
 */
export function scopeReleaseTag(tag: string, siteId?: string, isMonorepo?: boolean): string {
  const cleanTag = tag.trim();
  if (!isMonorepo || !siteId || siteId === 'default') {
    return cleanTag;
  }

  const cleanSite = siteId.toLowerCase().trim();
  if (cleanTag.startsWith(`${cleanSite}/`) || cleanTag.startsWith(`${cleanSite}-`)) {
    return cleanTag;
  }

  return `${cleanSite}/${cleanTag}`;
}
