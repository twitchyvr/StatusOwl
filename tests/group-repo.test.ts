/**
 * Service Group Repository Tests
 */

import { describe, it, expect } from 'vitest';
import { createGroup, getGroup, listGroups, updateGroup, deleteGroup } from '../src/storage/index.js';

describe('Group Repository', () => {
  describe('createGroup', () => {
    it('creates a group with required fields', () => {
      const result = createGroup({ name: 'Infrastructure' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.name).toBe('Infrastructure');
      expect(result.data.description).toBe('');
      expect(result.data.sortOrder).toBe(0);
      expect(result.data.collapsed).toBe(false);
      expect(result.data.id).toBeDefined();
    });

    it('creates a group with all fields', () => {
      const result = createGroup({
        name: 'APIs',
        description: 'All API services',
        sortOrder: 5,
        collapsed: true,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.name).toBe('APIs');
      expect(result.data.description).toBe('All API services');
      expect(result.data.sortOrder).toBe(5);
      expect(result.data.collapsed).toBe(true);
    });
  });

  describe('getGroup', () => {
    it('returns a group by id', () => {
      const created = createGroup({ name: 'Backend' });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = getGroup(created.data.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.name).toBe('Backend');
    });

    it('returns NOT_FOUND for missing group', () => {
      const result = getGroup('00000000-0000-0000-0000-000000000000');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  describe('listGroups', () => {
    it('returns all groups ordered by sort_order', () => {
      createGroup({ name: 'Z-Group', sortOrder: 10 });
      createGroup({ name: 'A-Group', sortOrder: 1 });

      const result = listGroups();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.length).toBeGreaterThanOrEqual(2);
      // Verify ordering: lower sort_order first
      const names = result.data.map(g => g.name);
      const zIdx = names.indexOf('Z-Group');
      const aIdx = names.indexOf('A-Group');
      expect(aIdx).toBeLessThan(zIdx);
    });
  });

  describe('updateGroup', () => {
    it('updates group name', () => {
      const created = createGroup({ name: 'Old Name' });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = updateGroup(created.data.id, { name: 'New Name' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.name).toBe('New Name');
    });

    it('updates multiple fields', () => {
      const created = createGroup({ name: 'Test' });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = updateGroup(created.data.id, {
        description: 'Updated desc',
        sortOrder: 99,
        collapsed: true,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.description).toBe('Updated desc');
      expect(result.data.sortOrder).toBe(99);
      expect(result.data.collapsed).toBe(true);
    });

    it('returns NOT_FOUND for missing group', () => {
      const result = updateGroup('00000000-0000-0000-0000-000000000000', { name: 'X' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });

    it('returns current group when no updates provided', () => {
      const created = createGroup({ name: 'No Change' });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = updateGroup(created.data.id, {});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.name).toBe('No Change');
    });
  });

  describe('deleteGroup', () => {
    it('deletes an existing group', () => {
      const created = createGroup({ name: 'To Delete' });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = deleteGroup(created.data.id);
      expect(result.ok).toBe(true);

      // Verify it's gone
      const get = getGroup(created.data.id);
      expect(get.ok).toBe(false);
    });

    it('returns NOT_FOUND for missing group', () => {
      const result = deleteGroup('00000000-0000-0000-0000-000000000000');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });
});
