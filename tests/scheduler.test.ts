import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/core/index.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    createChildLogger: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

vi.mock('../src/storage/index.js', () => ({
  listServices: vi.fn(),
  updateServiceStatus: vi.fn(),
  recordCheck: vi.fn(),
}));

vi.mock('../src/incidents/detector.js', () => ({
  detectIncidents: vi.fn(),
}));

vi.mock('../src/monitors/checker.js', () => ({
  checkService: vi.fn(),
}));

import {
  startScheduler,
  stopScheduler,
  scheduleService,
  unscheduleService,
  getScheduledCount,
} from '../src/monitors/scheduler.js';
import { listServices, updateServiceStatus, recordCheck } from '../src/storage/index.js';
import { checkService } from '../src/monitors/checker.js';
import { detectIncidents } from '../src/incidents/detector.js';

function makeService(overrides: Record<string, unknown> = {}) {
  return {
    id: 'svc-1',
    name: 'Test Service',
    url: 'https://example.com',
    enabled: true,
    checkInterval: 60,
    ...overrides,
  };
}

describe('Scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Ensure scheduler is stopped and timers are cleared between tests
    stopScheduler();
    // Default mock return values
    vi.mocked(listServices).mockReturnValue({ ok: true, data: [] } as any);
    vi.mocked(checkService).mockResolvedValue({
      status: 'operational',
      responseTime: 120,
      statusCode: 200,
      errorMessage: null,
    } as any);
    vi.mocked(detectIncidents).mockResolvedValue(undefined as any);
    vi.mocked(updateServiceStatus).mockReturnValue(undefined as any);
    vi.mocked(recordCheck).mockReturnValue(undefined as any);
  });

  afterEach(() => {
    stopScheduler();
    vi.useRealTimers();
  });

  // ---------- startScheduler ----------

  describe('startScheduler', () => {
    it('loads enabled services and schedules them', () => {
      const svc1 = makeService({ id: 'svc-1' });
      const svc2 = makeService({ id: 'svc-2', checkInterval: 30 });
      vi.mocked(listServices).mockReturnValue({ ok: true, data: [svc1, svc2] } as any);

      startScheduler();

      expect(listServices).toHaveBeenCalledWith({ enabled: true });
      // Both services should be scheduled (immediate check + interval)
      expect(getScheduledCount()).toBe(2);
      // checkService should have been called once per service (immediate run)
      expect(checkService).toHaveBeenCalledTimes(2);
      expect(checkService).toHaveBeenCalledWith(svc1);
      expect(checkService).toHaveBeenCalledWith(svc2);
    });

    it('is idempotent — calling twice does not double-schedule', () => {
      const svc = makeService();
      vi.mocked(listServices).mockReturnValue({ ok: true, data: [svc] } as any);

      startScheduler();
      startScheduler();

      expect(listServices).toHaveBeenCalledTimes(1);
      expect(getScheduledCount()).toBe(1);
    });

    it('handles listServices failure gracefully', () => {
      vi.mocked(listServices).mockReturnValue({
        ok: false,
        error: 'database unavailable',
      } as any);

      startScheduler();

      expect(listServices).toHaveBeenCalledWith({ enabled: true });
      expect(getScheduledCount()).toBe(0);
      expect(checkService).not.toHaveBeenCalled();
    });

    it('schedules zero services when none are enabled', () => {
      vi.mocked(listServices).mockReturnValue({ ok: true, data: [] } as any);

      startScheduler();

      expect(getScheduledCount()).toBe(0);
      expect(checkService).not.toHaveBeenCalled();
    });
  });

  // ---------- stopScheduler ----------

  describe('stopScheduler', () => {
    it('clears all timers and resets count to zero', () => {
      const svc1 = makeService({ id: 'svc-1' });
      const svc2 = makeService({ id: 'svc-2' });
      vi.mocked(listServices).mockReturnValue({ ok: true, data: [svc1, svc2] } as any);

      startScheduler();
      expect(getScheduledCount()).toBe(2);

      stopScheduler();
      expect(getScheduledCount()).toBe(0);
    });

    it('allows startScheduler to run again after stop', () => {
      const svc = makeService();
      vi.mocked(listServices).mockReturnValue({ ok: true, data: [svc] } as any);

      startScheduler();
      expect(getScheduledCount()).toBe(1);

      stopScheduler();
      expect(getScheduledCount()).toBe(0);

      // Should be able to start again since _running was reset
      startScheduler();
      expect(getScheduledCount()).toBe(1);
      expect(listServices).toHaveBeenCalledTimes(2);
    });

    it('is safe to call when no timers are active', () => {
      expect(getScheduledCount()).toBe(0);
      expect(() => stopScheduler()).not.toThrow();
      expect(getScheduledCount()).toBe(0);
    });
  });

  // ---------- scheduleService ----------

  describe('scheduleService', () => {
    it('runs check immediately when scheduling a service', () => {
      const svc = makeService();

      scheduleService(svc as any);

      expect(checkService).toHaveBeenCalledTimes(1);
      expect(checkService).toHaveBeenCalledWith(svc);
      expect(getScheduledCount()).toBe(1);
    });

    it('sets an interval that runs check periodically', async () => {
      const svc = makeService({ checkInterval: 10 }); // 10 seconds
      vi.mocked(checkService).mockResolvedValue({
        status: 'operational',
        responseTime: 50,
        statusCode: 200,
        errorMessage: null,
      } as any);

      scheduleService(svc as any);
      expect(checkService).toHaveBeenCalledTimes(1);

      // Advance past one interval (10 seconds = 10000 ms)
      vi.advanceTimersByTime(10_000);
      expect(checkService).toHaveBeenCalledTimes(2);

      // Advance another interval
      vi.advanceTimersByTime(10_000);
      expect(checkService).toHaveBeenCalledTimes(3);
    });

    it('replaces existing timer when re-scheduling the same service', () => {
      const svc = makeService({ id: 'svc-1', checkInterval: 60 });

      scheduleService(svc as any);
      expect(getScheduledCount()).toBe(1);
      expect(checkService).toHaveBeenCalledTimes(1);

      // Re-schedule same service
      scheduleService(svc as any);
      expect(getScheduledCount()).toBe(1); // Still 1, not 2
      expect(checkService).toHaveBeenCalledTimes(2); // Immediate check runs again
    });

    it('schedules multiple distinct services independently', () => {
      const svc1 = makeService({ id: 'svc-1' });
      const svc2 = makeService({ id: 'svc-2' });
      const svc3 = makeService({ id: 'svc-3' });

      scheduleService(svc1 as any);
      scheduleService(svc2 as any);
      scheduleService(svc3 as any);

      expect(getScheduledCount()).toBe(3);
      expect(checkService).toHaveBeenCalledTimes(3);
    });
  });

  // ---------- unscheduleService ----------

  describe('unscheduleService', () => {
    it('removes a scheduled service and decrements count', () => {
      const svc = makeService({ id: 'svc-1' });

      scheduleService(svc as any);
      expect(getScheduledCount()).toBe(1);

      unscheduleService('svc-1');
      expect(getScheduledCount()).toBe(0);
    });

    it('does nothing for an unknown service id', () => {
      const svc = makeService({ id: 'svc-1' });

      scheduleService(svc as any);
      expect(getScheduledCount()).toBe(1);

      unscheduleService('nonexistent-id');
      expect(getScheduledCount()).toBe(1); // unchanged
    });

    it('prevents future interval checks after unscheduling', () => {
      const svc = makeService({ id: 'svc-1', checkInterval: 5 });

      scheduleService(svc as any);
      expect(checkService).toHaveBeenCalledTimes(1); // immediate

      unscheduleService('svc-1');

      // Advance time well past the interval
      vi.advanceTimersByTime(30_000);
      // No additional calls — timer was cleared
      expect(checkService).toHaveBeenCalledTimes(1);
    });
  });

  // ---------- runCheck (tested indirectly via scheduleService) ----------

  describe('runCheck (via scheduleService)', () => {
    it('records check result and updates status on success', async () => {
      const svc = makeService({ id: 'svc-check' });
      vi.mocked(checkService).mockResolvedValue({
        status: 'operational',
        responseTime: 150,
        statusCode: 200,
        errorMessage: null,
      } as any);

      scheduleService(svc as any);
      // Clear interval to prevent infinite timer loop, then flush async chain
      unscheduleService('svc-check');
      await vi.advanceTimersByTimeAsync(0);

      expect(recordCheck).toHaveBeenCalledWith('svc-check', 'operational', 150, 200, null);
      expect(updateServiceStatus).toHaveBeenCalledWith('svc-check', 'operational');
      expect(detectIncidents).toHaveBeenCalled();
    });

    it('records degraded_performance status correctly', async () => {
      const svc = makeService({ id: 'svc-slow' });
      vi.mocked(checkService).mockResolvedValue({
        status: 'degraded_performance',
        responseTime: 4500,
        statusCode: 200,
        errorMessage: null,
      } as any);

      scheduleService(svc as any);
      unscheduleService('svc-slow');
      await vi.advanceTimersByTimeAsync(0);

      expect(recordCheck).toHaveBeenCalledWith('svc-slow', 'degraded_performance', 4500, 200, null);
      expect(updateServiceStatus).toHaveBeenCalledWith('svc-slow', 'degraded_performance');
    });

    it('updates status to major_outage and records error on check failure', async () => {
      const svc = makeService({ id: 'svc-fail' });
      vi.mocked(checkService).mockRejectedValue(new Error('Connection refused'));

      scheduleService(svc as any);
      unscheduleService('svc-fail');
      await vi.advanceTimersByTimeAsync(0);

      expect(updateServiceStatus).toHaveBeenCalledWith('svc-fail', 'major_outage');
      expect(recordCheck).toHaveBeenCalledWith(
        'svc-fail',
        'major_outage',
        0,
        null,
        'Scheduler error: Connection refused',
      );
      // detectIncidents still called in catch block
      expect(detectIncidents).toHaveBeenCalled();
    });

    it('handles non-Error thrown values in catch', async () => {
      const svc = makeService({ id: 'svc-weird' });
      vi.mocked(checkService).mockRejectedValue('string error');

      scheduleService(svc as any);
      unscheduleService('svc-weird');
      await vi.advanceTimersByTimeAsync(0);

      expect(updateServiceStatus).toHaveBeenCalledWith('svc-weird', 'major_outage');
      expect(recordCheck).toHaveBeenCalledWith(
        'svc-weird',
        'major_outage',
        0,
        null,
        'Scheduler error: string error',
      );
    });

    it('still calls detectIncidents even when detectIncidents itself throws in catch', async () => {
      const svc = makeService({ id: 'svc-double-fail' });
      vi.mocked(checkService).mockRejectedValue(new Error('check failed'));
      // detectIncidents throws in the catch path
      vi.mocked(detectIncidents).mockRejectedValue(new Error('detector broken'));

      scheduleService(svc as any);
      unscheduleService('svc-double-fail');

      // Should not throw — the .catch() in the source swallows it
      await vi.advanceTimersByTimeAsync(0);

      expect(updateServiceStatus).toHaveBeenCalledWith('svc-double-fail', 'major_outage');
      expect(recordCheck).toHaveBeenCalledWith(
        'svc-double-fail',
        'major_outage',
        0,
        null,
        'Scheduler error: check failed',
      );
    });

    it('calls detectIncidents after recording check on success path', async () => {
      const svc = makeService({ id: 'svc-order' });
      const callOrder: string[] = [];

      vi.mocked(checkService).mockResolvedValue({
        status: 'operational',
        responseTime: 100,
        statusCode: 200,
        errorMessage: null,
      } as any);
      vi.mocked(recordCheck).mockImplementation(() => {
        callOrder.push('recordCheck');
        return undefined as any;
      });
      vi.mocked(updateServiceStatus).mockImplementation(() => {
        callOrder.push('updateServiceStatus');
        return undefined as any;
      });
      vi.mocked(detectIncidents).mockImplementation(async () => {
        callOrder.push('detectIncidents');
        return undefined as any;
      });

      scheduleService(svc as any);
      unscheduleService('svc-order');
      await vi.advanceTimersByTimeAsync(0);

      expect(callOrder).toEqual(['recordCheck', 'updateServiceStatus', 'detectIncidents']);
    });
  });

  // ---------- getScheduledCount ----------

  describe('getScheduledCount', () => {
    it('returns 0 when no services are scheduled', () => {
      expect(getScheduledCount()).toBe(0);
    });

    it('returns correct count after scheduling services', () => {
      scheduleService(makeService({ id: 'a' }) as any);
      expect(getScheduledCount()).toBe(1);

      scheduleService(makeService({ id: 'b' }) as any);
      expect(getScheduledCount()).toBe(2);

      scheduleService(makeService({ id: 'c' }) as any);
      expect(getScheduledCount()).toBe(3);
    });

    it('decrements when services are unscheduled', () => {
      scheduleService(makeService({ id: 'a' }) as any);
      scheduleService(makeService({ id: 'b' }) as any);
      expect(getScheduledCount()).toBe(2);

      unscheduleService('a');
      expect(getScheduledCount()).toBe(1);

      unscheduleService('b');
      expect(getScheduledCount()).toBe(0);
    });

    it('returns 0 after stopScheduler', () => {
      const svc1 = makeService({ id: 'svc-1' });
      const svc2 = makeService({ id: 'svc-2' });
      vi.mocked(listServices).mockReturnValue({ ok: true, data: [svc1, svc2] } as any);

      startScheduler();
      expect(getScheduledCount()).toBe(2);

      stopScheduler();
      expect(getScheduledCount()).toBe(0);
    });
  });
});
