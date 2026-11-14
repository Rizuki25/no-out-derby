import {
  generateRoomCode,
  IceCandidateDTO,
  isValidRoomCode,
  MAX_CANDIDATES_PER_SIDE,
  ONLINE_MODE_OPTIONS,
  OnlineGameMode,
  OnlineRoomConfig,
  PublicRoomState,
  ROOM_TTL_SECONDS,
  RoomRecord,
  sanitizeRoomCode,
  SessionDescriptionDTO,
} from './SignalingTypes';
import {
  AIDifficulty,
  ArenaId,
  ControlStyle,
  MatchDurationOption,
  PitchSize,
  TeamKitId,
} from '../types';

export interface RoomStore {
  isConfigured(): boolean;
  getRoom(code: string): Promise<RoomRecord | null>;
  createRoomIfAbsent(code: string, record: RoomRecord, ttlSeconds: number): Promise<boolean>;
  setGuestAnswerIfAbsent(
    code: string,
    answer: SessionDescriptionDTO,
    guestCandidates: IceCandidateDTO[],
    ttlSeconds: number
  ): Promise<boolean>;
  appendCandidate(
    code: string,
    role: 'host' | 'guest',
    candidate: IceCandidateDTO,
    ttlSeconds: number
  ): Promise<void>;
  deleteRoom(code: string): Promise<void>;
}

const VALID_ONLINE_MODES = new Set<string>(ONLINE_MODE_OPTIONS.map((o) => o.value));
const VALID_ARENAS = new Set<string>(['classic', 'concrete', 'rooftop']);
const VALID_PITCH_SIZES = new Set<string>(['standard', 'large', 'xl']);
const VALID_CONTROLS = new Set<string>(['classic', 'dribble']);
const VALID_KITS = new Set<string>([
  'garuda',
  'cyber',
  'tarkam',
  'shadow',
  'street_lime',
  'sunset',
]);
const VALID_DIFFICULTIES = new Set<string>(['rookie', 'pro', 'tarkam']);
const VALID_DURATIONS = new Set<number>([60, 90, 120]);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

function createHostSecret(): string {
  const randomUuid =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return randomUuid.replace(/-/g, '');
}

function validateConfig(raw: unknown): OnlineRoomConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const mode =
    typeof r.mode === 'string' && VALID_ONLINE_MODES.has(r.mode)
      ? (r.mode as OnlineGameMode)
      : null;
  const arena =
    typeof r.arena === 'string' && VALID_ARENAS.has(r.arena) ? (r.arena as ArenaId) : 'classic';
  const pitchSize =
    typeof r.pitchSize === 'string' && VALID_PITCH_SIZES.has(r.pitchSize)
      ? (r.pitchSize as PitchSize)
      : 'standard';
  const controlStyle =
    typeof r.controlStyle === 'string' && VALID_CONTROLS.has(r.controlStyle)
      ? (r.controlStyle as ControlStyle)
      : 'dribble';
  const teamAKit =
    typeof r.teamAKit === 'string' && VALID_KITS.has(r.teamAKit)
      ? (r.teamAKit as TeamKitId)
      : 'garuda';
  const teamBKit =
    typeof r.teamBKit === 'string' && VALID_KITS.has(r.teamBKit)
      ? (r.teamBKit as TeamKitId)
      : 'cyber';
  const difficulty =
    typeof r.difficulty === 'string' && VALID_DIFFICULTIES.has(r.difficulty)
      ? (r.difficulty as AIDifficulty)
      : 'pro';
  const durationSeconds =
    typeof r.durationSeconds === 'number' && VALID_DURATIONS.has(r.durationSeconds)
      ? (r.durationSeconds as MatchDurationOption)
      : 90;
  const mutatorsEnabled = typeof r.mutatorsEnabled === 'boolean' ? r.mutatorsEnabled : true;

  if (!mode) return null;
  const resolvedPitch: PitchSize =
    mode === '4v4_local' || mode === '4v4_coop' ? 'xl' : pitchSize;

  return {
    mode,
    arena,
    pitchSize: resolvedPitch,
    controlStyle,
    teamAKit,
    teamBKit,
    difficulty,
    durationSeconds,
    mutatorsEnabled,
  };
}

