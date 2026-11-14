import { Redis } from '@upstash/redis';
import {
  type RoomStore,
  sanitizeCandidateList,
} from './SignalingHandler.js';
import {
  type IceCandidateDTO,
  MAX_CANDIDATES_PER_SIDE,
  type RoomRecord,
  type SessionDescriptionDTO,
} from './SignalingTypes.js';

interface BaseRoomPayload {
  code: string;
  hostSecret: string;
  createdAt: number;
  config: RoomRecord['config'];
  hostOffer: RoomRecord['hostOffer'];
}

function keyBase(code: string): string {
  return `nod:room:${code}:base`;
}
function keyAns(code: string): string {
  return `nod:room:${code}:ans`;
}
function keyCand(code: string, role: 'host' | 'guest'): string {
  return `nod:room:${code}:${role === 'host' ? 'hc' : 'gc'}`;
}

/**
 * Shared atomic Redis-backed RoomStore powered by Upstash Redis.
 * Uses NX + TTL keys so room allocation and guest claims are race-free across serverless instances.
 */
export function createUpstashRoomStore(url?: string, token?: string): RoomStore {
  const redis = url && token ? new Redis({ url, token }) : null;

  return {
    isConfigured(): boolean {
      return redis !== null;
    },

    async getRoom(code: string): Promise<RoomRecord | null> {
      if (!redis) return null;
      const [base, ans, hcRaw, gcRaw] = await Promise.all([
        redis.get<BaseRoomPayload>(keyBase(code)),
        redis.get<SessionDescriptionDTO>(keyAns(code)),
        redis.lrange<IceCandidateDTO>(keyCand(code, 'host'), 0, MAX_CANDIDATES_PER_SIDE - 1),
        redis.lrange<IceCandidateDTO>(keyCand(code, 'guest'), 0, MAX_CANDIDATES_PER_SIDE - 1),
      ]);
      if (!base) return null;
      return {
        code: base.code,
        hostSecret: base.hostSecret,
        createdAt: base.createdAt,
        config: base.config,
        hostOffer: base.hostOffer,
        hostCandidates: sanitizeCandidateList([], hcRaw),
        guestAnswer: ans ?? null,
        guestCandidates: sanitizeCandidateList([], gcRaw),
      };
    },

    async createRoomIfAbsent(
      code: string,
      record: RoomRecord,
      ttlSeconds: number
    ): Promise<boolean> {
      if (!redis) return false;
      const base: BaseRoomPayload = {
        code: record.code,
        hostSecret: record.hostSecret,
        createdAt: record.createdAt,
        config: record.config,
        hostOffer: record.hostOffer,
      };
      const res = await redis.set(keyBase(code), base, { nx: true, ex: ttlSeconds });
      if (res !== 'OK') return false;

      if (record.hostCandidates.length > 0) {
        const candKey = keyCand(code, 'host');
        await redis.rpush(candKey, ...record.hostCandidates);
        await redis.expire(candKey, ttlSeconds);
      }
      return true;
    },

    async setGuestAnswerIfAbsent(
      code: string,
      answer: SessionDescriptionDTO,
      guestCandidates: IceCandidateDTO[],
      ttlSeconds: number
    ): Promise<boolean> {
      if (!redis) return false;
      const res = await redis.set(keyAns(code), answer, { nx: true, ex: ttlSeconds });
      if (res !== 'OK') return false;

      await redis.expire(keyBase(code), ttlSeconds);
      if (guestCandidates.length > 0) {
        const candKey = keyCand(code, 'guest');
        await redis.rpush(candKey, ...guestCandidates.slice(0, MAX_CANDIDATES_PER_SIDE));
        await redis.expire(candKey, ttlSeconds);
      }
      return true;
    },

    async appendCandidate(
      code: string,
      role: 'host' | 'guest',
      candidate: IceCandidateDTO,
      ttlSeconds: number
    ): Promise<void> {
      if (!redis) return;
      const candKey = keyCand(code, role);
      const len = await redis.rpush(candKey, candidate);
      if (len > MAX_CANDIDATES_PER_SIDE) {
        await redis.ltrim(candKey, 0, MAX_CANDIDATES_PER_SIDE - 1);
      }
      await Promise.all([
        redis.expire(candKey, ttlSeconds),
        redis.expire(keyBase(code), ttlSeconds),
      ]);
    },

    async deleteRoom(code: string): Promise<void> {
      if (!redis) return;
      await redis.del(
        keyBase(code),
        keyAns(code),
        keyCand(code, 'host'),
        keyCand(code, 'guest')
      );
    },
  };
}
