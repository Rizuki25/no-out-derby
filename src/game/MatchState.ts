import {
  ArenaBounds,
  ArenaId,
  Ball,
  GameEvent,
  MatchConfig,
  MatchPhase,
  MatchStats,
  MutatorType,
  PhysicsParams,
  Player,
  PlayerInput,
  Team,
} from '../types.ts';
import { createArenaBounds } from '../engine/ArenaGeometry.ts';
import { ARENA_PRESETS } from '../engine/ArenaPresets.ts';
import { createDefaultPhysicsParams, PhysicsEngine } from '../engine/PhysicsEngine.ts';
import { ReplayBuffer } from '../engine/ReplayBuffer.ts';
import { AIController, createEmptyInput } from './AIController.ts';
import { createDefaultTeamModifiers, DerbyCupState } from './DerbyCup.ts';
import { MutatorManager } from './MutatorManager.ts';

export class MatchState {
  public phase: MatchPhase = 'MENU';
  public config: MatchConfig = {
    mode: '1v1_ai',
    arena: 'classic',
    pitchSize: 'standard',
    difficulty: 'pro',
    durationSeconds: 90,
    mutatorsEnabled: true,
    replayEnabled: true,
    controlStyle: 'classic',
    displayMode: 'auto',
    teamAKit: 'garuda',
    teamBKit: 'cyber',
  };

  public bounds: ArenaBounds = createArenaBounds(1.0, 'classic');
  public params: PhysicsParams = createDefaultPhysicsParams('classic');
  public balls: Ball[] = [];
  public players: Player[] = [];
  public scoreA = 0;
  public scoreB = 0;
  public timeRemaining = 90;
  public elapsedSeconds = 0;
  public isGoldenGoal = false;
  public lastScoringTeam: Team | null = null;
  public winner: Team | null = null;
  public stats: MatchStats = this.createEmptyStats();

  public phaseTimer = 0;
  private kickoffCountdownSecond = 0;
  private pendingFullTimeAfterGoal = false;
  private pendingReplayAfterGoal = false;
  private pendingReplayTag = 'POWER GOAL!';
  private pendingReplayTeam: Team = 'A';
  private recentBounceAge = 99;
  private recentOneTimerAge = 99;
  private replayTrailingFrames = 0;
  private autoSwitchCooldownP1 = 0;
  private autoSwitchCooldownP2 = 0;
  public sandboxDefenderEnabled = false;

  public readonly physics = new PhysicsEngine();
  public readonly ai = new AIController();
  public readonly mutators: MutatorManager;
  public readonly cup: DerbyCupState;
  public readonly replay = new ReplayBuffer();

  constructor(rng: () => number = Math.random) {
    this.mutators = new MutatorManager(rng);
    this.cup = new DerbyCupState(rng);
  }

  private createEmptyStats(): MatchStats {
    return {
      teamAShots: 0,
      teamBShots: 0,
      wallBounces: 0,
      tackles: 0,
      topBallSpeed: 0,
      teamASaves: 0,
      teamBSaves: 0,
      teamASteals: 0,
      teamABankShots: 0,
      teamAOneTimers: 0,
    };
  }

