import { Hono } from 'hono';
import { createDb } from '../db/client.js';
import { requireWriteAuth, getAuthenticatedUser } from '../auth/guard.js';
import { logActivity } from '../db/audit.js';
import type { Env } from '../types.js';

export const filesRouter = new Hono<{ Bindings: Env }>();

/**
 * Sanitizes a filename to a clean, descriptive URL/storage-safe slug.
 * e.g. "Hero Banner Image (Final).PNG" -> "hero-banner-image-final.png"
 */
function sanitizeFilename(originalName: string): { base: string; ext: string; key: string } {
  const lastDotIndex = originalName.lastIndexOf('.');
  const rawBase = lastDotIndex !== -1 ? originalName.slice(0, lastDotIndex) : originalName;
  const rawExt = lastDotIndex !== -1 ? originalName.slice(lastDotIndex + 1) : '';

  const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const base = rawBase
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'file';

  return { base, ext, key: `${base}.${ext}` };
}

// 1. Upload File (Directus compatible POST /files with descriptive R2 key preservation)
filesRouter.post('/', requireWriteAuth, async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return c.json({ error: 'No file provided in form field "file"' }, 400);
  }

  const id = crypto.randomUUID();
  const originalName = file.name || 'unnamed-file';
  const { base, ext, key: initialKey } = sanitizeFilename(originalName);
  const mimeType = file.type || 'application/octet-stream';
  const size = file.size;
  const now = Date.now();

  const db = createDb(c.env.DB);

  // Check for existing key collision in D1 to guarantee descriptive uniqueness
  let key = initialKey;
  const existing = await db
    .selectFrom('media')
    .where('key', '=', key)
    .select('id')
    .executeTakeFirst();

  if (existing) {
    // Append timestamp suffix to avoid overwriting distinct media with same name
    const suffix = Date.now().toString(36).slice(-4);
    key = `${base}-${suffix}.${ext}`;
  }

  // 1. Upload to Cloudflare R2 Bucket using descriptive key
  const fileBuffer = await file.arrayBuffer();
  await c.env.MEDIA.put(key, fileBuffer, {
    httpMetadata: {
      contentType: mimeType,
    },
    customMetadata: {
      id,
      originalName,
      uploadedAt: String(now),
    },
  });

  // 2. Insert UUID <-> Descriptive Key mapping into D1 media table
  await db
    .insertInto('media')
    .values({
      id,
      key,
      filename: originalName,
      mime_type: mimeType,
      size,
      created_at: now,
    })
    .execute();

  return c.json(
    {
      data: {
        id,
        storage: 'r2',
        filename_disk: key,
        filename_download: originalName,
        title: base.replace(/-/g, ' '),
        type: mimeType,
        filesize: size,
        key,
        filename: originalName,
        mime_type: mimeType,
        size,
        url: `/media/${key}`,
      },
    },
    201
  );
});

// 2. Query File Metadata or List (Directus compatible GET /files or GET /files/:idOrKey)
filesRouter.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db.selectFrom('media').selectAll().execute();
  const data = rows.map((r) => ({
    id: r.id,
    storage: 'r2',
    filename_disk: r.key,
    filename_download: r.filename,
    title: r.filename,
    type: r.mime_type,
    filesize: r.size,
    key: r.key,
    url: `/media/${r.key}`,
    created_at: r.created_at,
  }));
  return c.json({ data });
});

// 3. Stream/Serve File or Return Metadata by UUID or Descriptive Key
filesRouter.get('/:idOrKey', async (c) => {
  const idOrKey = c.req.param('idOrKey');
  const db = createDb(c.env.DB);

  // 1. Lookup in D1 by UUID or descriptive storage key
  const mediaRecord = await db
    .selectFrom('media')
    .where((eb) => eb.or([eb('id', '=', idOrKey), eb('key', '=', idOrKey)]))
    .selectAll()
    .executeTakeFirst();

  // If client requests JSON metadata (e.g. Directus SDK readItem('directus_files', id))
  const wantsJson = c.req.query('meta') === 'true' || c.req.header('Accept')?.includes('application/json');
  if (wantsJson && mediaRecord) {
    return c.json({
      data: {
        id: mediaRecord.id,
        storage: 'r2',
        filename_disk: mediaRecord.key,
        filename_download: mediaRecord.filename,
        title: mediaRecord.filename,
        type: mediaRecord.mime_type,
        filesize: mediaRecord.size,
        key: mediaRecord.key,
        url: `/media/${mediaRecord.key}`,
        created_at: mediaRecord.created_at,
      },
    });
  }

  // 2. Resolve R2 key: use mapped key from D1 record or fallback to direct key
  const r2Key = mediaRecord ? mediaRecord.key : idOrKey;
  let object = c.env.MEDIA ? await c.env.MEDIA.get(r2Key) : null;

  if (!object) {
    // Fallback to remote Cloudflare R2 bucket for local development
    const remoteUrl = c.env.REMOTE_MEDIA_URL || 'https://cms.brainendeavor.com/media';
    try {
      const res = await fetch(`${remoteUrl}/${encodeURIComponent(r2Key)}`);
      if (res.ok) {
        const body = await res.arrayBuffer();
        if (c.env.MEDIA) {
          c.executionCtx?.waitUntil?.(
            c.env.MEDIA.put(r2Key, body, {
              httpMetadata: { contentType: res.headers.get('content-type') || mediaRecord?.mime_type || 'image/jpeg' },
            }).catch(() => {})
          );
        }
        const headers = new Headers(res.headers);
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        return new Response(body, { headers });
      }
    } catch {}
    return c.text('File not found', 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  if (!headers.has('Content-Type') && mediaRecord?.mime_type) {
    headers.set('Content-Type', mediaRecord.mime_type);
  }

  return new Response(object.body, {
    headers,
  });
});

// 4. Delete File
filesRouter.delete('/:idOrKey', async (c) => {
  const idOrKey = c.req.param('idOrKey');
  const db = createDb(c.env.DB);

  const mediaRecord = await db
    .selectFrom('media')
    .where((eb) => eb.or([eb('id', '=', idOrKey), eb('key', '=', idOrKey)]))
    .selectAll()
    .executeTakeFirst();

  if (mediaRecord) {
    await db.deleteFrom('media').where('id', '=', mediaRecord.id).execute();
    if (c.env.MEDIA) {
      await c.env.MEDIA.delete(mediaRecord.key).catch(() => {});
    }

    const user = await getAuthenticatedUser(c);
    await logActivity(db, {
      actor: user?.email || 'admin@localhost',
      action: 'delete',
      collection: 'media',
      documentId: mediaRecord.id,
      documentTitle: mediaRecord.filename,
      details: { key: mediaRecord.key },
    });
  }

  return c.body(null, 204);
});
