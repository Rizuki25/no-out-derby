import type {
  DisplayMode,
  GameEvent,
  MatchConfig,
  MatchPhase,
  PlayerInput,
  Team,
  TeamTactic,
} from '../types.ts';
import type { MatchState } from '../game/MatchState.ts';
import {
  ActionEdgeTracker,
  buildNetSnapshot,
  HostRemoteInputDecoder,
  NetInterpolator,
  type NetReliableMessage,
  type NetStateSnapshot,
} from './NetSnapshot.ts';
import {
  fetchConnectionConfig,
  type NetPeerTransport,
  type PeerCallbacks,
  type PeerConnectionPhase,
  type TransportKind,
} from './NetTransport.ts';
import {
  isOnlineCoopMode,
  type OnlineRoomConfig,
} from './SignalingTypes.ts';
import { WebRtcPeer } from './WebRtcPeer.ts';
import { WebSocketPeer } from './WebSocketPeer.ts';

const SNAPSHOT_INTERVAL_SEC = 1 / 22;
const INPUT_HEARTBEAT_SEC = 0.2;
const INPUT_ANALOG_THROTTLE_SEC = 1 / 25;
const ONLINE_INTERP_DELAY_MS = 56;

function isMajorSnapshotEvent(ev: GameEvent): boolean {
  return ev.type === 'goal' || ev.type === 'mutator_start';
}

export interface OnlineStatusBadge {
  active: boolean;
  role: 'host' | 'guest' | null;
  transport?: TransportKind | null;
  localHumanSlot: 1 | 2 | null;
  localTeam: Team;
  roomCode: string | null;
  pingMs: number | null;
  peerWantsRematch: boolean;
  localWantsRematch: boolean;
  disconnectNotice: string | null;
  localPaused?: boolean;
}

export interface OnlineSessionCallbacks {
  onLobbyStateChange?: (phase: PeerConnectionPhase, detail?: string) => void;
  onRoomCodeReady?: (code: string) => void;
  onLobbyConfigPreview?: (config: OnlineRoomConfig) => void;
  onLobbyError?: (code: string, message: string) => void;
  onMatchConnected: (
    config: OnlineRoomConfig,
    role: 'host' | 'guest',
    transport: TransportKind
  ) => void;
  onRemoteEvents: (events: GameEvent[]) => void;
  onRemoteRematchRequested: () => void;
  onRemoteRematchStart: (config: OnlineRoomConfig) => void;
  onDisconnected: (reason: string) => void;
  onPingUpdate?: (pingMs: number) => void;
  createTransport?: (callbacks: PeerCallbacks) => Promise<NetPeerTransport> | NetPeerTransport;
}

export function onlineConfigToMatchConfig(
  cfg: OnlineRoomConfig,
  localDisplayMode: DisplayMode = 'auto'
): MatchConfig {
  return {
    mode: cfg.mode,
    arena: cfg.arena,
    pitchSize: cfg.pitchSize,
    controlStyle: cfg.controlStyle,
    displayMode: localDisplayMode,
    teamAKit: cfg.teamAKit,
    teamBKit: cfg.teamBKit,
    difficulty: cfg.difficulty,
    durationSeconds: cfg.durationSeconds,
    mutatorsEnabled: cfg.mutatorsEnabled,
    replayEnabled: true,
  };
}

/**
 * Coordinates live online multiplayer sessions across Host (authoritative simulation)
 * and Guest (input sender + smooth 60/120fps snapshot interpolator), routing via
 * Cloudflare Workers Edge WebSocket relay when configured or WebRTC P2P fallback.
 */
export class OnlineSession {
  private peer: NetPeerTransport | null = null;
  private role: 'host' | 'guest' | null = null;
  private transportKind: TransportKind | null = null;
  private connected = false;
  private activeConfig: OnlineRoomConfig | null = null;
  private roomCode: string | null = null;
  private pingMs: number | null = null;
  private sessionGen = 0;

  private simTimeMs = 0;
  private snapshotSeq = 0;
  private snapshotAccum = 0;
  private lastBroadcastPhase: MatchPhase = 'MENU';