function validateSdp(
  raw: unknown,
  expectedType: 'offer' | 'answer'
): SessionDescriptionDTO | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.type !== expectedType) return null;
  if (typeof r.sdp !== 'string' || r.sdp.length < 16 || r.sdp.length > 32768) return null;
  return { type: expectedType, sdp: r.sdp };
}

export function validateCandidate(raw: unknown): IceCandidateDTO | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.candidate !== 'string' || r.candidate.length > 2048) return null;
  const sdpMid = typeof r.sdpMid === 'string' || r.sdpMid === null ? r.sdpMid : undefined;
  const sdpMLineIndex =
    typeof r.sdpMLineIndex === 'number' || r.sdpMLineIndex === null ? r.sdpMLineIndex : undefined;
  const usernameFragment =
    typeof r.usernameFragment === 'string' || r.usernameFragment === null
      ? r.usernameFragment
      : undefined;
  return {
    candidate: r.candidate,
    sdpMid,
    sdpMLineIndex,
    usernameFragment,
  };
}

export function sanitizeCandidateList(
  target: IceCandidateDTO[],
  incoming: unknown
): IceCandidateDTO[] {
  if (!Array.isArray(incoming)) return target;
  const existing = new Set(
    target.map((c) => `${c.candidate}|${c.sdpMid ?? ''}|${c.sdpMLineIndex ?? ''}`)
  );
  const next = [...target];
  for (const item of incoming) {
    if (next.length >= MAX_CANDIDATES_PER_SIDE) break;
    const valid = validateCandidate(item);
    if (!valid) continue;
    const key = `${valid.candidate}|${valid.sdpMid ?? ''}|${valid.sdpMLineIndex ?? ''}`;
    if (!existing.has(key)) {
      existing.add(key);
      next.push(valid);
    }
  }
  return next;
}

function toPublicRoomState(record: RoomRecord): PublicRoomState {
  return {
    code: record.code,
    createdAt: record.createdAt,
    config: record.config,
    hostOffer: record.hostOffer,
    hostCandidates: record.hostCandidates,
    guestAnswer: record.guestAnswer,
    guestCandidates: record.guestCandidates,
  };
}

