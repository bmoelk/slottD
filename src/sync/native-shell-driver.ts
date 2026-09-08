import { isSshUrl, type GitDriver, type GitDriverOptions, type GitReleaseResult } from './driver.js';
import type { GitContentItem, SerializedGitFile } from './git-sync.js';

const dynamicImport = (modName: string): Promise<any> => {
  try {
    // @ts-ignore
    return import(/* @vite-ignore */ modName).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
};

export class NativeShellGitDriver implements GitDriver {
  readonly engineName = 'Native Git CLI (SSH Agent)';
  private readonly repoPath: string;
  private readonly branch: string;
  private readonly url: string;
  private readonly token?: string;

  constructor(options: GitDriverOptions) {
    const globalProc = (globalThis as any).process;
    this.repoPath = options.repoPath || (typeof globalProc !== 'undefined' && globalProc?.cwd ? globalProc.cwd() : '');
    this.branch = options.branch || 'main';
    this.url = options.url || '';
    this.token = options.token;
  }

  async listTags(): Promise<string[]> {
    const cp = await dynamicImport('child_process');
    if (cp && cp.execSync) {
      try {
        cp.execSync(`git -C "${this.repoPath}" fetch --tags origin`, {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
      } catch {}

      try {
        const output = cp.execSync(`git -C "${this.repoPath}" tag -l --sort=-creatordate`, {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        return (output as string)
          .split('\n')
          .map((t: string) => t.trim())
          .filter(Boolean);
      } catch {
        return [];
      }
    }

    // Edge isolate fallback: check local Git execution bridge on 127.0.0.1:8788
    try {
      const bridgeRes = await fetch('http://127.0.0.1:8788/exec/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath: this.repoPath }),
        signal: AbortSignal.timeout(1000),
      });
      if (bridgeRes.ok) {
        const json: any = await bridgeRes.json();
        if (json.tags && Array.isArray(json.tags)) {
          return json.tags;
        }
      }
    } catch {}

    // Only fall back to IsomorphicGitDriver if access token is available or URL is standard public HTTPS
    if (this.token || (!isSshUrl(this.url) && !this.url.includes('github.com'))) {
      const { IsomorphicGitDriver } = await import('./isomorphic-driver.js');
      const iso = new IsomorphicGitDriver({
        url: this.url,
        branch: this.branch,
        token: this.token,
      });
      return await iso.listTags();
    }

    return [];
  }

  async loadTagContent(tag: string): Promise<GitContentItem[]> {
    const cp = await dynamicImport('child_process');
    const fs = await dynamicImport('fs');
    const path = await dynamicImport('path');

    if (cp && fs && path && cp.execSync) {
      if (!tag) {
        throw new Error('Tag name is required to load content.');
      }

      const os = await dynamicImport('os');
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slottd-tag-'));
      try {
        cp.execSync(`git -C "${this.repoPath}" archive "${tag}" | tar -x -C "${tempDir}"`, {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });

        let baseDir = tempDir;
        if (fs.existsSync(path.join(tempDir, 'content')) && fs.statSync(path.join(tempDir, 'content')).isDirectory()) {
          baseDir = path.join(tempDir, 'content');
        }

        const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'src', 'public', 'scripts', 'tests', 'docs', 'packages', 'coverage', '.github']);
        const collections = (fs.readdirSync(baseDir) as string[]).filter((f: string) => {
          if (f.startsWith('.') || ignoredDirs.has(f)) return false;
          try {
            return fs.statSync(path.join(baseDir, f)).isDirectory();
          } catch {
            return false;
          }
        });

        const items: GitContentItem[] = [];

        for (const col of collections) {
          const colDir = path.join(baseDir, col);
          let jsonFiles: string[] = [];
          try {
            jsonFiles = (fs.readdirSync(colDir) as string[]).filter((f: string) => f.endsWith('.json'));
          } catch {
            continue;
          }
          if (jsonFiles.length === 0) continue;

          for (const jsonFile of jsonFiles) {
            const fullJsonPath = path.join(colDir, jsonFile);
            const rawJson = fs.readFileSync(fullJsonPath, 'utf8') as string;
            let doc: any = {};
            try {
              doc = JSON.parse(rawJson);
            } catch (err: any) {
              console.warn(`Failed to parse ${jsonFile}:`, err.message);
              continue;
            }

            const slug = doc.slug || jsonFile.replace('.json', '');
            const companionMdPath = path.join(colDir, `${slug}.md`);
            const customData = doc.data || {};

            if (fs.existsSync(companionMdPath)) {
              customData.content = fs.readFileSync(companionMdPath, 'utf8') as string;
            }

            items.push({
              id: doc.id || `doc-${col}-${slug}`,
              collection: col,
              slug,
              title: doc.title || slug,
              status: doc.status || 'published',
              schemaVersion: doc.schema_version || 1,
              publishAt: doc.publish_at || null,
              data: customData,
              createdAt: doc.created_at || doc.createdAt || Date.now(),
              updatedAt: doc.updated_at || doc.updatedAt || Date.now(),
            });
          }
        }
        return items;
      } finally {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {}
      }
    }

    // Fall back to IsomorphicGitDriver over Smart HTTPS
    const { IsomorphicGitDriver } = await import('./isomorphic-driver.js');
    const iso = new IsomorphicGitDriver({
      url: this.url,
      branch: this.branch,
      token: this.token,
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
    const cp = await dynamicImport('child_process');
    const fs = await dynamicImport('fs');
    const path = await dynamicImport('path');

    if (cp && fs && path && cp.execSync) {
      // 1. Write serialized files to disk
      for (const file of options.files) {
        const filePath = path.resolve(this.repoPath, file.path.replace(/^\//, ''));
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, file.content, 'utf8');
      }

      // 2. Git add, commit, tag
      cp.execSync(`git -C "${this.repoPath}" add -A`, { stdio: 'ignore' });
      const authorFlag = options.author ? `--author="${options.author.name} <${options.author.email}>"` : '';
      cp.execSync(`git -C "${this.repoPath}" commit -m "${options.message.replace(/"/g, '\\"')}" ${authorFlag}`, {
        stdio: 'ignore',
      });
      cp.execSync(`git -C "${this.repoPath}" tag -a "${options.tag}" -m "${options.message.replace(/"/g, '\\"')}"`, {
        stdio: 'ignore',
      });

      const commitSha = cp
        .execSync(`git -C "${this.repoPath}" rev-parse HEAD`, { encoding: 'utf8' })
        .trim();

      let pushed = false;
      if (options.push !== false) {
        cp.execSync(`git -C "${this.repoPath}" push origin "${this.branch}" --tags`, {
          stdio: 'ignore',
        });
        pushed = true;
      }

      return {
        commitSha,
        tagCreated: true,
        message: `Release '${options.tag}' committed and pushed via native Git CLI (${commitSha.slice(0, 7)}).`,
        pushed,
      };
    }

    // Check local Git bridge on 127.0.0.1:8788
    try {
      const bridgeRes = await fetch('http://127.0.0.1:8788/exec/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoPath: this.repoPath,
          tag: options.tag,
          message: options.message,
          push: options.push !== false,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (bridgeRes.ok) {
        const json: any = await bridgeRes.json();
        return {
          commitSha: json.sha || 'bridge-commit',
          tagCreated: true,
          message: json.message || `Release tagged via Git Bridge.`,
          pushed: options.push !== false,
        };
      }
    } catch {}

    // Fall back to IsomorphicGitDriver
    const { IsomorphicGitDriver } = await import('./isomorphic-driver.js');
    const iso = new IsomorphicGitDriver({
      url: this.url,
      branch: this.branch,
      token: this.token,
    });
    return await iso.createRelease(options);
  }
}