  startMatch(config: MatchConfig, preserveCup = false): GameEvent[] {
    const isCupMode =
      config.mode === 'derby_cup_1v1' ||
      config.mode === 'derby_cup_2v2' ||
      config.mode === 'derby_cup_3v3';
    const isSandbox = config.mode === 'practice_sandbox';
    this.config = {
      ...config,
      arena: config.arena ?? 'classic',
      pitchSize: config.pitchSize ?? 'standard',
      controlStyle: config.controlStyle ?? 'classic',
      displayMode: config.displayMode ?? 'auto',
      teamAKit: config.teamAKit ?? 'garuda',
      teamBKit: config.teamBKit ?? 'cyber',
      replayEnabled: isSandbox ? false : (config.replayEnabled ?? true),
    };

    if (!preserveCup) {
      this.sandboxDefenderEnabled = false;
      if (isCupMode) {
        const round = this.cup.startNewCup(config.mode !== 'derby_cup_1v1');
        this.config.arena = round.arena;
        this.config.difficulty = round.difficulty;
      } else {
        this.cup.reset();
      }
    } else if (this.cup.active) {
      const round = this.cup.getCurrentRound();
      this.config.arena = round.arena;
      this.config.difficulty = round.difficulty;
    }

    this.scoreA = 0;
    this.scoreB = 0;
    this.timeRemaining = this.config.durationSeconds;
    this.elapsedSeconds = 0;
    this.isGoldenGoal = false;
    this.lastScoringTeam = null;
    this.winner = null;
    this.pendingFullTimeAfterGoal = false;
    this.pendingReplayAfterGoal = false;
    this.recentBounceAge = 99;
    this.recentOneTimerAge = 99;
    this.replayTrailingFrames = 0;
    this.replay.clear();
    this.replay.clearPlayback();
    this.stats = this.createEmptyStats();
    this.params = createDefaultPhysicsParams(this.config.arena);
    this.params.controlStyle = this.config.controlStyle ?? 'classic';
    const pitchSize = this.config.pitchSize ?? 'standard';
    this.bounds = createArenaBounds(1.0, this.config.arena, pitchSize);
    this.mutators.reset(
      this.config.durationSeconds,
      isSandbox ? false : this.config.mutatorsEnabled,
      this.config.arena,
      pitchSize
    );

    this.spawnEntitiesForMode();
    this.phase = 'KICKOFF';
    this.phaseTimer = isSandbox ? 0.35 : 0.9;
    this.kickoffCountdownSecond = isSandbox ? 1 : 3;

    return [{ type: 'countdown_beep', final: false }];
  }

  rematch(): GameEvent[] {
    if (this.cup.active) {
      return this.startMatch(this.config, false);
    }
    return this.startMatch(this.config, false);
  }

  advanceFromCupResult(): void {
    if (!this.cup.active || this.winner !== 'A') return;
    if (this.cup.isFinalRound()) {
      this.phase = 'CUP_CHAMPION';
    } else {
      this.cup.preparePerkOffer();
      this.phase = 'PERK_SELECT';
    }
  }

  pickCupPerk(choiceIndex: number): GameEvent[] {
    if (!this.cup.active) return [];
    const nextRound = this.cup.selectPerkAndAdvance(choiceIndex);
    this.config.arena = nextRound.arena;
    this.config.difficulty = nextRound.difficulty;
    return this.startMatch(this.config, true);
  }

  skipReplay(): GameEvent[] {
    if (this.phase !== 'REPLAY') return [];
    this.replay.clearPlayback();
    this.replay.clear();
    return this.finishPostGoalTransition();
  }

  togglePause(): void {
    if (this.phase === 'PLAYING' || this.phase === 'KICKOFF') {
      this.phase = 'PAUSED';
    } else if (this.phase === 'PAUSED') {
      this.phase = this.phaseTimer > 0 && this.kickoffCountdownSecond > 0 ? 'KICKOFF' : 'PLAYING';
    }
  }

  returnToMenu(): void {
    this.phase = 'MENU';
    this.balls = [];
    this.players = [];
    this.cup.reset();
    this.replay.clear();
    this.replay.clearPlayback();
    this.bounds = this.mutators.clearAll(this.balls, this.params);
  }

  isTwoPlayerMode(): boolean {
    return (
      this.config.mode === '1v1_local' ||
      this.config.mode === '2v2_local' ||
      this.config.mode === '2v2_coop' ||
      this.config.mode === '3v3_local' ||
      this.config.mode === '3v3_coop'
    );
  }

  isTwoVsTwoMode(): boolean {
    return (
      this.config.mode === '2v2_ai' ||
      this.config.mode === 'derby_cup_2v2' ||
      this.config.mode === '2v2_local' ||
      this.config.mode === '2v2_coop'
    );
  }

  isThreeVsThreeMode(): boolean {
    return (
      this.config.mode === '3v3_ai' ||
      this.config.mode === 'derby_cup_3v3' ||
      this.config.mode === '3v3_local' ||
      this.config.mode === '3v3_coop'
    );
  }

  hasTwoOutfieldPerTeam(): boolean {
    return this.isTwoVsTwoMode() || this.isThreeVsThreeMode();
  }

  hasKeepers(): boolean {
    return !this.isTwoVsTwoMode();
  }

