// vitest/config re-exports Vite's defineConfig with the `test` field typed.
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  handleSignalingRequest,
  sanitizeCandidateList,
  type RoomStore,
} from './src/net/SignalingHandler';
import { createUpstashRoomStore } from './src/net/UpstashRoomStore';
import type { IceCandidateDTO, RoomRecord, SessionDescriptionDTO } from './src/net/SignalingTypes';

/**
 * Dev-only Vite middleware store used strictly during `npm run dev` when local `.env.local`
 * does not configure Upstash Redis yet. Production deployments always run `api/rooms.ts`.
 */
function createViteDevRoomStore(env: Record<string, string>): RoomStore {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (url && token) {
    return createUpstashRoomStore(url, token);
  }

  const devRooms = new Map<string, { record: RoomRecord; expiresAt: number }>();
  const purgeExpired = (code: string): RoomRecord | null => {
    const entry = devRooms.get(code);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      devRooms.delete(code);
      return null;
    }
    return entry.record;
  };

  return {
    isConfigured: () => true,
    async getRoom(code) {
      const r = purgeExpired(code);
      return r ? structuredClone(r) : null;
    },
    async createRoomIfAbsent(code, record, ttlSeconds) {
      if (purgeExpired(code)) return false;
      devRooms.set(code, {
        record: structuredClone(record),
        expiresAt: Date.now() + ttlSeconds * 1000,
      });
      return true;
    },
    async setGuestAnswerIfAbsent(
      code: string,
      answer: SessionDescriptionDTO,
      guestCandidates: IceCandidateDTO[],
      ttlSeconds: number
    ) {
      const entry = devRooms.get(code);
      if (!entry || entry.record.guestAnswer) return false;
      entry.record.guestAnswer = answer;
      entry.record.guestCandidates = sanitizeCandidateList(
        entry.record.guestCandidates,
        guestCandidates
      );
      entry.expiresAt = Date.now() + ttlSeconds * 1000;
      return true;
    },
    async appendCandidate(code, role, candidate, ttlSeconds) {
      const entry = devRooms.get(code);
      if (!entry) return;
      if (role === 'host') {
        entry.record.hostCandidates = sanitizeCandidateList(entry.record.hostCandidates, [
          candidate,
        ]);
      } else {
        entry.record.guestCandidates = sanitizeCandidateList(entry.record.guestCandidates, [
          candidate,
        ]);
      }
      entry.expiresAt = Date.now() + ttlSeconds * 1000;
    },
    async deleteRoom(code) {
      devRooms.delete(code);
    },
  };
}

function attachDevSignalingPlugin(mode: string) {
  return {
    name: 'dev-webrtc-signaling',
    configureServer(server: {
      middlewares: {
        use: (
          route: string,
          handler: (
          req: IncomingMessage & { originalUrl?: string },
          res: ServerResponse,
          next: () => void
        ) => void | Promise<void>
        ) => void;
      };
    }) {
      const env = loadEnv(mode, process.cwd(), '');
      const store = createViteDevRoomStore(env);
      server.middlewares.use('/api/rooms', async (req, res, next) => {
        if (!req.url) return next();
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
          }
          const bodyStr = Buffer.concat(chunks).toString('utf8');
          const rawUrl = req.originalUrl || `/api/rooms${req.url}`;
          const fullUrl = `http://${req.headers.host || 'localhost'}${rawUrl}`;
          const method = req.method || 'GET';
          const request = new Request(fullUrl, {
            method,
            headers: req.headers as Record<string, string>,
            body: method === 'GET' || method === 'HEAD' ? undefined : bodyStr || undefined,
          });
          const response = await handleSignalingRequest(request, store);
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(await response.text());
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'INTERNAL_ERROR', message: String(err) }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [attachDevSignalingPlugin(mode)],
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
  },
}));
