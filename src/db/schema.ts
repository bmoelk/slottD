import type { ActivityLogRow, BundleRow, CollectionRow, DirectusVersionRow, DocumentRow, MediaRow, SystemSettingRow } from '../types.js';

export interface Database {
  collections: CollectionRow;
  documents: DocumentRow;
  media: MediaRow;
  activity_log: ActivityLogRow;
  bundles: BundleRow;
  directus_versions: DirectusVersionRow;
  system_settings: SystemSettingRow;
  [viewName: string]: any; // Supports dynamic SQLite views
}

