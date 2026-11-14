const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 4;

const VALID_MODES = new Set([
  '1v1_local',
  '2v2_local',
  '3v3_local',
  '4v4_local',
  '2v2_coop',
  '3v3_coop',
  '4v4_coop',
]);
const VALID_ARENAS = new Set(['classic', 'concrete', 'rooftop']);
const VALID_PITCHES = new Set(['standard', 'large', 'xl']);
const VALID_CONTROLS = new Set(['classic', 'dribble']);
const VALID_KITS = new Set(['garuda', 'cyber', 'tarkam', 'shadow', 'street_lime', 'sunset']);
const VALID_DIFFS = new Set(['rookie', 'pro', 'tarkam']);
const VALID_DURATIONS = new Set([60, 90, 120]);

export interface RelayRoomConfig {
  mode: string;
  arena: string;
  pitchSize: string;
  controlStyle: string;
  teamAKit: string;
  teamBKit: string;
  difficulty: string;
  durationSeconds: number;
  mutatorsEnabled: boolean;
}

export interface RoomSocketAttachment {
  role: 'host' | 'guest';
  code: string;
  createdAt: number;
  config?: RelayRoomConfig;
}

export interface RelaySocketHandle {
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  getAttachment(): RoomSocketAttachment | null;
  setAttachment(attachment: RoomSocketAttachment): void;
}

export interface RelayRoomHost {
  acceptSocket(socket: RelaySocketHandle, tags: string[]): void;
  getSockets(tag?: string): RelaySocketHandle[];
}

export interface UpgradeRejection {
  code: 'ROOM_TAKEN' | 'ROOM_NOT_FOUND' | 'ROOM_FULL' | 'BAD_CONFIG' | 'BAD_REQUEST';
  message: string;
  wsCloseCode: number;
}

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store, max-age=0',
};

export function jsonCorsResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
    },
  });
}

export function sanitizeRelayCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ROOM_CODE_LENGTH);
}

export function isValidRelayCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  for (let i = 0; i < code.length; i++) {
    if (!ROOM_CODE_ALPHABET.includes(code[i])) return false;
  }
  return true;
}

export function sanitizeRelayConfig(raw: unknown): RelayRoomConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const mode = typeof r.mode === 'string' && VALID_MODES.has(r.mode) ? r.mode : null;
  if (!mode) return null;

  const isFour = mode === '4v4_local' || mode === '4v4_coop';
  const pitchSize = isFour
    ? 'xl'
    : typeof r.pitchSize === 'string' && VALID_PITCHES.has(r.pitchSize)
      ? r.pitchSize
      : 'standard';

  return {
    mode,
    arena: typeof r.arena === 'string' && VALID_ARENAS.has(r.arena) ? r.arena : 'classic',
    pitchSize,
    controlStyle:
      typeof r.controlStyle === 'string' && VALID_CONTROLS.has(r.controlStyle)
        ? r.controlStyle
        : 'dribble',
    teamAKit: typeof r.teamAKit === 'string' && VALID_KITS.has(r.teamAKit) ? r.teamAKit : 'garuda',
    teamBKit: typeof r.teamBKit === 'string' && VALID_KITS.has(r.teamBKit) ? r.teamBKit : 'cyber',
    difficulty: typeof r.difficulty === 'string' && VALID_DIFFS.has(r.difficulty) ? r.difficulty : 'pro',
    durationSeconds:
      typeof r.durationSeconds === 'number' && VALID_DURATIONS.has(r.durationSeconds)
        ? r.durationSeconds
        : 90,
    // Must mirror the signaling handler: a missing/non-boolean value defaults to ON, not OFF.
    mutatorsEnabled: typeof r.mutatorsEnabled === 'boolean' ? r.mutatorsEnabled : true,
  };
}

function decodeConfigParam(rawParam: string | null): RelayRoomConfig | null {
  if (!rawParam || rawParam.length > 2048) return null;
  try {
    const parsed = JSON.parse(rawParam) as unknown;
    return sanitizeRelayConfig(parsed);
  } catch {
    return null;
  }
}

