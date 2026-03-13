/**
 * StatusOwl — Server Entry Point
 */

import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, getLogger } from './core/index.js';
import { getDb, closeDb } from './storage/index.js';
import { startScheduler, stopScheduler } from './monitors/index.js';
import { startDailyAggregator, stopDailyAggregator } from './monitors/daily-aggregator.js';
import { router } from './api/routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = loadConfig();
const log = getLogger();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Status page static files
app.use(express.static('src/status-page'));

// Serve index.html for root path
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'status-page', 'index.html'));
});

// API routes
app.use(router);

// Health endpoint
app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Initialize database
getDb();

// Start monitoring scheduler and daily aggregator
startScheduler();
startDailyAggregator();

const server = app.listen(config.port, config.host, () => {
  log.info({ port: config.port, host: config.host }, 'StatusOwl server started');
});

// Graceful shutdown
function shutdown() {
  log.info('Shutting down...');
  stopScheduler();
  stopDailyAggregator();
  server.close();
  closeDb();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
