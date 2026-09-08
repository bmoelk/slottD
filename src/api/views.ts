import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Database } from '../db/schema.js';
import type { CollectionDefinition, FieldDefinition, ModelPack } from '../types.js';

export class SchemaVersionMismatchError extends Error {
  constructor(documentIdentifier: string, documentVersion: number, supportedVersion: number) {
    super(
      `[SchemaVersionMismatchError] Document '${documentIdentifier}' requires schema_version ${documentVersion}, but this SlottD engine only supports up to version ${supportedVersion}. Please update your SlottD codebase.`
    );
    this.name = 'SchemaVersionMismatchError';
  }
}

/**
 * Rule 5 Fail-Fast Enforcement:
 * Throws immediately if a document's schema_version exceeds what the codebase supports.
 */
export function assertSchemaVersion(
  documentIdentifier: string,
  documentVersion: number,
  supportedVersion: number = 1
): void {
  if (documentVersion > supportedVersion) {
    throw new SchemaVersionMismatchError(documentIdentifier, documentVersion, supportedVersion);
  }
}

/**
 * Registers or updates collection metadata in the physical `collections` table.
 */
export async function syncCollectionMetadata(
  db: Kysely<Database>,
  def: CollectionDefinition,
  packName: string = 'custom',
  packAuthor: string = 'custom',
  packVersion: string = '1.0.0'
): Promise<void> {
  const now = Date.now();
  const schemaJson = JSON.stringify(def.fields);

  await db
    .insertInto('collections')
    .values({
      name: def.name,
      display_name: def.displayName,
      icon: def.icon || '📁',
      description: def.description || '',
      pack_name: packName,
      pack_author: packAuthor,
      pack_version: packVersion,
      schema_version: def.schemaVersion || 1,
      schema: schemaJson,
      created_at: now,
      updated_at: now,
    })
    .onConflict((oc) =>
      oc.column('name').doUpdateSet({
        display_name: def.displayName,
        icon: def.icon || '📁',
        description: def.description || '',
        pack_name: packName,
        pack_author: packAuthor,
        pack_version: packVersion,
        schema_version: def.schemaVersion || 1,
        schema: schemaJson,
        updated_at: now,
      })
    )
    .execute();
}

/**
 * Ensures a dynamic SQLite View exists for a given collection.
 * Dropping and recreating a view is atomic and takes < 0.1ms with zero data mutation risk.
 */
export async function syncCollectionView(
  db: Kysely<Database>,
  collection: string,
  customFieldNames: string[] = []
): Promise<void> {
  const standardFields = ['id', 'collection', 'slug', 'title', 'status', 'schema_version', 'publish_at', 'created_at', 'updated_at'];
  const customFieldProjections = customFieldNames
    .filter((f) => !standardFields.includes(f))
    .map((field) => `json_extract(data, '$.${field}') AS "${field}"`);

  const selectColumns = [
    'id',
    'collection',
    'slug',
    'title',
    'status',
    'schema_version',
    'publish_at',
    ...customFieldProjections,
    'created_at',
    'updated_at',
  ].join(',\n    ');

  const viewSql = `
    DROP VIEW IF EXISTS "${collection}";
    CREATE VIEW "${collection}" AS
    SELECT 
      ${selectColumns}
    FROM documents
    WHERE collection = '${collection}';
  `;

  await sql.raw(viewSql).execute(db);
}

/**
 * Registers an entire model pack (metadata + SQLite views) into D1.
 */
export async function registerModelPack(db: Kysely<Database>, pack: ModelPack): Promise<void> {
  for (const [colName, colDef] of Object.entries(pack.collections)) {
    await syncCollectionMetadata(db, colDef, pack.name, pack.author, pack.version);
    const fieldNames = colDef.fields.map((f) => f.name);
    await syncCollectionView(db, colName, fieldNames);
  }
}

/**
 * Introspects a collection's view schema or metadata table to generate UI field widgets.
 */
export async function introspectCollectionFields(
  db: Kysely<Database>,
  collection: string
): Promise<FieldDefinition[]> {
  try {
    // 1. Check if collection metadata exists
    const meta = await db
      .selectFrom('collections')
      .where('name', '=', collection)
      .select(['schema'])
      .executeTakeFirst();

    if (meta && meta.schema) {
      try {
        const parsed = JSON.parse(meta.schema);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      } catch {}
    }

    // 2. PRAGMA fallback
    const result = await sql<{ name: string; type: string; notnull: number; pk: number }>`
      PRAGMA table_info(${sql.raw(`"${collection}"`)})
    `.execute(db);

    if (!result.rows || result.rows.length === 0) {
      return [
        { name: 'title', type: 'TEXT', widget: 'text', label: 'Title', required: true },
        { name: 'slug', type: 'TEXT', widget: 'slug', label: 'Slug', required: true },
        { name: 'status', type: 'TEXT', widget: 'text', label: 'Status', required: true },
        { name: 'content', type: 'TEXT', widget: 'markdown', label: 'Body Content' },
      ];
    }

    return result.rows.map((col) => ({
      name: col.name,
      type: col.type || 'TEXT',
      label: formatLabel(col.name),
      required: Boolean(col.notnull),
      widget: inferWidget(col.name, col.type),
    }));
  } catch (err) {
    return [
      { name: 'title', type: 'TEXT', widget: 'text', label: 'Title', required: true },
      { name: 'slug', type: 'TEXT', widget: 'slug', label: 'Slug', required: true },
      { name: 'status', type: 'TEXT', widget: 'text', label: 'Status', required: true },
      { name: 'content', type: 'TEXT', widget: 'markdown', label: 'Body Content' },
    ];
  }
}

function formatLabel(fieldName: string): string {
  return fieldName
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function inferWidget(name: string, type: string): FieldDefinition['widget'] {
  const lowerName = name.toLowerCase();
  if (lowerName === 'body' || lowerName === 'content' || lowerName.endsWith('_md') || lowerName.endsWith('_markdown')) {
    return 'markdown';
  }
  if (lowerName.includes('html') || lowerName.includes('richtext')) {
    return 'richtext';
  }
  if (lowerName.includes('image') || lowerName.includes('cover') || lowerName.includes('avatar') || lowerName.includes('asset') || lowerName.includes('file')) {
    return 'media';
  }
  if (lowerName.endsWith('_at') || lowerName.includes('date') || lowerName.includes('time')) {
    return 'datetime';
  }
  if (lowerName.startsWith('is_') || lowerName.startsWith('has_') || type === 'BOOLEAN') {
    return 'boolean';
  }
  if (lowerName === 'slug') {
    return 'slug';
  }
  if (lowerName.includes('items') || lowerName.includes('features') || lowerName.includes('cards') || lowerName.includes('tags') || lowerName.includes('testimonials')) {
    return 'repeater';
  }
  if (lowerName.includes('cta') || lowerName.includes('meta') || lowerName.includes('config')) {
    return 'object';
  }
  return 'text';
}
