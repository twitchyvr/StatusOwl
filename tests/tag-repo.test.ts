/**
 * Tag Repository Tests
 *
 * Tests for tag CRUD, service-tag associations, and tag-based filtering.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import {
  createTag,
  getTag,
  listTags,
  deleteTag,
  addTagToService,
  removeTagFromService,
  getTagsForService,
  getServicesByTag,
} from '../src/storage/tag-repo.js';
import { createService, deleteService } from '../src/storage/service-repo.js';
import { getDb, closeDb } from '../src/storage/database.js';
import type { CreateService } from '../src/core/index.js';

describe('Tag Repository', () => {
  let db: ReturnType<typeof getDb>;

  /** Helper to create a service and return its ID. */
  function makeService(name: string): string {
    const input: CreateService = { name, url: `https://${name.toLowerCase().replace(/\s+/g, '-')}.example.com` };
    const result = createService(input);
    if (!result.ok) throw new Error(`Failed to create service: ${result.error.message}`);
    return result.data.id;
  }

  /** Helper to create a tag and return its ID. */
  function makeTag(name: string, color?: string): string {
    const result = createTag(name, color);
    if (!result.ok) throw new Error(`Failed to create tag: ${result.error.message}`);
    return result.data.id;
  }

  beforeAll(() => {
    process.env.DB_PATH = ':memory:';
    process.env.LOG_LEVEL = 'error';
    db = getDb();
  });

  afterAll(() => {
    closeDb();
  });

  beforeEach(() => {
    // Clear relevant tables before each test for isolation
    db.prepare('DELETE FROM service_tags').run();
    db.prepare('DELETE FROM tags').run();
    db.prepare('DELETE FROM service_dependencies').run();
    db.prepare('DELETE FROM incident_updates').run();
    db.prepare('DELETE FROM incident_services').run();
    db.prepare('DELETE FROM incidents').run();
    db.prepare('DELETE FROM check_results').run();
    db.prepare('DELETE FROM services').run();
    db.prepare('DELETE FROM service_groups').run();
  });

  // ── Tag CRUD ──

  describe('createTag', () => {
    it('should create a tag with a name and explicit color', () => {
      const result = createTag('production', '#ef4444');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.id).toBeDefined();
      expect(result.data.name).toBe('production');
      expect(result.data.color).toBe('#ef4444');
      expect(result.data.createdAt).toBeDefined();
    });

    it('should assign a default color when none is provided', () => {
      const result = createTag('staging');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    });

    it('should rotate through default colors for successive tags', () => {
      const colors: string[] = [];
      for (let i = 0; i < 12; i++) {
        const result = createTag(`tag-${i}`);
        if (!result.ok) throw new Error('Failed to create tag');
        colors.push(result.data.color);
      }

      // The 11th and 12th tags (index 10, 11) should wrap around to the beginning
      expect(colors[10]).toBe(colors[0]);
      expect(colors[11]).toBe(colors[1]);
    });

    it('should trim whitespace from tag names', () => {
      const result = createTag('  frontend  ');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.name).toBe('frontend');
    });

    it('should reject duplicate tag names', () => {
      const first = createTag('critical');
      expect(first.ok).toBe(true);

      const duplicate = createTag('critical');

      expect(duplicate.ok).toBe(false);
      if (duplicate.ok) return;
      expect(duplicate.error.code).toBe('DUPLICATE');
      expect(duplicate.error.message).toContain('already exists');
    });
  });

  describe('getTag', () => {
    it('should retrieve a tag by ID', () => {
      const created = createTag('backend', '#10b981');
      if (!created.ok) throw new Error('Setup failed');

      const result = getTag(created.data.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.id).toBe(created.data.id);
      expect(result.data.name).toBe('backend');
      expect(result.data.color).toBe('#10b981');
    });

    it('should return NOT_FOUND for non-existent tag', () => {
      const result = getTag('00000000-0000-0000-0000-000000000000');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  describe('listTags', () => {
    it('should return all tags ordered by name', () => {
      createTag('zulu');
      createTag('alpha');
      createTag('mike');

      const result = listTags();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBe(3);
      expect(result.data[0].name).toBe('alpha');
      expect(result.data[1].name).toBe('mike');
      expect(result.data[2].name).toBe('zulu');
    });

    it('should return an empty array when no tags exist', () => {
      const result = listTags();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBe(0);
    });
  });

  describe('deleteTag', () => {
    it('should delete an existing tag', () => {
      const tagId = makeTag('temporary');

      const result = deleteTag(tagId);

      expect(result.ok).toBe(true);

      // Verify it's gone
      const getResult = getTag(tagId);
      expect(getResult.ok).toBe(false);
    });

    it('should return NOT_FOUND for non-existent tag', () => {
      const result = deleteTag('00000000-0000-0000-0000-000000000000');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });

    it('should cascade delete service-tag associations when tag is deleted', () => {
      const tagId = makeTag('doomed');
      const serviceId = makeService('Linked Service');
      addTagToService(serviceId, tagId);

      // Verify the association exists
      const tagsBefore = getTagsForService(serviceId);
      expect(tagsBefore.ok).toBe(true);
      if (!tagsBefore.ok) return;
      expect(tagsBefore.data.length).toBe(1);

      // Delete the tag
      deleteTag(tagId);

      // Association should be gone
      const tagsAfter = getTagsForService(serviceId);
      expect(tagsAfter.ok).toBe(true);
      if (!tagsAfter.ok) return;
      expect(tagsAfter.data.length).toBe(0);
    });
  });

  // ── Service-Tag Associations ──

  describe('addTagToService', () => {
    it('should associate a tag with a service', () => {
      const serviceId = makeService('My API');
      const tagId = makeTag('production');

      const result = addTagToService(serviceId, tagId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.serviceId).toBe(serviceId);
      expect(result.data.tagId).toBe(tagId);
    });

    it('should reject duplicate service-tag association', () => {
      const serviceId = makeService('My API');
      const tagId = makeTag('production');

      const first = addTagToService(serviceId, tagId);
      expect(first.ok).toBe(true);

      const duplicate = addTagToService(serviceId, tagId);

      expect(duplicate.ok).toBe(false);
      if (duplicate.ok) return;
      expect(duplicate.error.code).toBe('DUPLICATE');
    });

    it('should reject association with non-existent tag', () => {
      const serviceId = makeService('My API');

      const result = addTagToService(serviceId, '00000000-0000-0000-0000-000000000000');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });

    it('should reject association with non-existent service', () => {
      const tagId = makeTag('orphan');

      const result = addTagToService('00000000-0000-0000-0000-000000000000', tagId);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });

    it('should allow multiple tags on one service', () => {
      const serviceId = makeService('Multi-Tag Service');
      const tag1 = makeTag('production');
      const tag2 = makeTag('critical');
      const tag3 = makeTag('backend');

      addTagToService(serviceId, tag1);
      addTagToService(serviceId, tag2);
      addTagToService(serviceId, tag3);

      const tags = getTagsForService(serviceId);
      expect(tags.ok).toBe(true);
      if (!tags.ok) return;
      expect(tags.data.length).toBe(3);
    });

    it('should allow one tag on multiple services', () => {
      const tagId = makeTag('shared-tag');
      const service1 = makeService('Service A');
      const service2 = makeService('Service B');
      const service3 = makeService('Service C');

      addTagToService(service1, tagId);
      addTagToService(service2, tagId);
      addTagToService(service3, tagId);

      const result = getServicesByTag([tagId], 'or');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBe(3);
    });
  });

  describe('removeTagFromService', () => {
    it('should remove a tag from a service', () => {
      const serviceId = makeService('My API');
      const tagId = makeTag('production');
      addTagToService(serviceId, tagId);

      const result = removeTagFromService(serviceId, tagId);

      expect(result.ok).toBe(true);

      // Verify it's gone
      const tags = getTagsForService(serviceId);
      expect(tags.ok).toBe(true);
      if (!tags.ok) return;
      expect(tags.data.length).toBe(0);
    });

    it('should return NOT_FOUND when tag is not assigned to service', () => {
      const serviceId = makeService('My API');
      const tagId = makeTag('unlinked');

      const result = removeTagFromService(serviceId, tagId);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  describe('getTagsForService', () => {
    it('should return all tags for a service ordered by name', () => {
      const serviceId = makeService('Tagged Service');
      const tagZ = makeTag('zulu-tag');
      const tagA = makeTag('alpha-tag');
      const tagM = makeTag('mike-tag');

      addTagToService(serviceId, tagZ);
      addTagToService(serviceId, tagA);
      addTagToService(serviceId, tagM);

      const result = getTagsForService(serviceId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBe(3);
      expect(result.data[0].name).toBe('alpha-tag');
      expect(result.data[1].name).toBe('mike-tag');
      expect(result.data[2].name).toBe('zulu-tag');
    });

    it('should return an empty array for a service with no tags', () => {
      const serviceId = makeService('No Tags');

      const result = getTagsForService(serviceId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBe(0);
    });
  });

  // ── Cascade on service deletion ──

  describe('cascade on service deletion', () => {
    it('should remove service-tag associations when a service is deleted', () => {
      const serviceId = makeService('Doomed Service');
      const tagId = makeTag('survivor');
      addTagToService(serviceId, tagId);

      // Delete the service
      deleteService(serviceId);

      // The tag should still exist
      const tag = getTag(tagId);
      expect(tag.ok).toBe(true);

      // But the association should be gone (no services with this tag)
      const services = getServicesByTag([tagId], 'or');
      expect(services.ok).toBe(true);
      if (!services.ok) return;
      expect(services.data.length).toBe(0);
    });
  });

  // ── Filtering by Tags ──

  describe('getServicesByTag', () => {
    it('should return an empty array when no tag IDs are provided', () => {
      const result = getServicesByTag([], 'or');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBe(0);
    });

    describe('OR mode', () => {
      it('should return services matching ANY of the given tags', () => {
        const tagProd = makeTag('production');
        const tagStaging = makeTag('staging');
        const tagDev = makeTag('development');

        const serviceA = makeService('Service A'); // production
        const serviceB = makeService('Service B'); // staging
        const serviceC = makeService('Service C'); // development
        const _serviceD = makeService('Service D'); // no tags

        addTagToService(serviceA, tagProd);
        addTagToService(serviceB, tagStaging);
        addTagToService(serviceC, tagDev);

        // Filter by production OR staging
        const result = getServicesByTag([tagProd, tagStaging], 'or');

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.length).toBe(2);
        expect(result.data).toContain(serviceA);
        expect(result.data).toContain(serviceB);
      });

      it('should not return duplicates when a service matches multiple tags', () => {
        const tag1 = makeTag('tag-one');
        const tag2 = makeTag('tag-two');

        const serviceId = makeService('Multi-tag Service');
        addTagToService(serviceId, tag1);
        addTagToService(serviceId, tag2);

        const result = getServicesByTag([tag1, tag2], 'or');

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.length).toBe(1);
        expect(result.data[0]).toBe(serviceId);
      });

      it('should return services matching a single tag', () => {
        const tagId = makeTag('critical');
        const serviceId = makeService('Critical Service');
        addTagToService(serviceId, tagId);

        makeService('Untagged Service');

        const result = getServicesByTag([tagId], 'or');

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.length).toBe(1);
        expect(result.data[0]).toBe(serviceId);
      });
    });

    describe('AND mode', () => {
      it('should return only services matching ALL given tags', () => {
        const tagProd = makeTag('production');
        const tagCritical = makeTag('critical');

        const serviceA = makeService('Service A'); // production + critical
        const serviceB = makeService('Service B'); // production only
        const _serviceC = makeService('Service C'); // no tags

        addTagToService(serviceA, tagProd);
        addTagToService(serviceA, tagCritical);
        addTagToService(serviceB, tagProd);

        // Filter by production AND critical
        const result = getServicesByTag([tagProd, tagCritical], 'and');

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.length).toBe(1);
        expect(result.data[0]).toBe(serviceA);
      });

      it('should return an empty array when no service matches all tags', () => {
        const tag1 = makeTag('tag-alpha');
        const tag2 = makeTag('tag-bravo');

        const serviceA = makeService('Service A');
        const serviceB = makeService('Service B');

        addTagToService(serviceA, tag1);
        addTagToService(serviceB, tag2);

        const result = getServicesByTag([tag1, tag2], 'and');

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.length).toBe(0);
      });

      it('should work with a single tag (equivalent to OR)', () => {
        const tagId = makeTag('solo');
        const serviceId = makeService('Solo Service');
        addTagToService(serviceId, tagId);

        const result = getServicesByTag([tagId], 'and');

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.length).toBe(1);
        expect(result.data[0]).toBe(serviceId);
      });

      it('should handle three-tag AND filter correctly', () => {
        const tag1 = makeTag('env-prod');
        const tag2 = makeTag('tier-critical');
        const tag3 = makeTag('region-us');

        const serviceA = makeService('Service A'); // all three tags
        const serviceB = makeService('Service B'); // only two tags

        addTagToService(serviceA, tag1);
        addTagToService(serviceA, tag2);
        addTagToService(serviceA, tag3);
        addTagToService(serviceB, tag1);
        addTagToService(serviceB, tag2);

        const result = getServicesByTag([tag1, tag2, tag3], 'and');

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.length).toBe(1);
        expect(result.data[0]).toBe(serviceA);
      });
    });
  });

  // ── Tag Color Defaults ──

  describe('tag color defaults', () => {
    it('should use the provided hex color', () => {
      const result = createTag('custom-color', '#abcdef');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.color).toBe('#abcdef');
    });

    it('should assign the first default color to the first tag', () => {
      const result = createTag('first-tag');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // First default color is '#3b82f6' (blue)
      expect(result.data.color).toBe('#3b82f6');
    });

    it('should assign different default colors to successive tags', () => {
      const result1 = createTag('tag-a');
      const result2 = createTag('tag-b');

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (!result1.ok || !result2.ok) return;
      expect(result1.data.color).not.toBe(result2.data.color);
    });
  });
});
