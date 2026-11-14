import type {
  ActiveMutatorInfo,
  ArenaBounds,
  Ball,
  GameEvent,
  MatchPhase,
  MatchStats,
  Player,
  PlayerAnimState,
  PlayerInput,
  Team,
  TeamTactic,
} from '../types.ts';
import type { ReplayFrame } from '../engine/ReplayBuffer.ts';
import type { OnlineRoomConfig } from './SignalingTypes.ts';

export interface NetInputPacket {
  t: 'in';
  seq: number;
  mx: number;
  my: number;
  kh: boolean;
  ks: number;
  ds: number;
  ss: number;
  ps: number;
  fs: number;
  ts: number;
  dts?: number;
  dt?: TeamTactic;
}

export interface NetBallState {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  z: number;
  vz: number;
  r: number;
  ra: number;
  ut: number;
  cid: number | null;
  ex: boolean;
  ot: number;
  ft: number;
}

export interface NetPlayerState {
  id: number;
  team: Team;
  role: 'outfield' | 'keeper';
  hs: 1 | 2 | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number;
  fy: number;
  st: PlayerAnimState;
  at: number;
  su: number;
  ic: boolean;
  ct: number;
  dc: number;
  ft: number;
  fa: boolean;
}

export interface NetReplayPayload {
  frame: ReplayFrame | null;
  prog: number;
  tag: string;
  team: Team;
}

export interface NetStateSnapshot {
  t: 'st';
  seq: number;
  simTime: number;
  phase: MatchPhase;
  phaseTimer: number;
  timeRemaining: number;
  scoreA: number;
  scoreB: number;
  winner: Team | null;
  isGoldenGoal: boolean;
  lastScoringTeam: Team | null;
  feverA: number;
  feverB: number;
  feverTimerA: number;
  feverTimerB: number;
  tacticA: TeamTactic;
  tacticB: TeamTactic;
  mutator: ActiveMutatorInfo | null;
  bounds: ArenaBounds;
  pinballActive: boolean;
  hotPotatoActive: boolean;
  windX: number;
  windY: number;
  balls: NetBallState[];
  players: NetPlayerState[];
  stats?: MatchStats;
  replay?: NetReplayPayload;
}

export type NetReliableMessage =
  | { t: 'hello'; config: OnlineRoomConfig }
  | { t: 'events'; events: GameEvent[]; snapshot?: NetStateSnapshot }
  | { t: 'rematch_req' }
  | { t: 'rematch_start'; config: OnlineRoomConfig }
  | { t: 'leave'; reason?: string };

export type NetPingMessage =
  | { t: 'ping'; ts: number }
  | { t: 'pong'; ts: number };

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * Converts local single-tick edge actions into monotonic counters so dropped unreliable
 * UDP packets still trigger shots, passes, tackles, switches, fever, and tactics reliably on Host.
 */
export class ActionEdgeTracker {
  private seq = 0;
  private kickSeq = 0;
  private dashSeq = 0;
  private switchSeq = 0;
  private passSeq = 0;
  private feverSeq = 0;
  private tacticSeq = 0;
  private directTacticSeq = 0;
  private directTacticVal: TeamTactic | undefined;

  reset(): void {
    this.seq = 0;
    this.kickSeq = 0;
    this.dashSeq = 0;
    this.switchSeq = 0;
    this.passSeq = 0;
    this.feverSeq = 0;
    this.tacticSeq = 0;
    this.directTacticSeq = 0;
    this.directTacticVal = undefined;
  }

  encode(input: PlayerInput, directTactic?: TeamTactic | null): NetInputPacket {
    this.seq += 1;
    if (input.kickJustReleased) this.kickSeq += 1;
    if (input.dashJustPressed) this.dashSeq += 1;
    if (input.switchJustPressed) this.switchSeq += 1;
    if (input.passJustPressed) this.passSeq += 1;
    if (input.feverJustPressed) this.feverSeq += 1;
    if (input.tacticCycleJustPressed) this.tacticSeq += 1;
    if (directTactic) {
      this.directTacticSeq += 1;
      this.directTacticVal = directTactic;
    }

    const pkt: NetInputPacket = {
      t: 'in',
      seq: this.seq,
      mx: round3(input.moveX),
      my: round3(input.moveY),
      kh: input.kickHeld,
      ks: this.kickSeq,
      ds: this.dashSeq,
      ss: this.switchSeq,
      ps: this.passSeq,
      fs: this.feverSeq,
      ts: this.tacticSeq,
    };
    if (this.directTacticSeq > 0 && this.directTacticVal) {
      pkt.dts = this.directTacticSeq;
      pkt.dt = this.directTacticVal;
    }
    return pkt;
  }
}

