/**
 * Hydrates / restores the D1 database from an array of Git content items.
 * Can be triggered via CLI (`slottd sync --from-git`) or webhook.
 */
export async function hydrateFromGit(db, items) {
    let count = 0;
    const now = Date.now();
    for (const item of items) {
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
            data: JSON.stringify(item.data),
            created_at: createdAt,
            updated_at: updatedAt,
        })
            .onConflict((oc) => oc.column('id').doUpdateSet({
            collection: item.collection,
            slug: item.slug,
            title: item.title,
            status,
            data: JSON.stringify(item.data),
            updated_at: updatedAt,
        }))
            .execute();
        count++;
    }
    return { inserted: count, updated: count };
}
/**
 * Exports records from D1 into serialized format suitable for writing to Git files.
 */
export async function exportToGitFormat(db, collection) {
    let query = db.selectFrom('documents').selectAll();
    if (collection) {
        query = query.where('collection', '=', collection);
    }
    const rows = await query.execute();
    return rows.map((r) => {
        let parsedData = {};
        try {
            parsedData = JSON.parse(r.data);
        }
        catch { }
        return {
            id: r.id,
            collection: r.collection,
            slug: r.slug,
            title: r.title,
            status: r.status,
            data: parsedData,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
        };
    });
}
