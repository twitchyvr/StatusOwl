/**
 * Test Setup
 * 
 * Sets up in-memory SQLite database for testing.
 * Uses process.env to configure database before any imports.
 */

import { beforeAll, afterAll } from 'vitest';

// Set environment variables before any imports
// Use 'error' to minimize log noise (not 'silent' which is not a valid level)
process.env.DB_PATH = ':memory:';
process.env.LOG_LEVEL = 'error';

beforeAll(async () => {
  // Import after setting env to get the in-memory DB
  const { getDb } = await import('../src/storage/database.js');
  getDb();
});

afterAll(async () => {
  const { closeDb } = await import('../src/storage/database.js');
  closeDb();
});
