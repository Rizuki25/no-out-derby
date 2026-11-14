import type {
  NetInputPacket,
  NetPingMessage,
  NetReliableMessage,
  NetStateSnapshot,
} from './NetSnapshot.ts';
import {
  fetchConnectionConfig,
  type NetPeerTransport,
  type PeerCallbacks,
  type PeerConnectionPhase,
  SignalingError,
  signalingFetch,
  type TransportKind,
} from './NetTransport.ts';
import {
  type IceCandidateDTO,
  type IceServerEntry,
  type OnlineRoomConfig,
  type PublicRoomState,
  sanitizeRoomCode,
  type SessionDescriptionDTO,
} from './SignalingTypes.ts';

export type { PeerCallbacks, PeerConnectionPhase, TransportKind } from './NetTransport.ts';
export { fetchConnectionConfig as fetchIceConfig, SignalingError } from './NetTransport.ts';

const UNRELIABLE_BACKPRESSURE_BYTES = 65_536;

function parseCandidateType(cand: string): string {
  const match = /\btyp\s+(host|srflx|prflx|relay)\b/i.exec(cand);
  return match ? match[1].toLowerCase() : 'unknown';
}

function serializeCandidate(cand: RTCIceCandidate): IceCandidateDTO {
  return {
    candidate: cand.candidate,
    sdpMid: cand.sdpMid,
    sdpMLineIndex: cand.sdpMLineIndex,
    usernameFragment: cand.usernameFragment,
  };
}

function candidateKey(c: IceCandidateDTO): string {
  return `${c.candidate}|${c.sdpMid ?? ''}|${c.sdpMLineIndex ?? ''}`;
}

/** Fetches public room metadata (config & offer) to preview before or during join. */
export async function lookupSignalingRoom(rawCode: string, signal?: AbortSignal): Promise<PublicRoomState> {
  const code = sanitizeRoomCode(rawCode);
  return signalingFetch<PublicRoomState>(`/api/rooms?code=${encodeURIComponent(code)}`, {
    method: 'GET',
    cache: 'no-store',
    signal,
  });
}

/**
 * Manages a single P2P WebRTC fallback session (Host or Guest) including signaling room
 * handshake via `/api/rooms`, dual DataChannels (`unreliable` + `reliable`), and RTT ping.
 */
export class WebRtcPeer implements NetPeerTransport {
  readonly transportKind: TransportKind = 'webrtc-p2p';
  private pc: RTCPeerConnection | null = null;
  private unreliableCh: RTCDataChannel | null = null;
  private reliableCh: RTCDataChannel | null = null;

  private role: 'host' | 'guest' | null = null;
  private phase: PeerConnectionPhase = 'idle';
  private roomCode: string | null = null;
  private hostSecret: string | null = null;
  private activeConfig: OnlineRoomConfig | null = null;

  private closed = false;
  private abortCtrl = new AbortController();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private disconnectGraceTimer: ReturnType<typeof setTimeout> | null = null;

  private localCandidates: IceCandidateDTO[] = [];
  private sentCandidateKeys = new Set<string>();
  private addedRemoteCandidateKeys = new Set<string>();
  private queuedRemoteCandidates: IceCandidateDTO[] = [];
  private localCandTypes = new Set<string>();
  private remoteCandTypes = new Set<string>();
  private iceHasTurn = false;
  private remoteDescriptionReady = false;
  private signalingReadyForCandidates = false;
  private hasEmittedConnected = false;

  private pingMs: number | null = null;
  private callbacks: PeerCallbacks;

  constructor(callbacks: PeerCallbacks = {}) {
    this.callbacks = callbacks;
  }

  getPhase(): PeerConnectionPhase {
    return this.phase;
  }

  getRole(): 'host' | 'guest' | null {
    return this.role;
  }

  getRoomCode(): string | null {
    return this.roomCode;
  }

  getPingMs(): number | null {
    return this.pingMs;
  }

  isDataOpen(): boolean {
    return (
      !this.closed &&
      this.reliableCh?.readyState === 'open' &&
      this.unreliableCh?.readyState === 'open'
    );
  }

  private setPhase(next: PeerConnectionPhase, detail?: string): void {
    if (this.closed && next !== 'disconnected' && next !== 'idle') return;
    this.phase = next;
    this.callbacks.onPhaseChange?.(next, detail);
  }

