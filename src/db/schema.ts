import type { CollectionRow, DocumentRow, MediaRow } from '../types.js';

export interface Database {
  collections: CollectionRow;
  documents: DocumentRow;
  media: MediaRow;
  [viewName: string]: any; // Supports dynamic SQLite views
}