  private hasLastSentInput = false;
  private lastSentMoveX = 0;
  private lastSentMoveY = 0;
  private lastSentKickHeld = false;
  private inputSendTimer = 0;

  private peerWantsRematch = false;
  private localWantsRematch = false;
  private disconnectNotice: string | null = null;

  private edgeTracker = new ActionEdgeTracker();
  private remoteDecoder = new HostRemoteInputDecoder();
  private interpolator = new NetInterpolator(ONLINE_INTERP_DELAY_MS);

  private callbacks: OnlineSessionCallbacks;

  constructor(callbacks: OnlineSessionCallbacks) {
    this.callbacks = callbacks;
  }

  isActive(): boolean {
    return this.role !== null && (this.connected || this.disconnectNotice !== null);
  }

  isConnected(): boolean {
    return this.connected && this.peer?.isDataOpen() === true;
  }

  getRole(): 'host' | 'guest' | null {
    return this.role;
  }

  getTransportKind(): TransportKind | null {
    return this.transportKind;
  }

  getLocalHumanSlot(): 1 | 2 | null {
    if (!this.isActive()) return null;
    return this.role === 'host' ? 1 : 2;
  }

  getLocalTeam(): Team {
    if (this.role === 'guest' && this.activeConfig && !isOnlineCoopMode(this.activeConfig.mode)) {
      return 'B';
    }
    return 'A';
  }

  getActiveConfig(): OnlineRoomConfig | null {
    return this.activeConfig;
  }

  getDisconnectNotice(): string | null {
    return this.disconnectNotice;
  }

  getStatusBadge(): OnlineStatusBadge {
    return {
      active: this.isActive(),
      role: this.role,
      transport: this.transportKind,
      localHumanSlot: this.getLocalHumanSlot(),
      localTeam: this.getLocalTeam(),
      roomCode: this.roomCode,
      pingMs: this.pingMs,
      peerWantsRematch: this.peerWantsRematch,
      localWantsRematch: this.localWantsRematch,
      disconnectNotice: this.disconnectNotice,
    };
  }

  startHosting(config: OnlineRoomConfig): void {
    this.disconnect(false);
    const gen = this.sessionGen;
    this.role = 'host';
    this.activeConfig = config;
    this.resetMatchSyncState();
    this.callbacks.onLobbyStateChange?.('creating', 'Menyiapkan jalur koneksi online...');

    void this.resolveTransport('host').then((transport) => {
      if (!transport || gen !== this.sessionGen) return;
      this.peer = transport;
      this.transportKind = transport.transportKind;
      void transport.hostRoom(config);
    });
  }

  startJoining(code: string): void {
    this.disconnect(false);
    const gen = this.sessionGen;
    this.role = 'guest';
    this.roomCode = code;
    this.resetMatchSyncState();
    this.callbacks.onLobbyStateChange?.('joining', `Mencari room ${code}...`);

    void this.resolveTransport('guest').then((transport) => {
      if (!transport || gen !== this.sessionGen) return;
      this.peer = transport;
      this.transportKind = transport.transportKind;
      void transport.joinRoom(code);
    });
  }

  private resetMatchSyncState(): void {
    this.simTimeMs = 0;
    this.snapshotSeq = 0;
    this.snapshotAccum = 0;
    this.lastBroadcastPhase = 'MENU';
    this.hasLastSentInput = false;
    this.lastSentMoveX = 0;
    this.lastSentMoveY = 0;
    this.lastSentKickHeld = false;
    this.inputSendTimer = 0;
    this.peerWantsRematch = false;
    this.localWantsRematch = false;
    this.disconnectNotice = null;
    this.edgeTracker.reset();
    this.remoteDecoder.reset();
    this.interpolator.reset();
  }

  private async resolveTransport(expectedRole: 'host' | 'guest'): Promise<NetPeerTransport | null> {
    const peerCallbacks = this.buildPeerCallbacks(expectedRole);
    if (this.callbacks.createTransport) {
      return await this.callbacks.createTransport(peerCallbacks);
    }
    const connCfg = await fetchConnectionConfig();
    if (connCfg.relayWsUrl) {
      return new WebSocketPeer(connCfg.relayWsUrl, peerCallbacks);
    }
    return new WebRtcPeer(peerCallbacks);
  }

