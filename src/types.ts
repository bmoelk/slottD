export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ENVIRONMENT?: string;
  ALLOWED_ORIGINS?: string;
  ADMIN_API_KEY?: string;
  ADMIN_TOKEN?: string;
  PREVIEW_SECRET?: string;
  GITHUB_TOKEN?: string;
  PRODUCTION_DEPLOY_HOOK_URL?: string;
  STAGING_DEPLOY_HOOK_URL?: string;
  DEPLOY_HOOK_URL?: string;
}

export type DocumentStatus = 'draft' | 'scheduled' | 'published' | 'archived';

export interface CollectionRow {
  name: string;
  display_name: string;
  icon?: string | null;
  description?: string | null;
  pack_name: string;
  pack_author?: string | null;
  pack_version: string;
  schema_version: number;
  schema: string; // JSON string of FieldDefinition[]
  created_at: number;
  updated_at: number;
}

export interface DocumentRow {
  id: string;
  collection: string;
  slug: string;
  title: string;
  status: DocumentStatus;
  schema_version: number;
  publish_at?: number | null;
  data: string; // JSON string
  created_at: number;
  updated_at: number;
}

export interface MediaRow {
  id: string;
  key: string;
  filename: string;
  mime_type: string;
  size: number;
  width?: number | null;
  height?: number | null;
  created_at: number;
}

export interface DirectusQueryParams {
  filter?: Record<string, any>;
  sort?: string;
  limit?: string | number;
  page?: string | number;
  fields?: string;
  search?: string;
  status?: string;
}

export interface FieldDefinition {
  name: string;
  type: string;
  widget: 'text' | 'textarea' | 'number' | 'boolean' | 'datetime' | 'markdown' | 'richtext' | 'media' | 'repeater' | 'object' | 'slug' | 'select';
  label: string;
  required?: boolean;
  defaultValue?: any;
  options?: { label: string; value: any }[];
  items?: FieldDefinition[]; // For repeater composite slots
  fields?: FieldDefinition[]; // For object composite slots
}

export interface CollectionDefinition {
  name: string;
  displayName: string;
  icon?: string;
  description?: string;
  schemaVersion?: number;
  fields: FieldDefinition[];
}

export interface ModelPack {
  name: string;
  author: string;
  version: string;
  collections: Record<string, CollectionDefinition>;
}

export interface SlottdConfig {
  packs?: ModelPack[];
  collections?: Record<string, CollectionDefinition>;
  migrations?: Record<string, Record<number, (oldData: any) => any>>;
  git?: {
    repo: string;
    branch?: string;
    path?: string;
  };
}