function safeCloseSocket(ws: RelaySocketHandle, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // Socket may already be closed
  }
}

/**
 * Pure Durable Object room state machine shared between Cloudflare Workers runtime
 * and Node Vitest verification. All durable room metadata lives inside hibernatable socket attachments.
 */
export class RelayRoomEngine {
  constructor(private readonly host: RelayRoomHost) {}

  handleStatusHttp(code: string): Response {
    const hosts = this.host.getSockets('host');
    if (hosts.length === 0) {
      return jsonCorsResponse(404, {
        error: 'ROOM_NOT_FOUND',
        message: 'Room tidak ditemukan atau sudah ditutup Host.',
      });
    }
    const hostAtt = hosts[0].getAttachment();
    const guests = this.host.getSockets('guest');
    return jsonCorsResponse(200, {
      ok: true,
      code: hostAtt?.code || code,
      createdAt: hostAtt?.createdAt ?? Date.now(),
      config: hostAtt?.config ?? null,
      full: guests.length > 0,
    });
  }

  handleWebSocketConnect(
    url: URL,
    serverSocket: RelaySocketHandle,
    acceptWithoutHibernation: (socket: RelaySocketHandle) => void
  ): UpgradeRejection | null {
    const code = sanitizeRelayCode(url.searchParams.get('code') || '');
    const role = url.searchParams.get('role');
    if (!isValidRelayCode(code) || (role !== 'host' && role !== 'guest')) {
      return this.rejectUpgrade(serverSocket, acceptWithoutHibernation, {
        code: 'BAD_REQUEST',
        message: 'Kode room atau peran WebSocket tidak valid.',
        wsCloseCode: 4000,
      });
    }

    const existingHosts = this.host.getSockets('host');
    const existingGuests = this.host.getSockets('guest');

    if (role === 'host') {
      if (existingHosts.length > 0) {
        return this.rejectUpgrade(serverSocket, acceptWithoutHibernation, {
          code: 'ROOM_TAKEN',
          message: 'Kode room sedang dipakai, membuat ulang...',
          wsCloseCode: 4009,
        });
      }

      const config = decodeConfigParam(url.searchParams.get('cfg'));
      if (!config) {
        return this.rejectUpgrade(serverSocket, acceptWithoutHibernation, {
          code: 'BAD_CONFIG',
          message: 'Konfigurasi match room tidak valid.',
          wsCloseCode: 4001,
        });
      }

      const attachment: RoomSocketAttachment = {
        role: 'host',
        code,
        createdAt: Date.now(),
        config,
      };
      this.host.acceptSocket(serverSocket, ['host']);
      serverSocket.setAttachment(attachment);
      serverSocket.send(
        JSON.stringify({
          t: 'sys_ready',
          role: 'host',
          code,
          config,
        })
      );
      return null;
    }

    // role === 'guest'
    if (existingHosts.length === 0) {
      return this.rejectUpgrade(serverSocket, acceptWithoutHibernation, {
        code: 'ROOM_NOT_FOUND',
        message: 'Room tidak ditemukan atau sudah berakhir.',
        wsCloseCode: 4004,
      });
    }
    if (existingGuests.length > 0) {
      return this.rejectUpgrade(serverSocket, acceptWithoutHibernation, {
        code: 'ROOM_FULL',
        message: 'Room ini sudah penuh.',
        wsCloseCode: 4009,
      });
    }

    const hostAtt = existingHosts[0].getAttachment();
    const roomConfig = hostAtt?.config ?? null;
    const attachment: RoomSocketAttachment = {
      role: 'guest',
      code,
      createdAt: Date.now(),
    };
    this.host.acceptSocket(serverSocket, ['guest']);
    serverSocket.setAttachment(attachment);

    const joinedPayload = JSON.stringify({
      t: 'sys_joined',
      code,
      config: roomConfig,
    });
    serverSocket.send(joinedPayload);
    for (const h of existingHosts) {
      try {
        h.send(joinedPayload);
      } catch {
        // Ignore stale host
      }
    }
    return null;
  }

