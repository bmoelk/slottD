import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import type { DocumentStatus } from '../types.js';
import { assertSchemaVersion } from '../api/views.js';

export interface GitContentItem {
  id?: string;
  collection: string;
  slug: string;
  title: string;
  status?: DocumentStatus;
  schemaVersion?: number;
  publishAt?: number | null;
  data: Record<string, any>;
  createdAt?: number;
  updatedAt?: number;
}

export interface SerializedGitFile {
  path: string;
  content: string;
}

/**
 * Hydrates / restores the D1 database from an array of Git content items.
 * Enforces Rule 5 Fail-Fast version validation.
 */
export async function hydrateFromGit(
  db: Kysely<Database>,
  items: GitContentItem[],
  supportedVersion: number = 1
): Promise<{ inserted: number; updated: number }> {
  let count = 0;
  const now = Date.now();

  for (const item of items) {
    const docVersion = item.schemaVersion || 1;
    // Rule 5: Fail fast if incoming git content has higher schema version than supported
    assertSchemaVersion(`${item.collection}/${item.slug}`, docVersion, supportedVersion);

    const id = item.id || crypto.randomUUID();
    const status = item.status || 'published';
    const createdAt = item.createdAt || now;
    const updatedAt = item.updatedAt || now;

    // Direct SQLite INSERT OR REPLACE INTO documents
    await db
      .insertInto('documents')
      .values({
        id,
        collection: item.collection,
        slug: item.slug,
        title: item.title,
        status,
        schema_version: docVersion,
        publish_at: item.publishAt || null,
        data: JSON.stringify(item.data),
        created_at: createdAt,
        updated_at: updatedAt,
      })
      .onConflict((oc) =>
        oc.column('id').doUpdateSet({
          collection: item.collection,
          slug: item.slug,
          title: item.title,
          status,
          schema_version: docVersion,
          publish_at: item.publishAt || null,
          data: JSON.stringify(item.data),
          updated_at: updatedAt,
        })
      )
      .execute();

    count++;
  }

  return { inserted: count, updated: count };
}

/**
 * Exports records from D1 into serialized format suitable for writing to Git files.
 */
export async function exportToGitFormat(
  db: Kysely<Database>,
  collection?: string
): Promise<GitContentItem[]> {
  let query = db.selectFrom('documents').selectAll();
  if (collection) {
    query = query.where('collection', '=', collection);
  }

  const rows = await query.execute();
  return rows.map((r) => {
    let parsedData = {};
    try {
      parsedData = JSON.parse(r.data);
    } catch {}

    return {
      id: r.id,
      collection: r.collection,
      slug: r.slug,
      title: r.title,
      status: r.status,
      schemaVersion: r.schema_version,
      publishAt: r.publish_at,
      data: parsedData,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });
}

/**
 * Converts GitContentItems into plain .json and narrative .md file pairs.
 */
export function serializeToFiles(items: GitContentItem[], basePath: string = 'content'): SerializedGitFile[] {
  const files: SerializedGitFile[] = [];

  for (const item of items) {
    const dir = `${basePath}/${item.collection}`;
    const dataCopy = { ...item.data };

    // If narrative body/content exists, separate it to clean companion .md
    if (dataCopy.content && typeof dataCopy.content === 'string') {
      const markdownBody = dataCopy.content;
      delete dataCopy.content;

      files.push({
        path: `${dir}/${item.slug}.md`,
        content: markdownBody,
      });
    }

    const metadata = {
      id: item.id,
      collection: item.collection,
      slug: item.slug,
      title: item.title,
      status: item.status,
      schema_version: item.schemaVersion || 1,
      created_at: item.createdAt,
      updated_at: item.updatedAt,
      data: dataCopy,
    };

    files.push({
      path: `${dir}/${item.slug}.json`,
      content: JSON.stringify(metadata, null, 2),
    });
  }

  return files;
}

/**
 * Pushes serialized files to GitHub and creates an annotated release Git tag.
 */
export async function publishReleaseToGitHub(options: {
  githubToken: string;
  repoOwner: string;
  repoName: string;
  branch?: string;
  files: SerializedGitFile[];
  tagName: string;
  commitMessage: string;
}): Promise<{ commitSha: string; tagCreated: boolean }> {
  const { githubToken, repoOwner, repoName, branch = 'main', files, tagName, commitMessage } = options;
  const baseUrl = `https://api.github.com/repos/${repoOwner}/${repoName}`;
  const headers = {
    Authorization: `Bearer ${githubToken}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'SlottD-Git-Sync/1.0',
  };

  // 1. Get latest commit SHA on branch
  const refRes = await fetch(`${baseUrl}/git/ref/heads/${branch}`, { headers });
  if (!refRes.ok) {
    throw new Error(`Failed to get ref heads/${branch}: ${await refRes.text()}`);
  }
  const refData: any = await refRes.json();
  const latestCommitSha = refData.object.sha;

  // 1b. Fetch existing tree to discover deleted content files and mirror deletions
  const newPathSet = new Set(files.map((f) => f.path));
  const deleteEntries: any[] = [];
  try {
    const baseTreeRes = await fetch(`${baseUrl}/git/trees/${latestCommitSha}?recursive=1`, { headers });
    if (baseTreeRes.ok) {
      const baseTreeData: any = await baseTreeRes.json();
      const existingContentFiles = (baseTreeData.tree || []).filter(
        (node: any) => node.type === 'blob' && node.path.startsWith('content/')
      );
      for (const oldNode of existingContentFiles) {
        if (!newPathSet.has(oldNode.path)) {
          deleteEntries.push({
            path: oldNode.path,
            mode: '100644',
            type: 'blob',
            sha: null,
          });
        }
      }
    }
  } catch {}

  // 2. Create Tree with updated and deleted files
  const treePayload = {
    base_tree: latestCommitSha,
    tree: [
      ...files.map((f) => ({
        path: f.path,
        mode: '100644',
        type: 'blob',
        content: f.content,
      })),
      ...deleteEntries,
    ],
  };

  const treeRes = await fetch(`${baseUrl}/git/trees`, {
    method: 'POST',
    headers,
    body: JSON.stringify(treePayload),
  });
  if (!treeRes.ok) {
    throw new Error(`Failed to create tree: ${await treeRes.text()}`);
  }
  const treeData: any = await treeRes.json();

  // 3. Create Commit
  const commitRes = await fetch(`${baseUrl}/git/commits`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: commitMessage,
      tree: treeData.sha,
      parents: [latestCommitSha],
    }),
  });
  if (!commitRes.ok) {
    throw new Error(`Failed to create commit: ${await commitRes.text()}`);
  }
  const commitData: any = await commitRes.json();

  // 4. Update branch ref
  await fetch(`${baseUrl}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ sha: commitData.sha }),
  });

  // 5. Create Tag Ref
  const tagRes = await fetch(`${baseUrl}/git/refs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ref: `refs/tags/${tagName}`,
      sha: commitData.sha,
    }),
  });

  return {
    commitSha: commitData.sha,
    tagCreated: tagRes.ok,
  };
}
