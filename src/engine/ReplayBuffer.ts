import { ArenaBounds, ArenaId, Ball, Player, PlayerAnimState, Team, TeamKitId } from '../types.ts';

export interface ReplayBallSnapshot {
  id: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  rollAngle: number;
  untouchedTimer: number;
  carrierId?: number | null;
  isExtraBall?: boolean;
  feverTimer?: number;
}

export interface ReplayPlayerSnapshot {
  id: number;
  team: Team;
  role: 'outfield' | 'keeper';
  humanSlot: 1 | 2 | null;
  x: number;
  y: number;
  facingX: number;
  facingY: number;
  animState: PlayerAnimState;
  animTime: number;
  stunTimer: number;
  isCharging: boolean;
  chargeTime: number;
  dashCooldown: number;
  feintTimer?: number;
  feverActive?: boolean;
}

export interface ReplayFrame {
  arenaId: ArenaId;
  teamAKit: TeamKitId;
  teamBKit: TeamKitId;
  bounds: ArenaBounds;
  hotPotatoActive: boolean;
  pinballActive: boolean;
  isIce: boolean;
  windX: number;
  windY: number;
  balls: ReplayBallSnapshot[];
  players: ReplayPlayerSnapshot[];
}

const MAX_REPLAY_FRAMES = 180; // 3 seconds at 60Hz

export class ReplayBuffer {
  private frames: ReplayFrame[] = [];
  private playbackFrames: ReplayFrame[] = [];
  private playbackCursor = 0;
  private remoteFrame: ReplayFrame | null = null;
  private remoteProgress = 0;
  public activeGoalTag = 'SPECTACULAR GOAL!';
  public scoringTeam: Team = 'A';

  clear(): void {
    this.frames = [];
  }

  clearPlayback(): void {
    this.playbackFrames = [];
    this.playbackCursor = 0;
    this.remoteFrame = null;
    this.remoteProgress = 0;
  }

  /** Mirrors replay frame and progress streamed by an online host during Goal Replay. */
  setRemotePlayback(
    frame: ReplayFrame | null,
    progress: number,
    goalTag: string,
    scoringTeam: Team
  ): void {
    this.remoteFrame = frame;
    this.remoteProgress = progress;
    this.activeGoalTag = goalTag;
    this.scoringTeam = scoringTeam;
  }

  recordFrame(
    arenaId: ArenaId,
    teamAKit: TeamKitId,
    teamBKit: TeamKitId,
    bounds: ArenaBounds,
    hotPotatoActive: boolean,
    pinballActive: boolean,
    isIce: boolean,
    windX: number,
    windY: number,
    balls: Ball[],
    players: Player[]
  ): void {
    const snapshot: ReplayFrame = {
      arenaId,
      teamAKit,
      teamBKit,
      bounds: { ...bounds },
      hotPotatoActive,
      pinballActive,
      isIce,
      windX,
      windY,
      balls: balls.map((b) => ({
        id: b.id,
        x: b.x,
        y: b.y,
        z: b.z,
        radius: b.radius,
        rollAngle: b.rollAngle,
        untouchedTimer: b.untouchedTimer,
        carrierId: b.carrierId ?? null,
        isExtraBall: b.isExtraBall,
        feverTimer: b.feverTimer ?? 0,
      })),
      players: players.map((p) => ({
        id: p.id,
        team: p.team,
        role: p.role,
        humanSlot: p.humanSlot,
        x: p.x,
        y: p.y,
        facingX: p.facingX,
        facingY: p.facingY,
        animState: p.animState,
        animTime: p.animTime,
        stunTimer: p.stunTimer,
        isCharging: p.isCharging,
        chargeTime: p.chargeTime,
        dashCooldown: p.dashCooldown,
        feintTimer: p.feintTimer ?? 0,
        feverActive: Boolean(p.feverActive),
      })),
    };

    this.frames.push(snapshot);
    if (this.frames.length > MAX_REPLAY_FRAMES) {
      this.frames.shift();
    }
  }

  getRecordedCount(): number {
    return this.frames.length;
  }

  startPlayback(goalTag: string, scoringTeam: Team): boolean {
    if (this.frames.length < 30) return false;
    this.playbackFrames = this.frames.slice(-MAX_REPLAY_FRAMES);
    this.playbackCursor = 0;
    this.activeGoalTag = goalTag;
    this.scoringTeam = scoringTeam;
    return true;
  }

  /**
   * Advances replay playback cursor. Final ~40 frames run at 0.55x slow-motion for dramatic finish!
   * Returns true while playback is still running, false when complete.
   */
  advancePlayback(): boolean {
    if (this.playbackFrames.length === 0) return false;
    const remaining = this.playbackFrames.length - 1 - this.playbackCursor;
    const step = remaining <= 40 ? 0.55 : 1.15;
    this.playbackCursor += step;
    return this.playbackCursor < this.playbackFrames.length - 1;
  }

  getCurrentPlaybackFrame(): ReplayFrame | null {
    if (this.remoteFrame) return this.remoteFrame;
    if (this.playbackFrames.length === 0) return null;
    const idx = Math.min(this.playbackFrames.length - 1, Math.floor(this.playbackCursor));
    return this.playbackFrames[idx] ?? null;
  }

  getPlaybackProgress(): number {
    if (this.remoteFrame) return Math.max(0, Math.min(1, this.remoteProgress));
    if (this.playbackFrames.length <= 1) return 1;
    return Math.min(1, this.playbackCursor / (this.playbackFrames.length - 1));
  }
}
