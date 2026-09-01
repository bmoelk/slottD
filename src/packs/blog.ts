import type { ModelPack } from '../types.js';

export const blogPack: ModelPack = {
  name: '@slottd/pack-blog',
  author: '@slottd',
  version: '1.0.0',
  collections: {
    blog_posts: {
      name: 'blog_posts',
      displayName: 'Blog Posts',
      icon: '📝',
      description: 'Articles, news, guides, and long-form publications',
      schemaVersion: 1,
      fields: [
        { name: 'title', type: 'TEXT', widget: 'text', label: 'Article Title', required: true },
        { name: 'slug', type: 'TEXT', widget: 'slug', label: 'URL Slug', required: true },
        { name: 'excerpt', type: 'TEXT', widget: 'textarea', label: 'Excerpt / Summary' },
        { name: 'content', type: 'TEXT', widget: 'markdown', label: 'Article Content (Markdown)', required: true },
        { name: 'heroImage', type: 'TEXT', widget: 'media', label: 'Featured Cover Image' },
        { name: 'category', type: 'TEXT', widget: 'text', label: 'Category' },
        { name: 'author', type: 'TEXT', widget: 'text', label: 'Author ID / Name', required: true },
        { name: 'publishedAt', type: 'TEXT', widget: 'datetime', label: 'Publication Date' },
      ],
    },
    authors: {
      name: 'authors',
      displayName: 'Authors',
      icon: '✍️',
      description: 'Article authors, team members, and contributors',
      schemaVersion: 1,
      fields: [
        { name: 'title', type: 'TEXT', widget: 'text', label: 'Full Name', required: true },
        { name: 'slug', type: 'TEXT', widget: 'slug', label: 'Handle / Slug', required: true },
        { name: 'bio', type: 'TEXT', widget: 'textarea', label: 'Author Biography' },
        { name: 'avatarUrl', type: 'TEXT', widget: 'media', label: 'Avatar Photo (R2)' },
        { name: 'email', type: 'TEXT', widget: 'text', label: 'Contact Email' },
        { name: 'websiteUrl', type: 'TEXT', widget: 'text', label: 'Website / Social URL' },
      ],
    },
  },
};
