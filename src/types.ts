export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ALLOWED_ORIGINS?: string;
  ADMIN_TOKEN?: string;
}

export type DocumentStatus = 'draft' | 'published' | 'archived';

export interface DocumentRow {
  id: string;
  collection: string;
  slug: string;
  title: string;
  status: DocumentStatus;
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
  widget: 'text' | 'textarea' | 'number' | 'boolean' | 'datetime' | 'markdown' | 'richtext' | 'media' | 'repeater' | 'object';
  label: string;
  required?: boolean;
  defaultValue?: any;
  items?: FieldDefinition[]; // For repeater composite slots
  fields?: FieldDefinition[]; // For object composite slots
}

export interface CollectionSchema {
  collection: string;
  fields: FieldDefinition[];
}
