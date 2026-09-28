import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stashUnreleasedAsDrafts, getUnreleasedDocuments } from '../src/sync/git-sync.js';
import { createDb } from '../src/db/client.js';
import * as driverModule from '../src/sync/driver.js';
import app from '../src/index.js';

interface MockDocument {
  id: string;
  site_id: string;
  collection: string;
  slug: string;
  title: string;
  status: string;
  data: string;
  draft_data: string | null;
  draft_status: string;
  draft_updated_at: number | null;
  created_at: number;
  updated_at: number;
}

interface MockActivity {
  id: string;
  site_id: string;
  timestamp: number;
  actor: string;
  action: string;
  collection: string;
  document_id: string;
  document_title: string;
  details: string;
}

interface MockVersion {
  id: string;
  site_id: string;
  key: string;
  name: string;
  collection: string;
  item: string;
  delta: string;
  date_created: number;
  date_updated: number;
  user_created: string;
  user_updated: string;
}

function createConflictTestDb(initial?: {
  documents?: MockDocument[];
  activities?: MockActivity[];
  versions?: MockVersion[];
}) {
  const documents: MockDocument[] = initial?.documents ? [...initial.documents] : [];
  const activities: MockActivity[] = initial?.activities ? [...initial.activities] : [];
  const versions: MockVersion[] = initial?.versions ? [...initial.versions] : [];

  const mockD1: any = {
    prepare: vi.fn().mockImplementation((sql: string) => {
      let currentBinds: any[] = [];
      return {
        bind: vi.fn().mockImplementation((...binds: any[]) => {
          currentBinds = binds;
          const executeMutation = () => {
            const lower = sql.toLowerCase();
            // Insert into directus_versions
            if (lower.includes('insert into "directus_versions"')) {
              versions.push({
                id: currentBinds[0],
                site_id: currentBinds[1],
                key: currentBinds[2],
                name: currentBinds[3],
                collection: currentBinds[4],
                item: currentBinds[5],
                delta: currentBinds[6],
                date_created: currentBinds[7],
                date_updated: currentBinds[8],
                user_created: currentBinds[9],
                user_updated: currentBinds[10],
              });
              return true;
            }

            // Insert into activity_log
            if (lower.includes('insert into "activity_log"')) {
              activities.push({
                id: currentBinds[0],
                site_id: currentBinds[1],
                timestamp: currentBinds[2],
                actor: currentBinds[3],
                action: currentBinds[4],
                collection: currentBinds[5],
                document_id: currentBinds[6],
                document_title: currentBinds[7],
                details: currentBinds[8],
              });
              return true;
            }

            // Update documents
            if (lower.includes('update "documents"')) {
              const docId = currentBinds[currentBinds.length - 2];
              const siteId = currentBinds[currentBinds.length - 1];
              const doc = documents.find((d) => (d.id === docId || d.slug === docId) && d.site_id === siteId);
              if (doc) {
                if (lower.includes('"draft_data" =') || lower.includes('draft_data')) {
                  if (lower.includes('"draft_status" = \'none\'') || lower.includes("draft_status = 'none'")) {
                    doc.draft_data = null;
                    doc.draft_status = 'none';
                    doc.draft_updated_at = null;
                  } else {
                    doc.draft_data = currentBinds[0];
                    doc.draft_status = currentBinds[1];
                    doc.draft_updated_at = currentBinds[2];
                  }
                }
                if (lower.includes('"data" =')) {
                  doc.title = currentBinds[0];
                  doc.slug = currentBinds[1];
                  doc.data = currentBinds[2];
                  doc.draft_data = null;
                  doc.draft_status = 'none';
                  doc.draft_updated_at = null;
                  doc.updated_at = currentBinds[3] || Date.now();
                }
              }
              return true;
            }

            // Insert into documents
            if (lower.includes('insert into "documents"')) {
              documents.push({
                id: currentBinds[0] || crypto.randomUUID(),
                site_id: currentBinds[1] || 'brainendeavor.com',
                collection: currentBinds[2] || 'blog_posts',
                slug: currentBinds[3] || 'doc-slug',
                title: currentBinds[4] || 'Doc Title',
                status: currentBinds[5] || 'published',
                data: currentBinds[6] || '{}',
                draft_data: null,
                draft_status: 'none',
                draft_updated_at: null,
                created_at: currentBinds[7] || Date.now(),
                updated_at: currentBinds[8] || Date.now(),
              });
              return true;
            }

            return false;
          };

          return {
            all: vi.fn().mockImplementation(async () => {
              const lower = sql.toLowerCase();

              if (lower.startsWith('insert') || lower.startsWith('update') || lower.startsWith('delete')) {
                executeMutation();
                return { results: [], meta: { changes: 1 } };
              }

              // sqlite_master / pragma
              if (lower.includes('sqlite_master')) {
                return {
                  results: [
                    { name: 'documents' },
                    { name: 'activity_log' },
                    { name: 'directus_versions' },
                    { name: 'system_settings' },
                  ],
                  meta: { changes: 0 },
                };
              }
              if (lower.includes('pragma table_info')) {
                return {
                  results: [
                    { name: 'id' },
                    { name: 'site_id' },
                    { name: 'collection' },
                    { name: 'slug' },
                    { name: 'title' },
                    { name: 'data' },
                    { name: 'draft_data' },
                    { name: 'draft_status' },
                  ],
                  meta: { changes: 0 },
                };
              }

              // Query activity_log max timestamp
              if (lower.includes('activity_log') && lower.includes('max(')) {
                const siteId = currentBinds[0];
                const action = currentBinds[1];
                const rel = activities
                  .filter((a) => a.site_id === siteId && a.action === action)
                  .sort((a, b) => b.timestamp - a.timestamp);
                const lastTs = rel.length > 0 ? rel[0].timestamp : null;
                return { results: [{ last_ts: lastTs }], meta: { changes: 0 } };
              }

              // Query activity_log items
              if (lower.includes('activity_log')) {
                let filtered = [...activities];
                if (currentBinds.length > 0) {
                  const siteId = currentBinds[0];
                  filtered = filtered.filter((a) => a.site_id === siteId);
                }
                return { results: filtered, meta: { changes: 0 } };
              }

              // Query documents
              if (lower.includes('documents')) {
                let filtered = [...documents];
                const siteId = currentBinds[0];
                if (siteId) {
                  filtered = filtered.filter((d) => d.site_id === siteId);
                }
                // Check if filtering by updated_at > lastTs
                if (lower.includes('updated_at') && lower.includes('>')) {
                  const lastTs = currentBinds[1];
                  if (typeof lastTs === 'number') {
                    filtered = filtered.filter((d) => d.updated_at > lastTs);
                  }
                }
                // Check if filtering by collection and idOrSlug
                if (lower.includes('collection') && currentBinds.length >= 3) {
                  const coll = currentBinds[1];
                  const idOrSlug = currentBinds[2];
                  filtered = filtered.filter(
                    (d) => d.collection === coll && (d.id === idOrSlug || d.slug === idOrSlug)
                  );
                }
                return { results: filtered, meta: { changes: 0 } };
              }

              // Query directus_versions
              if (lower.includes('directus_versions')) {
                return { results: versions, meta: { changes: 0 } };
              }

              return { results: [], meta: { changes: 0 } };
            }),
            first: vi.fn().mockImplementation(async () => {
              const lower = sql.toLowerCase();
              if (lower.includes('activity_log') && lower.includes('max(')) {
                const siteId = currentBinds[0];
                const action = currentBinds[1];
                const rel = activities
                  .filter((a) => a.site_id === siteId && a.action === action)
                  .sort((a, b) => b.timestamp - a.timestamp);
                const lastTs = rel.length > 0 ? rel[0].timestamp : null;
                return { last_ts: lastTs };
              }

              if (lower.includes('documents')) {
                let filtered = [...documents];
                const siteId = currentBinds[0];
                if (siteId) {
                  filtered = filtered.filter((d) => d.site_id === siteId);
                }
                if (currentBinds.length >= 3) {
                  const coll = currentBinds[1];
                  const idOrSlug = currentBinds[2];
                  filtered = filtered.filter(
                    (d) => d.collection === coll && (d.id === idOrSlug || d.slug === idOrSlug)
                  );
                }
                return filtered[0] || null;
              }

              return null;
            }),
            run: vi.fn().mockImplementation(async () => {
              executeMutation();
              return { success: true, meta: { changes: 1 } };
            }),
            raw: vi.fn().mockImplementation(async () => []),
          };
        }),
      };
    }),
    batch: vi.fn().mockImplementation(async (statements: any[]) => {
      return statements.map(() => ({ success: true }));
    }),
  };

  return {
    d1: mockD1,
    db: createDb(mockD1),
    state: {
      documents,
      activities,
      versions,
    },
  };
}

