import { normalizeRelayUrls, type NormalizedRelayUrls } from './IceConfig.ts';
import type {
  NetInputPacket,
  NetPingMessage,
  NetReliableMessage,
  NetStateSnapshot,
} from './NetSnapshot.ts';
import {
  DEFAULT_STUN_SERVERS,
  type IceServersResponse,
  type OnlineRoomConfig,
  type PublicRoomState,
  sanitizeRoomCode,
} from './SignalingTypes.ts';

export type PeerConnectionPhase =
  | 'idle'
  | 'creating'
  | 'waiting_guest'
  | 'joining'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export type TransportKind = 'cloudflare-ws' | 'webrtc-p2p';

export interface PeerCallbacks {
  onPhaseChange?: (phase: PeerConnectionPhase, detail?: string) => void;
  onRoomCodeReady?: (code: string) => void;
  onConfigReady?: (config: OnlineRoomConfig) => void;
  onConnected?: (config: OnlineRoomConfig, transport: TransportKind) => void;
  onUnreliableMessage?: (msg: NetInputPacket | NetStateSnapshot | NetPingMessage) => void;
  onReliableMessage?: (msg: NetReliableMessage) => void;
  onPingUpdate?: (pingMs: number) => void;
  onDisconnected?: (reason: string) => void;
  onError?: (code: string, message: string) => void;
}

export interface NetPeerTransport {
  readonly transportKind: TransportKind;
  hostRoom(config: OnlineRoomConfig): Promise<void>;
  joinRoom(code: string): Promise<void>;
  isDataOpen(): boolean;
  sendUnreliable(msg: NetInputPacket | NetStateSnapshot | NetPingMessage): void;
  sendReliable(msg: NetReliableMessage): void;
  close(notifyPeer?: boolean): void;
}

export interface OnlineRoomPreview {
  code: string;
  createdAt: number;
  config: OnlineRoomConfig;
  full: boolean;
}

export class SignalingError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export async function signalingFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const errCode = typeof data.error === 'string' ? data.error : `HTTP_${res.status}`;
    const errMsg =
      typeof data.message === 'string'
        ? data.message
        : `Gagal menghubungi server (${res.status})`;
    throw new SignalingError(errCode, errMsg);
  }
  return data as T;
}

export function getBuildTimeRelayUrls(): NormalizedRelayUrls | null {
  try {
    const metaEnv = (import.meta as { env?: Record<string, string | undefined> }).env;
    return normalizeRelayUrls(metaEnv?.VITE_RELAY_URL);
  } catch {
    return null;
  }
}

let cachedConnConfig: { value: IceServersResponse; expiresAt: number } | null = null;
const CONN_CONFIG_TTL_MS = 60_000;

/** Clears cached connection config (primarily for isolated tests). */
export function clearConnectionConfigCache(): void {
  cachedConnConfig = null;
}

/**
 * Fetches server connection capabilities (`/api/rooms?ice=1`), resolving either Cloudflare
 * WebSocket relay URLs (`relayWsUrl`) or STUN/TURN fallback configuration.
 */
export async function fetchConnectionConfig(signal?: AbortSignal): Promise<IceServersResponse> {
  const buildRelay = getBuildTimeRelayUrls();
  if (cachedConnConfig && Date.now() < cachedConnConfig.expiresAt) {
    return cachedConnConfig.value;
  }

  const fallback: IceServersResponse = {
    iceServers: [...DEFAULT_STUN_SERVERS],
    hasTurn: false,
    provider: 'stun-only',
    ...(buildRelay ? buildRelay : {}),
  };
  if (signal?.aborted) return fallback;

  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), 1800);
  const onParentAbort = () => ac.abort();
  signal?.addEventListener('abort', onParentAbort, { once: true });

  try {
    const data = await signalingFetch<IceServersResponse>('/api/rooms?ice=1', {
      method: 'GET',
      cache: 'no-store',
      signal: ac.signal,
    });
    const merged: IceServersResponse = {
      iceServers:
        Array.isArray(data.iceServers) && data.iceServers.length > 0
          ? data.iceServers
          : [...DEFAULT_STUN_SERVERS],
      hasTurn: Boolean(data.hasTurn),
      provider: data.provider || 'stun-only',
      relayWsUrl: data.relayWsUrl || buildRelay?.relayWsUrl,
      relayHttpUrl: data.relayHttpUrl || buildRelay?.relayHttpUrl,
    };
    cachedConnConfig = { value: merged, expiresAt: Date.now() + CONN_CONFIG_TTL_MS };
    return merged;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onParentAbort);
  }
}

/** Fetches room metadata cleanly across either Cloudflare Relay HTTP or `/api/rooms` signaling. */
export async function lookupOnlineRoom(
  rawCode: string,
  signal?: AbortSignal
): Promise<OnlineRoomPreview> {
  const code = sanitizeRoomCode(rawCode);
  const cfg = await fetchConnectionConfig(signal);
  if (cfg.relayHttpUrl) {
    const res = await signalingFetch<{
      ok: boolean;
      code: string;
      createdAt: number;
      config: OnlineRoomConfig;
      full: boolean;
    }>(`${cfg.relayHttpUrl}/room/${encodeURIComponent(code)}`, {
      method: 'GET',
      cache: 'no-store',
      signal,
    });
    return {
      code: res.code,
      createdAt: res.createdAt,
      config: res.config,
      full: Boolean(res.full),
    };
  }

  const room = await signalingFetch<PublicRoomState>(
    `/api/rooms?code=${encodeURIComponent(code)}`,
    {
      method: 'GET',
      cache: 'no-store',
      signal,
    }
  );
  return {
    code: room.code,
    createdAt: room.createdAt,
    config: room.config,
    full: Boolean(room.guestAnswer),
  };
}
