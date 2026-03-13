/**
 * Slack & Discord Notification Tests
 *
 * Tests for Slack Block Kit and Discord Embed formatters.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Incident, Service } from '../src/core/contracts.js';
import { formatSlackMessage, sendSlackNotification } from '../src/notifications/slack.js';
import { formatDiscordEmbed, sendDiscordNotification } from '../src/notifications/discord.js';

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

describe('Slack Notifications', () => {
  describe('formatSlackMessage', () => {
    it('should format a critical incident with correct color', () => {
      const incident = createMockIncident({ severity: 'critical' });
      const services = createMockServices();

      const result = formatSlackMessage(incident, services, 'created');

      // Parse the payload
      const payload = JSON.parse(result.payload);
      const attachment = payload.attachments[0];

      expect(attachment.color).toBe('#FF0000'); // red for critical
      expect(payload.blocks).toBeDefined();
      expect(payload.blocks.length).toBeGreaterThan(0);
    });

    it('should format a major incident with orange color', () => {
      const incident = createMockIncident({ severity: 'major' });
      const services = createMockServices();

      const result = formatSlackMessage(incident, services, 'created');
      const payload = JSON.parse(result.payload);

      expect(payload.attachments[0].color).toBe('#FFA500'); // orange for major
    });

    it('should format a minor incident with yellow color', () => {
      const incident = createMockIncident({ severity: 'minor' });
      const services = createMockServices();

      const result = formatSlackMessage(incident, services, 'created');
      const payload = JSON.parse(result.payload);

      expect(payload.attachments[0].color).toBe('#FFFF00'); // yellow for minor
    });

    it('should format a resolved incident with green color', () => {
      const incident = createMockIncident({ status: 'resolved' });
      const services = createMockServices();

      const result = formatSlackMessage(incident, services, 'resolved');
      const payload = JSON.parse(result.payload);

      expect(payload.attachments[0].color).toBe('#00FF00'); // green for resolved
    });

    it('should include incident title and severity in message', () => {
      const incident = createMockIncident({ severity: 'critical' });
      const services = createMockServices();

      const result = formatSlackMessage(incident, services, 'created');
      const payload = JSON.parse(result.payload);

      const section = payload.blocks[0];
      expect(section.text.text).toContain('INCIDENT CREATED');
      expect(section.text.text).toContain(incident.title);
    });

    it('should list affected services', () => {
      const incident = createMockIncident({ severity: 'critical' });
      const services = createMockServices();

      const result = formatSlackMessage(incident, services, 'created');
      const payload = JSON.parse(result.payload);

      const servicesBlock = payload.blocks[2];
      expect(servicesBlock.text.text).toContain('API Service');
      expect(servicesBlock.text.text).toContain('Database Service');
    });

    it('should handle empty services array', () => {
      const incident = createMockIncident();
      const services: Service[] = [];

      const result = formatSlackMessage(incident, services, 'created');
      const payload = JSON.parse(result.payload);

      const servicesBlock = payload.blocks[2];
      expect(servicesBlock.text.text).toContain('No services affected');
    });

    it('should include message details when present', () => {
      const incident = createMockIncident({ message: 'High latency detected' });
      const services = createMockServices();

      const result = formatSlackMessage(incident, services, 'created');
      const payload = JSON.parse(result.payload);

      const detailsBlock = payload.blocks[3];
      expect(detailsBlock.text.text).toContain('High latency detected');
    });

    it('should include incident ID and timestamp', () => {
      const incident = createMockIncident();
      const services = createMockServices();

      const result = formatSlackMessage(incident, services, 'created');
      const payload = JSON.parse(result.payload);

      const contextBlock = payload.blocks[payload.blocks.length - 1];
      expect(contextBlock.text.text).toContain(incident.id);
    });
  });
});

describe('Discord Notifications', () => {
  describe('formatDiscordEmbed', () => {
    it('should format a critical incident with correct color', () => {
      const incident = createMockIncident({ severity: 'critical' });
      const services = createMockServices();

      const embed = formatDiscordEmbed(incident, services, 'created');

      expect(embed.color).toBe(0xff0000); // red for critical (as decimal)
    });

    it('should format a major incident with orange color', () => {
      const incident = createMockIncident({ severity: 'major' });
      const services = createMockServices();

      const embed = formatDiscordEmbed(incident, services, 'created');

      expect(embed.color).toBe(0xffa500); // orange for major
    });

    it('should format a minor incident with yellow color', () => {
      const incident = createMockIncident({ severity: 'minor' });
      const services = createMockServices();

      const embed = formatDiscordEmbed(incident, services, 'created');

      expect(embed.color).toBe(0xffff00); // yellow for minor
    });

    it('should format a resolved incident with green color', () => {
      const incident = createMockIncident({ status: 'resolved' });
      const services = createMockServices();

      const embed = formatDiscordEmbed(incident, services, 'resolved');

      expect(embed.color).toBe(0x00ff00); // green for resolved
    });

    it('should include title with event type', () => {
      const incident = createMockIncident({ severity: 'critical' });
      const services = createMockServices();

      const embed = formatDiscordEmbed(incident, services, 'created');

      expect(embed.title).toContain('INCIDENT CREATED');
      expect(embed.title).toContain(incident.title);
    });

    it('should include severity field', () => {
      const incident = createMockIncident({ severity: 'major' });
      const services = createMockServices();

      const embed = formatDiscordEmbed(incident, services, 'created');

      const severityField = embed.fields?.find((f) => f.name === 'Severity');
      expect(severityField?.value).toBe('Major');
    });

    it('should include status field', () => {
      const incident = createMockIncident({ status: 'monitoring' });
      const services = createMockServices();

      const embed = formatDiscordEmbed(incident, services, 'created');

      const statusField = embed.fields?.find((f) => f.name === 'Status');
      expect(statusField?.value).toBe('monitoring');
    });

    it('should include affected services field', () => {
      const incident = createMockIncident({ severity: 'critical' });
      const services = createMockServices();

      const embed = formatDiscordEmbed(incident, services, 'created');

      const servicesField = embed.fields?.find((f) => f.name === 'Affected Services');
      expect(servicesField?.value).toContain('API Service');
      expect(servicesField?.value).toContain('Database Service');
    });

    it('should include message as description when present', () => {
      const incident = createMockIncident({ message: 'Service degradation detected' });
      const services = createMockServices();

      const embed = formatDiscordEmbed(incident, services, 'created');

      expect(embed.description).toBe('Service degradation detected');
    });

    it('should include footer with incident ID', () => {
      const incident = createMockIncident();
      const services = createMockServices();

      const embed = formatDiscordEmbed(incident, services, 'created');

      expect(embed.footer?.text).toContain(incident.id);
    });

    it('should include timestamp', () => {
      const incident = createMockIncident();
      const services = createMockServices();

      const embed = formatDiscordEmbed(incident, services, 'created');

      expect(embed.timestamp).toBeDefined();
      expect(new Date(embed.timestamp!).toString()).not.toBe('Invalid Date');
    });
  });
});

describe('Notification Sending', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetAllMocks();
  });

  describe('sendSlackNotification', () => {
    it('should skip if no webhook configured', async () => {
      delete process.env.STATUSOWL_SLACK_WEBHOOK;
      vi.resetModules();

      const incident = createMockIncident();
      const services = createMockServices();

      // Should not throw, just skip
      await expect(
        sendSlackNotification(incident, services, 'created')
      ).resolves.not.toThrow();
    });
  });

  describe('sendDiscordNotification', () => {
    it('should skip if no webhook configured', async () => {
      delete process.env.STATUSOWL_DISCORD_WEBHOOK;
      vi.resetModules();

      const incident = createMockIncident();
      const services = createMockServices();

      // Should not throw, just skip
      await expect(
        sendDiscordNotification(incident, services, 'created')
      ).resolves.not.toThrow();
    });
  });
});
