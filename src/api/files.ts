import { Hono } from 'hono';
import { createDb } from '../db/client.js';
import type { Env } from '../types.js';

export const filesRouter = new Hono<{ Bindings: Env }>();

// 1. Upload File (Directus compatible POST /files)
filesRouter.post('/', async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return c.json({ error: 'No file provided in form field "file"' }, 400);
  }

  const id = crypto.randomUUID();
  const originalName = file.name;
  const ext = originalName.split('.').pop() || 'bin';
  const key = `${id}.${ext}`;
  const mimeType = file.type || 'application/octet-stream';
  const size = file.size;
  const now = Date.now();

  // 1. Upload to Cloudflare R2 Bucket
  const fileBuffer = await file.arrayBuffer();
  await c.env.MEDIA.put(key, fileBuffer, {
    httpMetadata: {
      contentType: mimeType,
    },
    customMetadata: {
      originalName,
      uploadedAt: String(now),
    },
  });

  // 2. Insert metadata into D1 media table
  const db = createDb(c.env.DB);
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
        key,
        filename: originalName,
        mime_type: mimeType,
        size,
        url: `/files/${key}`,
      },
    },
    201
  );
});

// 2. Stream/Serve File directly from R2
filesRouter.get('/:key', async (c) => {
  const key = c.req.param('key');
  const object = await c.env.MEDIA.get(key);

  if (!object) {
    return c.text('File not found', 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');

  return new Response(object.body, {
    headers,
  });
});
