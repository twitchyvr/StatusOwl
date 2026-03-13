/**
 * StatusOwl — Server Entry Point
 */

import express from 'express';
import cors from 'cors';
import { loadConfig, getLogger } from './core/index.js';
import { getDb, closeDb } from './storage/index.js';
import { startScheduler, stopScheduler } from './monitors/index.js';
import { router } from './api/routes.js';

const config = loadConfig();
const log = getLogger();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// API routes
app.use(router);

// Health endpoint
app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Initialize database
getDb();

// Start monitoring scheduler
startScheduler();

const server = app.listen(config.port, config.host, () => {
  log.info({ port: config.port, host: config.host }, 'StatusOwl server started');
});

// Graceful shutdown
function shutdown() {
  log.info('Shutting down...');
  stopScheduler();
  server.close();
  closeDb();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
