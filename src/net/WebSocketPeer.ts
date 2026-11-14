import type {
  NetInputPacket,
  NetPingMessage,
  NetReliableMessage,
  NetStateSnapshot,
} from './NetSnapshot.ts';
import {
  type NetPeerTransport,
  type PeerCallbacks,
  type PeerConnectionPhase,
  type TransportKind,
} from './NetTransport.ts';
import {
  generateRoomCode,
  type OnlineRoomConfig,
  sanitizeRoomCode,
} from './SignalingTypes.ts';

const CONNECT_TIMEOUT_MS = 7500;
const LOBBY_KEEPALIVE_MS = 25_000;
const PING_INTERVAL_MS = 2000;
const UNRELIABLE_BACKPRESSURE_BYTES = 65_536;
const MAX_HOST_CODE_RETRIES = 6;

/**
 * Low-latency WebSocket relay transport backed by Cloudflare Workers + SQLite Durable Objects.
 * Runs cleanly over TLS port 443 (`wss://`), bypassing Wi-Fi/CGNAT symmetric NAT & UDP blocks.
 */
export class WebSocketPeer implements NetPeerTransport {
  readonly transportKind: TransportKind = 'cloudflare-ws';

  private ws: WebSocket | null = null;
  private phase: PeerConnectionPhase = 'idle';
  private roomCode: string | null = null;
  private activeConfig: OnlineRoomConfig | null = null;

  private closed = false;
  private hasEmittedConnected = false;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pingMs: number | null = null;

  constructor(
    private readonly relayWsUrl: string,
    private readonly callbacks: PeerCallbacks = {}
  ) {}

  isDataOpen(): boolean {
    return (
      !this.closed &&
      this.hasEmittedConnected &&
      this.ws !== null &&
      this.ws.readyState === WebSocket.OPEN
    );
  }

  getPingMs(): number | null {
    return this.pingMs;
  }

  getRoomCode(): string | null {
    return this.roomCode;
  }

  private setPhase(next: PeerConnectionPhase, detail?: string): void {
    if (this.closed && next !== 'disconnected' && next !== 'idle') return;
    this.phase = next;
    this.callbacks.onPhaseChange?.(next, detail);
  }

