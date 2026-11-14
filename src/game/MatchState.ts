import {
  ARENA_CONSTANTS,
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
  TeamTactic,
} from '../types.ts';
import { createArenaBounds } from '../engine/ArenaGeometry.ts';
import { ARENA_PRESETS } from '../engine/ArenaPresets.ts';
import { createDefaultPhysicsParams, PhysicsEngine } from '../engine/PhysicsEngine.ts';
import { ReplayBuffer } from '../engine/ReplayBuffer.ts';
import { AIController, createEmptyInput } from './AIController.ts';
import { createDefaultTeamModifiers, DerbyCupState } from './DerbyCup.ts';
import { MutatorManager } from './MutatorManager.ts';
import type { NetStateSnapshot } from '../net/NetSnapshot.ts';

/** 4v4 always plays on Stadium XL; other formats honour the configured pitch size. */
export function resolvePitchSizeForMode(
  mode: MatchState['config']['mode'] | string,
  pitchSize: string | undefined
): 'standard' | 'large' | 'xl' {
  const isFourVsFour =
    mode === '4v4_ai' || mode === 'derby_cup_4v4' || mode === '4v4_local' || mode === '4v4_coop';
  if (isFourVsFour) return 'xl';
  return pitchSize === 'large' || pitchSize === 'xl' ? pitchSize : 'standard';
}

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
  private recentFeverGoalAge = 99;
  private replayTrailingFrames = 0;
  public sandboxDefenderEnabled = false;
  public teamFeverA = 0;
  public teamFeverB = 0;
  public teamFeverTimerA = 0;
  public teamFeverTimerB = 0;
  public teamTacticA: TeamTactic = 'balanced';
  public teamTacticB: TeamTactic = 'balanced';

  public readonly physics: PhysicsEngine;
  public readonly ai: AIController;
  public readonly mutators: MutatorManager;
  public readonly cup: DerbyCupState;
  public readonly replay = new ReplayBuffer();

  constructor(rng: () => number = Math.random) {
    // Every subsystem shares the match RNG so a seeded MatchState replays identically.
    this.physics = new PhysicsEngine(rng);
    this.ai = new AIController(rng);
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
      config.mode === 'derby_cup_3v3' ||
      config.mode === 'derby_cup_4v4';
    const isSandbox = config.mode === 'practice_sandbox';
    this.config = {
      ...config,
      arena: config.arena ?? 'classic',
      pitchSize: resolvePitchSizeForMode(config.mode, config.pitchSize ?? 'standard'),
      controlStyle: config.controlStyle ?? 'classic',
      displayMode: config.displayMode ?? 'auto',
      teamAKit: config.teamAKit ?? 'garuda',
      teamBKit: config.teamBKit ?? 'cyber',
      replayEnabled: isSandbox ? false : (config.replayEnabled ?? true),
    };

    if (!preserveCup) {
      this.sandboxDefenderEnabled = false;
      if (isCupMode) {
        const round = this.cup.startNewCup();
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
    this.recentFeverGoalAge = 99;
    this.teamFeverA = 0;
    this.teamFeverB = 0;
    this.teamFeverTimerA = 0;
    this.teamFeverTimerB = 0;
    this.teamTacticA = 'balanced';
    this.teamTacticB = 'balanced';
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
    this.kickoffCountdownSecond = isSandbox ? 2 : 3;

    return [{ type: 'countdown_beep', final: false }];
  }

  /** Starts a brand-new match. In Derby Cup this also starts a fresh tournament from round 1. */
  rematch(): GameEvent[] {
    return this.startMatch(this.config, false);
  }

  /**
   * Restarts the current match/round while keeping Derby Cup progress (round index + earned perks).
   * Used by the pause-menu "RESTART MATCH" option so it never wipes a tournament run.
   */
  restartCurrentRound(): GameEvent[] {
    return this.startMatch(this.config, this.cup.active);
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
    this.teamFeverA = 0;
    this.teamFeverB = 0;
    this.teamFeverTimerA = 0;
    this.teamFeverTimerB = 0;
    this.teamTacticA = 'balanced';
    this.teamTacticB = 'balanced';
    this.cup.reset();
    this.replay.clear();
    this.replay.clearPlayback();
    this.bounds = this.mutators.clearAll(this.balls, this.params);
  }

  getTeamFever(team: Team): number {
    return team === 'A' ? this.teamFeverA : this.teamFeverB;
  }

  isTeamFeverActive(team: Team): boolean {
    return (team === 'A' ? this.teamFeverTimerA : this.teamFeverTimerB) > 0;
  }

  getTeamTactic(team: Team): TeamTactic {
    return team === 'A' ? this.teamTacticA : this.teamTacticB;
  }

  setTeamTactic(team: Team, tactic: TeamTactic): GameEvent[] {
    const prev = this.getTeamTactic(team);
    if (prev === tactic) return [];
    if (team === 'A') this.teamTacticA = tactic;
    else this.teamTacticB = tactic;
    return [{ type: 'tactic_change', team, tactic }];
  }

  cycleTeamTactic(team: Team): GameEvent[] {
    const order: TeamTactic[] = ['balanced', 'attack', 'defend'];
    const current = this.getTeamTactic(team);
    const next = order[(order.indexOf(current) + 1) % order.length];
    return this.setTeamTactic(team, next);
  }

  addTeamFever(team: Team, amount: number): void {
    if (amount <= 0 || this.isTeamFeverActive(team)) return;
    if (team === 'A') {
      this.teamFeverA = Math.min(100, this.teamFeverA + amount);
    } else {
      this.teamFeverB = Math.min(100, this.teamFeverB + amount);
    }
  }

  tryActivateFever(team: Team): GameEvent[] {
    if (this.isTeamFeverActive(team) || this.getTeamFever(team) < 100) return [];
    if (team === 'A') {
      this.teamFeverA = 0;
      this.teamFeverTimerA = 4.5;
    } else {
      this.teamFeverB = 0;
      this.teamFeverTimerB = 4.5;
    }
    for (const p of this.players) {
      if (p.team === team) p.feverActive = true;
    }
    const anchor =
      this.players.find((p) => p.team === team && p.humanSlot !== null) ??
      this.players.find((p) => p.team === team && p.role === 'outfield') ??
      null;
    return [
      {
        type: 'fever_activate',
        team,
        x: anchor?.x ?? this.bounds.centerX,
        y: anchor?.y ?? this.bounds.centerY,
      },
    ];
  }

  private getHumanSlotTeam(slot: 1 | 2): Team | null {
    return this.players.find((p) => p.humanSlot === slot)?.team ?? null;
  }

  isTwoPlayerMode(): boolean {
    return (
      this.config.mode === '1v1_local' ||
      this.config.mode === '2v2_local' ||
      this.config.mode === '2v2_coop' ||
      this.config.mode === '3v3_local' ||
      this.config.mode === '3v3_coop' ||
      this.config.mode === '4v4_local' ||
      this.config.mode === '4v4_coop'
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

  isFourVsFourMode(): boolean {
    return (
      this.config.mode === '4v4_ai' ||
      this.config.mode === 'derby_cup_4v4' ||
      this.config.mode === '4v4_local' ||
      this.config.mode === '4v4_coop'
    );
  }

  hasTwoOutfieldPerTeam(): boolean {
    return this.isTwoVsTwoMode() || this.isThreeVsThreeMode() || this.isFourVsFourMode();
  }

  getOutfieldCountPerTeam(): 1 | 2 | 3 {
    if (this.isFourVsFourMode()) return 3;
    if (this.isTwoVsTwoMode() || this.isThreeVsThreeMode()) return 2;
    return 1;
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
      this.config.mode === '3v3_local' ||
      this.config.mode === '4v4_ai' ||
      this.config.mode === 'derby_cup_4v4' ||
      this.config.mode === '4v4_local' ||
      this.config.mode === '4v4_coop'
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
        // The last tick before the kickoff whistle gets the higher-pitched "go" beep.
        events.push({ type: 'countdown_beep', final: secBucket <= 1 });
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
    this.recentFeverGoalAge += dt;
    if (this.teamFeverTimerA > 0) this.teamFeverTimerA = Math.max(0, this.teamFeverTimerA - dt);
    if (this.teamFeverTimerB > 0) this.teamFeverTimerB = Math.max(0, this.teamFeverTimerB - dt);
    this.addTeamFever('A', 2.0 * dt);
    this.addTeamFever('B', 2.0 * dt);
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

    // Handle manual teammate switching in 2v2 / 3v3 / 4v4 (never auto-switch)
    this.handlePlayerSwitching(humanSlotInputs);

    // Handle manual Team Tactics & Fever Mode activations
    const p1Team = this.getHumanSlotTeam(1);
    const p2Team = this.getHumanSlotTeam(2);
    if (p1Team && humanSlotInputs.p1.tacticCycleJustPressed) {
      events.push(...this.cycleTeamTactic(p1Team));
    }
    if (p2Team && humanSlotInputs.p2.tacticCycleJustPressed) {
      events.push(...this.cycleTeamTactic(p2Team));
    }
    if (p1Team && humanSlotInputs.p1.feverJustPressed) {
      events.push(...this.tryActivateFever(p1Team));
    }
    if (p2Team && humanSlotInputs.p2.feverJustPressed) {
      events.push(...this.tryActivateFever(p2Team));
    }

    // Smart AI Fever activation when an AI-only team hits 100% near active play
    for (const aiTeam of ['A', 'B'] as const) {
      const hasHuman = this.players.some((p) => p.team === aiTeam && p.humanSlot !== null);
      if (hasHuman || this.getTeamFever(aiTeam) < 100 || this.isTeamFeverActive(aiTeam)) continue;
      const inPlay = this.players.some(
        (p) =>
          p.team === aiTeam &&
          p.role === 'outfield' &&
          p.stunTimer <= 0 &&
          this.balls.some(
            (b) => b.carrierId === p.id || Math.hypot(b.x - p.x, b.y - p.y) < 115
          )
      );
      if (inPlay) {
        events.push(...this.tryActivateFever(aiTeam));
      }
    }

    for (const p of this.players) {
      p.feverActive = this.isTeamFeverActive(p.team);
    }

    // Build per-player inputs (human vs AI)
    const inputMap = new Map<number, PlayerInput>();
    for (const p of this.players) {
      if (p.humanSlot === 1) {
        inputMap.set(p.id, humanSlotInputs.p1);
      } else if (p.humanSlot === 2) {
        inputMap.set(p.id, humanSlotInputs.p2);
      } else {
        const tactic = this.getTeamTactic(p.team);
        inputMap.set(
          p.id,
          this.ai.computeInput(dt, p, this.players, this.balls, this.bounds, this.config.difficulty, tactic)
        );
      }
    }

    const teamModifiers = {
      A: this.cup.active ? this.cup.getTeamAModifiers() : createDefaultTeamModifiers(),
      B: createDefaultTeamModifiers(),
    };
    const applyFeverBoost = (mods: typeof teamModifiers.A, active: boolean) => {
      if (!active) return;
      mods.moveSpeedMult *= 1.2;
      mods.shotPowerMult *= 1.18;
      mods.dashCooldownMult *= 0.55;
      mods.kickReachBonus += 2.5;
      mods.stunMult *= 0.45;
      mods.feverActive = true;
    };
    applyFeverBoost(teamModifiers.A, this.teamFeverTimerA > 0);
    applyFeverBoost(teamModifiers.B, this.teamFeverTimerB > 0);

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

    // Track stats, Fever gains & highlight recency (Bank Shot / One-Timer / Fever Strike detection)
    for (const ev of stepResult.events) {
      if (ev.type === 'kick') {
        // Keeper clears and dash pokes also emit 'kick' for audio, but they are not shot attempts.
        if (ev.isShot !== false) {
          if (ev.team === 'A') this.stats.teamAShots++;
          else this.stats.teamBShots++;
        }
        if (ev.isOneTimer) {
          this.recentOneTimerAge = 0;
        }
        if (ev.isFeverShot) {
          this.recentFeverGoalAge = 0;
        } else {
          const kickGain = ev.isOneTimer ? 18 : ev.isPass ? 8 : ev.isShot !== false ? 12 : 6;
          this.addTeamFever(ev.team, kickGain);
        }
      } else if (ev.type === 'wall_bounce') {
        this.stats.wallBounces++;
        this.recentBounceAge = 0;
      } else if (ev.type === 'post_clang') {
        this.recentBounceAge = 0;
      } else if (ev.type === 'save') {
        if (ev.team === 'A') this.stats.teamASaves++;
        else this.stats.teamBSaves++;
        this.addTeamFever(ev.team, 20);
      } else if (ev.type === 'tackle') {
        this.stats.tackles++;
        if (ev.stoleBall) {
          if (ev.team === 'A') this.stats.teamASteals++;
          this.addTeamFever(ev.team, 22);
        }
      } else if (ev.type === 'feint_dodge') {
        this.addTeamFever(ev.team, 16);
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

      const scoringBall =
        this.balls.find((b) => b.id === stepResult.scoredBallId) ?? this.balls[0];
      const ballSpeed = scoringBall ? Math.hypot(scoringBall.vx, scoringBall.vy) : 0;
      const lastKickPower = scoringBall?.lastKickPower ?? 0;
      const isBankShot = this.recentBounceAge < 1.35;
      const isOneTimerGoal = this.recentOneTimerAge < 1.6;
      const isFeverGoal = this.recentFeverGoalAge < 1.8 || (scoringBall?.feverTimer ?? 0) > 0;
      const isTopBin =
        Math.abs(goalPos.y - this.bounds.goalTopY) <= 10 ||
        Math.abs(goalPos.y - this.bounds.goalBottomY) <= 10;
      const isRocketShot = lastKickPower >= 0.78 || ballSpeed >= 270;

      const concedingTeam: Team = stepResult.scoredBy === 'A' ? 'B' : 'A';
      this.addTeamFever(concedingTeam, 26);

      const highlightTag = isFeverGoal
        ? 'FEVER STRIKE!'
        : isOneTimerGoal
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
        isFeverGoal ||
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
          : isFeverGoal
            ? 'FEVER STRIKE!'
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
      this.recentFeverGoalAge = 99;
      this.resetPositionsForKickoff();
      this.mutators.ensureMultiBallOnKickoff(this.balls, this.params, this.bounds);
      this.replay.clear();
      this.phase = 'KICKOFF';
      this.phaseTimer = this.isPracticeSandbox() ? 0.35 : 0.65;
      // 2 buckets so the short post-goal countdown still plays its final "go" beep.
      this.kickoffCountdownSecond = 2;
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
    if (this.canHumanSwitchPlayer()) {
      this.handleSlotSwitch(1, 'A', humanInputs.p1);
    }
    if (mode === '2v2_local' || mode === '3v3_local' || mode === '4v4_local') {
      this.handleSlotSwitch(2, 'B', humanInputs.p2);
    } else if (mode === '4v4_coop') {
      this.handleSlotSwitch(2, 'A', humanInputs.p2);
    }
  }

  private handleSlotSwitch(slot: 1 | 2, team: Team, input: PlayerInput): void {
    if (!input.switchJustPressed) return;

    const teamOutfield = this.players.filter((p) => p.team === team && p.role === 'outfield');
    if (teamOutfield.length < 2) return;

    const currentIndex = teamOutfield.findIndex((p) => p.humanSlot === slot);
    if (currentIndex === -1) return;

    // Cycle round-robin to the next teammate not currently controlled by another human slot
    for (let offset = 1; offset < teamOutfield.length; offset++) {
      const candidate = teamOutfield[(currentIndex + offset) % teamOutfield.length];
      if (candidate.humanSlot === null) {
        const current = teamOutfield[currentIndex];
        current.humanSlot = null;
        current.isCharging = false;
        current.chargeTime = 0;
        candidate.humanSlot = slot;
        return;
      }
    }
  }

  private createPlayer(
    id: number,
    team: Team,
    role: 'outfield' | 'keeper',
    humanSlot: 1 | 2 | null,
    x: number,
    y: number
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
      radius: role === 'keeper' ? ARENA_CONSTANTS.KEEPER_RADIUS : ARENA_CONSTANTS.PLAYER_RADIUS,
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
      feintTimer: 0,
      feintDir: 1,
      isPassSwing: false,
      feverActive: false,
    };
  }

  private getKickoffSpanScale(): number {
    return Math.max(1, ((this.bounds.right - this.bounds.left) * 0.5) / 204);
  }

  private getKickoffFormation(team: Team, outfieldCount: number): Array<{ x: number; y: number }> {
    const cx = this.bounds.centerX;
    const cy = this.bounds.centerY;
    const dir = team === 'A' ? -1 : 1;
    const spanScale = this.getKickoffSpanScale();

    if (outfieldCount === 1) {
      const off1v1X = Math.round(54 * spanScale);
      return [{ x: cx + dir * off1v1X, y: cy }];
    }

    if (outfieldCount === 2) {
      const offNearX = Math.round(48 * spanScale);
      const offFarX = Math.round(96 * spanScale);
      const offY = Math.round(26 * spanScale);
      return [
        { x: cx + dir * offNearX, y: cy + dir * offY },
        { x: cx + dir * offFarX, y: cy - dir * offY },
      ];
    }

    // 4v4 (3 outfielders per team on Stadium XL): center striker + two wide wing-backs
    const strikerX = Math.round(46 * spanScale);
    const wingX = Math.round(98 * spanScale);
    const wingY = Math.round(42 * spanScale);
    return [
      { x: cx + dir * strikerX, y: cy },
      { x: cx + dir * wingX, y: cy + dir * wingY },
      { x: cx + dir * wingX, y: cy - dir * wingY },
    ];
  }

  private spawnEntitiesForMode(): void {
    this.players = [];
    const { mode } = this.config;
    const isSandbox = this.isPracticeSandbox();
    const outfieldCount = this.getOutfieldCountPerTeam();
    const hasKeepers = this.hasKeepers();
    const is2PLocal =
      mode === '1v1_local' ||
      mode === '2v2_local' ||
      mode === '3v3_local' ||
      mode === '4v4_local';
    const isCoop = mode === '2v2_coop' || mode === '3v3_coop' || mode === '4v4_coop';

    let nextId = 1;
    const makePlayer = (
      team: Team,
      role: 'outfield' | 'keeper',
      humanSlot: 1 | 2 | null,
      x: number,
      y: number
    ): Player => this.createPlayer(nextId++, team, role, humanSlot, x, y);

    const cy = this.bounds.centerY;

    if (isSandbox) {
      const formA = this.getKickoffFormation('A', 1);
      this.players.push(makePlayer('A', 'outfield', 1, formA[0].x, formA[0].y));
      if (this.sandboxDefenderEnabled) {
        const formB = this.getKickoffFormation('B', 1);
        this.players.push(makePlayer('B', 'outfield', null, formB[0].x, formB[0].y));
      }
    } else {
      const formA = this.getKickoffFormation('A', outfieldCount);
      for (let i = 0; i < formA.length; i++) {
        const humanSlot: 1 | 2 | null = i === 0 ? 1 : isCoop && i === 1 ? 2 : null;
        this.players.push(makePlayer('A', 'outfield', humanSlot, formA[i].x, formA[i].y));
      }

      const formB = this.getKickoffFormation('B', outfieldCount);
      for (let i = 0; i < formB.length; i++) {
        const humanSlot: 1 | 2 | null = is2PLocal && i === 0 ? 2 : null;
        this.players.push(makePlayer('B', 'outfield', humanSlot, formB[i].x, formB[i].y));
      }
    }

    if (hasKeepers) {
      this.players.push(makePlayer('A', 'keeper', null, this.bounds.left + 10, cy));
      this.players.push(makePlayer('B', 'keeper', null, this.bounds.right - 10, cy));
    }

    this.balls = [this.createCenterBall(1, false)];
  }

  private resetPositionsForKickoff(): void {
    const cy = this.bounds.centerY;
    const outfieldCount = this.getOutfieldCountPerTeam();
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
      p.isPassSwing = false;
      p.dashTimer = 0;
      p.dashCooldown = 0;
      p.feintTimer = 0;
      p.stunTimer = 0;
      p.pickupCooldown = 0;
      p.animState = 'idle';
    };

    const formA = this.getKickoffFormation('A', outfieldCount);
    const formB = this.getKickoffFormation('B', outfieldCount);
    teamAOutfield.forEach((p, idx) => {
      const pos = formA[idx] ?? formA[0];
      if (pos) resetPlayer(p, pos.x, pos.y);
    });
    teamBOutfield.forEach((p, idx) => {
      const pos = formB[idx] ?? formB[0];
      if (pos) resetPlayer(p, pos.x, pos.y);
    });

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
      feverTimer: 0,
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
            this.bounds.centerY
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

  /**
   * Mirrors an interpolated Host snapshot onto this client MatchState for Guest rendering & HUD.
   */
  applyRemoteSnapshot(snapshot: NetStateSnapshot): void {
    this.phase = snapshot.phase;
    this.phaseTimer = snapshot.phaseTimer;
    this.timeRemaining = snapshot.timeRemaining;
    this.scoreA = snapshot.scoreA;
    this.scoreB = snapshot.scoreB;
    this.winner = snapshot.winner;
    this.isGoldenGoal = snapshot.isGoldenGoal;
    this.lastScoringTeam = snapshot.lastScoringTeam;
    this.teamFeverA = snapshot.feverA;
    this.teamFeverB = snapshot.feverB;
    this.teamFeverTimerA = snapshot.feverTimerA;
    this.teamFeverTimerB = snapshot.feverTimerB;
    this.teamTacticA = snapshot.tacticA;
    this.teamTacticB = snapshot.tacticB;
    this.bounds = { ...snapshot.bounds };
    this.params.pinballActive = snapshot.pinballActive;
    this.params.hotPotatoActive = snapshot.hotPotatoActive;
    this.params.windX = snapshot.windX;
    this.params.windY = snapshot.windY;
    this.mutators.setRemoteActive(snapshot.mutator);
    if (snapshot.stats) {
      this.stats = { ...snapshot.stats };
    }

    this.balls = snapshot.balls.map((b) => ({
      id: b.id,
      x: b.x,
      y: b.y,
      vx: b.vx,
      vy: b.vy,
      z: b.z,
      vz: b.vz,
      radius: b.r,
      mass: b.m,
      spin: b.sp,
      rollAngle: b.ra,
      lastTouchTeam: null,
      lastTouchPlayerId: null,
      lastKickPower: b.lk,
      untouchedTimer: b.ut,
      hotPotatoBeepAccum: 0,
      isExtraBall: b.ex,
      carrierId: b.cid,
      oneTimerTimer: b.ot,
      feverTimer: b.ft,
    }));

    this.players = snapshot.players.map((p) => ({
      id: p.id,
      team: p.team,
      role: p.role,
      humanSlot: p.hs,
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
      radius: p.r,
      facingX: p.fx,
      facingY: p.fy,
      isCharging: p.ic,
      chargeTime: p.ct,
      kickSwingTimer: 0,
      kickSwingPower: 0,
      kickSwingDirX: p.fx,
      kickSwingDirY: p.fy,
      dashTimer: p.st === 'dash' ? 0.1 : 0,
      dashCooldown: p.dc,
      dashDirX: p.fx,
      dashDirY: p.fy,
      stunTimer: p.su,
      kickContactCooldown: 0,
      pickupCooldown: 0,
      feintTimer: p.ft,
      feverActive: p.fa,
      animState: p.st,
      animTime: p.at,
      aiState: 'CHASE_BALL',
      aiDecisionTimer: 0,
      aiTargetX: p.x,
      aiTargetY: p.y,
      aiWantCharge: false,
      aiChargeTarget: 0,
      aiWantDash: false,
    }));

    if (snapshot.phase === 'REPLAY' && snapshot.replay) {
      this.replay.setRemotePlayback(
        snapshot.replay.frame,
        snapshot.replay.prog,
        snapshot.replay.tag,
        snapshot.replay.team
      );
    } else {
      this.replay.clearPlayback();
    }
  }
}

export { createEmptyInput };