  private createPeerConnection(iceServers: IceServerEntry[]): RTCPeerConnection {
    if (typeof RTCPeerConnection !== 'function') {
      throw new SignalingError('WEBRTC_UNSUPPORTED', 'Browser ini belum mendukung WebRTC.');
    }
    const pc = new RTCPeerConnection({
      iceServers,
      iceCandidatePoolSize: 2,
    });

    pc.onicecandidate = (ev) => {
      if (!ev.candidate || !ev.candidate.candidate || this.closed) return;
      const dto = serializeCandidate(ev.candidate);
      this.localCandTypes.add(parseCandidateType(dto.candidate));
      const k = candidateKey(dto);
      if (this.sentCandidateKeys.has(k)) return;
      this.localCandidates.push(dto);

      if (this.signalingReadyForCandidates && this.roomCode && this.role) {
        this.sentCandidateKeys.add(k);
        void this.postTrickleCandidate(this.roomCode, this.role, dto);
      }
    };

    const handleDisconnectTimeout = () => {
      if (this.closed) return;
      this.triggerDisconnect('Koneksi P2P dengan lawan terputus.');
    };

    const onStateChange = () => {
      if (this.closed) return;
      const connState = pc.connectionState;
      const iceState = pc.iceConnectionState;

      if (connState === 'connected' || iceState === 'connected' || iceState === 'completed') {
        if (this.disconnectGraceTimer) {
          clearTimeout(this.disconnectGraceTimer);
          this.disconnectGraceTimer = null;
        }
        return;
      }

      if (connState === 'failed' || iceState === 'failed' || connState === 'closed') {
        if (this.disconnectGraceTimer) {
          clearTimeout(this.disconnectGraceTimer);
          this.disconnectGraceTimer = null;
        }
        if (this.hasEmittedConnected) {
          this.triggerDisconnect('Koneksi P2P gagal / terputus.');
        } else {
          const localTypes = Array.from(this.localCandTypes);
          const remoteTypes = Array.from(this.remoteCandTypes);
          console.warn('[WebRtcPeer] ICE_FAILED diagnostics:', {
            role: this.role,
            hasTurn: this.iceHasTurn,
            connState,
            iceState,
            localTypes,
            remoteTypes,
          });
          const msg = this.iceHasTurn
            ? 'Gagal P2P lewat NAT/Firewall. Coba ganti jaringan atau buat room baru.'
            : 'Gagal P2P (NAT/Firewall ketat, TURN belum aktif). Coba 1 Wi-Fi atau pasang TURN gratis di Vercel.';
          this.fail('ICE_FAILED', msg);
        }
        return;
      }

      if ((connState === 'disconnected' || iceState === 'disconnected') && this.hasEmittedConnected) {
        if (!this.disconnectGraceTimer) {
          this.disconnectGraceTimer = setTimeout(handleDisconnectTimeout, 5000);
        }
      }
    };

    pc.onconnectionstatechange = onStateChange;
    pc.oniceconnectionstatechange = onStateChange;

    return pc;
  }

  private wireDataChannel(ch: RTCDataChannel, kind: 'unreliable' | 'reliable'): void {
    ch.binaryType = 'arraybuffer';
    if (kind === 'unreliable') this.unreliableCh = ch;
    else this.reliableCh = ch;

    ch.onopen = () => {
      if (this.closed) return;
      this.checkBothChannelsOpen();
    };

    ch.onclose = () => {
      if (this.closed || !this.hasEmittedConnected) return;
      this.triggerDisconnect('Lawan menutup koneksi.');
    };

    ch.onmessage = (ev) => {
      if (this.closed || typeof ev.data !== 'string') return;
      try {
        const parsed = JSON.parse(ev.data) as Record<string, unknown>;
        if (!parsed || typeof parsed.t !== 'string') return;
        if (parsed.t === 'ping' && typeof parsed.ts === 'number') {
          this.sendUnreliable({ t: 'pong', ts: parsed.ts });
          return;
        }
        if (parsed.t === 'pong' && typeof parsed.ts === 'number') {
          const sample = Math.max(1, Math.round(performance.now() - parsed.ts));
          this.pingMs = this.pingMs === null ? sample : Math.round(this.pingMs * 0.7 + sample * 0.3);
          this.callbacks.onPingUpdate?.(this.pingMs);
          return;
        }
        if (kind === 'unreliable') {
          this.callbacks.onUnreliableMessage?.(
            parsed as unknown as NetInputPacket | NetStateSnapshot | NetPingMessage
          );
        } else {
          const msg = parsed as unknown as NetReliableMessage;
          if (msg.t === 'leave') {
            this.triggerDisconnect(msg.reason || 'Lawan keluar dari pertandingan.');
            return;
          }
          if (msg.t === 'hello') {
            this.activeConfig = msg.config;
            this.callbacks.onConfigReady?.(msg.config);
          }
          this.callbacks.onReliableMessage?.(msg);
        }
      } catch {
        // Ignore malformed packets defensively
      }
    };
  }

