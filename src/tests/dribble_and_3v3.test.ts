import { describe, expect, it } from 'vitest';
import { createArenaBounds, isInsidePitchOctagon, resolveShotAim } from '../engine/ArenaGeometry.ts';
import { createDefaultPhysicsParams, PhysicsEngine } from '../engine/PhysicsEngine.ts';
import { AIController, createEmptyInput } from '../game/AIController.ts';
import { MatchState } from '../game/MatchState.ts';
import { MutatorManager } from '../game/MutatorManager.ts';
import { drawShotAimArrow } from '../render/PixelSprites.ts';
import { ARENA_CONSTANTS, Ball, FIXED_DT, GameMode, Player, PlayerInput } from '../types.ts';

function makeBall(overrides: Partial<Ball> = {}): Ball {
  return {
    id: 1,
    x: ARENA_CONSTANTS.CENTER_X,
    y: ARENA_CONSTANTS.CENTER_Y,
    vx: 0,
    vy: 0,
    z: 0,
    vz: 0,
    radius: ARENA_CONSTANTS.BASE_BALL_RADIUS,
    mass: 1,
    spin: 0,
    rollAngle: 0,
    lastTouchTeam: null,
    lastTouchPlayerId: null,
    lastKickPower: 0,
    untouchedTimer: 0,
    hotPotatoBeepAccum: 0,
    isExtraBall: false,
    carrierId: null,
    ...overrides,
  };
}

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 1,
    team: 'A',
    role: 'outfield',
    humanSlot: 1,
    x: 150,
    y: ARENA_CONSTANTS.CENTER_Y,
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
    pickupCooldown: 0,
    animState: 'idle',
    animTime: 0,
    aiState: 'CHASE_BALL',
    aiDecisionTimer: 0,
    aiTargetX: 150,
    aiTargetY: ARENA_CONSTANTS.CENTER_Y,
    aiWantCharge: false,
    aiChargeTarget: 0,
    aiWantDash: false,
    ...overrides,
  };
}

