import {
  DEFAULT_STUN_SERVERS,
  type IceServerEntry,
  type IceServersResponse,
} from './SignalingTypes.js';

interface CachedIceEntry {
  key: string;
  expiresAt: number;
  value: IceServersResponse;
}

const ICE_CACHE_TTL_MS = 5 * 60 * 1000;
let cachedIce: CachedIceEntry | null = null;

/** Clears cached dynamic TURN credentials (primarily for isolated unit tests). */
export function clearIceCache(): void {
  cachedIce = null;
}

function sanitizeIceEntry(raw: unknown): IceServerEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  let urls: string | string[] | null = null;
  if (typeof r.urls === 'string' && r.urls.trim()) {
    urls = r.urls.trim();
  } else if (Array.isArray(r.urls)) {
    const clean = r.urls.filter((u): u is string => typeof u === 'string' && u.trim().length > 0);
    if (clean.length > 0) urls = clean;
  }
  if (!urls) return null;

  const entry: IceServerEntry = { urls };
  if (typeof r.username === 'string' && r.username) entry.username = r.username;
  if (typeof r.credential === 'string' && r.credential) entry.credential = r.credential;
  return entry;
}

function hasTurnUrl(entries: IceServerEntry[]): boolean {
  return entries.some((entry) => {
    const list = Array.isArray(entry.urls) ? entry.urls : [entry.urls];
    return list.some((u) => /^turns?:/i.test(u));
  });
}

function withDefaultStun(entries: IceServerEntry[]): IceServerEntry[] {
  return [...entries, ...DEFAULT_STUN_SERVERS];
}

function normalizeMeteredDomain(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
}

async function fetchMeteredTurn(
  domain: string,
  apiKey: string,
  fetchFn: typeof fetch
): Promise<IceServerEntry[] | null> {
  const host = normalizeMeteredDomain(domain);
  if (!host || !apiKey.trim()) return null;
  const url = `https://${host}/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey.trim())}`;
  const res = await fetchFn(url, { signal: AbortSignal.timeout(2500) });
  if (!res.ok) return null;
  const parsed = (await res.json()) as unknown;
  if (!Array.isArray(parsed)) return null;
  const entries = parsed.map(sanitizeIceEntry).filter((x): x is IceServerEntry => x !== null);
  return hasTurnUrl(entries) ? entries : null;
}

async function fetchCloudflareTurn(
  tokenId: string,
  apiToken: string,
  fetchFn: typeof fetch
): Promise<IceServerEntry[] | null> {
  if (!tokenId.trim() || !apiToken.trim()) return null;
  const url = `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(tokenId.trim())}/credentials/generate-ice-servers`;
  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ttl: 3600 }),
    signal: AbortSignal.timeout(2500),
  });
  if (!res.ok) return null;
  const parsed = (await res.json()) as Record<string, unknown>;
  const rawServers = parsed?.iceServers;
  const list = Array.isArray(rawServers) ? rawServers : rawServers ? [rawServers] : [];
  const entries = list.map(sanitizeIceEntry).filter((x): x is IceServerEntry => x !== null);
  return hasTurnUrl(entries) ? entries : null;
}

function parseCustomTurn(env: Record<string, string | undefined>): IceServerEntry[] | null {
  const rawUrls = (env.TURN_URLS || env.TURN_URL || '').trim();
  const username = (env.TURN_USERNAME || '').trim();
  const credential = (env.TURN_CREDENTIAL || '').trim();
  if (!rawUrls) return null;

  const urls = rawUrls
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter((u) => u.length > 0);
  if (urls.length === 0) return null;

  const entry: IceServerEntry = { urls: urls.length === 1 ? urls[0] : urls };
  if (username) entry.username = username;
  if (credential) entry.credential = credential;
  return hasTurnUrl([entry]) ? [entry] : null;
}

export interface NormalizedRelayUrls {
  relayWsUrl: string;
  relayHttpUrl: string;
}

