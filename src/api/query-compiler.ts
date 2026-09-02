import { type Expression, type ExpressionBuilder, type SelectQueryBuilder, sql } from 'kysely';
import type { Database } from '../db/schema.js';
import type { DirectusQueryParams } from '../types.js';

/**
 * Compiles Directus-style query parameters into a parameterized Kysely query.
 */
export function compileDirectusQuery(
  baseQuery: SelectQueryBuilder<Database, any, any>,
  params: DirectusQueryParams
): SelectQueryBuilder<Database, any, any> {
  let query = baseQuery;

  // 1. Projection (fields)
  if (params.fields && params.fields !== '*') {
    const fieldList = params.fields.split(',').map((f) => f.trim()).filter(Boolean);
    if (fieldList.length > 0) {
      query = query.select(fieldList as any);
    }
  } else {
    query = query.selectAll();
  }

  // 2. Global search
  if (params.search && params.search.trim()) {
    const term = `%${params.search.trim()}%`;
    query = query.where((eb) =>
      eb.or([
        eb('title', 'like', term),
        eb('slug', 'like', term),
      ])
    );
  }

  // 3. Filter AST compilation
  if (params.filter && typeof params.filter === 'object') {
    query = query.where((eb) => buildFilterExpression(eb, params.filter!));
  }

  // 4. Sorting
  if (params.sort) {
    const sortClauses = params.sort.split(',').map((s) => s.trim()).filter(Boolean);
    for (const sortField of sortClauses) {
      const isDesc = sortField.startsWith('-');
      const cleanField = isDesc ? sortField.slice(1) : sortField;
      if (cleanField === 'order') {
        query = query.orderBy(sql`CAST("order" AS NUMERIC)`, isDesc ? 'desc' : 'asc');
      } else {
        query = query.orderBy(cleanField as any, isDesc ? 'desc' : 'asc');
      }
    }
  } else {
    query = query.orderBy('created_at' as any, 'desc');
  }

  // 5. Pagination (Limit & Offset)
  const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 100);
  const page = Math.max(Number(params.page) || 1, 1);
  const offset = (page - 1) * limit;

  query = query.limit(limit).offset(offset);

  return query;
}

/**
 * Recursively builds boolean expressions for Directus filters.
 */
function buildFilterExpression(
  eb: ExpressionBuilder<any, any>,
  filter: Record<string, any>
): Expression<any> {
  const andExpressions: Expression<any>[] = [];

  for (const [key, val] of Object.entries(filter)) {
    if (key === '_and' && Array.isArray(val)) {
      andExpressions.push(eb.and(val.map((subFilter) => buildFilterExpression(eb, subFilter))));
      continue;
    }

    if (key === '_or' && Array.isArray(val)) {
      andExpressions.push(eb.or(val.map((subFilter) => buildFilterExpression(eb, subFilter))));
      continue;
    }

    // Leaf condition (field with operators)
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      for (const [op, targetVal] of Object.entries(val)) {
        const expr = mapOperatorToExpression(eb, key, op, targetVal);
        if (expr) andExpressions.push(expr);
      }
    } else {
      // Shorthand equality: { status: 'published' }
      andExpressions.push(eb(key, '=', val));
    }
  }

  return andExpressions.length === 1 ? andExpressions[0] : eb.and(andExpressions);
}

function mapOperatorToExpression(
  eb: ExpressionBuilder<any, any>,
  field: string,
  op: string,
  val: any
): Expression<any> | null {
  switch (op) {
    case '_eq':
      return eb(field, '=', val);
    case '_neq':
      return eb(field, '!=', val);
    case '_gt':
      return eb(field, '>', val);
    case '_gte':
      return eb(field, '>=', val);
    case '_lt':
      return eb(field, '<', val);
    case '_lte':
      return eb(field, '<=', val);
    case '_in': {
      const list = Array.isArray(val) ? val : String(val).split(',').map((s) => s.trim());
      return eb(field, 'in', list);
    }
    case '_nin': {
      const list = Array.isArray(val) ? val : String(val).split(',').map((s) => s.trim());
      return eb(field, 'not in', list);
    }
    case '_contains':
    case '_icontains':
      return eb(field, 'like', `%${val}%`);
    case '_starts_with':
      return eb(field, 'like', `${val}%`);
    case '_ends_with':
      return eb(field, 'like', `%${val}`);
    case '_null':
      return String(val) === 'true' || val === true ? eb(field, 'is', null) : eb(field, 'is not', null);
    case '_nnull':
      return String(val) === 'true' || val === true ? eb(field, 'is not', null) : eb(field, 'is', null);
    default:
      return null;
  }
}

/**
 * Parses query params from Hono context URL search params into nested Directus filter format.
 */
export function parseQueryParams(url: URL): DirectusQueryParams {
  const params: DirectusQueryParams = {
    sort: url.searchParams.get('sort') || undefined,
    limit: url.searchParams.get('limit') || undefined,
    page: url.searchParams.get('page') || undefined,
    fields: url.searchParams.get('fields') || undefined,
    search: url.searchParams.get('search') || undefined,
  };

  const filter: Record<string, any> = {};

  for (const [key, value] of url.searchParams.entries()) {
    // Matches filter[field][_eq]=val or filter[field]=val
    const match = key.match(/^filter\[([^\]]+)\](?:\[([^\]]+)\])?$/);
    if (match) {
      const [, field, op] = match;
      if (op) {
        if (!filter[field]) filter[field] = {};
        filter[field][op] = value;
      } else {
        filter[field] = { _eq: value };
      }
    }
  }

  if (Object.keys(filter).length > 0) {
    params.filter = filter;
  }

  return params;
}
