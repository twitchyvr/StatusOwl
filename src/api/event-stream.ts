/**
 * StatusOwl -- Server-Sent Events (SSE) Event Stream
 *
 * Provides a singleton EventBus that manages SSE client connections,
 * broadcasts typed events to all subscribers, and tracks event IDs
 * for potential replay. Keepalive comments are sent every 30 seconds
 * to prevent proxy/load-balancer timeouts.
 */

import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { createChildLogger } from '../core/index.js';

const log = createChildLogger('event-stream');

// ── SSE Event Types ──

export type SseEventType =
  | 'status.change'
  | 'incident.created'
  | 'incident.updated'
  | 'incident.resolved'
  | 'maintenance.started'
  | 'maintenance.ended'
  | 'check.completed';

export const SSE_EVENT_TYPES: readonly SseEventType[] = [
  'status.change',
  'incident.created',
  'incident.updated',
  'incident.resolved',
  'maintenance.started',
  'maintenance.ended',
  'check.completed',
] as const;

// ── Stored Event (for replay) ──

interface StoredEvent {
  id: string;
  event: SseEventType;
  data: object;
  timestamp: number;
}

// ── EventBus ──

const KEEPALIVE_INTERVAL_MS = 30_000;
const MAX_STORED_EVENTS = 500;

export class EventBus {
  private clients: Set<Response> = new Set();
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private eventHistory: StoredEvent[] = [];

  constructor() {
    this.startKeepalive();
  }

  /**
   * Subscribe an SSE client. The Response object must already have
   * its SSE headers set (Content-Type, Cache-Control, Connection).
   */
  subscribe(res: Response): void {
    this.clients.add(res);
    log.info({ connections: this.clients.size }, 'SSE client subscribed');
  }

  /**
   * Remove an SSE client (typically called on 'close' event).
   */
  unsubscribe(res: Response): void {
    this.clients.delete(res);
    log.info({ connections: this.clients.size }, 'SSE client unsubscribed');
  }

  /**
   * Broadcast a typed event to every connected SSE client.
   * Each event is assigned a unique ID and stored for potential replay.
   */
  broadcast(event: SseEventType, data: object): void {
    const id = randomUUID();
    const storedEvent: StoredEvent = {
      id,
      event,
      data,
      timestamp: Date.now(),
    };

    // Store for replay
    this.eventHistory.push(storedEvent);
    if (this.eventHistory.length > MAX_STORED_EVENTS) {
      this.eventHistory = this.eventHistory.slice(-MAX_STORED_EVENTS);
    }

    const payload = this.formatSseMessage(id, event, data);

    log.debug(
      { event, id, clients: this.clients.size },
      'Broadcasting SSE event',
    );

    for (const client of this.clients) {
      this.safeWrite(client, payload);
    }
  }

  /**
   * Return the number of currently connected SSE clients.
   */
  getConnectionCount(): number {
    return this.clients.size;
  }

  /**
   * Retrieve the last N stored events, optionally filtered by type.
   * Used for replay when a client reconnects with a Last-Event-ID.
   */
  getEventsSince(lastEventId: string): StoredEvent[] {
    const idx = this.eventHistory.findIndex((e) => e.id === lastEventId);
    if (idx === -1) {
      // ID not found -- return empty (client is too far behind)
      return [];
    }
    return this.eventHistory.slice(idx + 1);
  }

  /**
   * Get the ID of the most recently broadcast event, or null if none.
   */
  getLastEventId(): string | null {
    if (this.eventHistory.length === 0) return null;
    return this.eventHistory[this.eventHistory.length - 1].id;
  }

  /**
   * Stop the keepalive timer. Call when shutting down the server.
   */
  destroy(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    this.clients.clear();
    this.eventHistory = [];
  }

  // ── Private helpers ──

  /**
   * Format a message according to the SSE wire protocol:
   *   id: <uuid>\nevent: <type>\ndata: <json>\n\n
   */
  private formatSseMessage(id: string, event: string, data: object): string {
    return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  /**
   * Write to a client Response, catching and handling write errors
   * (e.g. the client disconnected mid-write).
   */
  private safeWrite(client: Response, payload: string): void {
    try {
      const ok = client.write(payload);
      if (!ok) {
        // Back-pressure: the write buffer is full. The client is slow.
        // We keep the connection but log a warning.
        log.warn('SSE client back-pressure detected');
      }
    } catch (err) {
      // Client disconnected during write -- remove it
      log.debug({ err }, 'SSE write failed, removing client');
      this.clients.delete(client);
    }
  }

  /**
   * Send a keepalive comment to all connected clients every 30 s.
   * Comments (lines starting with ':') are ignored by EventSource
   * but keep the TCP connection alive through proxies.
   */
  private startKeepalive(): void {
    this.keepaliveTimer = setInterval(() => {
      const comment = ':keepalive\n\n';
      for (const client of this.clients) {
        this.safeWrite(client, comment);
      }
    }, KEEPALIVE_INTERVAL_MS);

    // Allow the process to exit without waiting for this timer
    if (this.keepaliveTimer.unref) {
      this.keepaliveTimer.unref();
    }
  }
}

// ── Singleton ──

let _instance: EventBus | null = null;

/**
 * Get (or create) the singleton EventBus instance.
 * Other modules call `getEventBus().broadcast(...)` to push events.
 */
export function getEventBus(): EventBus {
  if (!_instance) {
    _instance = new EventBus();
  }
  return _instance;
}

/**
 * Reset the singleton. Primarily used in tests to get a fresh bus.
 */
export function resetEventBus(): void {
  if (_instance) {
    _instance.destroy();
    _instance = null;
  }
}
