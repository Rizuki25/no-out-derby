import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import roomsEndpoint from '../../api/rooms.js';
import {
  handleSignalingRequest,
  type RoomStore,
  sanitizeCandidateList,
} from '../net/SignalingHandler.ts';
import {
  type IceCandidateDTO,
  isValidRoomCode,
  type RoomRecord,
  sanitizeRoomCode,
  type SessionDescriptionDTO,
  toOnlineGameMode,
} from '../net/SignalingTypes.ts';

function createTestStore(configured = true): RoomStore {
  const rooms = new Map<string, RoomRecord>();
  return {
    isConfigured: () => configured,
    async getRoom(code) {
      const r = rooms.get(code);
      return r ? structuredClone(r) : null;
    },
    async createRoomIfAbsent(code, record) {
      if (rooms.has(code)) return false;
      rooms.set(code, structuredClone(record));
      return true;
    },
    async setGuestAnswerIfAbsent(code, answer, guestCandidates) {
      const r = rooms.get(code);
      if (!r || r.guestAnswer) return false;
      r.guestAnswer = answer;
      r.guestCandidates = sanitizeCandidateList(r.guestCandidates, guestCandidates);
      return true;
    },
    async appendCandidate(code, role, candidate) {
      const r = rooms.get(code);
      if (!r) return;
      if (role === 'host') {
        r.hostCandidates = sanitizeCandidateList(r.hostCandidates, [candidate]);
      } else {
        r.guestCandidates = sanitizeCandidateList(r.guestCandidates, [candidate]);
      }
    },
    async deleteRoom(code) {
      rooms.delete(code);
    },
  };
}

const SAMPLE_OFFER: SessionDescriptionDTO = {
  type: 'offer',
  sdp: 'v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n',
};

const SAMPLE_ANSWER: SessionDescriptionDTO = {
  type: 'answer',
  sdp: 'v=0\r\no=- 456 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n',
};

const SAMPLE_CAND: IceCandidateDTO = {
  candidate: 'candidate:1 1 UDP 2122252543 192.0.2.1 54321 typ host',
  sdpMid: '0',
  sdpMLineIndex: 0,
};