describe('Dribble Mode, Tackle Steal, and 3v3 Mode', () => {
  it('spawns 6 players (1 keeper + 2 outfield per team) across all 3v3 modes', () => {
    const modes3v3: GameMode[] = ['3v3_ai', 'derby_cup_3v3', '3v3_local', '3v3_coop'];
    for (const mode of modes3v3) {
      const match = new MatchState(() => 0.42);
      match.startMatch({
        mode,
        arena: 'classic',
        difficulty: 'pro',
        durationSeconds: 90,
        mutatorsEnabled: false,
        controlStyle: 'dribble',
      });

      expect(match.isThreeVsThreeMode()).toBe(true);
      expect(match.hasKeepers()).toBe(true);
      expect(match.players).toHaveLength(6);

      const teamAOut = match.players.filter((p) => p.team === 'A' && p.role === 'outfield');
      const teamAKeepers = match.players.filter((p) => p.team === 'A' && p.role === 'keeper');
      const teamBOut = match.players.filter((p) => p.team === 'B' && p.role === 'outfield');
      const teamBKeepers = match.players.filter((p) => p.team === 'B' && p.role === 'keeper');

      expect(teamAOut).toHaveLength(2);
      expect(teamAKeepers).toHaveLength(1);
      expect(teamBOut).toHaveLength(2);
      expect(teamBKeepers).toHaveLength(1);

      const p1Count = match.players.filter((p) => p.humanSlot === 1).length;
      const p2Count = match.players.filter((p) => p.humanSlot === 2).length;
      expect(p1Count).toBe(1);

      if (mode === '3v3_local') {
        expect(p2Count).toBe(1);
        expect(teamBOut.some((p) => p.humanSlot === 2)).toBe(true);
      } else if (mode === '3v3_coop') {
        expect(p2Count).toBe(1);
        expect(teamAOut.every((p) => p.humanSlot !== null)).toBe(true);
      } else {
        expect(p2Count).toBe(0);
      }

      if (mode === 'derby_cup_3v3') {
        expect(match.cup.active).toBe(true);
      }
    }
  });

  it('picks up loose ball smoothly, keeps it at feet while dribbling, and releases cleanly on kick', () => {
    const physics = new PhysicsEngine();
    const bounds = createArenaBounds();
    const params = { ...createDefaultPhysicsParams(), controlStyle: 'dribble' as const };

    const p = makePlayer({ id: 1, x: 200, y: bounds.centerY });
    const ball = makeBall({ x: 215, y: bounds.centerY, vx: 0, vy: 0 });
    const inputs = new Map<number, PlayerInput>();

    // Run right toward ball and dribble upward-right
    for (let i = 0; i < 25; i++) {
      inputs.set(1, { ...createEmptyInput(), moveX: 1, moveY: i > 12 ? -0.5 : 0 });
      physics.step(FIXED_DT, [ball], [p], inputs, bounds, params, true);
    }

    expect(ball.carrierId).toBe(p.id);
    const distWhileCarrying = Math.hypot(ball.x - p.x, ball.y - p.y);
    expect(distWhileCarrying).toBeLessThanOrEqual(p.radius + ball.radius + 4);
    expect(isInsidePitchOctagon(ball.x, ball.y, bounds, ball.radius)).toBe(true);

    // Kick release detaches ball cleanly with cooldown before re-pickup
    inputs.set(1, { ...createEmptyInput(), moveX: 1, moveY: 0, kickJustReleased: true });
    const kickResult = physics.step(FIXED_DT, [ball], [p], inputs, bounds, params, true);

    expect(ball.carrierId).toBeNull();
    expect(ball.vx).toBeGreaterThan(150);
    expect(p.pickupCooldown).toBeGreaterThan(0);
    expect(kickResult.events.some((e) => e.type === 'kick')).toBe(true);
  });

  it('allows walking a carried ball across open goal mouth to score', () => {
    const physics = new PhysicsEngine();
    const bounds = createArenaBounds();
    const params = { ...createDefaultPhysicsParams(), controlStyle: 'dribble' as const };

    const attacker = makePlayer({ id: 1, team: 'A', x: bounds.right - 22, y: bounds.centerY });
    const ball = makeBall({ x: bounds.right - 10, y: bounds.centerY, carrierId: 1 });
    const inputs = new Map<number, PlayerInput>();

    let scoredBy = null;
    for (let i = 0; i < 30; i++) {
      inputs.set(1, { ...createEmptyInput(), moveX: 1, moveY: 0 });
      const res = physics.step(FIXED_DT, [ball], [attacker], inputs, bounds, params, true);
      if (res.scoredBy) {
        scoredBy = res.scoredBy;
        break;
      }
    }

    expect(scoredBy).toBe('A');
  });

  it('requires Dash-Tackle to stun carrier and steal possession cleanly', () => {
    const physics = new PhysicsEngine();
    const bounds = createArenaBounds();
    const params = { ...createDefaultPhysicsParams(), controlStyle: 'dribble' as const };

    const carrier = makePlayer({ id: 1, team: 'A', x: 220, y: bounds.centerY, facingX: 1 });
    const defender = makePlayer({ id: 2, team: 'B', humanSlot: 2, x: 242, y: bounds.centerY, facingX: -1 });
    const ball = makeBall({ x: 233, y: bounds.centerY, carrierId: carrier.id });
    const inputs = new Map<number, PlayerInput>();

    // Passive bump without dashing should NOT steal the ball cleanly
    for (let i = 0; i < 6; i++) {
      inputs.set(1, createEmptyInput());
      inputs.set(2, { ...createEmptyInput(), moveX: -1, moveY: 0 });
      physics.step(FIXED_DT, [ball], [carrier, defender], inputs, bounds, params, true);
    }
    expect(ball.carrierId).toBe(carrier.id);
    expect(carrier.stunTimer).toBe(0);

    // Dash-tackle into carrier stuns victim and transfers possession to tackler
    let sawTackle = false;
    for (let i = 0; i < 10; i++) {
      inputs.set(1, createEmptyInput());
      inputs.set(2, {
        ...createEmptyInput(),
        moveX: -1,
        moveY: 0,
        dashJustPressed: i === 0,
      });
      const res = physics.step(FIXED_DT, [ball], [carrier, defender], inputs, bounds, params, true);
      if (res.events.some((e) => e.type === 'tackle')) {
        sawTackle = true;
      }
    }

    expect(sawTackle).toBe(true);
    expect(carrier.stunTimer).toBeGreaterThan(0);
    expect(carrier.pickupCooldown).toBeGreaterThan(0);
    expect(ball.carrierId).toBe(defender.id);
  });

  it('preserves dribble controlStyle across mutators and clears carrierId after Hot Potato blast', () => {
    const bounds = createArenaBounds();
    const params = { ...createDefaultPhysicsParams(), controlStyle: 'dribble' as const };
    const mutators = new MutatorManager(() => 0.1);
    const balls = [makeBall({ carrierId: 1 })];
    const events: any[] = [];

    mutators.activateMutator('hot_potato', balls, params, events);
    expect(params.controlStyle).toBe('dribble');

    mutators.clearAll(balls, params);
    expect(params.controlStyle).toBe('dribble');

    // Hot potato explosion should also detach carried state
    const physics = new PhysicsEngine();
    params.hotPotatoActive = true;
    const carrier = makePlayer({ id: 1, x: bounds.centerX - 10, y: bounds.centerY });
    const blastBall = makeBall({ x: bounds.centerX + 4, y: bounds.centerY, untouchedTimer: 6.0, carrierId: null });
    physics.step(FIXED_DT, [blastBall], [carrier], new Map(), bounds, params, true);
    expect(blastBall.carrierId).toBeNull();
    expect(carrier.stunTimer).toBeGreaterThan(0);
  });

  it('guides AI to dribble when carrying in midfield and dash-tackle opposing carriers', () => {
    const ai = new AIController();
    const bounds = createArenaBounds();

    const aiCarrier = makePlayer({
      id: 1,
      team: 'A',
      humanSlot: null,
      x: 110,
      y: bounds.centerY,
      aiDecisionTimer: 0,
    });
    const farDefender = makePlayer({
      id: 2,
      team: 'B',
      humanSlot: null,
      x: 340,
      y: bounds.centerY,
      aiDecisionTimer: 0,
    });
    const ball = makeBall({ x: 123, y: bounds.centerY, carrierId: aiCarrier.id });

    // Carrier in own half should dribble forward instead of kicking immediately
    const carryInput = ai.computeInput(FIXED_DT, aiCarrier, [aiCarrier, farDefender], [ball], bounds, 'pro');
    expect(carryInput.moveX).toBeGreaterThan(0.4);
    expect(carryInput.kickJustReleased).toBe(false);

    // Near opponent carrier, Tarkam AI charges in and attempts tackle dash across decision ticks
    const tackler = makePlayer({
      id: 3,
      team: 'B',
      humanSlot: null,
      x: 146,
      y: bounds.centerY,
      aiDecisionTimer: 0,
    });
    const closeCarryBall = makeBall({ x: 123, y: bounds.centerY, carrierId: aiCarrier.id });
    let sawDash = false;
    let movedLeft = false;
    for (let i = 0; i < 25; i++) {
      const tacklerInput = ai.computeInput(
        FIXED_DT,
        tackler,
        [aiCarrier, tackler],
        [closeCarryBall],
        bounds,
        'tarkam'
      );
      if (tacklerInput.moveX < -0.4) movedLeft = true;
      if (tacklerInput.dashJustPressed) {
        sawDash = true;
        break;
      }
    }
    expect(movedLeft).toBe(true);
    expect(sawDash).toBe(true);
  });

  it('resolves human goal-cone aim assist cleanly without hijacking bank shots or passes', () => {
    const bounds = createArenaBounds();

    // Off-center attacking shot pressing straight right (8-way D) assists gently into goalmouth
    const assisted = resolveShotAim(320, 102, 1, 0, 'A', bounds, 331.5, 102);
    expect(assisted.isGoalLocked).toBe(true);
    expect(assisted.x).toBeGreaterThan(0.9);
    expect(assisted.y).toBeGreaterThan(0.15);
    const tGoal = (bounds.right - 331.5) / assisted.x;
    const hitY = 102 + assisted.y * tGoal;
    expect(hitY).toBeGreaterThanOrEqual(bounds.goalTopY + 5);
    expect(hitY).toBeLessThanOrEqual(bounds.goalBottomY - 5);

    // Steep +45 deg corner bank shot from midfield stays unbent (manual bank angle preserved)
    const bank = resolveShotAim(260, bounds.centerY, Math.SQRT1_2, Math.SQRT1_2, 'A', bounds);
    expect(bank.isGoalLocked).toBe(false);
    expect(bank.y).toBeCloseTo(Math.SQRT1_2, 3);

    // Back-pass & lateral pass stay 100% manual
    const backPass = resolveShotAim(340, 100, -1, 0, 'A', bounds);
    expect(backPass.isGoalLocked).toBe(false);
    expect(backPass.x).toBeCloseTo(-1, 5);

    // Team B symmetric left-goal aim assist
    const teamBAim = resolveShotAim(160, 190, -1, 0, 'B', bounds, 148.5, 190);
    expect(teamBAim.isGoalLocked).toBe(true);
    expect(teamBAim.x).toBeLessThan(-0.9);
    expect(teamBAim.y).toBeLessThan(-0.15);
  });

  it('fires carried dribble kicks strictly along the resolved aim arrow and renders arrow cleanly', () => {
    const physics = new PhysicsEngine();
    const bounds = createArenaBounds();
    const params = { ...createDefaultPhysicsParams(), controlStyle: 'dribble' as const };

    const p = makePlayer({
      id: 1,
      team: 'A',
      humanSlot: 1,
      x: 325,
      y: 102,
      facingX: 1,
      facingY: 0,
      isCharging: true,
      chargeTime: 0.45,
    });
    const ball = makeBall({ x: 336, y: 102, carrierId: p.id });

    // Smoke-check canvas drawing of shot aim arrow while carrying & goal-locked
    const fillRectCalls: number[] = [];
    const fakeCtx = {
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      stroke: () => {},
      fill: () => {},
      fillRect: (...args: number[]) => {
        fillRectCalls.push(args.length);
      },
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;
    expect(() => drawShotAimArrow(fakeCtx, p, ball, bounds, 0.25)).not.toThrow();
    expect(fillRectCalls.length).toBeGreaterThan(0);

    // Release kick -> ball velocity matches resolveShotAim direction and enters right goalmouth
    const expectedAim = resolveShotAim(p.x, p.y, 1, 0, 'A', bounds, ball.x, ball.y);
    const inputs = new Map<number, PlayerInput>([
      [1, { ...createEmptyInput(), moveX: 1, moveY: 0, kickJustReleased: true }],
    ]);
    physics.step(FIXED_DT, [ball], [p], inputs, bounds, params, true);

    const speed = Math.hypot(ball.vx, ball.vy);
    expect(speed).toBeGreaterThan(250);
    expect(ball.vx / speed).toBeCloseTo(expectedAim.x, 1);
    expect(ball.vy / speed).toBeCloseTo(expectedAim.y, 1);

    let scored = false;
    for (let i = 0; i < 35; i++) {
      const stepRes = physics.step(FIXED_DT, [ball], [p], new Map(), bounds, params, true);
      if (stepRes.scoredBy === 'A') {
        scored = true;
        break;
      }
    }
    expect(scored).toBe(true);
  });

  it('spawns 8 players (1 keeper + 3 outfield per team) and enforces Stadium XL across all 4v4 modes', () => {
    const modes4v4: GameMode[] = ['4v4_ai', 'derby_cup_4v4', '4v4_local', '4v4_coop'];
    for (const mode of modes4v4) {
      const match = new MatchState(() => 0.42);
      match.startMatch({
        mode,
        arena: 'classic',
        pitchSize: 'standard',
        difficulty: 'pro',
        durationSeconds: 90,
        mutatorsEnabled: false,
        controlStyle: 'dribble',
      });

      expect(match.isFourVsFourMode()).toBe(true);
      expect(match.hasKeepers()).toBe(true);
      expect(match.canHumanSwitchPlayer()).toBe(true);
      expect(match.config.pitchSize).toBe('xl');
      expect(match.bounds.right - match.bounds.left).toBeGreaterThan(640);
      expect(match.players).toHaveLength(8);

      const teamAOut = match.players.filter((p) => p.team === 'A' && p.role === 'outfield');
      const teamAKeepers = match.players.filter((p) => p.team === 'A' && p.role === 'keeper');
      const teamBOut = match.players.filter((p) => p.team === 'B' && p.role === 'outfield');
      const teamBKeepers = match.players.filter((p) => p.team === 'B' && p.role === 'keeper');

      expect(teamAOut).toHaveLength(3);
      expect(teamAKeepers).toHaveLength(1);
      expect(teamBOut).toHaveLength(3);
      expect(teamBKeepers).toHaveLength(1);

      for (const p of match.players) {
        expect(isInsidePitchOctagon(p.x, p.y, match.bounds, p.radius)).toBe(true);
      }

      const p1Count = match.players.filter((p) => p.humanSlot === 1).length;
      const p2Count = match.players.filter((p) => p.humanSlot === 2).length;
      expect(p1Count).toBe(1);

      if (mode === '4v4_local') {
        expect(p2Count).toBe(1);
        expect(teamBOut.some((p) => p.humanSlot === 2)).toBe(true);
      } else if (mode === '4v4_coop') {
        expect(p2Count).toBe(1);
        expect(teamAOut.filter((p) => p.humanSlot !== null)).toHaveLength(2);
        expect(teamAOut.filter((p) => p.humanSlot === null)).toHaveLength(1);
      } else {
        expect(p2Count).toBe(0);
      }

      if (mode === 'derby_cup_4v4') {
        expect(match.cup.active).toBe(true);
      }
    }
  });

  it('cycles manual switch round-robin across 3 outfielders in 4v4 and avoids slot collisions in 4v4 coop', () => {
    const match = new MatchState(() => 0.42);
    match.startMatch({
      mode: '4v4_ai',
      arena: 'classic',
      pitchSize: 'standard',
      difficulty: 'pro',
      durationSeconds: 90,
      mutatorsEnabled: false,
      controlStyle: 'dribble',
    });

    const empty = { p1: createEmptyInput(), p2: createEmptyInput() };
    for (let i = 0; i < 100; i++) {
      match.update(FIXED_DT, empty);
    }
    expect(match.phase).toBe('PLAYING');

    const teamAIds = match.players
      .filter((p) => p.team === 'A' && p.role === 'outfield')
      .map((p) => p.id);
    expect(teamAIds).toHaveLength(3);
    const activeId = () => match.players.find((p) => p.humanSlot === 1)?.id;
    expect(activeId()).toBe(teamAIds[0]);

    const switchInput = {
      p1: { ...createEmptyInput(), switchJustPressed: true },
      p2: createEmptyInput(),
    };
    match.update(FIXED_DT, switchInput);
    expect(activeId()).toBe(teamAIds[1]);
    match.update(FIXED_DT, switchInput);
    expect(activeId()).toBe(teamAIds[2]);
    match.update(FIXED_DT, switchInput);
    expect(activeId()).toBe(teamAIds[0]);

    // In 4v4 co-op, P1 switching skips P2 and moves only onto the AI teammate
    match.startMatch({
      mode: '4v4_coop',
      arena: 'classic',
      pitchSize: 'xl',
      difficulty: 'pro',
      durationSeconds: 90,
      mutatorsEnabled: false,
      controlStyle: 'dribble',
    });
    for (let i = 0; i < 100; i++) {
      match.update(FIXED_DT, empty);
    }
    const coopIds = match.players
      .filter((p) => p.team === 'A' && p.role === 'outfield')
      .map((p) => p.id);
    expect(match.players.find((p) => p.humanSlot === 1)?.id).toBe(coopIds[0]);
    expect(match.players.find((p) => p.humanSlot === 2)?.id).toBe(coopIds[1]);

    match.update(FIXED_DT, switchInput);
    expect(match.players.find((p) => p.humanSlot === 1)?.id).toBe(coopIds[2]);
    expect(match.players.find((p) => p.humanSlot === 2)?.id).toBe(coopIds[1]);
  });

  it('spreads multiple 4v4 AI support teammates across distinct offensive and defensive lanes', () => {
    const bounds = createArenaBounds(1.0, 'classic', 'xl');
    const ai = new AIController(() => 0.4);

    const human = makePlayer({
      id: 1,
      team: 'A',
      humanSlot: 1,
      x: bounds.centerX + 90,
      y: bounds.centerY - 40,
    });
    const bot1 = makePlayer({
      id: 2,
      team: 'A',
      humanSlot: null,
      x: bounds.centerX + 20,
      y: bounds.centerY,
      aiDecisionTimer: 0,
    });
    const bot2 = makePlayer({
      id: 3,
      team: 'A',
      humanSlot: null,
      x: bounds.centerX + 20,
      y: bounds.centerY,
      aiDecisionTimer: 0,
    });
    const keeperA = makePlayer({
      id: 4,
      team: 'A',
      role: 'keeper',
      humanSlot: null,
      x: bounds.left + 10,
      y: bounds.centerY,
    });

    // Attacking scenario: human carries the ball forward -> bots take separate wing & trailer lanes
    const attackBall = makeBall({ x: human.x + 11, y: human.y, carrierId: human.id });
    ai.computeInput(FIXED_DT, bot1, [human, bot1, bot2, keeperA], [attackBall], bounds, 'pro');
    ai.computeInput(FIXED_DT, bot2, [human, bot1, bot2, keeperA], [attackBall], bounds, 'pro');
    expect(bot1.aiState).toBe('ALIGN_SHOT');
    expect(bot2.aiState).toBe('ALIGN_SHOT');
    expect(
      Math.hypot(bot1.aiTargetX - bot2.aiTargetX, bot1.aiTargetY - bot2.aiTargetY)
    ).toBeGreaterThan(35);

    // Defensive scenario: opponent threatens near Team A box -> bots split goal cover vs weak-side lane
    const oppAttacker = makePlayer({
      id: 5,
      team: 'B',
      humanSlot: null,
      x: bounds.left + 95,
      y: bounds.centerY - 25,
    });
    human.x = bounds.centerX;
    human.y = bounds.centerY;
    bot1.aiDecisionTimer = 0;
    bot2.aiDecisionTimer = 0;
    const defBall = makeBall({ x: oppAttacker.x - 11, y: oppAttacker.y, carrierId: oppAttacker.id });
    const defRoster = [human, bot1, bot2, keeperA, oppAttacker];
    ai.computeInput(FIXED_DT, bot1, defRoster, [defBall], bounds, 'pro');
    ai.computeInput(FIXED_DT, bot2, defRoster, [defBall], bounds, 'pro');
    expect(bot1.aiState).toBe('DEFEND_GOAL');
    expect(bot2.aiState).toBe('DEFEND_GOAL');
    expect(
      Math.hypot(bot1.aiTargetX - bot2.aiTargetX, bot1.aiTargetY - bot2.aiTargetY)
    ).toBeGreaterThan(35);
  });
});
