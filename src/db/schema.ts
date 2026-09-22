import type {
  ActivityLogRow,
  BundleRow,
  CollectionRow,
  DirectusVersionRow,
  DocumentRow,
  MediaRow,
  SiteDomainReferralRow,
  SiteSettingRow,
  SystemSettingRow,
} from '../types.js';

export interface Database {
  collections: CollectionRow;
  documents: DocumentRow;
  media: MediaRow;
  activity_log: ActivityLogRow;
  bundles: BundleRow;
  directus_versions: DirectusVersionRow;
  system_settings: SystemSettingRow;
  system_site_settings: SiteSettingRow;
  site_domain_referrals: SiteDomainReferralRow;
  [viewName: string]: any; // Supports dynamic SQLite views
}

