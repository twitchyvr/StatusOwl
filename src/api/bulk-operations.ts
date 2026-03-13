/**
 * StatusOwl — Bulk Operations API
 *
 * Batch endpoints for service management: bulk create, update, and delete.
 * Supports atomic (default) and partial (?mode=partial) execution modes.
 * Max 100 items per batch request. Zod validation on all items before execution.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { CreateServiceSchema, ok, err, createChildLogger } from '../core/index.js';
import type { Result, Service, CreateService } from '../core/index.js';
import { createService, updateService, deleteService } from '../storage/service-repo.js';
import { getDb } from '../storage/database.js';
import { recordAudit } from '../audit/audit-repo.js';
import { requireAuth } from './auth.js';

const log = createChildLogger('BulkOps');

const MAX_BATCH_SIZE = 100;

// ── Schemas ──

const BulkCreateSchema = z.object({
  services: z.array(CreateServiceSchema).min(1).max(MAX_BATCH_SIZE),
});

const BulkUpdateItemSchema = CreateServiceSchema.partial().extend({
  id: z.string().uuid(),
});

const BulkUpdateSchema = z.object({
  updates: z.array(BulkUpdateItemSchema).min(1).max(MAX_BATCH_SIZE),
});

const BulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(MAX_BATCH_SIZE),
});

// ── Types ──

interface BulkItemResult<T> {
  index: number;
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface BulkResponse<T> {
  ok: boolean;
  mode: 'atomic' | 'partial';
  total: number;
  succeeded: number;
  failed: number;
  results: BulkItemResult<T>[];
}

/**
 * Extract error message from a failed Result, throwing if the result failed.
 * This helper exists because TypeScript's narrowing cannot flow through `throw new Error(result.error.message)`
 * in a single expression when `result` is a discriminated union.
 */
function throwIfFailed<T>(result: Result<T>, prefix: string): asserts result is { ok: true; data: T } {
  if (result.ok) return;
  const errResult = result as { ok: false; error: { code: string; message: string } };
  throw new Error(`${prefix}${errResult.error.message}`);
}

// ── Handlers ──

/**
 * Bulk create services.
 * Atomic mode (default): all succeed or all rollback.
 * Partial mode (?mode=partial): continue on error, report per-item results.
 */
export function bulkCreateServices(
  services: CreateService[],
  mode: 'atomic' | 'partial' = 'atomic'
): Result<BulkResponse<Service>> {
  const db = getDb();
  const results: BulkItemResult<Service>[] = [];
  let succeeded = 0;
  let failed = 0;

  if (mode === 'atomic') {
    try {
      const txn = db.transaction(() => {
        for (let i = 0; i < services.length; i++) {
          const result = createService(services[i]);
          throwIfFailed(result, `Item ${i}: `);
          recordAudit('service.create', 'service', result.data.id, {
            detail: `Bulk create: ${result.data.name}`,
          });
          results.push({ index: i, ok: true, data: result.data });
          succeeded++;
        }
      });
      txn();
      log.info({ count: services.length, mode }, 'Bulk create completed');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error({ error: msg, mode }, 'Bulk create failed (atomic rollback)');
      return err('BULK_CREATE_FAILED', `Atomic bulk create failed: ${msg}`);
    }
  } else {
    // Partial mode: each item in its own savepoint
    for (let i = 0; i < services.length; i++) {
      try {
        const savepointTxn = db.transaction(() => {
          const result = createService(services[i]);
          throwIfFailed(result, '');
          recordAudit('service.create', 'service', result.data.id, {
            detail: `Bulk create: ${result.data.name}`,
          });
          results.push({ index: i, ok: true, data: result.data });
          succeeded++;
        });
        savepointTxn();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ index: i, ok: false, error: { code: 'CREATE_FAILED', message: msg } });
        failed++;
      }
    }
    log.info({ total: services.length, succeeded, failed, mode }, 'Bulk create completed (partial)');
  }

  return ok({
    ok: failed === 0,
    mode,
    total: services.length,
    succeeded,
    failed,
    results,
  });
}

/**
 * Bulk update services.
 * Each update item must include an `id` and any fields to change.
 */
