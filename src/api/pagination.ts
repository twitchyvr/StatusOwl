/**
 * StatusOwl — API Pagination Utilities
 *
 * Cursor-based pagination for list endpoints.
 */

import { z } from 'zod';

export const PaginationParamsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
});
export type PaginationParams = z.infer<typeof PaginationParamsSchema>;

export interface PaginatedResult<T> {
  ok: true;
  data: T[];
  pagination: {
    cursor: string | null;
    hasMore: boolean;
    total?: number;
  };
}

/**
 * Encode a cursor from a record's unique identifier and sort field.
 * Format: base64url(JSON({ id, sortValue }))
 */
export function encodeCursor(id: string, sortValue: string | number): string {
  return Buffer.from(JSON.stringify({ id, sortValue })).toString('base64url');
}

/**
 * Decode a cursor back to its components.
 */
export function decodeCursor(cursor: string): { id: string; sortValue: string | number } | null {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
    if (decoded && typeof decoded.id === 'string') {
      return decoded;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build a paginated response from a full result set.
 * The items should already be sorted and include one extra item beyond the limit
 * to determine if there are more results.
 */
export function buildPaginatedResponse<T extends { id: string }>(
  items: T[],
  limit: number,
  sortKeyFn: (item: T) => string | number,
  total?: number,
): PaginatedResult<T> {
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;

  const lastItem = data[data.length - 1];
  const cursor = lastItem ? encodeCursor(lastItem.id, sortKeyFn(lastItem)) : null;

  return {
    ok: true,
    data,
    pagination: {
      cursor: hasMore ? cursor : null,
      hasMore,
      total,
    },
  };
}