  private buildPeerCallbacks(expectedRole: 'host' | 'guest'): PeerCallbacks {
    return {
      onPhaseChange: (phase, detail) => {
        this.callbacks.onLobbyStateChange?.(phase, detail);
      },
      onRoomCodeReady: (code) => {
        this.roomCode = code;
        this.callbacks.onRoomCodeReady?.(code);
      },
      onConfigReady: (cfg) => {
        this.activeConfig = cfg;
        this.callbacks.onLobbyConfigPreview?.(cfg);
      },
      onConnected: (cfg, transport) => {
        this.connected = true;
        this.transportKind = transport;
        this.activeConfig = cfg;
        this.disconnectNotice = null;
        this.resetMatchSyncState();
        this.callbacks.onMatchConnected(cfg, expectedRole, transport);
      },
      onUnreliableMessage: (msg) => {
        if (msg.t === 'in' && expectedRole === 'host') {
          this.remoteDecoder.ingest(msg);
        } else if (msg.t === 'st' && expectedRole === 'guest') {
          this.interpolator.pushSnapshot(msg, performance.now());
        }
      },
      onReliableMessage: (msg: NetReliableMessage) => {
        if (msg.t === 'events' && expectedRole === 'guest') {
          if (msg.snapshot) {
            this.interpolator.pushSnapshot(msg.snapshot, performance.now());
          }
          if (msg.events.length > 0) {
            this.callbacks.onRemoteEvents(msg.events);
          }
        } else if (msg.t === 'rematch_req' && expectedRole === 'host') {
          this.peerWantsRematch = true;
          this.callbacks.onRemoteRematchRequested();
        } else if (msg.t === 'rematch_start' && expectedRole === 'guest') {
          this.activeConfig = msg.config;
          this.resetMatchSyncState();
          this.callbacks.onRemoteRematchStart(msg.config);
        }
      },
      onPingUpdate: (ping) => {
        this.pingMs = ping;
        this.callbacks.onPingUpdate?.(ping);
      },
      onDisconnected: (reason) => {
        this.connected = false;
        this.disconnectNotice = reason;
        this.callbacks.onDisconnected(reason);
      },
      onError: (code, message) => {
        this.connected = false;
        this.callbacks.onLobbyError?.(code, message);
      },
    };
  }

  /**
   * Authoritative Host step: injects decoded Guest input as P2, advances `MatchState`,
   * and streams bandwidth-optimized snapshots & events cleanly to Guest.
   */
  stepHostTick(
    dt: number,
    localInput: PlayerInput,
    match: MatchState,
    onEvents: (evs: GameEvent[]) => void
  ): void {
    if (!this.isConnected() || this.role !== 'host') return;

    this.simTimeMs += dt * 1000;
    const { input: guestInput, directTactic } = this.remoteDecoder.consumeTick();

    const extraEvents: GameEvent[] = [];
    if (directTactic && match.phase === 'PLAYING' && match.hasTwoOutfieldPerTeam()) {
      const guestTeam: Team = isOnlineCoopMode(match.config.mode) ? 'A' : 'B';
      extraEvents.push(...match.setTeamTactic(guestTeam, directTactic));
    }

    const evs = match.update(dt, { p1: localInput, p2: guestInput });
    const allEvents = extraEvents.length > 0 ? [...extraEvents, ...evs] : evs;
    if (allEvents.length > 0) {
      onEvents(allEvents);
    }

    const phaseChanged = match.phase !== this.lastBroadcastPhase;
    const majorEvent = allEvents.some(isMajorSnapshotEvent);
    this.snapshotAccum += dt;
    const intervalReady = this.snapshotAccum >= SNAPSHOT_INTERVAL_SEC;

    if (phaseChanged || majorEvent) {
      this.lastBroadcastPhase = match.phase;
      this.snapshotAccum = 0;
      const snap = this.captureSnapshot(match, true);
      this.peer?.sendReliable({ t: 'events', events: allEvents, snapshot: snap });
      return;
    }

    if (allEvents.length > 0) {
      this.peer?.sendReliable({ t: 'events', events: allEvents });
    }

    if (intervalReady) {
      this.snapshotAccum = 0;
      const includeStats = this.snapshotSeq % 22 === 0;
      const snap = this.captureSnapshot(match, includeStats);
      this.peer?.sendUnreliable(snap);
    }
  }

