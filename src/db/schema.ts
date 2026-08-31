import type { DocumentRow, MediaRow } from '../types.js';

export interface Database {
  documents: DocumentRow;
  media: MediaRow;
  [viewName: string]: any; // Supports dynamic SQLite views
}
