/**
 * Calendar Data Tests
 *
 * Tests for the GitHub-contribution-graph-style calendar data generation.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { getCalendarData, getOverallCalendarData, uptimeToLevel } from '../src/api/calendar.js';
import { createService } from '../src/storage/service-repo.js';
import { getDb, closeDb } from '../src/storage/database.js';

describe('Calendar', () => {
  let db: ReturnType<typeof getDb>;
  let testServiceId: string;
  let testServiceId2: string;

  beforeAll(() => {
    process.env.DB_PATH = ':memory:';
    process.env.LOG_LEVEL = 'error';
    db = getDb();
  });

  afterAll(() => {
    closeDb();
  });

  beforeEach(() => {
    // Clean slate
    db.exec('DELETE FROM uptime_daily');
    db.exec('DELETE FROM incident_services');
    db.exec('DELETE FROM incident_updates');
    db.exec('DELETE FROM incidents');
    db.exec('DELETE FROM check_results');
    db.exec('DELETE FROM services');

    // Create test services
    const svc1 = createService({
      name: 'Calendar Test Service A',
      url: 'https://a.example.com/health',
    });
    testServiceId = (svc1 as { ok: true; data: { id: string } }).data.id;

    const svc2 = createService({
      name: 'Calendar Test Service B',
      url: 'https://b.example.com/health',
    });
    testServiceId2 = (svc2 as { ok: true; data: { id: string } }).data.id;
  });

  // ── uptimeToLevel ──

  describe('uptimeToLevel', () => {
    it('should return level 4 for >99.9% uptime', () => {
      expect(uptimeToLevel(99.95)).toBe(4);
      expect(uptimeToLevel(100)).toBe(4);
    });

    it('should return level 3 for >99% uptime up to 99.9%', () => {
      expect(uptimeToLevel(99.5)).toBe(3);
      expect(uptimeToLevel(99.1)).toBe(3);
      expect(uptimeToLevel(99.9)).toBe(3);
    });

    it('should return level 2 for >95% uptime up to 99%', () => {
      expect(uptimeToLevel(95.5)).toBe(2);
      expect(uptimeToLevel(98)).toBe(2);
      expect(uptimeToLevel(99)).toBe(2);
    });

    it('should return level 1 for >90% uptime up to 95%', () => {
      expect(uptimeToLevel(90.5)).toBe(1);
      expect(uptimeToLevel(93)).toBe(1);
      expect(uptimeToLevel(95)).toBe(1);
    });

    it('should return level 0 for <=90% uptime', () => {
      expect(uptimeToLevel(90)).toBe(0);
      expect(uptimeToLevel(85)).toBe(0);
      expect(uptimeToLevel(50)).toBe(0);
      expect(uptimeToLevel(0)).toBe(0);
    });

    it('should handle boundary value 99.9 as level 3 (not 4)', () => {
      // 99.9 is exactly at the boundary — must be > 99.9 for level 4
      expect(uptimeToLevel(99.9)).toBe(3);
    });
  });

  // ── getCalendarData ──

  describe('getCalendarData', () => {
    it('should return calendar data for the requested number of days', () => {
      const result = getCalendarData(testServiceId, 30);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // 30 days + today = 31 entries
      expect(result.data.length).toBe(31);
    });

    it('should return ascending dates', () => {
      const result = getCalendarData(testServiceId, 14);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      for (let i = 1; i < result.data.length; i++) {
        expect(result.data[i].date > result.data[i - 1].date).toBe(true);
      }
    });

    it('should default to level 4 (100% uptime) for days with no data', () => {
      const result = getCalendarData(testServiceId, 7);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      for (const day of result.data) {
        expect(day.uptimePercent).toBe(100);
        expect(day.level).toBe(4);
        expect(day.totalChecks).toBe(0);
      }
    });

    it('should reflect uptime_daily data when present', () => {
      const today = new Date().toISOString().slice(0, 10);

      // Insert uptime data: 950 successful out of 1000
      db.prepare(`
        INSERT INTO uptime_daily (service_id, date, total_checks, successful_checks, avg_response_time)
        VALUES (?, ?, 1000, 950, 150.5)
      `).run(testServiceId, today);

      const result = getCalendarData(testServiceId, 7);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const todayEntry = result.data.find(d => d.date === today);
      expect(todayEntry).toBeDefined();
      expect(todayEntry!.uptimePercent).toBe(95);
      expect(todayEntry!.totalChecks).toBe(1000);
      expect(todayEntry!.successfulChecks).toBe(950);
      expect(todayEntry!.avgResponseTime).toBeCloseTo(150.5);
      // 95% is exactly at the boundary: >95 -> level 2, but 95 is not >95
      expect(todayEntry!.level).toBe(1);
    });

    it('should count incidents per day', () => {
      const today = new Date().toISOString().slice(0, 10);
      const now = new Date().toISOString();

      // Create two incidents today
      const incId1 = crypto.randomUUID();
      const incId2 = crypto.randomUUID();

      db.prepare(`
        INSERT INTO incidents (id, title, severity, status, message, created_at, updated_at)
        VALUES (?, 'Outage A', 'major', 'investigating', '', ?, ?)
      `).run(incId1, now, now);

      db.prepare(`
        INSERT INTO incident_services (incident_id, service_id) VALUES (?, ?)
      `).run(incId1, testServiceId);

      db.prepare(`
        INSERT INTO incidents (id, title, severity, status, message, created_at, updated_at)
        VALUES (?, 'Outage B', 'minor', 'investigating', '', ?, ?)
      `).run(incId2, now, now);

      db.prepare(`
        INSERT INTO incident_services (incident_id, service_id) VALUES (?, ?)
      `).run(incId2, testServiceId);

      const result = getCalendarData(testServiceId, 7);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const todayEntry = result.data.find(d => d.date === today);
      expect(todayEntry).toBeDefined();
      expect(todayEntry!.incidentCount).toBe(2);
    });

    it('should not count incidents belonging to other services', () => {
      const today = new Date().toISOString().slice(0, 10);
      const now = new Date().toISOString();

      const incId = crypto.randomUUID();

      db.prepare(`
        INSERT INTO incidents (id, title, severity, status, message, created_at, updated_at)
        VALUES (?, 'Other service outage', 'major', 'investigating', '', ?, ?)
      `).run(incId, now, now);

      // Link to service B, not service A
      db.prepare(`
        INSERT INTO incident_services (incident_id, service_id) VALUES (?, ?)
      `).run(incId, testServiceId2);

      const result = getCalendarData(testServiceId, 7);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const todayEntry = result.data.find(d => d.date === today);
      expect(todayEntry).toBeDefined();
      expect(todayEntry!.incidentCount).toBe(0);
    });

    it('should return empty incident count when no incidents exist', () => {
      const result = getCalendarData(testServiceId, 7);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      for (const day of result.data) {
        expect(day.incidentCount).toBe(0);
      }
    });

    it('should include all required CalendarDay fields', () => {
      const result = getCalendarData(testServiceId, 1);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const day = result.data[0];
      expect(day).toHaveProperty('date');
      expect(day).toHaveProperty('uptimePercent');
      expect(day).toHaveProperty('totalChecks');
      expect(day).toHaveProperty('successfulChecks');
      expect(day).toHaveProperty('avgResponseTime');
      expect(day).toHaveProperty('incidentCount');
      expect(day).toHaveProperty('level');
      expect(typeof day.date).toBe('string');
      expect(typeof day.uptimePercent).toBe('number');
      expect(typeof day.level).toBe('number');
      expect(day.level).toBeGreaterThanOrEqual(0);
      expect(day.level).toBeLessThanOrEqual(4);
    });

    it('should handle day-of-week alignment (dates cover correct range)', () => {
      const result = getCalendarData(testServiceId, 14);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Verify the last entry is today
      const today = new Date().toISOString().slice(0, 10);
      expect(result.data[result.data.length - 1].date).toBe(today);

      // Verify the first entry is 14 days ago
      const fourteenDaysAgo = new Date();
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
      expect(result.data[0].date).toBe(fourteenDaysAgo.toISOString().slice(0, 10));
    });
  });

  // ── getOverallCalendarData ──

  describe('getOverallCalendarData', () => {
    it('should aggregate uptime across all services', () => {
      const today = new Date().toISOString().slice(0, 10);

      // Service A: 900/1000 = 90%
      db.prepare(`
        INSERT INTO uptime_daily (service_id, date, total_checks, successful_checks, avg_response_time)
        VALUES (?, ?, 1000, 900, 100)
      `).run(testServiceId, today);

      // Service B: 1000/1000 = 100%
      db.prepare(`
        INSERT INTO uptime_daily (service_id, date, total_checks, successful_checks, avg_response_time)
        VALUES (?, ?, 1000, 1000, 200)
      `).run(testServiceId2, today);

      const result = getOverallCalendarData(7);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const todayEntry = result.data.find(d => d.date === today);
      expect(todayEntry).toBeDefined();
      // Weighted average: (900+1000) / (1000+1000) = 95%
      expect(todayEntry!.uptimePercent).toBe(95);
      expect(todayEntry!.totalChecks).toBe(2000);
      expect(todayEntry!.successfulChecks).toBe(1900);
    });

    it('should aggregate incidents across all services', () => {
      const today = new Date().toISOString().slice(0, 10);
      const now = new Date().toISOString();

      // Incident linked to service A
      const incIdA = crypto.randomUUID();
      db.prepare(`
        INSERT INTO incidents (id, title, severity, status, message, created_at, updated_at)
        VALUES (?, 'Outage A', 'major', 'investigating', '', ?, ?)
      `).run(incIdA, now, now);
      db.prepare(`INSERT INTO incident_services (incident_id, service_id) VALUES (?, ?)`).run(incIdA, testServiceId);

      // Incident linked to service B
      const incIdB = crypto.randomUUID();
      db.prepare(`
        INSERT INTO incidents (id, title, severity, status, message, created_at, updated_at)
        VALUES (?, 'Outage B', 'minor', 'investigating', '', ?, ?)
      `).run(incIdB, now, now);
      db.prepare(`INSERT INTO incident_services (incident_id, service_id) VALUES (?, ?)`).run(incIdB, testServiceId2);

      const result = getOverallCalendarData(7);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const todayEntry = result.data.find(d => d.date === today);
      expect(todayEntry).toBeDefined();
      // Overall counts distinct incidents, not per-service incidents
      expect(todayEntry!.incidentCount).toBe(2);
    });

    it('should return data for the requested number of days', () => {
      const result = getOverallCalendarData(30);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBe(31); // 30 days + today
    });

    it('should handle empty database gracefully', () => {
      const result = getOverallCalendarData(7);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // All days should exist with default 100% uptime
      for (const day of result.data) {
        expect(day.uptimePercent).toBe(100);
        expect(day.totalChecks).toBe(0);
        expect(day.incidentCount).toBe(0);
        expect(day.level).toBe(4);
      }
    });
  });
});
