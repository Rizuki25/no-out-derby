import { describe, expect, it } from 'vitest';
import { createArenaBounds, isInsidePitchOctagon } from '../engine/ArenaGeometry.ts';
import { createDefaultPhysicsParams, PhysicsEngine } from '../engine/PhysicsEngine.ts';
import { AIController, createEmptyInput } from '../game/AIController.ts';
import { MatchState } from '../game/MatchState.ts';
import { MutatorManager } from '../game/MutatorManager.ts';
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
    shirtNumber: 9,
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
});