describe('Draft-Driven Conflict Resolution & Automatic Version Snapshotting', () => {
  beforeEach(() => {
    vi.spyOn(driverModule, 'getGitDriver').mockImplementation(async () => {
      return {
        engineName: 'mock-git-driver',
        listTags: vi.fn().mockResolvedValue(['v0.0.1']),
        loadTagContent: vi.fn().mockResolvedValue([
          {
            collection: 'blog_posts',
            slug: 'guard-post',
            title: 'Restored Guard Post',
            data: { title: 'Restored Guard Post', body: 'Restored from tag' },
          },
        ]),
        createRelease: vi.fn().mockResolvedValue({
          commitSha: 'c0ffee1234567890',
          tagCreated: true,
          message: 'Mock release completed',
          pushed: true,
        }),
      } as any;
    });
  });

  it('stashes unreleased content as draft when no draft exists (Case A: Fresh Draft)', async () => {
    const initialDocs: MockDocument[] = [
      {
        id: 'doc-fresh-1',
        site_id: 'test.io',
        collection: 'blog_posts',
        slug: 'my-first-post',
        title: 'My First Post (Unreleased Local Edits)',
        status: 'published',
        data: JSON.stringify({ title: 'My First Post (Unreleased Local Edits)', content: 'Locally modified content' }),
        draft_data: null,
        draft_status: 'none',
        draft_updated_at: null,
        created_at: 1000,
        updated_at: 2500, // Unreleased edit after release at 2000
      },
    ];

    const initialActs: MockActivity[] = [
      {
        id: 'act-rel-1',
        site_id: 'test.io',
        timestamp: 2000,
        actor: 'system',
        action: 'git_release',
        collection: '_git',
        document_id: 'release-v1',
        document_title: 'Release v1',
        details: '{}',
      },
    ];

    const { db, state } = createConflictTestDb({
      documents: initialDocs,
      activities: initialActs,
    });

    const result = await stashUnreleasedAsDrafts(db, 'test.io', 'alice@test.io');

    expect(result.count).toBe(1);
    expect(result.snapshottedVersions).toBe(0);
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].slug).toBe('my-first-post');

    // Verify document was converted to draft
    const updatedDoc = state.documents[0];
    expect(updatedDoc.draft_status).toBe('modified');
    expect(updatedDoc.draft_data).toContain('Locally modified content');

    // Verify zero records snapshotted to directus_versions
    expect(state.versions).toHaveLength(0);

    // Verify conflict_stashed_as_draft activity log entry was logged
    const stashLog = state.activities.find((a) => a.action === 'conflict_stashed_as_draft');
    expect(stashLog).toBeDefined();
    expect(stashLog?.actor).toBe('alice@test.io');
    expect(stashLog?.document_id).toBe('doc-fresh-1');
  });

  it('snapshots existing draft to directus_versions before stashing local content (Case B: Zero Data Loss)', async () => {
    const existingDraftData = JSON.stringify({
      title: 'Active Work In Progress Draft',
      content: 'Important thoughts typed by the author before conflict happened',
    });

    const localAuthoritativeData = JSON.stringify({
      title: 'Local Version of Content',
      content: 'Content stored in published data table',
    });

    const initialDocs: MockDocument[] = [
      {
        id: 'doc-with-draft-1',
        site_id: 'test.io',
        collection: 'projects',
        slug: 'super-app',
        title: 'Local Version of Content',
        status: 'published',
        data: localAuthoritativeData,
        draft_data: existingDraftData,
        draft_status: 'modified', // Already has an active working draft!
        draft_updated_at: 2200,
        created_at: 1000,
        updated_at: 2500, // Unreleased edit after release at 2000
      },
    ];

    const initialActs: MockActivity[] = [
      {
        id: 'act-rel-1',
        site_id: 'test.io',
        timestamp: 2000,
        actor: 'system',
        action: 'git_release',
        collection: '_git',
        document_id: 'release-v1',
        document_title: 'Release v1',
        details: '{}',
      },
    ];

    const { db, state } = createConflictTestDb({
      documents: initialDocs,
      activities: initialActs,
    });

    const result = await stashUnreleasedAsDrafts(db, 'test.io', 'bob@test.io');

    expect(result.count).toBe(1);
    expect(result.snapshottedVersions).toBe(1);

    // Verify that the existing draft was safely snapshotted into directus_versions!
    expect(state.versions).toHaveLength(1);
    const versionRecord = state.versions[0];
    expect(versionRecord.item).toBe('doc-with-draft-1');
    expect(versionRecord.collection).toBe('projects');
    expect(versionRecord.key).toMatch(/^v_auto_\d+_doc-with/);
    expect(versionRecord.name).toContain('Draft snapshot before upstream sync');
    expect(versionRecord.delta).toBe(existingDraftData);
    expect(versionRecord.user_created).toBe('bob@test.io');

    // Verify the document draft_data now holds the local content that was conflicting
    const updatedDoc = state.documents[0];
    expect(updatedDoc.draft_status).toBe('modified');
    expect(updatedDoc.draft_data).toBe(localAuthoritativeData);
  });

  it('correctly filters unreleased documents with getUnreleasedDocuments', async () => {
    const initialDocs: MockDocument[] = [
      {
        id: 'doc-old',
        site_id: 'test.io',
        collection: 'pages',
        slug: 'about',
        title: 'About Us',
        status: 'published',
        data: '{}',
        draft_data: null,
        draft_status: 'none',
        draft_updated_at: null,
        created_at: 500,
        updated_at: 1500, // Before release at 2000
      },
      {
        id: 'doc-new',
        site_id: 'test.io',
        collection: 'pages',
        slug: 'contact',
        title: 'Contact Us',
        status: 'published',
        data: '{}',
        draft_data: null,
        draft_status: 'none',
        draft_updated_at: null,
        created_at: 500,
        updated_at: 2500, // After release at 2000
      },
    ];

    const initialActs: MockActivity[] = [
      {
        id: 'act-rel-1',
        site_id: 'test.io',
        timestamp: 2000,
        actor: 'system',
        action: 'git_release',
        collection: '_git',
        document_id: 'release-v1',
        document_title: 'Release v1',
        details: '{}',
      },
    ];

    const { db } = createConflictTestDb({
      documents: initialDocs,
      activities: initialActs,
    });

    const unreleased = await getUnreleasedDocuments(db, 'test.io');
    expect(unreleased).toHaveLength(1);
    expect(unreleased[0].id).toBe('doc-new');
    expect(unreleased[0].slug).toBe('contact');
  });

  it('promotes draft to live published content via POST /items/:collection/:id/promote-draft', async () => {
    const publishedData = { title: 'Live Headline', subtitle: 'Old Subtitle', count: 5 };
    const draftData = { title: 'Promoted Headline', subtitle: 'Refined Subtitle', count: 10, newField: 'Added' };

    const initialDocs: MockDocument[] = [
      {
        id: 'doc-promote-1',
        site_id: 'brainendeavor.com',
        collection: 'pages',
        slug: 'home',
        title: 'Live Headline',
        status: 'published',
        data: JSON.stringify(publishedData),
        draft_data: JSON.stringify(draftData),
        draft_status: 'modified',
        draft_updated_at: 2200,
        created_at: 1000,
        updated_at: 2000,
      },
    ];

    const { d1, state } = createConflictTestDb({
      documents: initialDocs,
    });

    const mockEnv = {
      DB: d1,
      ENVIRONMENT: 'development',
      ADMIN_API_KEY: 'test-admin-secret',
    };

    const res = await app.fetch(
      new Request('https://cms.brainendeavor.com/items/pages/doc-promote-1/promote-draft?site_id=brainendeavor.com', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-admin-secret',
        },
      }),
      mockEnv
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data.title).toBe('Promoted Headline');
    expect(json.data.draft_status).toBe('none');
    expect(json.data.newField).toBe('Added');

    // Verify database document was updated with merged draft data and draft_status reset
    const doc = state.documents[0];
    expect(doc.draft_status).toBe('none');
    expect(doc.draft_data).toBeNull();
    const parsedData = JSON.parse(doc.data);
    expect(parsedData.title).toBe('Promoted Headline');
    expect(parsedData.subtitle).toBe('Refined Subtitle');
    expect(parsedData.newField).toBe('Added');

    // Verify activity_log recorded draft_promote
    const promoteLog = state.activities.find((a) => a.action === 'draft_promote');
    expect(promoteLog).toBeDefined();
    expect(promoteLog?.document_id).toBe('doc-promote-1');
  });

  it('triggers Pre-Hydration Tag Restore Guard (409) when unreleased local content exists', async () => {
    const initialDocs: MockDocument[] = [
      {
        id: 'doc-unreleased-1',
        site_id: 'brainendeavor.com',
        collection: 'blog_posts',
        slug: 'unreleased-post',
        title: 'Unreleased Post',
        status: 'published',
        data: '{}',
        draft_data: null,
        draft_status: 'none',
        draft_updated_at: null,
        created_at: 1000,
        updated_at: 3000, // Unreleased
      },
    ];

    const initialActs: MockActivity[] = [
      {
        id: 'act-rel-1',
        site_id: 'brainendeavor.com',
        timestamp: 2000,
        actor: 'system',
        action: 'git_release',
        collection: '_git',
        document_id: 'release-v1',
        document_title: 'Release v1',
        details: '{}',
      },
    ];

    const { d1 } = createConflictTestDb({
      documents: initialDocs,
      activities: initialActs,
    });

    const mockEnv = {
      DB: d1,
      ENVIRONMENT: 'development',
      ADMIN_API_KEY: 'test-admin-secret',
      DEPLOY_REPO_URL: 'https://github.com/bmoelk/brainendeavor.com.git',
    };

    // Request without force or stashDrafts -> triggers 409
    const res = await app.fetch(
      new Request('http://localhost:8787/admin/git/load', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          host: 'localhost:8787',
        },
        body: JSON.stringify({ tag: 'release-2026.09.24-1000' }),
      }),
      mockEnv
    );

    expect(res.status).toBe(409);
    const json: any = await res.json();
    expect(json.conflict).toBe(true);
    expect(json.requiresConfirmation).toBe(true);
    expect(json.unreleasedCount).toBe(1);
    expect(json.unreleasedDocuments[0].slug).toBe('unreleased-post');
    expect(json.choices).toHaveLength(2);
    expect(json.choices[0].action).toBe('stash_draft');
    expect(json.choices[1].action).toBe('overwrite');
  });

  it('resolves conflict via POST /admin/git/resolve-conflict with stash_draft', async () => {
    const existingDraftData = JSON.stringify({ title: 'Important Pre-existing Draft' });
    const initialDocs: MockDocument[] = [
      {
        id: 'doc-conflict-1',
        site_id: 'brainendeavor.com',
        collection: 'projects',
        slug: 'conflicted-proj',
        title: 'Local Edits',
        status: 'published',
        data: JSON.stringify({ title: 'Local Edits', desc: 'Conflict local version' }),
        draft_data: existingDraftData,
        draft_status: 'modified',
        draft_updated_at: 2100,
        created_at: 1000,
        updated_at: 2500, // Unreleased
      },
    ];

    const initialActs: MockActivity[] = [
      {
        id: 'act-rel-1',
        site_id: 'brainendeavor.com',
        timestamp: 2000,
        actor: 'system',
        action: 'git_release',
        collection: '_git',
        document_id: 'release-v1',
        document_title: 'Release v1',
        details: '{}',
      },
    ];

    const { d1, state } = createConflictTestDb({
      documents: initialDocs,
      activities: initialActs,
    });

    const mockEnv = {
      DB: d1,
      ENVIRONMENT: 'development',
      DEPLOY_REPO_URL: 'https://github.com/bmoelk/brainendeavor.com.git',
    };

    const res = await app.fetch(
      new Request('http://localhost:8787/admin/git/resolve-conflict', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          host: 'localhost:8787',
        },
        body: JSON.stringify({ action: 'stash_draft' }),
      }),
      mockEnv
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);
    expect(json.stashedCount).toBe(1);
    expect(json.snapshottedVersions).toBe(1);
    expect(json.message).toContain('Conflict resolved safely');

    // Verify existing draft was snapshotted to versions
    expect(state.versions).toHaveLength(1);
    expect(state.versions[0].delta).toBe(existingDraftData);

    // Verify local content was stashed into working draft
    const doc = state.documents[0];
    expect(doc.draft_status).toBe('modified');
    expect(doc.draft_data).toContain('Conflict local version');
  });

  it('rejects invalid action on POST /admin/git/resolve-conflict with 400', async () => {
    const { d1 } = createConflictTestDb();
    const mockEnv = {
      DB: d1,
      ENVIRONMENT: 'development',
    };

    const res = await app.fetch(
      new Request('http://localhost:8787/admin/git/resolve-conflict', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          host: 'localhost:8787',
        },
        body: JSON.stringify({ action: 'invalid_action' }),
      }),
      mockEnv
    );

    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.error).toContain('Invalid action');
  });

  it('bypasses Pre-Hydration Tag Restore Guard when stashDrafts: true is passed', async () => {
    const initialDocs: MockDocument[] = [
      {
        id: 'doc-stash-guard-1',
        site_id: 'brainendeavor.com',
        collection: 'blog_posts',
        slug: 'guard-post',
        title: 'Unreleased Guard Post',
        status: 'published',
        data: JSON.stringify({ title: 'Unreleased Guard Post', body: 'Local content' }),
        draft_data: null,
        draft_status: 'none',
        draft_updated_at: null,
        created_at: 1000,
        updated_at: 3000,
      },
    ];

    const initialActs: MockActivity[] = [
      {
        id: 'act-rel-1',
        site_id: 'brainendeavor.com',
        timestamp: 2000,
        actor: 'system',
        action: 'git_release',
        collection: '_git',
        document_id: 'release-v1',
        document_title: 'Release v1',
        details: '{}',
      },
    ];

    const { d1, state } = createConflictTestDb({
      documents: initialDocs,
      activities: initialActs,
    });

    const mockEnv = {
      DB: d1,
      ENVIRONMENT: 'development',
      DEPLOY_REPO_URL: 'https://github.com/bmoelk/brainendeavor.com.git',
    };

    const res = await app.fetch(
      new Request('http://localhost:8787/admin/git/load', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          host: 'localhost:8787',
        },
        body: JSON.stringify({ tag: 'v0.0.1', stashDrafts: true }),
      }),
      mockEnv
    );

    const json: any = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.message).toContain('Stashed 1 unreleased local document(s) as working drafts');

    // Document in state was stashed as draft
    const doc = state.documents[0];
    expect(doc.draft_status).toBe('modified');
    expect(doc.draft_data).toContain('Local content');
  });

  it('bypasses Pre-Hydration Tag Restore Guard when force: true is passed (direct overwrite)', async () => {
    const initialDocs: MockDocument[] = [
      {
        id: 'doc-force-1',
        site_id: 'brainendeavor.com',
        collection: 'blog_posts',
        slug: 'force-post',
        title: 'Unreleased Force Post',
        status: 'published',
        data: '{}',
        draft_data: null,
        draft_status: 'none',
        draft_updated_at: null,
        created_at: 1000,
        updated_at: 3000,
      },
    ];

    const initialActs: MockActivity[] = [
      {
        id: 'act-rel-1',
        site_id: 'brainendeavor.com',
        timestamp: 2000,
        actor: 'system',
        action: 'git_release',
        collection: '_git',
        document_id: 'release-v1',
        document_title: 'Release v1',
        details: '{}',
      },
    ];

    const { d1 } = createConflictTestDb({
      documents: initialDocs,
      activities: initialActs,
    });

    const mockEnv = {
      DB: d1,
      ENVIRONMENT: 'development',
      DEPLOY_REPO_URL: 'https://github.com/bmoelk/brainendeavor.com.git',
    };

    const res = await app.fetch(
      new Request('http://localhost:8787/admin/git/load', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          host: 'localhost:8787',
        },
        body: JSON.stringify({ tag: 'v0.0.1', force: true }),
      }),
      mockEnv
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);
    expect(json.message).toContain("Successfully loaded and restored");
  });

  it('resolves conflict via POST /admin/git/resolve-conflict with use_local (authoritative push)', async () => {
    const initialDocs: MockDocument[] = [
      {
        id: 'doc-local-authoritative-1',
        site_id: 'brainendeavor.com',
        collection: 'projects',
        slug: 'authoritative-proj',
        title: 'Authoritative Local Version',
        status: 'published',
        data: JSON.stringify({ title: 'Authoritative Local Version', priority: 1 }),
        draft_data: null,
        draft_status: 'none',
        draft_updated_at: null,
        created_at: 1000,
        updated_at: 2500,
      },
    ];

    const { d1, state } = createConflictTestDb({
      documents: initialDocs,
    });

    const mockEnv = {
      DB: d1,
      ENVIRONMENT: 'development',
      DEPLOY_REPO_URL: 'https://github.com/bmoelk/brainendeavor.com.git',
    };

    const res = await app.fetch(
      new Request('http://localhost:8787/admin/git/resolve-conflict', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          host: 'localhost:8787',
        },
        body: JSON.stringify({ action: 'use_local', tag: 'release-authoritative' }),
      }),
      mockEnv
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);
    expect(json.message).toContain('Local version of content pushed to remote as authoritative');

    // Verify git_release was recorded with forced: true in activity log
    const releaseLog = state.activities.find((a) => a.action === 'git_release');
    expect(releaseLog).toBeDefined();
    expect(releaseLog?.document_id).toBe('release-authoritative');
  });
});