/** Handles WebRTC room creation, lookup, joining, ICE exchange, and cleanup. */
export async function handleSignalingRequest(
  request: Request,
  store: RoomStore
): Promise<Response> {
  if (!store.isConfigured()) {
    return jsonResponse(503, {
      error: 'REDIS_NOT_CONFIGURED',
      message:
        'Signaling Redis belum dikonfigurasi di Vercel. Hubungkan Upstash Redis di Vercel Dashboard -> Stores.',
    });
  }

  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (method === 'GET') {
    const code = sanitizeRoomCode(url.searchParams.get('code') ?? '');
    if (!isValidRoomCode(code)) {
      return jsonResponse(400, {
        error: 'INVALID_CODE',
        message: 'Kode room harus 4 karakter valid.',
      });
    }
    const room = await store.getRoom(code);
    if (!room) {
      return jsonResponse(404, {
        error: 'ROOM_NOT_FOUND',
        message: 'Room tidak ditemukan atau sudah kedaluwarsa.',
      });
    }
    return jsonResponse(200, toPublicRoomState(room));
  }

  if (method !== 'POST') {
    return jsonResponse(405, {
      error: 'METHOD_NOT_ALLOWED',
      message: 'Gunakan GET atau POST untuk /api/rooms.',
    });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object') {
      return jsonResponse(400, { error: 'INVALID_BODY', message: 'Payload JSON tidak valid.' });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonResponse(400, { error: 'INVALID_JSON', message: 'Body harus berupa JSON valid.' });
  }

  const action = body.action;

  if (action === 'create') {
    const config = validateConfig(body.config);
    const hostOffer = validateSdp(body.hostOffer, 'offer');
    if (!config || !hostOffer) {
      return jsonResponse(400, {
        error: 'INVALID_CREATE_PAYLOAD',
        message: 'Konfigurasi room atau SDP offer host tidak valid.',
      });
    }

    const hostCandidates = sanitizeCandidateList([], body.hostCandidates);
    const hostSecret = createHostSecret();
    const createdAt = Date.now();

    for (let attempt = 0; attempt < 8; attempt++) {
      const code = generateRoomCode();
      const record: RoomRecord = {
        code,
        hostSecret,
        createdAt,
        config,
        hostOffer,
        hostCandidates,
        guestAnswer: null,
        guestCandidates: [],
      };
      const allocated = await store.createRoomIfAbsent(code, record, ROOM_TTL_SECONDS);
      if (allocated) {
        return jsonResponse(201, {
          code,
          hostSecret,
          expiresInSeconds: ROOM_TTL_SECONDS,
        });
      }
    }

    return jsonResponse(503, {
      error: 'ROOM_ALLOCATION_FAILED',
      message: 'Gagal membuat kode room unik. Silakan coba lagi.',
    });
  }

  const code = sanitizeRoomCode(typeof body.code === 'string' ? body.code : '');
  if (!isValidRoomCode(code)) {
    return jsonResponse(400, {
      error: 'INVALID_CODE',
      message: 'Kode room tidak valid.',
    });
  }

  const room = await store.getRoom(code);
  if (!room) {
    return jsonResponse(404, {
      error: 'ROOM_NOT_FOUND',
      message: 'Room tidak ditemukan atau sudah kedaluwarsa.',
    });
  }

  if (action === 'join') {
    const guestAnswer = validateSdp(body.guestAnswer, 'answer');
    if (!guestAnswer) {
      return jsonResponse(400, {
        error: 'INVALID_ANSWER',
        message: 'SDP answer guest tidak valid.',
      });
    }
    const guestCandidates = sanitizeCandidateList([], body.guestCandidates);
    const claimed = await store.setGuestAnswerIfAbsent(
      code,
      guestAnswer,
      guestCandidates,
      ROOM_TTL_SECONDS
    );
    if (!claimed) {
      return jsonResponse(409, {
        error: 'ROOM_FULL',
        message: 'Room sudah terisi oleh pemain lain.',
      });
    }
    const updated = await store.getRoom(code);
    return jsonResponse(200, {
      ok: true,
      room: toPublicRoomState(
        updated ?? { ...room, guestAnswer, guestCandidates }
      ),
    });
  }

  if (action === 'candidate') {
    const role = body.role;
    if (role !== 'host' && role !== 'guest') {
      return jsonResponse(400, {
        error: 'INVALID_ROLE',
        message: 'Role ICE harus host atau guest.',
      });
    }
    const candidate = validateCandidate(body.candidate);
    if (!candidate) {
      return jsonResponse(400, {
        error: 'INVALID_CANDIDATE',
        message: 'ICE candidate tidak valid.',
      });
    }
    await store.appendCandidate(code, role, candidate, ROOM_TTL_SECONDS);
    return jsonResponse(200, { ok: true });
  }

  if (action === 'close') {
    if (typeof body.hostSecret !== 'string' || body.hostSecret !== room.hostSecret) {
      return jsonResponse(403, { error: 'FORBIDDEN', message: 'Host secret tidak cocok.' });
    }
    await store.deleteRoom(code);
    return jsonResponse(200, { ok: true });
  }

  return jsonResponse(400, {
    error: 'UNKNOWN_ACTION',
    message: 'Action signaling tidak dikenali.',
  });
}
