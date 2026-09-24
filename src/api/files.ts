import { Hono } from 'hono';
import { createDb } from '../db/client.js';
import { requireWriteAuth, getAuthenticatedUser } from '../auth/guard.js';
import { resolveSiteId } from '../auth/site.js';
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

  const siteId = (c as any).get('siteId') || (await resolveSiteId(c));
  const id = crypto.randomUUID();
  const originalName = file.name || 'unnamed-file';
  const { base, ext, key: initialKey } = sanitizeFilename(originalName);
  const mimeType = file.type || 'application/octet-stream';
  const size = file.size;
  const now = Date.now();

  const db = createDb(c.env.DB);

  // Check for existing key collision in D1 for this site
  let key = initialKey;
  const existing = await db
    .selectFrom('media')
    .where('site_id', '=', siteId)
    .where('key', '=', key)
    .select('id')
    .executeTakeFirst();

  if (existing) {
    const suffix = Date.now().toString(36).slice(-4);
    key = `${base}-${suffix}.${ext}`;
  }

  // 1. Upload to Cloudflare R2 Bucket using descriptive key namespaced by site
  const r2StorageKey = `${siteId}/${key}`;
  const fileBuffer = await file.arrayBuffer();
  await c.env.MEDIA.put(r2StorageKey, fileBuffer, {
    httpMetadata: {
      contentType: mimeType,
    },
    customMetadata: {
      id,
      siteId,
      originalName,
      uploadedAt: String(now),
    },
  });

  // 2. Insert UUID <-> Descriptive Key mapping into D1 media table
  await db
    .insertInto('media')
    .values({
      id,
      site_id: siteId,
      key,
      filename: originalName,
      mime_type: mimeType,
      size,
      created_at: now,
    })
    .execute();

  await logActivity(db, {
    siteId,
    actor: (await getAuthenticatedUser(c))?.email || 'admin@localhost',
    action: 'upload_file',
    collection: 'media',
    documentId: id,
    documentTitle: originalName,
    details: { key, r2StorageKey, siteId },
  });

  return c.json(
    {
      data: {
        id,
        site_id: siteId,
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
  const siteId = (c as any).get('siteId') || (await resolveSiteId(c));
  const db = createDb(c.env.DB);
  const rows = await db.selectFrom('media').where('site_id', '=', siteId).selectAll().execute();
  const data = rows.map((r) => ({
    id: r.id,
    site_id: r.site_id,
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
  const siteId = (c as any).get('siteId') || (await resolveSiteId(c));
  const db = createDb(c.env.DB);

  // 1. Lookup in D1 by UUID or descriptive storage key strictly for active site
  const mediaRecord = await db
    .selectFrom('media')
    .where('site_id', '=', siteId)
    .where((eb) => eb.or([eb('id', '=', idOrKey), eb('key', '=', idOrKey)]))
    .selectAll()
    .executeTakeFirst();

  // If client requests JSON metadata
  const wantsJson = c.req.query('meta') === 'true' || c.req.header('Accept')?.includes('application/json');
  if (wantsJson && mediaRecord) {
    return c.json({
      data: {
        id: mediaRecord.id,
        site_id: mediaRecord.site_id,
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

  // 2. Resolve R2 key: try site-prefixed key first, then raw key
  const r2Key = mediaRecord ? mediaRecord.key : idOrKey;
  let object = null;
  if (c.env.MEDIA) {
    object = await c.env.MEDIA.get(`${siteId}/${r2Key}`);
    if (!object) {
      object = await c.env.MEDIA.get(r2Key);
    }
  }

  if (!object) {
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
  const siteId = (c as any).get('siteId') || (await resolveSiteId(c));
  const db = createDb(c.env.DB);

  const mediaRecord = await db
    .selectFrom('media')
    .where('site_id', '=', siteId)
    .where((eb) => eb.or([eb('id', '=', idOrKey), eb('key', '=', idOrKey)]))
    .selectAll()
    .executeTakeFirst();

  if (mediaRecord) {
    await db.deleteFrom('media').where('id', '=', mediaRecord.id).where('site_id', '=', siteId).execute();
    if (c.env.MEDIA) {
      const siteR2Key = `${siteId}/${mediaRecord.key}`;
      await c.env.MEDIA.delete(siteR2Key).catch(() => {});
      await c.env.MEDIA.delete(mediaRecord.key).catch(() => {});
    }

    const user = await getAuthenticatedUser(c);
    await logActivity(db, {
      siteId,
      actor: user?.email || 'admin@localhost',
      action: 'delete',
      collection: 'media',
      documentId: mediaRecord.id,
      documentTitle: mediaRecord.filename,
      details: { key: mediaRecord.key, siteId },
    });
  }

  return c.body(null, 204);
});
