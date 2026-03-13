/**
 * Email Notification Tests
 *
 * Tests for email HTML and plain text formatters.
 */

import { describe, it, expect } from 'vitest';
import type { Incident, Service } from '../src/core/contracts.js';
import { formatEmailHtml, formatEmailText } from '../src/notifications/email.js';

// Helper to create a mock incident
function createMockIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: '123e4567-e89b-12d3-a456-426614174000',
    title: 'Test Service is down',
    severity: 'critical',
    status: 'investigating',
    serviceIds: ['service-1', 'service-2'],
    message: 'Multiple failures detected',
    createdAt: '2024-01-15T10:30:00.000Z',
    updatedAt: '2024-01-15T10:30:00.000Z',
    resolvedAt: null,
    ...overrides,
  };
}

// Helper to create mock services
function createMockServices(): Service[] {
  return [
    {
      id: 'service-1',
      name: 'API Service',
      url: 'https://api.example.com',
      method: 'GET',
      checkType: 'http',
      expectedStatus: 200,
      checkInterval: 60,
      timeout: 10,
      status: 'operational',
      enabled: true,
      groupId: null,
      sortOrder: 0,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    {
      id: 'service-2',
      name: 'Database Service',
      url: 'https://db.example.com',
      method: 'GET',
      checkType: 'http',
      expectedStatus: 200,
      checkInterval: 60,
      timeout: 10,
      status: 'operational',
      enabled: true,
      groupId: null,
      sortOrder: 1,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
  ];
}

describe('Email Notifications', () => {
  describe('formatEmailHtml', () => {
    it('should generate valid HTML with incident details', () => {
      const incident = createMockIncident();
      const services = createMockServices();

      const html = formatEmailHtml(incident, services, 'created');

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Test Service is down');
      expect(html).toContain('API Service, Database Service');
      expect(html).toContain('Investigating');
      expect(html).toContain('CRITICAL');
      expect(html).toContain('Multiple failures detected');
      expect(html).toContain('Sent by StatusOwl');
    });

    it('should escape HTML in incident title', () => {
      const incident = createMockIncident({ title: '<script>alert("xss")</script>' });
      const services = createMockServices();

      const html = formatEmailHtml(incident, services, 'created');

      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('should escape HTML in incident message', () => {
      const incident = createMockIncident({ message: 'Error: <div class="bad">injection</div>' });
      const services = createMockServices();

      const html = formatEmailHtml(incident, services, 'created');

      expect(html).not.toContain('<div class="bad">');
      expect(html).toContain('&lt;div class=&quot;bad&quot;&gt;');
    });

    it('should handle "created" event type', () => {
      const incident = createMockIncident();
      const services = createMockServices();

      const html = formatEmailHtml(incident, services, 'created');

      expect(html).toContain('New Incident');
    });

    it('should handle "resolved" event type', () => {
      const incident = createMockIncident({ status: 'resolved' });
      const services = createMockServices();

      const html = formatEmailHtml(incident, services, 'resolved');

      expect(html).toContain('Incident Resolved');
      expect(html).toContain('Resolved');
    });

    it('should handle "updated" event type', () => {
      const incident = createMockIncident({ status: 'identified' });
      const services = createMockServices();

      const html = formatEmailHtml(incident, services, 'updated');

      expect(html).toContain('Incident Updated');
      expect(html).toContain('Identified');
    });

    it('should use correct color for critical severity', () => {
      const incident = createMockIncident({ severity: 'critical' });
      const services = createMockServices();

      const html = formatEmailHtml(incident, services, 'created');

      expect(html).toContain('#dc2626');
    });

    it('should use correct color for major severity', () => {
      const incident = createMockIncident({ severity: 'major' });
      const services = createMockServices();

      const html = formatEmailHtml(incident, services, 'created');

      expect(html).toContain('#ea580c');
    });

    it('should use correct color for minor severity', () => {
      const incident = createMockIncident({ severity: 'minor' });
      const services = createMockServices();

      const html = formatEmailHtml(incident, services, 'created');

      expect(html).toContain('#ca8a04');
    });

    it('should omit message block when message is empty', () => {
      const incident = createMockIncident({ message: '' });
      const services = createMockServices();

      const html = formatEmailHtml(incident, services, 'created');

      // The message div with background #f9fafb and border-radius: 6px should not be present
      // (the footer also uses #f9fafb but has border-top instead of border-radius: 6px)
      expect(html).not.toContain('border-radius: 6px; font-size: 14px; color: #374151;');
    });

    it('should handle empty services array', () => {
      const incident = createMockIncident();
      const services: Service[] = [];

      const html = formatEmailHtml(incident, services, 'created');

      expect(html).toContain('Unknown');
    });
  });

  describe('formatEmailText', () => {
    it('should generate plain text with proper formatting', () => {
      const incident = createMockIncident();
      const services = createMockServices();

      const text = formatEmailText(incident, services, 'created');

      expect(text).toContain('[NEW INCIDENT]');
      expect(text).toContain('Test Service is down');
      expect(text).toContain('StatusOwl');
    });

    it('should include all incident details', () => {
      const incident = createMockIncident({
        severity: 'major',
        status: 'identified',
        message: 'Root cause found',
      });
      const services = createMockServices();

      const text = formatEmailText(incident, services, 'updated');

      expect(text).toContain('Severity: MAJOR');
      expect(text).toContain('Status: identified');
      expect(text).toContain('Affected: API Service, Database Service');
      expect(text).toContain('Message: Root cause found');
      expect(text).toContain('[UPDATED]');
    });

    it('should use correct event label for "created"', () => {
      const incident = createMockIncident();
      const services = createMockServices();

      const text = formatEmailText(incident, services, 'created');

      expect(text).toContain('[NEW INCIDENT]');
    });

    it('should use correct event label for "resolved"', () => {
      const incident = createMockIncident({ status: 'resolved' });
      const services = createMockServices();

      const text = formatEmailText(incident, services, 'resolved');

      expect(text).toContain('[RESOLVED]');
    });

    it('should use correct event label for "updated"', () => {
      const incident = createMockIncident();
      const services = createMockServices();

      const text = formatEmailText(incident, services, 'updated');

      expect(text).toContain('[UPDATED]');
    });

    it('should handle empty services array', () => {
      const incident = createMockIncident();
      const services: Service[] = [];

      const text = formatEmailText(incident, services, 'created');

      expect(text).toContain('Affected: Unknown');
    });

    it('should include timestamp', () => {
      const incident = createMockIncident();
      const services = createMockServices();

      const text = formatEmailText(incident, services, 'created');

      expect(text).toMatch(/Time: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should omit message line when message is empty', () => {
      const incident = createMockIncident({ message: '' });
      const services = createMockServices();

      const text = formatEmailText(incident, services, 'created');

      expect(text).not.toContain('Message:');
    });
  });
});