/** Decodes incoming Guest input packets on Host, firing each edge action counter once. */
export class HostRemoteInputDecoder {
  private lastPktSeq = 0;
  private moveX = 0;
  private moveY = 0;
  private kickHeld = false;

  private appliedKickSeq = 0;
  private appliedDashSeq = 0;
  private appliedSwitchSeq = 0;
  private appliedPassSeq = 0;
  private appliedFeverSeq = 0;
  private appliedTacticSeq = 0;
  private appliedDirectTacticSeq = 0;

  private pendingKick = false;
  private pendingDash = false;
  private pendingSwitch = false;
  private pendingPass = false;
  private pendingFever = false;
  private pendingTactic = false;
  private pendingDirectTactic: TeamTactic | null = null;

  reset(): void {
    this.lastPktSeq = 0;
    this.moveX = 0;
    this.moveY = 0;
    this.kickHeld = false;
    this.appliedKickSeq = 0;
    this.appliedDashSeq = 0;
    this.appliedSwitchSeq = 0;
    this.appliedPassSeq = 0;
    this.appliedFeverSeq = 0;
    this.appliedTacticSeq = 0;
    this.appliedDirectTacticSeq = 0;
    this.pendingKick = false;
    this.pendingDash = false;
    this.pendingSwitch = false;
    this.pendingPass = false;
    this.pendingFever = false;
    this.pendingTactic = false;
    this.pendingDirectTactic = null;
  }

  ingest(pkt: NetInputPacket): void {
    if (pkt.seq > this.lastPktSeq) {
      this.lastPktSeq = pkt.seq;
      this.moveX = Math.max(-1, Math.min(1, pkt.mx));
      this.moveY = Math.max(-1, Math.min(1, pkt.my));
      this.kickHeld = Boolean(pkt.kh);
    }

    if (pkt.ks > this.appliedKickSeq) {
      this.appliedKickSeq = pkt.ks;
      this.pendingKick = true;
    }
    if (pkt.ds > this.appliedDashSeq) {
      this.appliedDashSeq = pkt.ds;
      this.pendingDash = true;
    }
    if (pkt.ss > this.appliedSwitchSeq) {
      this.appliedSwitchSeq = pkt.ss;
      this.pendingSwitch = true;
    }
    if (pkt.ps > this.appliedPassSeq) {
      this.appliedPassSeq = pkt.ps;
      this.pendingPass = true;
    }
    if (pkt.fs > this.appliedFeverSeq) {
      this.appliedFeverSeq = pkt.fs;
      this.pendingFever = true;
    }
    if (pkt.ts > this.appliedTacticSeq) {
      this.appliedTacticSeq = pkt.ts;
      this.pendingTactic = true;
    }
    if ((pkt.dts ?? 0) > this.appliedDirectTacticSeq && pkt.dt) {
      this.appliedDirectTacticSeq = pkt.dts ?? 0;
      this.pendingDirectTactic = pkt.dt;
    }
  }

  consumeTick(): { input: PlayerInput; directTactic: TeamTactic | null } {
    const input: PlayerInput = {
      moveX: this.moveX,
      moveY: this.moveY,
      kickHeld: this.kickHeld,
      kickJustReleased: this.pendingKick,
      dashJustPressed: this.pendingDash,
      switchJustPressed: this.pendingSwitch,
      passJustPressed: this.pendingPass,
      feverJustPressed: this.pendingFever,
      tacticCycleJustPressed: this.pendingTactic,
    };
    const directTactic = this.pendingDirectTactic;

    this.pendingKick = false;
    this.pendingDash = false;
    this.pendingSwitch = false;
    this.pendingPass = false;
    this.pendingFever = false;
    this.pendingTactic = false;
    this.pendingDirectTactic = null;

    return { input, directTactic };
  }
}