/**
 * Normalizes a configured Cloudflare Relay Worker URL (https/wss/host) into both
 * WebSocket (`wss://...`) and HTTP lookup (`https://...`) base origins.
 */
export function normalizeRelayUrls(raw: string | undefined): NormalizedRelayUrls | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;

  let candidate = trimmed;
  if (!/^[a-z]+:\/\//i.test(candidate)) {
    const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(candidate);
    candidate = `${isLocal ? 'http' : 'https'}://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    const proto = parsed.protocol.toLowerCase();
    if (proto !== 'http:' && proto !== 'https:' && proto !== 'ws:' && proto !== 'wss:') {
      return null;
    }
    const secure = proto === 'https:' || proto === 'wss:';
    const host = parsed.host;
    if (!host) return null;
    return {
      relayWsUrl: `${secure ? 'wss' : 'ws'}://${host}`,
      relayHttpUrl: `${secure ? 'https' : 'http'}://${host}`,
    };
  } catch {
    return null;
  }
}

/**
 * Resolves online relay & ICE/TURN config from server-only environment variables
 * (`RELAY_WS_URL` Cloudflare WebSocket relay, plus optional TURN fallbacks).
 */
export async function resolveIceServers(
  env: Record<string, string | undefined>,
  fetchFn: typeof fetch = fetch
): Promise<IceServersResponse> {
  const rawRelayUrl =
    env.RELAY_WS_URL || env.CLOUDFLARE_RELAY_URL || env.VITE_RELAY_URL || '';
  const relayUrls = normalizeRelayUrls(rawRelayUrl);

  const meteredDomain = env.METERED_TURN_DOMAIN || '';
  const meteredKey = env.METERED_TURN_API_KEY || '';
  const cfTokenId = env.CLOUDFLARE_TURN_TOKEN_ID || '';
  const cfApiToken = env.CLOUDFLARE_TURN_API_TOKEN || '';
  const customKey = `${env.TURN_URLS || env.TURN_URL || ''}|${env.TURN_USERNAME || ''}`;

  const cacheKey = `${relayUrls?.relayWsUrl || ''}|${meteredDomain}|${meteredKey}|${cfTokenId}|${cfApiToken}|${customKey}`;
  if (cachedIce && cachedIce.key === cacheKey && Date.now() < cachedIce.expiresAt) {
    return cachedIce.value;
  }

  let resolved: IceServersResponse | null = null;

  if (meteredDomain && meteredKey) {
    try {
      const turn = await fetchMeteredTurn(meteredDomain, meteredKey, fetchFn);
      if (turn) {
        resolved = { iceServers: withDefaultStun(turn), hasTurn: true, provider: 'metered' };
      }
    } catch {
      // Fall through to alternative TURN or STUN default
    }
  }

  if (!resolved && cfTokenId && cfApiToken) {
    try {
      const turn = await fetchCloudflareTurn(cfTokenId, cfApiToken, fetchFn);
      if (turn) {
        resolved = { iceServers: withDefaultStun(turn), hasTurn: true, provider: 'cloudflare' };
      }
    } catch {
      // Fall through to static custom TURN or STUN default
    }
  }

  if (!resolved) {
    const custom = parseCustomTurn(env);
    if (custom) {
      resolved = { iceServers: withDefaultStun(custom), hasTurn: true, provider: 'custom' };
    }
  }

  if (!resolved) {
    resolved = {
      iceServers: [...DEFAULT_STUN_SERVERS],
      hasTurn: false,
      provider: 'stun-only',
    };
  }

  if (relayUrls) {
    resolved = {
      ...resolved,
      relayWsUrl: relayUrls.relayWsUrl,
      relayHttpUrl: relayUrls.relayHttpUrl,
    };
  }

  if (resolved.hasTurn || resolved.relayWsUrl) {
    cachedIce = {
      key: cacheKey,
      expiresAt: Date.now() + ICE_CACHE_TTL_MS,
      value: resolved,
    };
  }
  return resolved;
}
