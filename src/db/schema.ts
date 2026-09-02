import type { ActivityLogRow, CollectionRow, DocumentRow, MediaRow } from '../types.js';

export interface Database {
  collections: CollectionRow;
  documents: DocumentRow;
  media: MediaRow;
  activity_log: ActivityLogRow;
  [viewName: string]: any; // Supports dynamic SQLite views
}