  private clearTimers(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private fail(code: string, message: string): void {
    if (this.closed) return;
    this.setPhase('error', message);
    this.close(false);
    this.callbacks.onError?.(code, message);
  }

  private triggerDisconnect(reason: string): void {
    if (this.closed) return;
    this.setPhase('disconnected', reason);
    this.close(false);
    this.callbacks.onDisconnected?.(reason);
  }

  async hostRoom(config: OnlineRoomConfig): Promise<void> {
    this.activeConfig = config;
    this.setPhase('creating', 'Membuka room di Cloudflare Edge...');
    this.openSocketWithRetry(config, 0);
  }

  private openSocketWithRetry(config: OnlineRoomConfig, attempt: number): void {
    if (this.closed) return;
    const code = generateRoomCode();
    this.roomCode = code;
    const cfgParam = encodeURIComponent(JSON.stringify(config));
    const url = `${this.relayWsUrl}/ws?code=${encodeURIComponent(code)}&role=host&cfg=${cfgParam}`;
    this.attachWebSocket(url, () => {
      if (attempt + 1 < MAX_HOST_CODE_RETRIES) {
        this.openSocketWithRetry(config, attempt + 1);
      } else {
        this.fail('ROOM_CREATE_FAILED', 'Gagal membuat kode room unik. Coba lagi.');
      }
    });
  }

  async joinRoom(rawCode: string): Promise<void> {
    const code = sanitizeRoomCode(rawCode);
    this.roomCode = code;
    this.setPhase('joining', `Menghubungi room ${code} di Edge...`);
    const url = `${this.relayWsUrl}/ws?code=${encodeURIComponent(code)}&role=guest`;
    this.attachWebSocket(url);
  }

  private attachWebSocket(url: string, onRoomTakenRetry?: () => void): void {
    if (this.closed) return;
    if (typeof WebSocket !== 'function') {
      this.fail('WS_UNSUPPORTED', 'Browser tidak mendukung WebSocket.');
      return;
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.fail('WS_CONNECT_FAILED', 'URL server Cloudflare Relay tidak valid.');
      return;
    }

    this.ws = ws;
    let retryingCode = false;
    let sawSysError = false;
    let openedOnce = false;

    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = setTimeout(() => {
      if (this.closed || this.phase === 'waiting_guest' || this.hasEmittedConnected) return;
      this.fail(
        'CONNECT_TIMEOUT',
        'Timeout menyambung server Cloudflare Relay. Periksa koneksi internet.'
      );
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      if (this.closed || this.ws !== ws) return;
      openedOnce = true;
      if (this.connectTimer) {
        clearTimeout(this.connectTimer);
        this.connectTimer = null;
      }
      this.startKeepaliveLoop();
    };

    ws.onmessage = (ev) => {
      if (this.closed || this.ws !== ws || typeof ev.data !== 'string') return;
      if (ev.data === 'hb_ack') return;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(ev.data) as Record<string, unknown>;
      } catch {
        return;
      }
      if (!parsed || typeof parsed.t !== 'string') return;

      const msgType = parsed.t;
      if (msgType === 'sys_err') {
        sawSysError = true;
        const code = typeof parsed.code === 'string' ? parsed.code : 'RELAY_ERROR';
        const message =
          typeof parsed.message === 'string' ? parsed.message : 'Gagal terhubung ke room.';
        if (code === 'ROOM_TAKEN' && onRoomTakenRetry) {
          retryingCode = true;
          try {
            ws.close(1000, 'RETRY_CODE');
          } catch {
            // Ignore
          }
          onRoomTakenRetry();
          return;
        }
        this.fail(code, message);
        return;
      }

      if (msgType === 'sys_ready') {
        const readyCode = typeof parsed.code === 'string' ? parsed.code : this.roomCode || '';
        this.roomCode = readyCode;
        if (parsed.config && typeof parsed.config === 'object') {
          this.activeConfig = parsed.config as OnlineRoomConfig;
        }
        this.callbacks.onRoomCodeReady?.(readyCode);
        this.setPhase('waiting_guest', `Kode Room: ${readyCode} (Edge WSS siap)`);
        return;
      }

      if (msgType === 'sys_joined') {
        if (this.hasEmittedConnected) return;
        if (parsed.config && typeof parsed.config === 'object') {
          this.activeConfig = parsed.config as OnlineRoomConfig;
          this.callbacks.onConfigReady?.(this.activeConfig);
        }
        this.hasEmittedConnected = true;
        this.setPhase('connected');
        this.startPingLoop();
        if (this.activeConfig) {
          this.callbacks.onConnected?.(this.activeConfig, this.transportKind);
        }
        return;
      }

      if (msgType === 'sys_peer_left') {
        const reason =
          typeof parsed.reason === 'string' ? parsed.reason : 'Lawan terputus dari server.';
        if (this.hasEmittedConnected) {
          this.triggerDisconnect(reason);
        } else {
          this.fail('PEER_LEFT', reason);
        }
        return;
      }

      if (msgType === 'ping' && typeof parsed.ts === 'number') {
        this.sendRaw({ t: 'pong', ts: parsed.ts } satisfies NetPingMessage, false);
        return;
      }

      if (msgType === 'pong' && typeof parsed.ts === 'number') {
        const sample = Math.max(1, Math.round(performance.now() - parsed.ts));
        this.pingMs =
          this.pingMs === null ? sample : Math.round(this.pingMs * 0.7 + sample * 0.3);
        this.callbacks.onPingUpdate?.(this.pingMs);
        return;
      }

      if (msgType === 'in' || msgType === 'st') {
        this.callbacks.onUnreliableMessage?.(
          parsed as unknown as NetInputPacket | NetStateSnapshot
        );
        return;
      }

      const rel = parsed as unknown as NetReliableMessage;
      if (rel.t === 'leave') {
        this.triggerDisconnect(rel.reason || 'Lawan keluar dari pertandingan.');
        return;
      }
      if (rel.t === 'hello') {
        this.activeConfig = rel.config;
        this.callbacks.onConfigReady?.(rel.config);
      }
      this.callbacks.onReliableMessage?.(rel);
    };

    ws.onerror = () => {
      if (this.closed || this.ws !== ws || retryingCode || sawSysError) return;
      if (!openedOnce) {
        this.fail(
          'WS_ERROR',
          'Gagal menghubungi server Cloudflare Relay. Periksa koneksi / URL worker.'
        );
      }
    };

    ws.onclose = (ev) => {
      if (this.closed || this.ws !== ws || retryingCode || sawSysError) return;
      if (this.hasEmittedConnected) {
        this.triggerDisconnect('Koneksi WebSocket terputus.');
      } else {
        const detail =
          ev.code === 4004
            ? 'Room tidak ditemukan atau sudah berakhir.'
            : ev.code === 4009
              ? 'Room sudah penuh.'
              : 'Gagal menyambung ke server Cloudflare Relay.';
        this.fail('WS_CLOSED', detail);
      }
    };
  }

  private startKeepaliveLoop(): void {
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = setInterval(() => {
      if (this.closed || this.ws?.readyState !== WebSocket.OPEN) return;
      try {
        this.ws.send('hb');
      } catch {
        // Ignore
      }
    }, LOBBY_KEEPALIVE_MS);
  }

  private startPingLoop(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    const sendPing = () => {
      if (this.closed || !this.hasEmittedConnected) return;
      this.sendRaw({ t: 'ping', ts: performance.now() } satisfies NetPingMessage, false);
    };
    sendPing();
    this.pingTimer = setInterval(sendPing, PING_INTERVAL_MS);
  }

  private sendRaw(payload: unknown, reliable: boolean): void {
    if (this.closed || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!reliable && this.ws.bufferedAmount > UNRELIABLE_BACKPRESSURE_BYTES) {
      return;
    }
    try {
      this.ws.send(JSON.stringify(payload));
    } catch {
      // Ignore send failures when closing
    }
  }

  sendUnreliable(msg: NetInputPacket | NetStateSnapshot | NetPingMessage): void {
    if (!this.isDataOpen() && msg.t !== 'pong' && msg.t !== 'ping') return;
    this.sendRaw(msg, false);
  }

  sendReliable(msg: NetReliableMessage): void {
    this.sendRaw(msg, true);
  }

  close(notifyPeer = true): void {
    if (this.closed) return;
    this.closed = true;

    if (notifyPeer && this.ws?.readyState === WebSocket.OPEN && this.hasEmittedConnected) {
      try {
        this.ws.send(
          JSON.stringify({
            t: 'leave',
            reason: 'Lawan keluar dari pertandingan.',
          } satisfies NetReliableMessage)
        );
      } catch {
        // Ignore
      }
    }

    this.clearTimers();
    const socket = this.ws;
    this.ws = null;
    if (socket) {
      try {
        socket.close(1000, 'USER_LEAVE');
      } catch {
        // Ignore
      }
    }
  }
}