export function bulkUpdateServices(
  updates: Array<{ id: string } & Partial<CreateService>>,
  mode: 'atomic' | 'partial' = 'atomic'
): Result<BulkResponse<Service>> {
  const db = getDb();
  const results: BulkItemResult<Service>[] = [];
  let succeeded = 0;
  let failed = 0;

  if (mode === 'atomic') {
    try {
      const txn = db.transaction(() => {
        for (let i = 0; i < updates.length; i++) {
          const { id, ...changes } = updates[i];
          const result = updateService(id, changes);
          throwIfFailed(result, `Item ${i} (id=${id}): `);
          recordAudit('service.update', 'service', id, {
            detail: `Bulk update: ${Object.keys(changes).join(', ')}`,
          });
          results.push({ index: i, ok: true, data: result.data });
          succeeded++;
        }
      });
      txn();
      log.info({ count: updates.length, mode }, 'Bulk update completed');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error({ error: msg, mode }, 'Bulk update failed (atomic rollback)');
      return err('BULK_UPDATE_FAILED', `Atomic bulk update failed: ${msg}`);
    }
  } else {
    for (let i = 0; i < updates.length; i++) {
      try {
        const savepointTxn = db.transaction(() => {
          const { id, ...changes } = updates[i];
          const result = updateService(id, changes);
          throwIfFailed(result, '');
          recordAudit('service.update', 'service', id, {
            detail: `Bulk update: ${Object.keys(changes).join(', ')}`,
          });
          results.push({ index: i, ok: true, data: result.data });
          succeeded++;
        });
        savepointTxn();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ index: i, ok: false, error: { code: 'UPDATE_FAILED', message: msg } });
        failed++;
      }
    }
    log.info({ total: updates.length, succeeded, failed, mode }, 'Bulk update completed (partial)');
  }

  return ok({
    ok: failed === 0,
    mode,
    total: updates.length,
    succeeded,
    failed,
    results,
  });
}

/**
 * Bulk delete services.
 */
export function bulkDeleteServices(
  ids: string[],
  mode: 'atomic' | 'partial' = 'atomic'
): Result<BulkResponse<{ id: string }>> {
  const db = getDb();
  const results: BulkItemResult<{ id: string }>[] = [];
  let succeeded = 0;
  let failed = 0;

  if (mode === 'atomic') {
    try {
      const txn = db.transaction(() => {
        for (let i = 0; i < ids.length; i++) {
          const result = deleteService(ids[i]);
          throwIfFailed(result, `Item ${i} (id=${ids[i]}): `);
          recordAudit('service.delete', 'service', ids[i], {
            detail: 'Bulk delete',
          });
          results.push({ index: i, ok: true, data: { id: ids[i] } });
          succeeded++;
        }
      });
      txn();
      log.info({ count: ids.length, mode }, 'Bulk delete completed');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error({ error: msg, mode }, 'Bulk delete failed (atomic rollback)');
      return err('BULK_DELETE_FAILED', `Atomic bulk delete failed: ${msg}`);
    }
  } else {
    for (let i = 0; i < ids.length; i++) {
      try {
        const savepointTxn = db.transaction(() => {
          const result = deleteService(ids[i]);
          throwIfFailed(result, '');
          recordAudit('service.delete', 'service', ids[i], {
            detail: 'Bulk delete',
          });
          results.push({ index: i, ok: true, data: { id: ids[i] } });
          succeeded++;
        });
        savepointTxn();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ index: i, ok: false, error: { code: 'DELETE_FAILED', message: msg } });
        failed++;
      }
    }
    log.info({ total: ids.length, succeeded, failed, mode }, 'Bulk delete completed (partial)');
  }

  return ok({
    ok: failed === 0,
    mode,
    total: ids.length,
    succeeded,
    failed,
    results,
  });
}

// ── Express Route Handlers ──

export const bulkRouter = Router();

bulkRouter.post('/api/bulk/services/create', requireAuth, (req: Request, res: Response) => {
  const parsed = BulkCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION', message: parsed.error.message },
    });
  }

  const mode = req.query.mode === 'partial' ? 'partial' as const : 'atomic' as const;
  const result = bulkCreateServices(parsed.data.services, mode);

  if (!result.ok) {
    return res.status(500).json(result);
  }

  const statusCode = result.data.failed > 0 ? 207 : 201;
  res.status(statusCode).json({ ok: true, data: result.data });
});

bulkRouter.post('/api/bulk/services/update', requireAuth, (req: Request, res: Response) => {
  const parsed = BulkUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION', message: parsed.error.message },
    });
  }

  const mode = req.query.mode === 'partial' ? 'partial' as const : 'atomic' as const;
  // Schema guarantees id is present via .extend({ id: z.string().uuid() })
  const updates = parsed.data.updates as Array<{ id: string } & Partial<CreateService>>;
  const result = bulkUpdateServices(updates, mode);

  if (!result.ok) {
    return res.status(500).json(result);
  }

  const statusCode = result.data.failed > 0 ? 207 : 200;
  res.status(statusCode).json({ ok: true, data: result.data });
});

bulkRouter.post('/api/bulk/services/delete', requireAuth, (req: Request, res: Response) => {
  const parsed = BulkDeleteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION', message: parsed.error.message },
    });
  }

  const mode = req.query.mode === 'partial' ? 'partial' as const : 'atomic' as const;
  const result = bulkDeleteServices(parsed.data.ids, mode);

  if (!result.ok) {
    return res.status(500).json(result);
  }

  const statusCode = result.data.failed > 0 ? 207 : 200;
  res.status(statusCode).json({ ok: true, data: result.data });
});
