import { describe, expect, it } from 'vitest';
import { createArenaBounds } from '../engine/ArenaGeometry.ts';
import { ARENA_PRESETS } from '../engine/ArenaPresets.ts';
import { createDefaultPhysicsParams, PhysicsEngine } from '../engine/PhysicsEngine.ts';
import { computeModifiersFromPerks } from '../game/DerbyCup.ts';
import { createEmptyInput, MatchState } from '../game/MatchState.ts';
import { ARENA_CONSTANTS, FIXED_DT, Player, PlayerInput } from '../types.ts';

describe('Phase 3 Features', () => {
  it('applies distinct Concrete Alley bounds/restitution and Rooftop wind drift', () => {
    const classic = createArenaBounds(1.0, 'classic');
    const concrete = createArenaBounds(1.0, 'concrete');
    expect(concrete.right - concrete.left).toBeLessThan(classic.right - classic.left);
    expect(ARENA_PRESETS.concrete.wallRestitution).toBeGreaterThan(ARENA_PRESETS.classic.wallRestitution);

    const match = new MatchState();
    match.startMatch({
      mode: '1v1_local',
      arena: 'rooftop',
      difficulty: 'pro',
      durationSeconds: 60,
      mutatorsEnabled: false,
      replayEnabled: false,
    });

    const empty = { p1: createEmptyInput(), p2: createEmptyInput() };
    // Finish kickoff
    for (let i = 0; i < 60; i++) match.update(FIXED_DT, empty);

    const initialY = match.balls[0].y;
    for (let i = 0; i < 120; i++) {
      match.update(FIXED_DT, empty);
    }
    // Gentle rooftop side wind nudges ball laterally over 2 seconds
    expect(Math.abs(match.balls[0].y - initialY)).toBeGreaterThan(1.0);
  });

  it('runs a full 3-round Derby Cup with Perks and reaches CUP_CHAMPION', () => {
    const match = new MatchState(() => 0.25);
    match.startMatch({
      mode: 'derby_cup_1v1',
      arena: 'classic',
      difficulty: 'rookie',
      durationSeconds: 60,
      mutatorsEnabled: false,
      replayEnabled: false,
    });

    expect(match.cup.active).toBe(true);
    expect(match.cup.getCurrentRound().roundNumber).toBe(1);
    expect(match.config.arena).toBe('classic');
    expect(match.config.difficulty).toBe('rookie');

    const finishRoundWithWin = () => {
      match.scoreA = 2;
      match.scoreB = 0;
      match.timeRemaining = FIXED_DT;
      match.phase = 'PLAYING';
      match.update(FIXED_DT, { p1: createEmptyInput(), p2: createEmptyInput() });
      expect(match.phase).toBe('FULL_TIME');
      expect(match.winner).toBe('A');
    };

    // Win Round 1 -> Perk Select -> Round 2 (Concrete + Pro)
    finishRoundWithWin();
    match.advanceFromCupResult();
    expect(match.phase).toBe('PERK_SELECT');
    expect(match.cup.perkChoices.length).toBe(3);

    match.pickCupPerk(0);
    expect(match.cup.earnedPerks.length).toBe(1);
    expect(match.cup.getCurrentRound().roundNumber).toBe(2);
    expect(match.config.arena).toBe('concrete');
    expect(match.config.difficulty).toBe('pro');

    // Win Round 2 -> Perk Select -> Round 3 (Rooftop + Tarkam)
    finishRoundWithWin();
    match.advanceFromCupResult();
    expect(match.phase).toBe('PERK_SELECT');

    match.pickCupPerk(1);
    expect(match.cup.earnedPerks.length).toBe(2);
    expect(match.cup.getCurrentRound().roundNumber).toBe(3);
    expect(match.config.arena).toBe('rooftop');
    expect(match.config.difficulty).toBe('tarkam');

    // Win Round 3 -> CUP_CHAMPION
    finishRoundWithWin();
    match.advanceFromCupResult();
    expect(match.phase).toBe('CUP_CHAMPION');
    expect(match.cup.totalGoalsScored).toBe(6);
  });

  it('applies Derby Cup perk modifiers cleanly in PhysicsEngine', () => {
    const engine = new PhysicsEngine();
    const bounds = createArenaBounds(1.0, 'classic');
    const params = createDefaultPhysicsParams('classic');

    const normalMods = computeModifiersFromPerks([]);
    const turboMods = computeModifiersFromPerks(['turbo_boots', 'quick_dash']);

    const makeP = (id: number, team: 'A' | 'B'): Player => ({
      id,
      team,
      role: 'outfield',
      humanSlot: 1,
      x: 150,
      y: team === 'A' ? 120 : 180,
      vx: 0,
      vy: 0,
      radius: ARENA_CONSTANTS.PLAYER_RADIUS,
      facingX: 1,
      facingY: 0,
      isCharging: false,
      chargeTime: 0,
      kickSwingTimer: 0,
      kickSwingPower: 0,
      kickSwingDirX: 1,
      kickSwingDirY: 0,
      dashTimer: 0,
      dashCooldown: 0,
      dashDirX: 1,
      dashDirY: 0,
      stunTimer: 0,
      kickContactCooldown: 0,
      animState: 'idle',
      animTime: 0,
      aiState: 'CHASE_BALL',
      aiDecisionTimer: 0,
      aiTargetX: 150,
      aiTargetY: 120,
      aiWantCharge: false,
      aiChargeTarget: 0,
      aiWantDash: false,
    });

    const pPerk = makeP(1, 'A');
    const pBase = makeP(2, 'B');
    const inputs = new Map<number, PlayerInput>([
      [1, { ...createEmptyInput(), moveX: 1, dashJustPressed: true }],
      [2, { ...createEmptyInput(), moveX: 1, dashJustPressed: true }],
    ]);

    engine.step(FIXED_DT, [], [pPerk, pBase], inputs, bounds, params, true, {
      A: turboMods,
      B: normalMods,
    });

    // Quick dash gives 25% shorter cooldown
    expect(pPerk.dashCooldown).toBeCloseTo(pBase.dashCooldown * 0.75, 2);

    // Clear dash and accelerate to top speed
    pPerk.dashTimer = 0;
    pBase.dashTimer = 0;
    for (let i = 0; i < 30; i++) {
      inputs.set(1, { ...createEmptyInput(), moveX: 1 });
      inputs.set(2, { ...createEmptyInput(), moveX: 1 });
      engine.step(FIXED_DT, [], [pPerk, pBase], inputs, bounds, params, true, {
        A: turboMods,
        B: normalMods,
      });
    }
    expect(pPerk.vx / pBase.vx).toBeCloseTo(1.15, 2);
  });

  it('records last 3 seconds and triggers skippable Instant Replay after spectacular goal', () => {
    const match = new MatchState();
    match.startMatch({
      mode: '1v1_local',
      arena: 'classic',
      difficulty: 'pro',
      durationSeconds: 90,
      mutatorsEnabled: false,
      replayEnabled: true,
    });

    const empty = { p1: createEmptyInput(), p2: createEmptyInput() };
    // Finish kickoff
    for (let i = 0; i < 60; i++) match.update(FIXED_DT, empty);
    expect(match.phase).toBe('PLAYING');

    // Simulate 1.2s of play so replay buffer has > 30 frames
    for (let i = 0; i < 72; i++) match.update(FIXED_DT, empty);
    expect(match.replay.getRecordedCount()).toBeGreaterThanOrEqual(70);

    // Rocket shot aimed cleanly into upper corner past keeper
    match.balls[0].x = match.bounds.right - 2;
    match.balls[0].y = match.bounds.goalTopY + 8;
    match.balls[0].vx = 310;
    match.balls[0].lastKickPower = 0.95;

    match.update(FIXED_DT, empty);
    expect(match.scoreA).toBe(1);
    expect(match.phase).toBe('GOAL_CELEBRATION');

    // Finish celebration -> REPLAY
    for (let i = 0; i < 35; i++) match.update(FIXED_DT, empty);
    expect(match.phase).toBe('REPLAY');
    expect(match.replay.activeGoalTag).toBe('ROCKET GOAL!');
    expect(match.replay.getCurrentPlaybackFrame()).not.toBeNull();

    // Skipping replay jumps straight to KICKOFF
    match.skipReplay();
    expect(match.phase).toBe('KICKOFF');

    // Also test full replay playback completion without skipping
    for (let i = 0; i < 60; i++) match.update(FIXED_DT, empty);
    for (let i = 0; i < 60; i++) match.update(FIXED_DT, empty);
    match.balls[0].x = match.bounds.left + 2;
    match.balls[0].y = match.bounds.goalBottomY - 8;
    match.balls[0].vx = -290;
    match.balls[0].lastKickPower = 0.85;
    match.update(FIXED_DT, empty);
    for (let i = 0; i < 35; i++) match.update(FIXED_DT, empty);
    expect(match.phase).toBe('REPLAY');

    let guard = 0;
    while (match.phase === 'REPLAY' && guard < 300) {
      match.update(FIXED_DT, empty);
      guard++;
    }
    expect(match.phase).toBe('KICKOFF');
    expect(guard).toBeGreaterThan(40);
  });
});