  canHumanSwitchPlayer(): boolean {
    return (
      this.config.mode === '2v2_ai' ||
      this.config.mode === 'derby_cup_2v2' ||
      this.config.mode === '2v2_local' ||
      this.config.mode === '3v3_ai' ||
      this.config.mode === 'derby_cup_3v3' ||
      this.config.mode === '3v3_local'
    );
  }

  isPracticeSandbox(): boolean {
    return this.config.mode === 'practice_sandbox';
  }

  isFinalStretch(): boolean {
    return !this.isGoldenGoal && !this.isPracticeSandbox() && this.timeRemaining <= 15 && this.phase === 'PLAYING';
  }

  getActiveArena(): ArenaId {
    return this.config.arena;
  }

  update(dt: number, humanSlotInputs: { p1: PlayerInput; p2: PlayerInput }): GameEvent[] {
    const events: GameEvent[] = [];

    if (
      this.phase === 'MENU' ||
      this.phase === 'PAUSED' ||
      this.phase === 'FULL_TIME' ||
      this.phase === 'PERK_SELECT' ||
      this.phase === 'CUP_CHAMPION'
    ) {
      return events;
    }

    if (this.phase === 'KICKOFF') {
      this.phaseTimer -= dt;
      const secBucket = Math.ceil(this.phaseTimer * 3);
      if (secBucket > 0 && secBucket < this.kickoffCountdownSecond) {
        this.kickoffCountdownSecond = secBucket;
        events.push({ type: 'countdown_beep', final: false });
      }
      if (this.phaseTimer <= 0) {
        this.phase = 'PLAYING';
        this.kickoffCountdownSecond = 0;
        events.push({ type: 'whistle', kind: 'kickoff' });
      }
      return events;
    }

    if (this.phase === 'GOLDEN_GOAL_INTRO') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this.resetPositionsForKickoff();
        this.phase = 'PLAYING';
        events.push({ type: 'whistle', kind: 'golden_goal' });
      }
      return events;
    }

    if (this.phase === 'REPLAY') {
      const stillPlaying = this.replay.advancePlayback();
      if (!stillPlaying) {
        this.replay.clearPlayback();
        this.replay.clear();
        return this.finishPostGoalTransition();
      }
      return events;
    }

    if (this.phase === 'GOAL_CELEBRATION') {
      this.phaseTimer -= dt;
      // Keep physics rolling gently in slow-mo so the ball settles inside the net!
      const emptyInputs = new Map<number, PlayerInput>();
      this.physics.step(dt, this.balls, this.players, emptyInputs, this.bounds, this.params, false);

      if (this.replayTrailingFrames > 0) {
        this.replayTrailingFrames--;
        this.recordReplaySnapshot();
      }

      if (this.phaseTimer <= 0) {
        if (this.pendingReplayAfterGoal && this.replay.startPlayback(this.pendingReplayTag, this.pendingReplayTeam)) {
          this.pendingReplayAfterGoal = false;
          this.phase = 'REPLAY';
          return events;
        }
        return this.finishPostGoalTransition();
      }
      return events;
    }

    // PLAYING phase
    this.elapsedSeconds += dt;
    this.recentBounceAge += dt;
    this.recentOneTimerAge += dt;
    if (!this.isGoldenGoal && !this.isPracticeSandbox()) {
      this.timeRemaining = Math.max(0, this.timeRemaining - dt);
    }

    // Gentle rooftop side wind modulation
    if (ARENA_PRESETS[this.config.arena].hasWind) {
      this.params.windY = Math.sin(this.elapsedSeconds * 0.34) * 24;
      this.params.windX = Math.cos(this.elapsedSeconds * 0.22) * 7;
    } else {
      this.params.windX = 0;
      this.params.windY = 0;
    }

    // Update mutators
    this.bounds = this.mutators.update(
      dt,
      this.elapsedSeconds,
      this.isGoldenGoal,
      this.balls,
      this.params,
      this.bounds,
      events
    );

    // Handle 2v2 manual & smart auto-switching
    if (this.autoSwitchCooldownP1 > 0) this.autoSwitchCooldownP1 -= dt;
    if (this.autoSwitchCooldownP2 > 0) this.autoSwitchCooldownP2 -= dt;
    this.handlePlayerSwitching(humanSlotInputs);

    // Build per-player inputs (human vs AI)
    const inputMap = new Map<number, PlayerInput>();
    for (const p of this.players) {
      if (p.humanSlot === 1) {
        inputMap.set(p.id, humanSlotInputs.p1);
      } else if (p.humanSlot === 2) {
        inputMap.set(p.id, humanSlotInputs.p2);
      } else {
        inputMap.set(
          p.id,
          this.ai.computeInput(dt, p, this.players, this.balls, this.bounds, this.config.difficulty)
        );
      }
    }

    const teamModifiers = {
      A: this.cup.active ? this.cup.getTeamAModifiers() : createDefaultTeamModifiers(),
      B: createDefaultTeamModifiers(),
    };

    // Step physics
    const stepResult = this.physics.step(
      dt,
      this.balls,
      this.players,
      inputMap,
      this.bounds,
      this.params,
      true,
      teamModifiers
    );
    events.push(...stepResult.events);

    // Record frame into Instant Replay ring buffer
    this.recordReplaySnapshot();

    // Track stats & highlight recency (Bank Shot / One-Timer detection)
    for (const ev of stepResult.events) {
      if (ev.type === 'kick') {
        if (ev.team === 'A') this.stats.teamAShots++;
        else this.stats.teamBShots++;
        if (ev.isOneTimer) {
          this.recentOneTimerAge = 0;
        }
      } else if (ev.type === 'wall_bounce') {
        this.stats.wallBounces++;
        this.recentBounceAge = 0;
      } else if (ev.type === 'post_clang') {
        this.recentBounceAge = 0;
      } else if (ev.type === 'save') {
        if (ev.team === 'A') this.stats.teamASaves++;
        else this.stats.teamBSaves++;
      } else if (ev.type === 'tackle') {
        this.stats.tackles++;
        if (ev.stoleBall && ev.team === 'A') this.stats.teamASteals++;
      }
    }
    for (const b of this.balls) {
      const spd = Math.hypot(b.vx, b.vy);
      if (spd > this.stats.topBallSpeed) {
        this.stats.topBallSpeed = Math.round(spd);
      }
    }

    // Check Goal Scored
    if (stepResult.scoredBy !== null) {
      for (const ball of this.balls) {
        ball.carrierId = null;
      }
      if (stepResult.scoredBy === 'A') {
        this.scoreA++;
      } else {
        this.scoreB++;
      }
      this.lastScoringTeam = stepResult.scoredBy;
      const goalPos = stepResult.scoredBallPos ?? { x: this.bounds.centerX, y: this.bounds.centerY };

      const scoringBall = this.balls[0];
      const ballSpeed = scoringBall ? Math.hypot(scoringBall.vx, scoringBall.vy) : 0;
      const lastKickPower = scoringBall?.lastKickPower ?? 0;
      const isBankShot = this.recentBounceAge < 1.35;
      const isOneTimerGoal = this.recentOneTimerAge < 1.6;
      const isTopBin =
        Math.abs(goalPos.y - this.bounds.goalTopY) <= 10 ||
        Math.abs(goalPos.y - this.bounds.goalBottomY) <= 10;
      const isRocketShot = lastKickPower >= 0.78 || ballSpeed >= 270;

      const highlightTag = isOneTimerGoal
        ? 'ONE-TIMER!'
        : isBankShot
          ? 'BANK SHOT!'
          : isRocketShot
            ? 'ROCKET!'
            : isTopBin
              ? 'TOP BIN!'
              : undefined;

      if (stepResult.scoredBy === 'A') {
        if (highlightTag === 'BANK SHOT!') this.stats.teamABankShots++;
        else if (highlightTag === 'ONE-TIMER!') this.stats.teamAOneTimers++;
      }

      events.push({
        type: 'goal',
        scoringTeam: stepResult.scoredBy,
        x: goalPos.x,
        y: goalPos.y,
        isGoldenGoal: this.isGoldenGoal,
        highlightTag,
      });

      const isSpectacular =
        this.isGoldenGoal ||
        this.params.pinballActive ||
        isOneTimerGoal ||
        isBankShot ||
        isRocketShot ||
        isTopBin ||
        ballSpeed >= 190 ||
        lastKickPower >= 0.55 ||
        this.balls.length > 1;

      this.pendingReplayTag = this.isGoldenGoal
        ? 'GOLDEN GOAL!'
        : this.params.pinballActive
          ? 'PINBALL GOAL!'
          : isOneTimerGoal
            ? 'ONE-TIMER GOAL!'
            : isBankShot
              ? 'BANK SHOT!'
              : isRocketShot
                ? 'ROCKET GOAL!'
                : isTopBin
                  ? 'TOP BIN!'
                  : 'POWER GOAL!';
      this.pendingReplayTeam = stepResult.scoredBy;
      this.pendingReplayAfterGoal =
        !this.isPracticeSandbox() &&
        Boolean(this.config.replayEnabled) &&
        isSpectacular &&
        this.replay.getRecordedCount() >= 30;
      this.replayTrailingFrames = 14;

      this.phase = 'GOAL_CELEBRATION';
      this.phaseTimer = this.isPracticeSandbox() ? 0.32 : this.isGoldenGoal ? 0.5 : 0.42;
      this.pendingFullTimeAfterGoal = this.isGoldenGoal && !this.isPracticeSandbox();
      return events;
    }

    // Check Full-Time or Golden Goal tie-breaker
    if (!this.isGoldenGoal && !this.isPracticeSandbox() && this.timeRemaining <= 0) {
      if (this.scoreA === this.scoreB) {
        this.isGoldenGoal = true;
        this.bounds = this.mutators.clearAll(this.balls, this.params);
        this.phase = 'GOLDEN_GOAL_INTRO';
        this.phaseTimer = 1.05;
        events.push({ type: 'whistle', kind: 'golden_goal' });
      } else {
        this.concludeMatch();
        events.push({ type: 'whistle', kind: 'fulltime' });
      }
    }

    return events;
  }

  private finishPostGoalTransition(): GameEvent[] {
    const events: GameEvent[] = [];
    if (this.pendingFullTimeAfterGoal) {
      this.pendingFullTimeAfterGoal = false;
      this.concludeMatch();
      events.push({ type: 'whistle', kind: 'fulltime' });
    } else {
      this.resetPositionsForKickoff();
      this.mutators.ensureMultiBallOnKickoff(this.balls, this.params, this.bounds);
      this.replay.clear();
      this.phase = 'KICKOFF';
      this.phaseTimer = this.isPracticeSandbox() ? 0.35 : 0.65;
      this.kickoffCountdownSecond = 1;
    }
    return events;
  }

  private concludeMatch(): void {
    this.winner = this.scoreA > this.scoreB ? 'A' : 'B';
    if (this.cup.active) {
      this.cup.recordRoundScore(this.scoreA, this.scoreB);
    }
    this.phase = 'FULL_TIME';
  }

  private recordReplaySnapshot(): void {
    const isIce = this.mutators.getActive()?.type === 'slippery_pitch';
    this.replay.recordFrame(
      this.config.arena,
      this.config.teamAKit ?? 'garuda',
      this.config.teamBKit ?? 'cyber',
      this.bounds,
      this.params.hotPotatoActive,
      this.params.pinballActive,
      isIce,
      this.params.windX,
      this.params.windY,
      this.balls,
      this.players
    );
  }

  private handlePlayerSwitching(humanInputs: { p1: PlayerInput; p2: PlayerInput }): void {
    const { mode } = this.config;
    if (
      mode === '2v2_ai' ||
      mode === 'derby_cup_2v2' ||
      mode === '2v2_local' ||
      mode === '3v3_ai' ||
      mode === 'derby_cup_3v3' ||
      mode === '3v3_local'
    ) {
      this.handleSlotSwitch(1, 'A', humanInputs.p1);
    }
    if (mode === '2v2_local' || mode === '3v3_local') {
      this.handleSlotSwitch(2, 'B', humanInputs.p2);
    }
  }

  private handleSlotSwitch(slot: 1 | 2, team: Team, input: PlayerInput): void {
    const teamOutfield = this.players.filter((p) => p.team === team && p.role === 'outfield');
    if (teamOutfield.length < 2) return;

    const current = teamOutfield.find((p) => p.humanSlot === slot);
    const other = teamOutfield.find((p) => p.humanSlot !== slot);
    if (!current || !other) return;

    if (input.switchJustPressed) {
      current.humanSlot = null;
      current.isCharging = false;
      current.chargeTime = 0;
      other.humanSlot = slot;
      if (slot === 1) this.autoSwitchCooldownP1 = 0.8;
      else this.autoSwitchCooldownP2 = 0.8;
      return;
    }

    const cooldown = slot === 1 ? this.autoSwitchCooldownP1 : this.autoSwitchCooldownP2;
    const isCarrying = this.balls.some((b) => b.carrierId === current.id);
    if (cooldown > 0 || current.isCharging || current.dashTimer > 0 || isCarrying || this.balls.length === 0) return;

    const primaryBall = this.balls[0];
    const distCur = Math.hypot(primaryBall.x - current.x, primaryBall.y - current.y);
    const distOther = Math.hypot(primaryBall.x - other.x, primaryBall.y - other.y);

    const ballBehindCurrent = team === 'A' ? primaryBall.x < current.x - 16 : primaryBall.x > current.x + 16;
    if (ballBehindCurrent && distOther + 24 < distCur) {
      current.humanSlot = null;
      other.humanSlot = slot;
      if (slot === 1) this.autoSwitchCooldownP1 = 0.9;
      else this.autoSwitchCooldownP2 = 0.9;
    }
  }

  private createPlayer(
    id: number,
    team: Team,
    role: 'outfield' | 'keeper',
    humanSlot: 1 | 2 | null,
    x: number,
    y: number,
    shirtNumber: number
  ): Player {
    return {
      id,
      team,
      role,
      humanSlot,
      x,
      y,
      vx: 0,
      vy: 0,
      radius: role === 'keeper' ? 6 : 7.5,
      facingX: team === 'A' ? 1 : -1,
      facingY: 0,
      isCharging: false,
      chargeTime: 0,
      kickSwingTimer: 0,
      kickSwingPower: 0,
      kickSwingDirX: team === 'A' ? 1 : -1,
      kickSwingDirY: 0,
      dashTimer: 0,
      dashCooldown: 0,
      dashDirX: team === 'A' ? 1 : -1,
      dashDirY: 0,
      stunTimer: 0,
      kickContactCooldown: 0,
      pickupCooldown: 0,
      animState: 'idle',
      animTime: 0,
      aiState: 'CHASE_BALL',
      aiDecisionTimer: 0,
      aiTargetX: x,
      aiTargetY: y,
      aiWantCharge: false,
      aiChargeTarget: 0,
      aiWantDash: false,
      shirtNumber,
    };
  }

  private getKickoffSpanScale(): number {
    return Math.max(1, ((this.bounds.right - this.bounds.left) * 0.5) / 204);
  }

  private spawnEntitiesForMode(): void {
    this.players = [];
    const { mode } = this.config;
    const isSandbox = this.isPracticeSandbox();
    const hasTwoOutfield = this.hasTwoOutfieldPerTeam();
    const hasKeepers = this.hasKeepers();
    const is2PLocal = mode === '1v1_local' || mode === '2v2_local' || mode === '3v3_local';
    const isCoop = mode === '2v2_coop' || mode === '3v3_coop';

    let nextId = 1;
    const makePlayer = (
      team: Team,
      role: 'outfield' | 'keeper',
      humanSlot: 1 | 2 | null,
      x: number,
      y: number,
      shirtNumber: number
    ): Player => this.createPlayer(nextId++, team, role, humanSlot, x, y, shirtNumber);

    const cy = this.bounds.centerY;
    const cx = this.bounds.centerX;
    const spanScale = this.getKickoffSpanScale();
    const off1v1X = Math.round(54 * spanScale);
    const off2v2NearX = Math.round(48 * spanScale);
    const off2v2FarX = Math.round(96 * spanScale);
    const off2v2Y = Math.round(26 * spanScale);

    if (isSandbox) {
      this.players.push(makePlayer('A', 'outfield', 1, cx - off1v1X, cy, 9));
      if (this.sandboxDefenderEnabled) {
        this.players.push(makePlayer('B', 'outfield', null, cx + off1v1X, cy, 5));
      }
    } else if (!hasTwoOutfield) {
      this.players.push(makePlayer('A', 'outfield', 1, cx - off1v1X, cy, 9));
      this.players.push(makePlayer('B', 'outfield', is2PLocal ? 2 : null, cx + off1v1X, cy, 10));
    } else {
      this.players.push(makePlayer('A', 'outfield', 1, cx - off2v2NearX, cy - off2v2Y, 9));
      this.players.push(makePlayer('A', 'outfield', isCoop ? 2 : null, cx - off2v2FarX, cy + off2v2Y, 4));

      this.players.push(makePlayer('B', 'outfield', is2PLocal ? 2 : null, cx + off2v2NearX, cy + off2v2Y, 10));
      this.players.push(makePlayer('B', 'outfield', null, cx + off2v2FarX, cy - off2v2Y, 5));
    }

    if (hasKeepers) {
      this.players.push(makePlayer('A', 'keeper', null, this.bounds.left + 10, cy, 1));
      this.players.push(makePlayer('B', 'keeper', null, this.bounds.right - 10, cy, 1));
    }

    this.balls = [this.createCenterBall(1, false)];
  }

  private resetPositionsForKickoff(): void {
    const cy = this.bounds.centerY;
    const cx = this.bounds.centerX;
    const hasTwoOutfield = this.hasTwoOutfieldPerTeam();
    const hasKeepers = this.hasKeepers();

    const teamAOutfield = this.players.filter((p) => p.team === 'A' && p.role === 'outfield');
    const teamBOutfield = this.players.filter((p) => p.team === 'B' && p.role === 'outfield');
    const teamAKeeper = this.players.find((p) => p.team === 'A' && p.role === 'keeper');
    const teamBKeeper = this.players.find((p) => p.team === 'B' && p.role === 'keeper');

    const resetPlayer = (p: Player, x: number, y: number) => {
      p.x = x;
      p.y = y;
      p.vx = 0;
      p.vy = 0;
      p.facingX = p.team === 'A' ? 1 : -1;
      p.facingY = 0;
      p.isCharging = false;
      p.chargeTime = 0;
      p.kickSwingTimer = 0;
      p.dashTimer = 0;
      p.dashCooldown = 0;
      p.stunTimer = 0;
      p.pickupCooldown = 0;
      p.animState = 'idle';
    };

    const spanScale = this.getKickoffSpanScale();
    const off1v1X = Math.round(54 * spanScale);
    const off2v2NearX = Math.round(48 * spanScale);
    const off2v2FarX = Math.round(96 * spanScale);
    const off2v2Y = Math.round(26 * spanScale);

    if (!hasTwoOutfield) {
      if (teamAOutfield[0]) resetPlayer(teamAOutfield[0], cx - off1v1X, cy);
      if (teamBOutfield[0]) resetPlayer(teamBOutfield[0], cx + off1v1X, cy);
    } else {
      if (teamAOutfield[0]) resetPlayer(teamAOutfield[0], cx - off2v2NearX, cy - off2v2Y);
      if (teamAOutfield[1]) resetPlayer(teamAOutfield[1], cx - off2v2FarX, cy + off2v2Y);
      if (teamBOutfield[0]) resetPlayer(teamBOutfield[0], cx + off2v2NearX, cy + off2v2Y);
      if (teamBOutfield[1]) resetPlayer(teamBOutfield[1], cx + off2v2FarX, cy - off2v2Y);
    }

    if (hasKeepers) {
      if (teamAKeeper) resetPlayer(teamAKeeper, this.bounds.left + 10, cy);
      if (teamBKeeper) resetPlayer(teamBKeeper, this.bounds.right - 10, cy);
    }

    this.balls = [this.createCenterBall(1, false)];
  }

  private createCenterBall(id: number, isExtraBall: boolean): Ball {
    return {
      id,
      x: this.bounds.centerX,
      y: this.bounds.centerY,
      vx: 0,
      vy: 0,
      z: 18,
      vz: 0,
      radius: this.params.ballRadius,
      mass: this.params.ballMass,
      spin: 0,
      rollAngle: 0,
      lastTouchTeam: null,
      lastTouchPlayerId: null,
      lastKickPower: 0,
      untouchedTimer: 0,
      hotPotatoBeepAccum: 0,
      isExtraBall,
      carrierId: null,
      oneTimerTimer: 0,
    };
  }

  /** Toggle or activate any mutator instantly in Practice Sandbox mode */
  triggerSandboxMutator(type: MutatorType): GameEvent[] {
    if (!this.isPracticeSandbox() || (this.phase !== 'PLAYING' && this.phase !== 'KICKOFF')) {
      return [];
    }
    const active = this.mutators.getActive();
    if (active && active.type === type) {
      return this.clearSandboxMutator();
    }
    const events: GameEvent[] = [];
    this.bounds = this.mutators.activateMutator(type, this.balls, this.params, events, true);
    return events;
  }

  /** Clear any active Sandbox mutator and revert arena/ball defaults cleanly */
  clearSandboxMutator(): GameEvent[] {
    if (!this.isPracticeSandbox()) return [];
    const active = this.mutators.getActive();
    this.bounds = this.mutators.clearAll(this.balls, this.params);
    return active ? [{ type: 'mutator_end', mutator: active.type }] : [];
  }

  /** Reset ball(s) to center spot during Sandbox practice */
  resetSandboxBall(): void {
    if (!this.isPracticeSandbox()) return;
    this.balls = [this.createCenterBall(1, false)];
    this.mutators.ensureMultiBallOnKickoff(this.balls, this.params, this.bounds);
    this.recentBounceAge = 99;
    this.recentOneTimerAge = 99;
    for (const p of this.players) {
      p.stunTimer = 0;
      p.pickupCooldown = 0;
    }
  }

  /** Launch a crisp wing pass toward P1 so they can practice One-Timer volleys */
  triggerSandboxFeedPass(): void {
    if (!this.isPracticeSandbox() || this.balls.length === 0) return;
    const p1 = this.players.find((p) => p.humanSlot === 1);
    if (!p1) return;

    const ball = this.balls[0];
    const wingYOffset = p1.y > this.bounds.centerY ? -42 : 42;
    const startX = Math.min(this.bounds.right - 22, Math.max(this.bounds.left + 34, p1.x + 58));
    const startY = Math.min(this.bounds.bottom - 18, Math.max(this.bounds.top + 18, p1.y + wingYOffset));

    const targetX = p1.x + 8;
    const targetY = p1.y;
    const dx = targetX - startX;
    const dy = targetY - startY;
    const dist = Math.hypot(dx, dy) || 1;
    const feedSpeed = 165;

    ball.carrierId = null;
    ball.x = startX;
    ball.y = startY;
    ball.vx = (dx / dist) * feedSpeed;
    ball.vy = (dy / dist) * feedSpeed;
    ball.z = 8;
    ball.vz = 26;
    ball.spin = 0;
    ball.oneTimerTimer = 0;
    ball.lastTouchTeam = 'A';
    ball.lastTouchPlayerId = 999;
    ball.untouchedTimer = 0;
    p1.kickContactCooldown = 0;
    p1.pickupCooldown = 0.25;
  }

  /** Add or remove a Team B sparring defender AI in Practice Sandbox */
  toggleSandboxDefender(): boolean {
    if (!this.isPracticeSandbox()) return false;
    this.sandboxDefenderEnabled = !this.sandboxDefenderEnabled;
    if (this.sandboxDefenderEnabled) {
      const hasDefender = this.players.some((p) => p.team === 'B' && p.role === 'outfield');
      if (!hasDefender) {
        const maxId = this.players.reduce((m, p) => Math.max(m, p.id), 0);
        this.players.push(
          this.createPlayer(
            maxId + 1,
            'B',
            'outfield',
            null,
            Math.min(
              this.bounds.right - 56,
              this.bounds.centerX + Math.round(54 * this.getKickoffSpanScale())
            ),
            this.bounds.centerY,
            5
          )
        );
      }
    } else {
      for (const b of this.balls) {
        const carrier = this.players.find((p) => p.id === b.carrierId);
        if (carrier && carrier.team === 'B' && carrier.role === 'outfield') {
          b.carrierId = null;
        }
      }
      this.players = this.players.filter((p) => !(p.team === 'B' && p.role === 'outfield'));
    }
    return this.sandboxDefenderEnabled;
  }
}

export { createEmptyInput };
