import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import { Volume, createFsFromVolume } from 'memfs';
import type { GitDriver, GitDriverOptions, GitReleaseResult } from './driver.js';
import { normalizeGitUrl } from './driver.js';
import type { GitContentItem, SerializedGitFile } from './git-sync.js';

export class IsomorphicGitDriver implements GitDriver {
  readonly engineName = 'isomorphic-git (Smart HTTP)';
  private readonly url: string;
  private readonly branch: string;
  private readonly token?: string;

  constructor(options: GitDriverOptions) {
    this.url = normalizeGitUrl(options.url);
    this.branch = options.branch || 'main';
    this.token = options.token;
  }

  private getAuthCallback() {
    if (!this.token) return undefined;
    return () => ({
      username: this.token!,
      password: '',
    });
  }

  /**
   * Lists remote tags using Git Smart HTTP discovery (GET /info/refs?service=git-upload-pack).
   * Zero filesystem required.
   */
  async listTags(): Promise<string[]> {
    if (!this.url) return [];

    const onAuth = this.getAuthCallback();
    const refs = await git.listServerRefs({
      http,
      url: this.url,
      prefix: 'refs/tags/',
      onAuth,
    });

    return refs
      .map((r) => r.ref.replace('refs/tags/', ''))
      .filter((tag) => !tag.endsWith('^{}'))
      .sort()
      .reverse();
  }

  /**
   * Shallow clones the selected tag snapshot into an in-memory memfs Volume,
   * parses the /content directory, and returns structured GitContentItems.
   */
  async loadTagContent(tag: string): Promise<GitContentItem[]> {
    if (!this.url) {
      throw new Error('No Git remote URL configured.');
    }
    if (!tag) {
      throw new Error('Tag name is required to load content.');
    }

    const vol = new Volume();
    const fs = createFsFromVolume(vol);
    const onAuth = this.getAuthCallback();

    // Shallow clone only the target tag into RAM
    await git.clone({
      fs: fs as any,
      http,
      dir: '/',
      url: this.url,
      ref: tag,
      depth: 1,
      singleBranch: true,
      onAuth,
    });

    // Support both /content subfolder and root-level collections
    let baseDir = '/';
    if (fs.existsSync('/content') && fs.statSync('/content').isDirectory()) {
      baseDir = '/content';
    }

    const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'src', 'public', 'scripts', 'tests', 'docs', 'packages', 'coverage', '.github']);
    const collections = (fs.readdirSync(baseDir) as string[]).filter((entry) => {
      if (entry.startsWith('.') || ignoredDirs.has(entry)) return false;
      const fullPath = baseDir === '/' ? `/${entry}` : `${baseDir}/${entry}`;
      try {
        return fs.statSync(fullPath).isDirectory();
      } catch {
        return false;
      }
    });

    const items: GitContentItem[] = [];

    for (const col of collections) {
      const colDir = baseDir === '/' ? `/${col}` : `${baseDir}/${col}`;
      let jsonFiles: string[] = [];
      try {
        jsonFiles = (fs.readdirSync(colDir) as string[]).filter((f) => f.endsWith('.json'));
      } catch {
        continue;
      }
      if (jsonFiles.length === 0) continue;

      for (const jsonFile of jsonFiles) {
        const fullJsonPath = `${colDir}/${jsonFile}`;
        const rawJson = fs.readFileSync(fullJsonPath, 'utf8') as string;
        let doc: any = {};
        try {
          doc = JSON.parse(rawJson);
        } catch (err: any) {
          console.warn(`Failed to parse ${jsonFile}:`, err.message);
          continue;
        }

        const slug = doc.slug || jsonFile.replace('.json', '');
        const companionMdPath = `${colDir}/${slug}.md`;
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
  }

  /**
   * Commits files to in-memory Volume and pushes commit & tag over Git Smart HTTP.
   */
  async createRelease(options: {
    tag: string;
    message: string;
    files: SerializedGitFile[];
    push?: boolean;
    author?: { name: string; email: string };
  }): Promise<GitReleaseResult> {
    if (!this.url) {
      throw new Error('No Git remote URL configured.');
    }

    const vol = new Volume();
    const fs = createFsFromVolume(vol);
    const onAuth = this.getAuthCallback();

    // 1. Shallow clone current branch head or initialize in memory
    try {
      await git.clone({
        fs: fs as any,
        http,
        dir: '/',
        url: this.url,
        ref: this.branch,
        depth: 1,
        singleBranch: true,
        onAuth,
      });
    } catch {
      await git.init({ fs: fs as any, dir: '/' });
      await git.branch({ fs: fs as any, dir: '/', ref: this.branch, checkout: true });
    }

    // 2. Write all serialized files into /
    for (const file of options.files) {
      const filePath = file.path.startsWith('/') ? file.path : `/${file.path}`;
      const lastSlash = filePath.lastIndexOf('/');
      const dir = lastSlash > 0 ? filePath.substring(0, lastSlash) : '/';
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, file.content, { encoding: 'utf8' });
      await git.add({
        fs: fs as any,
        dir: '/',
        filepath: file.path.replace(/^\//, ''),
      });
    }

    // 3. Commit
    const commitSha = await git.commit({
      fs: fs as any,
      dir: '/',
      message: options.message,
      author: options.author || {
        name: 'SlottD Operator',
        email: 'operator@slottd.dev',
      },
    });

    // 4. Tag
    await git.tag({
      fs: fs as any,
      dir: '/',
      ref: options.tag,
    });

    // 5. Push if requested
    let pushed = false;
    if (options.push !== false) {
      // Push branch commit
      await git.push({
        fs: fs as any,
        http,
        dir: '/',
        url: this.url,
        ref: this.branch,
        onAuth,
      });

      // Push release tag
      await git.push({
        fs: fs as any,
        http,
        dir: '/',
        url: this.url,
        ref: options.tag,
        onAuth,
      });
      pushed = true;
    }

    return {
      commitSha,
      tagCreated: true,
      message: `Release '${options.tag}' committed and pushed via isomorphic-git (${commitSha.slice(0, 7)}).`,
      pushed,
    };
  }
}
