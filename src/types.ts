export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ENVIRONMENT?: string;
  ALLOWED_ORIGINS?: string;
  ADMIN_API_KEY?: string;
  ADMIN_TOKEN?: string;
  ADMIN_PASSWORD_HASH?: string;
  ADMIN_PASSWORD?: string;
  JWT_SECRET?: string;
  PREVIEW_SECRET?: string;
  GITHUB_TOKEN?: string;
  GIT_REMOTE_URL?: string;
  REPO_PATH?: string;
  CONTENT_DIR?: string;
  OPERATOR_NAME?: string;
  OPERATOR_EMAIL?: string;
  PRODUCTION_DEPLOY_HOOK_URL?: string;
  STAGING_DEPLOY_HOOK_URL?: string;
  DEPLOY_HOOK_URL?: string;
  REMOTE_MEDIA_URL?: string;
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
  draft_data?: string | null; // JSON string of working copy / uncommitted draft
  draft_updated_at?: number | null;
  draft_status?: 'none' | 'modified' | 'new';
  created_at: number;
  updated_at: number;
}

export interface DirectusVersionRow {
  id: string;
  key: string;
  name: string;
  collection: string;
  item: string;
  delta: string; // JSON string of field diffs
  date_created: number;
  date_updated: number;
  user_created?: string | null;
  user_updated?: string | null;
}

export interface BundleRow {
  id: string;
  name: string;
  slug: string;
  status: 'draft' | 'in_review' | 'approved' | 'published';
  git_branch?: string | null;
  publish_at?: number | null;
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

export interface ActivityLogRow {
  id: string;
  timestamp: number;
  actor: string;
  action: string;
  collection: string;
  document_id: string;
  document_title?: string | null;
  details?: string | null;
}

export interface SystemSettingRow {
  key: string;
  value: string;
  updated_at: number;
}

export interface DirectusQueryParams {
  filter?: Record<string, any>;
  sort?: string;
  limit?: string | number;
  page?: string | number;
  fields?: string;
  search?: string;
  status?: string;
  version?: string;
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
  hooks?: CollectionHooks;
}

export interface ModelPack {
  name: string;
  author: string;
  version: string;
  collections: Record<string, CollectionDefinition>;
}

// ── Standardized Lifecycle Hooks Contract ───────────────────────────────────

export interface HookResult<T = any> {
  status: 'ok' | 'warning' | 'error';
  message?: string;
  data?: T;
  code?: string;
  field?: string;
  bypassable?: boolean;
}

export interface ItemHookContext<T = Record<string, any>> {
  collection: string;
  id: string;
  data: T;
  existing?: T;
  db: any;
  env: Env;
  user?: { email: string; authMethod?: string };
  isDraft: boolean;
  force: boolean;
  changedFields?: string[];
}

export interface CollectionHooks<T = Record<string, any>> {
  beforeCreate?: (ctx: ItemHookContext<T>) => Promise<HookResult<T> | T | void>;
  afterCreate?: (ctx: ItemHookContext<T>) => Promise<void>;
  beforeUpdate?: (ctx: ItemHookContext<T>) => Promise<HookResult<T> | T | void>;
  afterUpdate?: (ctx: ItemHookContext<T>) => Promise<void>;
  beforeDelete?: (ctx: ItemHookContext<T>) => Promise<HookResult<void> | void>;
  afterDelete?: (ctx: ItemHookContext<T>) => Promise<void>;
}

export interface PublishHookContext {
  bundle?: { id: string; slug: string; name: string };
  items?: any[];
  changedItems?: {
    collection: string;
    slug: string;
    status: 'new' | 'modified' | 'deleted';
    modifiedFields: string[];
    delta: Record<string, any>;
  }[];
  actor?: { email: string; authMethod: string };
  forcePublish?: boolean;
  timestamp?: number;
  commitSha?: string;
  env?: any;
  db?: any;
}

export interface PublishCheckResult {
  name: string; // Identifier, e.g. 'slotwire-contracts', 'spell-check', 'terminology'
  displayName: string; // User-facing, e.g. 'SlotWire Schema Contracts'
  passed: boolean;
  errors: string[];
  warnings: string[];
  metadata?: Record<string, any>;
}

export type PublishCheck = (ctx: PublishHookContext) => Promise<PublishCheckResult>;

export interface PublishReportData {
  summary: {
    totalChecks: number;
    passed: number;
    failed: number;
    warningCount: number;
  };
  checks: PublishCheckResult[];
  errors: string[]; // Explicitly attributed with [CheckName] prefix
  warnings: string[]; // Explicitly attributed with [CheckName] prefix
}

export interface SlottdConfig {
  packs?: ModelPack[];
  collections?: Record<string, CollectionDefinition>;
  migrations?: Record<string, Record<number, (oldData: any) => any>>;
  git?: {
    repo: string;
    branch?: string;
    path?: string;
    includeDrafts?: boolean;
  };
  hooks?: {
    onBeforePublish?: (ctx: PublishHookContext) => Promise<HookResult<PublishReportData>>;
    onAfterPublish?: (ctx: PublishHookContext) => Promise<HookResult<any>>;
  };
}
