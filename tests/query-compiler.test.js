import { describe, it, expect } from 'vitest';
import { parseQueryParams } from '../src/api/query-compiler.js';
describe('Query Compiler & Parser', () => {
    it('parses Directus nested filter params from URL search parameters', () => {
        const url = new URL('https://cms.test/items/posts?filter[status][_eq]=published&filter[category][_in]=tech,news&sort=-created_at&limit=10&page=2');
        const params = parseQueryParams(url);
        expect(params.limit).toBe('10');
        expect(params.page).toBe('2');
        expect(params.sort).toBe('-created_at');
        expect(params.filter).toEqual({
            status: { _eq: 'published' },
            category: { _in: 'tech,news' },
        });
    });
    it('handles flat filter shorthand', () => {
        const url = new URL('https://cms.test/items/articles?filter[status]=draft');
        const params = parseQueryParams(url);
        expect(params.filter).toEqual({
            status: { _eq: 'draft' },
        });
    });
});