function makeReq(pathAndQuery: string, method = 'GET', body?: unknown): Request {
  return new Request(`https://no-out-derby.vercel.app${pathAndQuery}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('Online Room Signaling & Validation', () => {
  it('returns 503 REDIS_NOT_CONFIGURED on api/rooms.ts when Redis env vars are absent', async () => {
    const prevUrl = process.env.UPSTASH_REDIS_REST_URL;
    const prevToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    const prevKvUrl = process.env.KV_REST_API_URL;
    const prevKvToken = process.env.KV_REST_API_TOKEN;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;

    try {
      const res = await roomsEndpoint.fetch(makeReq('/api/rooms?code=ABCD', 'GET'));
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('REDIS_NOT_CONFIGURED');
    } finally {
      if (prevUrl !== undefined) process.env.UPSTASH_REDIS_REST_URL = prevUrl;
      if (prevToken !== undefined) process.env.UPSTASH_REDIS_REST_TOKEN = prevToken;
      if (prevKvUrl !== undefined) process.env.KV_REST_API_URL = prevKvUrl;
      if (prevKvToken !== undefined) process.env.KV_REST_API_TOKEN = prevKvToken;
    }
  });

  it('creates room, enforces 4v4 XL pitch, strips hostSecret on GET, joins once, and blocks second guest with 409', async () => {
    const store = createTestStore(true);

    const createRes = await handleSignalingRequest(
      makeReq('/api/rooms', 'POST', {
        action: 'create',
        config: {
          mode: '4v4_local',
          arena: 'concrete',
          pitchSize: 'standard',
          controlStyle: 'dribble',
          teamAKit: 'garuda',
          teamBKit: 'cyber',
          difficulty: 'pro',
          durationSeconds: 90,
          mutatorsEnabled: true,
        },
        hostOffer: SAMPLE_OFFER,
        hostCandidates: [SAMPLE_CAND],
      }),
      store
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      code: string;
      hostSecret: string;
      expiresInSeconds: number;
    };
    expect(isValidRoomCode(created.code)).toBe(true);
    expect(created.hostSecret.length).toBeGreaterThan(8);

    // Lowercase GET normalizes code and strips secret
    const getRes = await handleSignalingRequest(
      makeReq(`/api/rooms?code=${created.code.toLowerCase()}`, 'GET'),
      store
    );
    expect(getRes.status).toBe(200);
    const pub = (await getRes.json()) as Record<string, unknown>;
    expect(pub.hostSecret).toBeUndefined();
    expect((pub.config as { pitchSize: string }).pitchSize).toBe('xl');

    // Join succeeds once
    const joinRes1 = await handleSignalingRequest(
      makeReq('/api/rooms', 'POST', {
        action: 'join',
        code: created.code,
        guestAnswer: SAMPLE_ANSWER,
        guestCandidates: [SAMPLE_CAND],
      }),
      store
    );
    expect(joinRes1.status).toBe(200);

    // Second guest gets 409 ROOM_FULL
    const joinRes2 = await handleSignalingRequest(
      makeReq('/api/rooms', 'POST', {
        action: 'join',
        code: created.code,
        guestAnswer: SAMPLE_ANSWER,
      }),
      store
    );
    expect(joinRes2.status).toBe(409);
  });

  it('supports trickle candidate deduplication and authenticated room closure', async () => {
    const store = createTestStore(true);
    const createRes = await handleSignalingRequest(
      makeReq('/api/rooms', 'POST', {
        action: 'create',
        config: {
          mode: '2v2_coop',
          arena: 'rooftop',
          pitchSize: 'large',
          controlStyle: 'dribble',
          teamAKit: 'garuda',
          teamBKit: 'cyber',
          difficulty: 'tarkam',
          durationSeconds: 120,
          mutatorsEnabled: false,
        },
        hostOffer: SAMPLE_OFFER,
      }),
      store
    );
    const created = (await createRes.json()) as { code: string; hostSecret: string };

    // Post same candidate twice -> stored once
    for (let i = 0; i < 2; i++) {
      const cRes = await handleSignalingRequest(
        makeReq('/api/rooms', 'POST', {
          action: 'candidate',
          code: created.code,
          role: 'guest',
          candidate: SAMPLE_CAND,
        }),
        store
      );
      expect(cRes.status).toBe(200);
    }

    const roomAfterCand = await store.getRoom(created.code);
    expect(roomAfterCand?.guestCandidates).toHaveLength(1);

    // Wrong secret rejected with 403
    const badClose = await handleSignalingRequest(
      makeReq('/api/rooms', 'POST', {
        action: 'close',
        code: created.code,
        hostSecret: 'wrong-secret',
      }),
      store
    );
    expect(badClose.status).toBe(403);

    // Right secret deletes room -> 404 on subsequent lookup
    const goodClose = await handleSignalingRequest(
      makeReq('/api/rooms', 'POST', {
        action: 'close',
        code: created.code,
        hostSecret: created.hostSecret,
      }),
      store
    );
    expect(goodClose.status).toBe(200);

    const afterDelete = await handleSignalingRequest(
      makeReq(`/api/rooms?code=${created.code}`, 'GET'),
      store
    );
    expect(afterDelete.status).toBe(404);
  });

  it('sanitizes codes and maps menu modes to supported online modes', () => {
    expect(sanitizeRoomCode(' k7-m9x ')).toBe('K7M9');
    expect(isValidRoomCode('O0I1')).toBe(false);
    expect(isValidRoomCode('K7M9')).toBe(true);
    expect(toOnlineGameMode('derby_cup_4v4')).toBe('4v4_local');
    expect(toOnlineGameMode('3v3_coop')).toBe('3v3_coop');
    expect(toOnlineGameMode('1v1_ai')).toBe('1v1_local');
  });

  it('uses explicit .js extensions for all serverless ESM relative imports required by Vercel Node runtime', () => {
    const serverFiles = [
      'api/rooms.ts',
      'src/net/SignalingHandler.ts',
      'src/net/SignalingTypes.ts',
      'src/net/UpstashRoomStore.ts',
    ];
    for (const relPath of serverFiles) {
      const source = readFileSync(resolve(process.cwd(), relPath), 'utf8');
      const info = ts.preProcessFile(source, true, true);
      for (const imp of info.importedFiles) {
        if (imp.fileName.startsWith('./') || imp.fileName.startsWith('../')) {
          expect(
            imp.fileName.endsWith('.js'),
            `${relPath} imports '${imp.fileName}' without .js extension (breaks Vercel Node ESM)`
          ).toBe(true);
        }
      }
    }
  });
});
