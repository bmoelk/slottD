import { sql } from 'kysely';
/**
 * Ensures a dynamic SQLite View exists for a given collection.
 * Dropping and recreating a view is atomic and takes < 0.1ms with zero data mutation risk.
 */
export async function syncCollectionView(db, collection, customFieldNames = []) {
    const customFieldProjections = customFieldNames
        .filter((f) => !['id', 'collection', 'slug', 'title', 'status', 'created_at', 'updated_at'].includes(f))
        .map((field) => `json_extract(data, '$.${field}') AS "${field}"`);
    const selectColumns = [
        'id',
        'collection',
        'slug',
        'title',
        'status',
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
 * Introspects a collection's view schema using PRAGMA table_info to generate UI field widgets.
 */
export async function introspectCollectionFields(db, collection) {
    try {
        const result = await sql `
      PRAGMA table_info(${sql.raw(`"${collection}"`)})
    `.execute(db);
        if (!result.rows || result.rows.length === 0) {
            // Return default core fields if view has not been generated yet
            return [
                { name: 'title', type: 'TEXT', widget: 'text', label: 'Title', required: true },
                { name: 'slug', type: 'TEXT', widget: 'text', label: 'Slug', required: true },
                { name: 'status', type: 'TEXT', widget: 'text', label: 'Status', required: true },
                { name: 'body', type: 'TEXT', widget: 'markdown', label: 'Body Content' },
            ];
        }
        return result.rows.map((col) => ({
            name: col.name,
            type: col.type || 'TEXT',
            label: formatLabel(col.name),
            required: Boolean(col.notnull),
            widget: inferWidget(col.name, col.type),
        }));
    }
    catch (err) {
        return [
            { name: 'title', type: 'TEXT', widget: 'text', label: 'Title', required: true },
            { name: 'slug', type: 'TEXT', widget: 'text', label: 'Slug', required: true },
            { name: 'status', type: 'TEXT', widget: 'text', label: 'Status', required: true },
            { name: 'body', type: 'TEXT', widget: 'markdown', label: 'Body Content' },
        ];
    }
}
function formatLabel(fieldName) {
    return fieldName
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
}
function inferWidget(name, type) {
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
    if (lowerName.includes('items') || lowerName.includes('features') || lowerName.includes('cards') || lowerName.includes('tags') || lowerName.includes('testimonials')) {
        return 'repeater';
    }
    if (lowerName.includes('cta') || lowerName.includes('meta') || lowerName.includes('config')) {
        return 'object';
    }
    return 'text';
}