export interface SnapshotSource {
  phase: MatchPhase;
  phaseTimer: number;
  timeRemaining: number;
  scoreA: number;
  scoreB: number;
  winner: Team | null;
  isGoldenGoal: boolean;
  lastScoringTeam: Team | null;
  teamFeverA: number;
  teamFeverB: number;
  teamFeverTimerA: number;
  teamFeverTimerB: number;
  teamTacticA: TeamTactic;
  teamTacticB: TeamTactic;
  bounds: ArenaBounds;
  params: {
    pinballActive: boolean;
    hotPotatoActive: boolean;
    windX: number;
    windY: number;
  };
  balls: Ball[];
  players: Player[];
  stats: MatchStats;
  mutators: { getActive(): ActiveMutatorInfo | null };
  replay: {
    getCurrentPlaybackFrame(): ReplayFrame | null;
    getPlaybackProgress(): number;
    activeGoalTag: string;
    scoringTeam: Team;
  };
}

/** Encodes authoritative Host simulation state into a compact wire snapshot. */
export function buildNetSnapshot(
  source: SnapshotSource,
  seq: number,
  simTimeMs: number,
  includeStats: boolean
): NetStateSnapshot {
  const mut = source.mutators.getActive();
  const snap: NetStateSnapshot = {
    t: 'st',
    seq,
    simTime: Math.round(simTimeMs),
    phase: source.phase,
    phaseTimer: round2(source.phaseTimer),
    timeRemaining: round2(source.timeRemaining),
    scoreA: source.scoreA,
    scoreB: source.scoreB,
    winner: source.winner,
    isGoldenGoal: source.isGoldenGoal,
    lastScoringTeam: source.lastScoringTeam,
    feverA: round1(source.teamFeverA),
    feverB: round1(source.teamFeverB),
    feverTimerA: round2(source.teamFeverTimerA),
    feverTimerB: round2(source.teamFeverTimerB),
    tacticA: source.teamTacticA,
    tacticB: source.teamTacticB,
    mutator: mut
      ? {
          ...mut,
          remainingSeconds: round1(mut.remainingSeconds),
        }
      : null,
    bounds: { ...source.bounds },
    pinballActive: source.params.pinballActive,
    hotPotatoActive: source.params.hotPotatoActive,
    windX: round1(source.params.windX),
    windY: round1(source.params.windY),
    balls: source.balls.map((b) => ({
      id: b.id,
      x: round2(b.x),
      y: round2(b.y),
      vx: round1(b.vx),
      vy: round1(b.vy),
      z: round2(b.z),
      vz: round1(b.vz),
      r: round1(b.radius),
      ra: round2(b.rollAngle),
      ut: round2(b.untouchedTimer),
      cid: b.carrierId ?? null,
      ex: b.isExtraBall,
      ot: round2(b.oneTimerTimer ?? 0),
      ft: round2(b.feverTimer ?? 0),
    })),
    players: source.players.map((p) => ({
      id: p.id,
      team: p.team,
      role: p.role,
      hs: p.humanSlot,
      x: round2(p.x),
      y: round2(p.y),
      vx: round1(p.vx),
      vy: round1(p.vy),
      fx: round3(p.facingX),
      fy: round3(p.facingY),
      st: p.animState,
      at: round2(p.animTime),
      su: round2(p.stunTimer),
      ic: p.isCharging,
      ct: round2(p.chargeTime),
      dc: round2(p.dashCooldown),
      ft: round2(p.feintTimer ?? 0),
      fa: Boolean(p.feverActive),
    })),
  };

  if (includeStats || source.phase === 'FULL_TIME') {
    snap.stats = { ...source.stats };
  }
  if (source.phase === 'REPLAY') {
    snap.replay = {
      frame: source.replay.getCurrentPlaybackFrame(),
      prog: round3(source.replay.getPlaybackProgress()),
      tag: source.replay.activeGoalTag,
      team: source.replay.scoringTeam,
    };
  }
  return snap;
}

const MAX_BUFFER_SNAPSHOTS = 10;
const INTERP_DELAY_MS = 42;
const MAX_EXTRAP_SEC = 0.075;
const TELEPORT_SNAP_DIST = 72;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Buffers recent Host snapshots and computes smooth 60/120fps interpolated entities on Guest.
 */
export class NetInterpolator {
  private buffer: NetStateSnapshot[] = [];
  private highestSeq = -1;
  private hostClockOffsetMs: number | null = null;

  reset(): void {
    this.buffer = [];
    this.highestSeq = -1;
    this.hostClockOffsetMs = null;
  }

