import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });
loadEnv();

import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { RedisPresence } from '@colyseus/redis-presence';
import cors from 'cors';
import express from 'express';
import { prisma } from '@kampi/database';
import { env } from './config.js';
import { LobbyRoom } from './rooms/lobby-room.js';
import { RpsRoom } from './rooms/rps-room.js';

const app = express();
app.use(cors({ origin: env.WEB_ORIGIN }));
app.use(express.json());

app.get('/health/live', (_req, res) => {
  res.json({ status: 'ok', service: 'realtime' });
});

app.get('/health/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready', service: 'realtime' });
  } catch {
    res.status(503).json({ status: 'not_ready', service: 'realtime' });
  }
});

const gameServer = new Server({
  transport: new WebSocketTransport({
    server: app.listen(env.REALTIME_PORT, () => {
      console.info(`Realtime listening on port ${env.REALTIME_PORT}`);
    }),
  }),
  presence: new RedisPresence(env.REDIS_URL),
});

gameServer.define('lobby', LobbyRoom);
gameServer.define('rps', RpsRoom);

process.on('SIGINT', async () => {
  await gameServer.gracefullyShutdown(false);
  await prisma.$disconnect();
  process.exit(0);
});
