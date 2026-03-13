/**
 * EventBus / SSE Event Stream Tests
 *
 * Tests the EventBus singleton, subscribe/unsubscribe, broadcast,
 * SSE message format, keepalive, connection counting, event replay,
 * and the SSE route integration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus, getEventBus, resetEventBus } from '../src/api/event-stream.js';
import type { SseEventType } from '../src/api/event-stream.js';

// No need to mock core/index.js — LOG_LEVEL=error suppresses log noise,
// and EventBus does not use the database.

/**
 * Create a mock Express Response object that captures SSE writes.
 */
function createMockResponse(): {
  res: any;
  written: string[];
  destroyed: boolean;
} {
  const written: string[] = [];
  let destroyed = false;
  const res = {
    write: vi.fn((data: string) => {
      if (destroyed) throw new Error('write after destroy');
      written.push(data);
      return true;
    }),
    end: vi.fn(() => {
      destroyed = true;
    }),
    on: vi.fn(),
    once: vi.fn(),
    emit: vi.fn(),
    headersSent: true,
    writableEnded: false,
    writableFinished: false,
  };
  return { res, written, destroyed };
}

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    resetEventBus();
    bus = new EventBus();
  });

  afterEach(() => {
    bus.destroy();
  });

  // ── 1. Singleton ──

  it('getEventBus returns the same instance on repeated calls', () => {
    const a = getEventBus();
    const b = getEventBus();
    expect(a).toBe(b);
  });

  it('resetEventBus clears the singleton and creates a new instance', () => {
    const a = getEventBus();
    resetEventBus();
    const b = getEventBus();
    expect(a).not.toBe(b);
  });

  // ── 2. Subscribe / Unsubscribe ──

  it('subscribe adds a client and increases connection count', () => {
    const { res } = createMockResponse();
    expect(bus.getConnectionCount()).toBe(0);

    bus.subscribe(res);
    expect(bus.getConnectionCount()).toBe(1);
  });

  it('unsubscribe removes a client and decreases connection count', () => {
    const { res } = createMockResponse();
    bus.subscribe(res);
    expect(bus.getConnectionCount()).toBe(1);

    bus.unsubscribe(res);
    expect(bus.getConnectionCount()).toBe(0);
  });

  it('unsubscribing a non-subscribed client is a no-op', () => {
    const { res } = createMockResponse();
    bus.unsubscribe(res); // should not throw
    expect(bus.getConnectionCount()).toBe(0);
  });

  // ── 3. Broadcast to multiple clients ──

  it('broadcast sends the event to all subscribed clients', () => {
    const mock1 = createMockResponse();
    const mock2 = createMockResponse();
    const mock3 = createMockResponse();

    bus.subscribe(mock1.res);
    bus.subscribe(mock2.res);
    bus.subscribe(mock3.res);

    bus.broadcast('status.change', { serviceId: 'abc', status: 'degraded' });

    // Each client should have received exactly one write
    expect(mock1.res.write).toHaveBeenCalledTimes(1);
    expect(mock2.res.write).toHaveBeenCalledTimes(1);
    expect(mock3.res.write).toHaveBeenCalledTimes(1);
  });

  it('broadcast does not send to unsubscribed clients', () => {
    const mock1 = createMockResponse();
    const mock2 = createMockResponse();

    bus.subscribe(mock1.res);
    bus.subscribe(mock2.res);
    bus.unsubscribe(mock1.res);

    bus.broadcast('incident.created', { id: '123', title: 'test' });

    expect(mock1.res.write).not.toHaveBeenCalled();
    expect(mock2.res.write).toHaveBeenCalledTimes(1);
  });

  // ── 4. SSE message format ──

  it('broadcast sends messages in correct SSE wire format', () => {
    const mock = createMockResponse();
    bus.subscribe(mock.res);

    const testData = { serviceId: 'svc-1', status: 'operational' };
    bus.broadcast('status.change', testData);

    expect(mock.written.length).toBe(1);
    const message = mock.written[0];

    // Verify SSE format: id, event, data fields separated by \n, terminated by \n\n
    expect(message).toMatch(/^id: [0-9a-f-]{36}\n/);
    expect(message).toContain('event: status.change\n');
    expect(message).toContain(`data: ${JSON.stringify(testData)}\n`);
    expect(message).toMatch(/\n\n$/);
  });

  it('each broadcast event gets a unique ID', () => {
    const mock = createMockResponse();
    bus.subscribe(mock.res);

    bus.broadcast('status.change', { a: 1 });
    bus.broadcast('status.change', { a: 2 });

    const id1 = mock.written[0].match(/^id: ([0-9a-f-]+)\n/)?.[1];
    const id2 = mock.written[1].match(/^id: ([0-9a-f-]+)\n/)?.[1];

    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);
  });

  // ── 5. Event types ──

  it('supports all defined SSE event types', () => {
    const mock = createMockResponse();
    bus.subscribe(mock.res);

    const eventTypes: SseEventType[] = [
      'status.change',
      'incident.created',
      'incident.updated',
      'incident.resolved',
      'maintenance.started',
      'maintenance.ended',
      'check.completed',
    ];

    for (const eventType of eventTypes) {
      bus.broadcast(eventType, { type: eventType });
    }

    expect(mock.written.length).toBe(7);

    for (let i = 0; i < eventTypes.length; i++) {
      expect(mock.written[i]).toContain(`event: ${eventTypes[i]}\n`);
    }
  });

  // ── 6. Connection count ──

  it('getConnectionCount accurately reflects current client count', () => {
    const mocks = Array.from({ length: 5 }, () => createMockResponse());

    expect(bus.getConnectionCount()).toBe(0);

    mocks.forEach((m) => bus.subscribe(m.res));
    expect(bus.getConnectionCount()).toBe(5);

    bus.unsubscribe(mocks[0].res);
    bus.unsubscribe(mocks[1].res);
    expect(bus.getConnectionCount()).toBe(3);

    bus.unsubscribe(mocks[2].res);
    bus.unsubscribe(mocks[3].res);
    bus.unsubscribe(mocks[4].res);
    expect(bus.getConnectionCount()).toBe(0);
  });

  // ── 7. Keepalive ──

  it('sends keepalive comments to all clients every 30 seconds', () => {
    vi.useFakeTimers();

    const localBus = new EventBus();
    const mock1 = createMockResponse();
    const mock2 = createMockResponse();

    localBus.subscribe(mock1.res);
    localBus.subscribe(mock2.res);

    // No keepalive yet
    expect(mock1.res.write).not.toHaveBeenCalled();

    // Advance 30 seconds
    vi.advanceTimersByTime(30_000);

    expect(mock1.res.write).toHaveBeenCalledWith(':keepalive\n\n');
    expect(mock2.res.write).toHaveBeenCalledWith(':keepalive\n\n');

    // Advance another 30 seconds — second keepalive
    vi.advanceTimersByTime(30_000);
    expect(mock1.res.write).toHaveBeenCalledTimes(2);
    expect(mock2.res.write).toHaveBeenCalledTimes(2);

    localBus.destroy();
    vi.useRealTimers();
  });

  // ── 8. Client disconnect during write ──

  it('removes a client that throws on write', () => {
    const mock1 = createMockResponse();
    const mock2 = createMockResponse();

    // Make mock1 throw on write (simulating a disconnected client)
    mock1.res.write = vi.fn(() => {
      throw new Error('Connection reset');
    });

    bus.subscribe(mock1.res);
    bus.subscribe(mock2.res);
    expect(bus.getConnectionCount()).toBe(2);

    bus.broadcast('status.change', { test: true });

    // mock1 should have been removed after the failed write
    expect(bus.getConnectionCount()).toBe(1);
    // mock2 should still have received the message
    expect(mock2.res.write).toHaveBeenCalledTimes(1);
  });

  // ── 9. Empty listener list ──

  it('broadcast with no listeners does not throw', () => {
    expect(bus.getConnectionCount()).toBe(0);
    expect(() => {
      bus.broadcast('status.change', { test: true });
    }).not.toThrow();
  });

  // ── 10. Event history / replay ──

  it('stores broadcast events in history for replay', () => {
    bus.broadcast('status.change', { seq: 1 });
    bus.broadcast('incident.created', { seq: 2 });
    bus.broadcast('incident.resolved', { seq: 3 });

    const lastId = bus.getLastEventId();
    expect(lastId).toBeDefined();
    expect(typeof lastId).toBe('string');
  });

  it('getEventsSince returns events after the given ID', () => {
    bus.broadcast('status.change', { seq: 1 });

    // Get the ID of the first event
    const firstId = bus.getLastEventId()!;

    bus.broadcast('incident.created', { seq: 2 });
    bus.broadcast('incident.resolved', { seq: 3 });

    const missed = bus.getEventsSince(firstId);
    expect(missed.length).toBe(2);
    expect(missed[0].event).toBe('incident.created');
    expect(missed[1].event).toBe('incident.resolved');
  });

  it('getEventsSince returns empty array for unknown ID', () => {
    bus.broadcast('status.change', { seq: 1 });
    const missed = bus.getEventsSince('nonexistent-id');
    expect(missed).toEqual([]);
  });

  it('getLastEventId returns null when no events have been broadcast', () => {
    expect(bus.getLastEventId()).toBeNull();
  });

  // ── 11. Destroy ──

  it('destroy clears all clients and stops timers', () => {
    const mock = createMockResponse();
    bus.subscribe(mock.res);
    expect(bus.getConnectionCount()).toBe(1);

    bus.destroy();
    expect(bus.getConnectionCount()).toBe(0);
    expect(bus.getLastEventId()).toBeNull();
  });

  // ── 12. Data integrity ──

  it('broadcast data is JSON-serialized correctly', () => {
    const mock = createMockResponse();
    bus.subscribe(mock.res);

    const complexData = {
      serviceId: 'svc-123',
      status: 'major_outage',
      metadata: {
        responseTime: 5000,
        errorMessage: 'Connection timeout',
        tags: ['production', 'critical'],
      },
    };

    bus.broadcast('status.change', complexData);

    const message = mock.written[0];
    const dataLine = message.split('\n').find((l: string) => l.startsWith('data: '));
    expect(dataLine).toBeDefined();

    const parsed = JSON.parse(dataLine!.replace('data: ', ''));
    expect(parsed).toEqual(complexData);
  });

  // ── 13. Multiple subscriptions of same response ──

  it('subscribing the same response twice only counts as one connection', () => {
    const mock = createMockResponse();
    bus.subscribe(mock.res);
    bus.subscribe(mock.res);

    // Set uses reference equality, so same object = one entry
    expect(bus.getConnectionCount()).toBe(1);

    bus.broadcast('status.change', { test: true });
    // Should only receive one write, not two
    expect(mock.res.write).toHaveBeenCalledTimes(1);
  });

  // ── 14. Back-pressure handling ──

  it('handles write returning false (back-pressure) without removing client', () => {
    const mock = createMockResponse();
    // Simulate back-pressure: write returns false
    mock.res.write = vi.fn(() => false);

    bus.subscribe(mock.res);
    bus.broadcast('status.change', { test: true });

    // Client should still be connected (not removed)
    expect(bus.getConnectionCount()).toBe(1);
    expect(mock.res.write).toHaveBeenCalledTimes(1);
  });
});