  private rejectUpgrade(
    socket: RelaySocketHandle,
    acceptWithoutHibernation: (socket: RelaySocketHandle) => void,
    rejection: UpgradeRejection
  ): UpgradeRejection {
    acceptWithoutHibernation(socket);
    try {
      socket.send(
        JSON.stringify({
          t: 'sys_err',
          code: rejection.code,
          message: rejection.message,
        })
      );
    } catch {
      // Ignore send failure during immediate reject
    }
    safeCloseSocket(socket, rejection.wsCloseCode, rejection.code);
    return rejection;
  }

  handleWebSocketMessage(sender: RelaySocketHandle, message: string | ArrayBuffer): void {
    if (typeof message === 'string' && message === 'hb') {
      try {
        sender.send('hb_ack');
      } catch {
        // Ignore
      }
      return;
    }

    const att = sender.getAttachment();
    if (!att) return;

    const targetTag = att.role === 'host' ? 'guest' : 'host';
    const peers = this.host.getSockets(targetTag);
    for (const peer of peers) {
      try {
        peer.send(message);
      } catch {
        // Ignore closing socket
      }
    }
  }

  handleWebSocketClose(ws: RelaySocketHandle, code: number, reason: string): void {
    const att = ws.getAttachment();
    safeCloseSocket(ws, code || 1000, reason || 'closed');
    if (!att) return;

    const targetTag = att.role === 'host' ? 'guest' : 'host';
    const peers = this.host.getSockets(targetTag);
    const leftMsg = JSON.stringify({
      t: 'sys_peer_left',
      role: att.role,
      reason:
        att.role === 'host'
          ? 'Host menutup room atau koneksi terputus.'
          : 'Lawan keluar atau koneksi terputus.',
    });

    for (const peer of peers) {
      if (peer === ws) continue;
      try {
        peer.send(leftMsg);
      } catch {
        // Ignore
      }
      if (att.role === 'host') {
        safeCloseSocket(peer, 1000, 'HOST_LEFT');
      }
    }
  }
}

export interface RoomStubRouter {
  getRoomStatus(code: string, request: Request): Promise<Response>;
  connectWebSocket(code: string, request: Request): Promise<Response>;
}

/** Handles top-level Worker HTTP & WebSocket upgrade routing with CORS enabled. */
export async function routeRelayWorkerRequest(
  request: Request,
  router: RoomStubRouter
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  if (url.pathname === '/' || url.pathname === '/health') {
    return jsonCorsResponse(200, {
      ok: true,
      service: 'no-out-derby-relay',
      transport: 'cloudflare-do-ws',
    });
  }

  if (url.pathname.startsWith('/room/')) {
    const rawCode = decodeURIComponent(url.pathname.slice('/room/'.length));
    const code = sanitizeRelayCode(rawCode);
    if (!isValidRelayCode(code)) {
      return jsonCorsResponse(400, {
        error: 'INVALID_CODE',
        message: 'Kode room harus 4 karakter huruf/angka yang valid.',
      });
    }
    return router.getRoomStatus(code, request);
  }

  if (url.pathname === '/ws') {
    const upgradeHeader = request.headers.get('Upgrade') || '';
    if (upgradeHeader.toLowerCase() !== 'websocket') {
      return jsonCorsResponse(426, {
        error: 'UPGRADE_REQUIRED',
        message: 'Gunakan koneksi WebSocket pada endpoint /ws.',
      });
    }
    const code = sanitizeRelayCode(url.searchParams.get('code') || '');
    if (!isValidRelayCode(code)) {
      return jsonCorsResponse(400, {
        error: 'INVALID_CODE',
        message: 'Kode room harus 4 karakter huruf/angka yang valid.',
      });
    }
    return router.connectWebSocket(code, request);
  }

  return jsonCorsResponse(404, { error: 'NOT_FOUND', message: 'Endpoint tidak ditemukan.' });
}