  private checkBothChannelsOpen(): void {
    if (this.hasEmittedConnected || this.closed) return;
    if (this.reliableCh?.readyState === 'open' && this.unreliableCh?.readyState === 'open') {
      this.hasEmittedConnected = true;
      this.stopPolling();
      this.setPhase('connected');
      this.startPingLoop();

      if (this.role === 'host' && this.activeConfig) {
        this.sendReliable({ t: 'hello', config: this.activeConfig });
        void this.deleteRoomSilently();
      }
      if (this.activeConfig) {
        this.callbacks.onConnected?.(this.activeConfig, this.transportKind);
      }
    }
  }

  private startPingLoop(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    const sendPing = () => {
      if (this.closed) return;
      this.sendUnreliable({ t: 'ping', ts: performance.now() });
    };
    sendPing();
    this.pingTimer = setInterval(sendPing, 2000);
  }

  private async waitInitialIce(
    pc: RTCPeerConnection,
    maxWaitMs = 1500,
    minEarlyResolveMs = 380
  ): Promise<void> {
    if (pc.iceGatheringState === 'complete') return;
    await new Promise<void>((resolve) => {
      let settled = false;
      let minWindowPassed = false;
      const hasUsefulNatCandidate = () =>
        this.localCandTypes.has('relay') || this.localCandTypes.has('srflx');
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(maxTimer);
        clearTimeout(minTimer);
        pc.removeEventListener('icegatheringstatechange', onState);
        pc.removeEventListener('icecandidate', onCand);
        resolve();
      };
      const maxTimer = setTimeout(done, maxWaitMs);
      const minTimer = setTimeout(() => {
        minWindowPassed = true;
        if (hasUsefulNatCandidate()) done();
      }, minEarlyResolveMs);
      const onState = () => {
        if (pc.iceGatheringState === 'complete') done();
      };
      const onCand = (ev: RTCPeerConnectionIceEvent) => {
        if (!ev.candidate) {
          done();
          return;
        }
        if (minWindowPassed && hasUsefulNatCandidate()) {
          done();
        }
      };
      pc.addEventListener('icegatheringstatechange', onState);
      pc.addEventListener('icecandidate', onCand);
    });
  }

  private async addRemoteCandidates(cands: IceCandidateDTO[]): Promise<void> {
    for (const c of cands) {
      const k = candidateKey(c);
      if (this.addedRemoteCandidateKeys.has(k)) continue;
      this.addedRemoteCandidateKeys.add(k);
      this.remoteCandTypes.add(parseCandidateType(c.candidate));
      if (!this.remoteDescriptionReady || !this.pc) {
        this.queuedRemoteCandidates.push(c);
      } else {
        await this.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      }
    }
  }

  private async flushQueuedCandidates(): Promise<void> {
    if (!this.pc || !this.remoteDescriptionReady) return;
    const queue = this.queuedRemoteCandidates.splice(0);
    for (const c of queue) {
      await this.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    }
  }

  private async postTrickleCandidate(
    code: string,
    role: 'host' | 'guest',
    candidate: IceCandidateDTO
  ): Promise<void> {
    await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: this.abortCtrl.signal,
      body: JSON.stringify({ action: 'candidate', code, role, candidate }),
    }).catch(() => {});
  }

  private flushUnsentLocalCandidates(): void {
    if (!this.roomCode || !this.role) return;
    for (const cand of this.localCandidates) {
      const k = candidateKey(cand);
      if (this.sentCandidateKeys.has(k)) continue;
      this.sentCandidateKeys.add(k);
      void this.postTrickleCandidate(this.roomCode, this.role, cand);
    }
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async deleteRoomSilently(): Promise<void> {
    if (this.role !== 'host' || !this.roomCode || !this.hostSecret) return;
    const code = this.roomCode;
    const secret = this.hostSecret;
    this.hostSecret = null;
    await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'close', code, hostSecret: secret }),
    }).catch(() => {});
  }

  private triggerDisconnect(reason: string): void {
    if (this.closed) return;
    this.close(false);
    this.setPhase('disconnected', reason);
    this.callbacks.onDisconnected?.(reason);
  }

  private fail(code: string, message: string): void {
    if (this.closed) return;
    this.close(false);
    this.phase = 'error';
    this.callbacks.onPhaseChange?.('error', message);
    this.callbacks.onError?.(code, message);
  }

  /** Host creates a WebRTC offer, registers a signaling room, and waits for Guest. */
  async hostRoom(config: OnlineRoomConfig): Promise<void> {
    this.role = 'host';
    this.activeConfig = config;
    this.setPhase('creating', 'Menyiapkan room online...');

    try {
      const iceConfig = await fetchConnectionConfig(this.abortCtrl.signal);
      if (this.closed) return;
      this.iceHasTurn = iceConfig.hasTurn;

      const pc = this.createPeerConnection(iceConfig.iceServers);
      this.pc = pc;

      const reliable = pc.createDataChannel('reliable', { ordered: true });
      const unreliable = pc.createDataChannel('unreliable', {
        ordered: false,
        maxRetransmits: 0,
      });
      this.wireDataChannel(reliable, 'reliable');
      this.wireDataChannel(unreliable, 'unreliable');

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this.waitInitialIce(pc);
      if (this.closed) return;

      const localOffer = pc.localDescription;
      if (!localOffer?.sdp) {
        throw new SignalingError('SDP_FAILED', 'Gagal membuat SDP offer WebRTC.');
      }

      const initialCands = [...this.localCandidates];
      for (const c of initialCands) this.sentCandidateKeys.add(candidateKey(c));

      const created = await signalingFetch<{ code: string; hostSecret: string }>('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: this.abortCtrl.signal,
        body: JSON.stringify({
          action: 'create',
          config,
          hostOffer: { type: 'offer', sdp: localOffer.sdp } satisfies SessionDescriptionDTO,
          hostCandidates: initialCands,
        }),
      });

      if (this.closed) return;
      this.roomCode = created.code;
      this.hostSecret = created.hostSecret;
      this.signalingReadyForCandidates = true;
      this.flushUnsentLocalCandidates();

      this.callbacks.onRoomCodeReady?.(created.code);
      this.setPhase('waiting_guest', `Kode Room: ${created.code}`);

      const pollOnce = async () => {
        if (this.closed || !this.roomCode || this.hasEmittedConnected) return;
        try {
          const room = await lookupSignalingRoom(this.roomCode, this.abortCtrl.signal);
          if (this.closed) return;
          if (room.guestAnswer && !this.remoteDescriptionReady) {
            this.setPhase('connecting', 'Lawan ditemukan! Menyambungkan P2P...');
            await pc.setRemoteDescription(new RTCSessionDescription(room.guestAnswer));
            this.remoteDescriptionReady = true;
            await this.flushQueuedCandidates();
          }
          if (room.guestCandidates.length > 0) {
            await this.addRemoteCandidates(room.guestCandidates);
          }
        } catch (err) {
          if (err instanceof SignalingError && err.code === 'ROOM_NOT_FOUND' && !this.remoteDescriptionReady) {
            this.fail('ROOM_EXPIRED', 'Room kedaluwarsa sebelum ada lawan yang masuk.');
          }
        }
      };

      this.pollTimer = setInterval(() => void pollOnce(), 500);
    } catch (err) {
      if (this.abortCtrl.signal.aborted || this.closed) return;
      if (err instanceof SignalingError) {
        this.fail(err.code, err.message);
      } else {
        this.fail('HOST_ERROR', 'Gagal membuat room online. Periksa koneksi internet.');
      }
    }
  }

  /** Guest fetches room by code, generates WebRTC answer, and connects P2P to Host. */
  async joinRoom(rawCode: string): Promise<void> {
    const code = sanitizeRoomCode(rawCode);
    this.role = 'guest';
    this.roomCode = code;
    this.setPhase('joining', `Mencari room ${code}...`);

    try {
      const [room, iceConfig] = await Promise.all([
        lookupSignalingRoom(code, this.abortCtrl.signal),
        fetchConnectionConfig(this.abortCtrl.signal),
      ]);
      if (this.closed) return;
      this.iceHasTurn = iceConfig.hasTurn;
      if (room.guestAnswer) {
        throw new SignalingError('ROOM_FULL', 'Room ini sudah penuh.');
      }

      this.activeConfig = room.config;
      this.callbacks.onConfigReady?.(room.config);

      const pc = this.createPeerConnection(iceConfig.iceServers);
      this.pc = pc;
      pc.ondatachannel = (ev) => {
        if (ev.channel.label === 'unreliable') {
          this.wireDataChannel(ev.channel, 'unreliable');
        } else if (ev.channel.label === 'reliable') {
          this.wireDataChannel(ev.channel, 'reliable');
        }
      };

      await pc.setRemoteDescription(new RTCSessionDescription(room.hostOffer));
      this.remoteDescriptionReady = true;
      await this.addRemoteCandidates(room.hostCandidates);
      await this.flushQueuedCandidates();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.waitInitialIce(pc);
      if (this.closed) return;

      const localAnswer = pc.localDescription;
      if (!localAnswer?.sdp) {
        throw new SignalingError('SDP_FAILED', 'Gagal membuat SDP answer WebRTC.');
      }

      const initialCands = [...this.localCandidates];
      for (const c of initialCands) this.sentCandidateKeys.add(candidateKey(c));

      this.setPhase('connecting', 'Menghubungkan P2P ke Host...');
      const joined = await signalingFetch<{ ok: boolean; room: PublicRoomState }>('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: this.abortCtrl.signal,
        body: JSON.stringify({
          action: 'join',
          code,
          guestAnswer: { type: 'answer', sdp: localAnswer.sdp } satisfies SessionDescriptionDTO,
          guestCandidates: initialCands,
        }),
      });

      if (this.closed) return;
      this.signalingReadyForCandidates = true;
      this.flushUnsentLocalCandidates();
      await this.addRemoteCandidates(joined.room.hostCandidates);

      this.pollTimer = setInterval(async () => {
        if (this.closed || !this.roomCode || this.hasEmittedConnected) return;
        try {
          const updated = await lookupSignalingRoom(this.roomCode, this.abortCtrl.signal);
          await this.addRemoteCandidates(updated.hostCandidates);
        } catch {
          // Host may delete room right as connection finishes opening
        }
      }, 650);
    } catch (err) {
      if (this.abortCtrl.signal.aborted || this.closed) return;
      if (err instanceof SignalingError) {
        this.fail(err.code, err.message);
      } else {
        this.fail('JOIN_ERROR', 'Gagal masuk room online. Periksa kode atau koneksi.');
      }
    }
  }

  sendUnreliable(msg: NetInputPacket | NetStateSnapshot | NetPingMessage): void {
    if (this.closed) return;
    if (
      this.unreliableCh?.readyState === 'open' &&
      (this.unreliableCh.bufferedAmount ?? 0) <= UNRELIABLE_BACKPRESSURE_BYTES
    ) {
      try {
        this.unreliableCh.send(JSON.stringify(msg));
        return;
      } catch {
        // Ignore transient backpressure drop on unreliable stream
      }
    }
    if (msg.t === 'pong' && this.reliableCh?.readyState === 'open') {
      try {
        this.reliableCh.send(JSON.stringify(msg));
      } catch {
        // Ignore
      }
    }
  }

  sendReliable(msg: NetReliableMessage): void {
    if (this.closed || this.reliableCh?.readyState !== 'open') return;
    try {
      this.reliableCh.send(JSON.stringify(msg));
    } catch {
      // Ignore if closing
    }
  }

  close(notifyPeer = true): void {
    if (this.closed) return;
    this.closed = true;

    if (notifyPeer && this.reliableCh?.readyState === 'open') {
      try {
        this.reliableCh.send(
          JSON.stringify({ t: 'leave', reason: 'Lawan keluar dari pertandingan.' } satisfies NetReliableMessage)
        );
      } catch {
        // Ignore
      }
    }

    this.stopPolling();
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.disconnectGraceTimer) {
      clearTimeout(this.disconnectGraceTimer);
      this.disconnectGraceTimer = null;
    }
    this.abortCtrl.abort();

    if (this.role === 'host' && this.hostSecret && this.roomCode) {
      void this.deleteRoomSilently();
    }

    try {
      this.unreliableCh?.close();
    } catch {
      // Ignore
    }
    try {
      this.reliableCh?.close();
    } catch {
      // Ignore
    }
    try {
      this.pc?.close();
    } catch {
      // Ignore
    }
    this.unreliableCh = null;
    this.reliableCh = null;
    this.pc = null;
  }
}
