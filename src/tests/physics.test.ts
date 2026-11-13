import { describe, expect, it } from 'vitest';
import { createArenaBounds, isInsidePitchOctagon } from '../engine/ArenaGeometry.ts';
import { createDefaultPhysicsParams, PhysicsEngine } from '../engine/PhysicsEngine.ts';
import { ARENA_CONSTANTS, Ball, FIXED_DT, Player, PlayerInput } from '../types.ts';
import { createEmptyInput } from '../game/AIController.ts';

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

describe('PhysicsEngine', () => {
  it('prevents high-speed pinball tunneling through arena walls and corners', () => {
    const engine = new PhysicsEngine();
    const bounds = createArenaBounds(1.0);
    const params = createDefaultPhysicsParams();
    params.pinballActive = true;
    params.wallRestitution = 1.14;
    params.maxBallSpeed = 445;

    const ball = makeBall({ vx: 440, vy: 390 });
    const inputs = new Map<number, PlayerInput>();

    for (let i = 0; i < 1200; i++) {
      const res = engine.step(FIXED_DT, [ball], [], inputs, bounds, params, false);
      void res;
      // Ball must always stay inside outer bounding limits (including goal pocket range)
      expect(ball.x).toBeGreaterThanOrEqual(bounds.left - bounds.goalDepth);
      expect(ball.x).toBeLessThanOrEqual(bounds.right + bounds.goalDepth);
      expect(ball.y).toBeGreaterThanOrEqual(bounds.top);
      expect(ball.y).toBeLessThanOrEqual(bounds.bottom);
      expect(Math.hypot(ball.vx, ball.vy)).toBeLessThanOrEqual(params.maxBallSpeed + 0.01);
    }
  });

  it('bounces ball cleanly 90 degrees off 45-degree chamfered corner', () => {
    const engine = new PhysicsEngine();
    const bounds = createArenaBounds(1.0);
    const params = createDefaultPhysicsParams();
    params.ballFriction = 1.0;
    params.wallRestitution = 1.0;

    // Shoot ball directly left toward top-left 45-degree chamfer (x:36..68, y:44..76)
    const ball = makeBall({ x: 75, y: 54, vx: -220, vy: 0 });
    const inputs = new Map<number, PlayerInput>();

    let bounced = false;
    for (let i = 0; i < 20; i++) {
      const res = engine.step(FIXED_DT, [ball], [], inputs, bounds, params, true);
      if (res.events.some((e) => e.type === 'wall_bounce')) {
        bounced = true;
        break;
      }
    }

    expect(bounced).toBe(true);
    // Hitting the 45° TL chamfer heading (-1, 0) reflects velocity downward (+y)
    expect(ball.vy).toBeGreaterThan(150);
    expect(Math.abs(ball.vx)).toBeLessThan(30);
  });

  it('emits post_clang and reflects ball sharply off circular goalpost', () => {
    const engine = new PhysicsEngine();
    const bounds = createArenaBounds(1.0);
    const params = createDefaultPhysicsParams();
    const ball = makeBall({ x: bounds.right - 16, y: bounds.goalTopY, vx: 220, vy: 0 });

    let clangEvents = 0;
    for (let i = 0; i < 12; i++) {
      const res = engine.step(FIXED_DT, [ball], [], new Map(), bounds, params, true);
      clangEvents += res.events.filter((e) => e.type === 'post_clang').length;
    }

    expect(clangEvents).toBeGreaterThanOrEqual(1);
    expect(ball.vx).toBeLessThan(0);
  });

  it('slows player by 40% while charging Power Shot and fires curved power shot on release', () => {
    const engine = new PhysicsEngine();
    const bounds = createArenaBounds(1.0);
    const params = createDefaultPhysicsParams();

    const normalPlayer = makePlayer({ id: 1, x: 120, y: 120 });
    const chargingPlayer = makePlayer({ id: 2, x: 120, y: 190 });

    const inputs = new Map<number, PlayerInput>();
    for (let i = 0; i < 36; i++) {
      inputs.set(1, { ...createEmptyInput(), moveX: 1, moveY: 0, kickHeld: false });
      inputs.set(2, { ...createEmptyInput(), moveX: 1, moveY: 0, kickHeld: true });
      engine.step(FIXED_DT, [], [normalPlayer, chargingPlayer], inputs, bounds, params, true);
    }

    const normalSpeed = Math.hypot(normalPlayer.vx, normalPlayer.vy);
    const chargeSpeed = Math.hypot(chargingPlayer.vx, chargingPlayer.vy);
    expect(chargeSpeed / normalSpeed).toBeCloseTo(0.6, 1);
    expect(chargingPlayer.chargeTime).toBeCloseTo(0.6, 1);

    // Now test kick with lateral strafing spin
    const shooter = makePlayer({ id: 3, x: 200, y: 146, vx: 0, vy: 95, facingX: 1, facingY: 0, isCharging: true, chargeTime: 0.6 });
    const ball = makeBall({ x: 211, y: 146 });
    const kickInputs = new Map<number, PlayerInput>([
      [3, { ...createEmptyInput(), moveX: 1, moveY: 0, kickJustReleased: true }],
    ]);

    const res = engine.step(FIXED_DT, [ball], [shooter], kickInputs, bounds, params, true);
    const kickEv = res.events.find((e) => e.type === 'kick');
    expect(kickEv).toBeDefined();
    if (kickEv && kickEv.type === 'kick') {
      expect(kickEv.power).toBeCloseTo(1, 2);
      expect(kickEv.curved).toBe(true);
    }
    expect(Math.hypot(ball.vx, ball.vy)).toBeGreaterThan(280);
  });

  it('detects dash tackle stun on opponent and respects Wide Goals scoring', () => {
    const engine = new PhysicsEngine();
    const bounds = createArenaBounds(1.6);
    const params = createDefaultPhysicsParams();
    params.goalWidthMultiplier = 1.6;

    const p1 = makePlayer({ id: 1, team: 'A', x: 200, y: 146, facingX: 1, facingY: 0 });
    const p2 = makePlayer({ id: 2, team: 'B', x: 215, y: 146, facingX: -1, facingY: 0 });

    const inputs = new Map<number, PlayerInput>([
      [1, { ...createEmptyInput(), moveX: 1, dashJustPressed: true }],
      [2, createEmptyInput()],
    ]);

    let tackled = false;
    for (let i = 0; i < 6; i++) {
      const res = engine.step(FIXED_DT, [], [p1, p2], inputs, bounds, params, true);
      inputs.set(1, createEmptyInput());
      if (res.events.some((e) => e.type === 'tackle')) tackled = true;
    }

    expect(tackled).toBe(true);
    expect(p2.stunTimer).toBeGreaterThan(0);

    // Ball entering widened portion of right goal (e.g. y = 110, which is outside normal [117..175] but inside wide [100..192])
    const wideBall = makeBall({ x: bounds.right + 4, y: 110, vx: 120 });
    const scoreRes = engine.step(FIXED_DT, [wideBall], [], new Map(), bounds, params, true);
    expect(scoreRes.scoredBy).toBe('A');
    expect(isInsidePitchOctagon(bounds.centerX, bounds.centerY, bounds)).toBe(true);
  });
});