  private captureSnapshot(match: MatchState, includeStats: boolean): NetStateSnapshot {
    this.snapshotSeq += 1;
    return buildNetSnapshot(match, this.snapshotSeq, this.simTimeMs, includeStats);
  }

  /** Pushes initial Host state snapshot right after Kickoff starts or restarts. */
  pushHostImmediateState(match: MatchState, events: GameEvent[]): void {
    if (!this.isConnected() || this.role !== 'host') return;
    this.lastBroadcastPhase = match.phase;
    const snap = this.captureSnapshot(match, true);
    this.peer?.sendReliable({ t: 'events', events, snapshot: snap });
  }

  /**
   * Guest sends local input (from single-player P1 bindings) to Host:
   * button edges, charge toggles, and move start/stop transmit immediately;
   * steady holds fall back to a low-rate heartbeat to minimize bandwidth.
   */
  sendGuestInput(
    localInput: PlayerInput,
    directTactic?: TeamTactic | null,
    dt = 1 / 60
  ): void {
    if (!this.isConnected() || this.role !== 'guest') return;
    this.inputSendTimer += dt;

    const mx = Math.round(localInput.moveX * 1000) / 1000;
    const my = Math.round(localInput.moveY * 1000) / 1000;
    const hasEdge = Boolean(
      localInput.kickJustReleased ||
        localInput.dashJustPressed ||
        localInput.switchJustPressed ||
        localInput.passJustPressed ||
        localInput.feverJustPressed ||
        localInput.tacticCycleJustPressed ||
        directTactic
    );
    const kickHeldChanged = !this.hasLastSentInput || localInput.kickHeld !== this.lastSentKickHeld;
    const wasIdleMove = this.lastSentMoveX === 0 && this.lastSentMoveY === 0;
    const isIdleMove = mx === 0 && my === 0;
    const startOrStopMove = !this.hasLastSentInput || wasIdleMove !== isIdleMove;
    const moveChanged =
      Math.abs(mx - this.lastSentMoveX) > 0.02 || Math.abs(my - this.lastSentMoveY) > 0.02;

    const shouldSend =
      hasEdge ||
      kickHeldChanged ||
      startOrStopMove ||
      (moveChanged && this.inputSendTimer >= INPUT_ANALOG_THROTTLE_SEC) ||
      this.inputSendTimer >= INPUT_HEARTBEAT_SEC;

    if (!shouldSend) return;

    this.hasLastSentInput = true;
    this.lastSentMoveX = mx;
    this.lastSentMoveY = my;
    this.lastSentKickHeld = localInput.kickHeld;
    this.inputSendTimer = 0;

    const pkt = this.edgeTracker.encode(localInput, directTactic);
    this.peer?.sendUnreliable(pkt);
  }

  /** Guest mirrors interpolated Host entities and state at render cadence (60/120fps). */
  syncGuestRenderState(nowMs: number, match: MatchState): boolean {
    if (this.role !== 'guest') return false;
    const sampled = this.interpolator.sample(nowMs);
    if (!sampled) return false;
    match.applyRemoteSnapshot(sampled);
    return true;
  }

  /** Sends or triggers rematch depending on Host vs Guest role. */
  requestRematch(onHostExecute: () => void): 'started' | 'requested' {
    if (this.role === 'host' && this.activeConfig) {
      this.resetMatchSyncState();
      this.peer?.sendReliable({ t: 'rematch_start', config: this.activeConfig });
      onHostExecute();
      return 'started';
    }
    this.localWantsRematch = true;
    this.peer?.sendReliable({ t: 'rematch_req' });
    return 'requested';
  }

  /** Cleanly tears down active connection & signaling state. */
  disconnect(notifyPeer = true): void {
    this.sessionGen += 1;
    if (this.peer) {
      this.peer.close(notifyPeer);
      this.peer = null;
    }
    this.role = null;
    this.transportKind = null;
    this.connected = false;
    this.roomCode = null;
    this.pingMs = null;
    this.activeConfig = null;
    this.resetMatchSyncState();
  }
}
