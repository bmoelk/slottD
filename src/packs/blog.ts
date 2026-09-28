import type { ModelPack } from '../types.js';
import {
  verifyMediaExists,
  validateRequiredFields,
  composeHooks,
} from '../hooks/builtins.js';

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
      hooks: {
        beforeCreate: composeHooks(
          verifyMediaExists(['heroImage']),
          validateRequiredFields(['title', 'slug', 'content', 'author'])
        ),
        beforeUpdate: composeHooks(
          verifyMediaExists(['heroImage'])
        ),
      },
    },
    authors: {
      name: 'authors',
      displayName: 'Authors & Profiles',
      icon: '✍️',
      description: 'Authors, contributors, and team member profiles',
      schemaVersion: 1,
      fields: [
        { name: 'title', type: 'TEXT', widget: 'text', label: 'Full Name', required: true },
        { name: 'slug', type: 'TEXT', widget: 'slug', label: 'Handle / Slug', required: true },
        { name: 'role', type: 'TEXT', widget: 'text', label: 'Professional Role / Title' },
        { name: 'location', type: 'TEXT', widget: 'text', label: 'Location' },
        { name: 'handle', type: 'TEXT', widget: 'text', label: 'User / Social Handle' },
        { name: 'about', type: 'TEXT', widget: 'textarea', label: 'Short Bio / Byline' },
        { name: 'bio', type: 'TEXT', widget: 'textarea', label: 'Biography' },
        { name: 'extendedBio', type: 'TEXT', widget: 'markdown', label: 'Extended Biography' },
        { name: 'avatarUrl', type: 'TEXT', widget: 'media', label: 'Avatar Photo (R2)' },
        { name: 'email', type: 'TEXT', widget: 'text', label: 'Contact Email' },
        { name: 'websiteUrl', type: 'TEXT', widget: 'text', label: 'Website / Social URL' },
        {
          name: 'careerHighlights',
          type: 'JSON',
          widget: 'repeater',
          label: 'Career Journey / Highlights',
          items: [
            { name: 'company', type: 'TEXT', widget: 'text', label: 'Company / Organization', required: true },
            { name: 'role', type: 'TEXT', widget: 'text', label: 'Role / Title' },
            { name: 'desc', type: 'TEXT', widget: 'textarea', label: 'Description', required: true },
            { name: 'period', type: 'TEXT', widget: 'text', label: 'Time Period' },
          ],
        },
      ],
      hooks: {
        beforeCreate: composeHooks(
          verifyMediaExists(['avatarUrl']),
          validateRequiredFields(['title', 'slug'])
        ),
        beforeUpdate: composeHooks(
          verifyMediaExists(['avatarUrl'])
        ),
      },
    },
  },
};