  pushSnapshot(snapshot: NetStateSnapshot, localNowMs: number): boolean {
    if (snapshot.seq <= this.highestSeq) return false;
    this.highestSeq = snapshot.seq;

    const measuredOffset = localNowMs - snapshot.simTime;
    if (this.hostClockOffsetMs === null || Math.abs(measuredOffset - this.hostClockOffsetMs) > 140) {
      this.hostClockOffsetMs = measuredOffset;
    } else {
      // Slow drift adjustment while pulling offset down slightly on early arrivals
      const alpha = measuredOffset < this.hostClockOffsetMs ? 0.25 : 0.04;
      this.hostClockOffsetMs = this.hostClockOffsetMs * (1 - alpha) + measuredOffset * alpha;
    }

    this.buffer.push(snapshot);
    if (this.buffer.length > MAX_BUFFER_SNAPSHOTS) {
      this.buffer.shift();
    }
    return true;
  }

  getLatestSnapshot(): NetStateSnapshot | null {
    return this.buffer.length > 0 ? this.buffer[this.buffer.length - 1] : null;
  }

  sample(localNowMs: number): NetStateSnapshot | null {
    if (this.buffer.length === 0 || this.hostClockOffsetMs === null) return null;
    const latest = this.buffer[this.buffer.length - 1];
    if (this.buffer.length === 1 || latest.phase === 'REPLAY' || latest.phase === 'FULL_TIME') {
      return latest;
    }

    const renderSimTime = localNowMs - this.hostClockOffsetMs - INTERP_DELAY_MS;

    // Extrapolate slightly ahead of latest snapshot if packet hasn't arrived yet
    if (renderSimTime >= latest.simTime) {
      const extraSec = Math.min(MAX_EXTRAP_SEC, (renderSimTime - latest.simTime) / 1000);
      if (extraSec <= 0.001 || latest.phase !== 'PLAYING') return latest;
      return {
        ...latest,
        balls: latest.balls.map((b) =>
          b.cid !== null
            ? b
            : {
                ...b,
                x: b.x + b.vx * extraSec,
                y: b.y + b.vy * extraSec,
              }
        ),
        players: latest.players.map((p) => ({
          ...p,
          x: p.x + p.vx * extraSec,
          y: p.y + p.vy * extraSec,
        })),
      };
    }

    // Find bracketing pair [from, to]
    let from = this.buffer[0];
    let to = latest;
    for (let i = 0; i < this.buffer.length - 1; i++) {
      if (this.buffer[i].simTime <= renderSimTime && this.buffer[i + 1].simTime >= renderSimTime) {
        from = this.buffer[i];
        to = this.buffer[i + 1];
        break;
      }
    }

    const span = to.simTime - from.simTime;
    const t = span > 0 ? Math.max(0, Math.min(1, (renderSimTime - from.simTime) / span)) : 1;

    const fromBalls = new Map(from.balls.map((b) => [b.id, b]));
    const fromPlayers = new Map(from.players.map((p) => [p.id, p]));

    const balls: NetBallState[] = to.balls.map((bTo) => {
      const bFrom = fromBalls.get(bTo.id);
      if (!bFrom || Math.hypot(bTo.x - bFrom.x, bTo.y - bFrom.y) > TELEPORT_SNAP_DIST) {
        return bTo;
      }
      return {
        ...bTo,
        x: lerp(bFrom.x, bTo.x, t),
        y: lerp(bFrom.y, bTo.y, t),
        z: lerp(bFrom.z, bTo.z, t),
        ra: lerp(bFrom.ra, bTo.ra, t),
      };
    });

    const players: NetPlayerState[] = to.players.map((pTo) => {
      const pFrom = fromPlayers.get(pTo.id);
      if (!pFrom || Math.hypot(pTo.x - pFrom.x, pTo.y - pFrom.y) > TELEPORT_SNAP_DIST) {
        return pTo;
      }
      const fx = lerp(pFrom.fx, pTo.fx, t);
      const fy = lerp(pFrom.fy, pTo.fy, t);
      const fLen = Math.hypot(fx, fy) || 1;
      return {
        ...pTo,
        x: lerp(pFrom.x, pTo.x, t),
        y: lerp(pFrom.y, pTo.y, t),
        fx: fx / fLen,
        fy: fy / fLen,
      };
    });

    return {
      ...to,
      balls,
      players,
    };
  }
}
