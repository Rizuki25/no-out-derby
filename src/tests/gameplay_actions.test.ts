import { afterEach, describe, expect, it } from 'vitest';
import { createArenaBounds, resolvePassTarget } from '../engine/ArenaGeometry.ts';
import { createDefaultPhysicsParams, PhysicsEngine } from '../engine/PhysicsEngine.ts';
import { AIController, createEmptyInput } from '../game/AIController.ts';
import { createDefaultTeamModifiers } from '../game/DerbyCup.ts';
import { InputManager } from '../game/InputManager.ts';
import { MatchState } from '../game/MatchState.ts';
import { ARENA_CONSTANTS, Ball, FIXED_DT, GameEvent, MatchConfig, Player, PlayerInput } from '../types.ts';

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 1,
    team: 'A',
    role: 'outfield',
    humanSlot: 1,
    x: 180,
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
    feintTimer: 0,
    feintDir: 1,
    isPassSwing: false,
    feverActive: false,
    animState: 'idle',
    animTime: 0,
    aiState: 'CHASE_BALL',
    aiDecisionTimer: 0,
    aiTargetX: 180,
    aiTargetY: ARENA_CONSTANTS.CENTER_Y,
    aiWantCharge: false,
    aiChargeTarget: 0,
    aiWantDash: false,
    ...overrides,
  };
}

function makeBall(x: number, y: number, vx = 0, vy = 0, overrides: Partial<Ball> = {}): Ball {
  return {
    id: 1,
    x,
    y,
    vx,
    vy,
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
    oneTimerTimer: 0,
    feverTimer: 0,
    ...overrides,
  };
}

function createMockGamepad(buttonsPressed: number[] = [], axes: number[] = [0, 0, 0, 0]): Gamepad {
  const buttons: GamepadButton[] = Array.from({ length: 16 }, (_, idx) => {
    const pressed = buttonsPressed.includes(idx);
    return { pressed, touched: pressed, value: pressed ? 1 : 0 };
  });
  return {
    id: 'Xbox Mock Gamepad (STANDARD GAMEPAD Vendor: 045e Product: 02fd)',
    index: 0,
    connected: true,
    mapping: 'standard',
    axes,
    buttons,
    timestamp: 1000,
    hapticActuators: [],
    vibrationActuator: null as unknown as GamepadHapticActuator,
  } as unknown as Gamepad;
}

describe('Category 1: Smart Pass, Skill Feint, Fever Gauge & Quick Tactics', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  it('locks smart Pass onto open wing teammate without goal-cone hijack and triggers Give-and-Go', () => {
    const physics = new PhysicsEngine(() => 0.5);
    const bounds = createArenaBounds(1.0, 'classic');
    const params = createDefaultPhysicsParams('classic');
    params.controlStyle = 'dribble';

    // Passer faces diagonally toward top-right near goal-cone boundary; open teammate stands wide on bottom wing.
    const passer = makePlayer({ id: 1, team: 'A', x: 220, y: 120, facingX: 0.7, facingY: 0.7 });
    const wingMate = makePlayer({
      id: 2,
      team: 'A',
      humanSlot: null,
      x: 310,
      y: 205,
      vx: 0,
      vy: 25,
    });
    const oppKeeper = makePlayer({
      id: 3,
      team: 'B',
      role: 'keeper',
      humanSlot: null,
      x: bounds.right - 10,
      y: bounds.centerY,
      facingX: -1,
    });

    const target = resolvePassTarget(passer, [passer, wingMate, oppKeeper], bounds, 0.7, 0.7);
    expect(target).not.toBeNull();
    expect(target?.targetPlayerId).toBe(wingMate.id);

    const ball = makeBall(passer.x + 12, passer.y + 8, 0, 0, { carrierId: passer.id });
    const inputs = new Map<number, PlayerInput>();
    inputs.set(passer.id, {
      ...createEmptyInput(),
      moveX: 0.7,
      moveY: 0.7,
      passJustPressed: true,
    });
    inputs.set(wingMate.id, createEmptyInput());
    inputs.set(oppKeeper.id, createEmptyInput());

    const mods = {
      A: createDefaultTeamModifiers(),
      B: createDefaultTeamModifiers(),
    };

    const res = physics.step(FIXED_DT, [ball], [passer, wingMate, oppKeeper], inputs, bounds, params, true, mods);
    const kickEv = res.events.find((e) => e.type === 'kick');

    expect(ball.carrierId).toBeNull();
    expect(kickEv?.type).toBe('kick');
    if (kickEv?.type === 'kick') {
      expect(kickEv.isPass).toBe(true);
      expect(kickEv.isShot).toBe(false);
    }
    // Pass ball moves downward-right toward wingMate (positive vy) instead of hijacking center goal mouth
    expect(ball.vx).toBeGreaterThan(150);
    expect(ball.vy).toBeGreaterThan(85);
    // Give-and-Go forward momentum boost on passer toward pass direction
    expect(passer.vx).toBeGreaterThan(30);
    expect(passer.vy).toBeGreaterThan(25);
  });

  it('AI bot uses dedicated passJustPressed to feed open teammate when lane is clear', () => {
    const ai = new AIController(() => 0.5);
    const bounds = createArenaBounds(1.0, 'classic');

    const botCarrier = makePlayer({
      id: 1,
      team: 'A',
      humanSlot: null,
      x: bounds.left + 90,
      y: bounds.centerY,
    });
    const openAiMate = makePlayer({
      id: 2,
      team: 'A',
      humanSlot: null,
      x: bounds.centerX + 50,
      y: bounds.centerY + 35,
    });
    const closeOpp = makePlayer({
      id: 3,
      team: 'B',
      humanSlot: null,
      x: botCarrier.x - 18,
      y: botCarrier.y - 8,
    });
    const ball = makeBall(botCarrier.x + 12, botCarrier.y, 0, 0, { carrierId: botCarrier.id });

    const input = ai.computeInput(
      FIXED_DT,
      botCarrier,
      [botCarrier, openAiMate, closeOpp],
      [ball],
      bounds,
      'pro',
      'attack'
    );
    expect(input.passJustPressed).toBe(true);
    expect(input.kickJustReleased).toBe(false);
    expect(input.moveX).toBeGreaterThan(0.5);
  });

  it('executes Skill Dribble Feint while carrying and evades incoming Dash-Tackle with ANKLE BREAKER!', () => {
    const physics = new PhysicsEngine(() => 0.5);
    const bounds = createArenaBounds(1.0, 'classic');
    const params = createDefaultPhysicsParams('classic');
    params.controlStyle = 'dribble';

    const carrier = makePlayer({
      id: 1,
      team: 'A',
      humanSlot: 1,
      x: 220,
      y: ARENA_CONSTANTS.CENTER_Y,
      facingX: 1,
      facingY: 0,
    });
    const defender = makePlayer({
      id: 2,
      team: 'B',
      humanSlot: null,
      x: 232,
      y: ARENA_CONSTANTS.CENTER_Y,
      facingX: -1,
      facingY: 0,
      dashTimer: 0.14,
      dashDirX: -1,
      dashDirY: 0,
      vx: -250,
    });
    const ball = makeBall(carrier.x + 12, carrier.y, 0, 0, { carrierId: carrier.id });

    const mods = {
      A: createDefaultTeamModifiers(),
      B: createDefaultTeamModifiers(),
    };

    const inputs = new Map<number, PlayerInput>();
    inputs.set(carrier.id, { ...createEmptyInput(), moveX: 1, dashJustPressed: true });
    inputs.set(defender.id, createEmptyInput());

    const collectedEvents: GameEvent[] = [];
    for (let step = 0; step < 3; step++) {
      const res = physics.step(FIXED_DT, [ball], [carrier, defender], inputs, bounds, params, true, mods);
      collectedEvents.push(...res.events);
      // Clear single-frame edge trigger after frame 0
      inputs.set(carrier.id, { ...createEmptyInput(), moveX: 1 });
    }

    const feintDodgeEv = collectedEvents.find((e) => e.type === 'feint_dodge');
    expect(carrier.feintTimer).toBeGreaterThan(0);
    expect(Math.abs(carrier.dashDirY)).toBeGreaterThan(0.35);
    expect(feintDodgeEv).toBeDefined();
    expect(ball.carrierId).toBe(carrier.id);
    expect(defender.stunTimer).toBeGreaterThan(0);
    expect(carrier.stunTimer).toBe(0);
  });

  it('fills Fever gauge on steals/saves/goals, activates Fever Blitz boosts, and launches blazing Fever Strike', () => {
    const match = new MatchState(() => 0.5);
    const config: MatchConfig = {
      mode: '1v1_ai',
      arena: 'classic',
      pitchSize: 'standard',
      difficulty: 'pro',
      durationSeconds: 90,
      mutatorsEnabled: false,
      replayEnabled: false,
      controlStyle: 'dribble',
    };
    match.startMatch(config);
    match.phase = 'PLAYING';
    match.phaseTimer = 0;

    // 1. Cannot activate Fever prematurely before 100%
    expect(match.tryActivateFever('A')).toHaveLength(0);
    match.addTeamFever('A', 60);
    expect(match.teamFeverA).toBe(60);
    match.addTeamFever('A', 75);
    expect(match.teamFeverA).toBe(100);

    // 2. Activate Fever Mode via P1 input during MatchState.update
    const p1 = match.players.find((p) => p.humanSlot === 1)!;
    const kickEvents = match.update(FIXED_DT, {
      p1: { ...createEmptyInput(), feverJustPressed: true },
      p2: createEmptyInput(),
    });
    expect(kickEvents.some((e) => e.type === 'fever_activate' && e.team === 'A')).toBe(true);
    expect(match.isTeamFeverActive('A')).toBe(true);
    expect(match.teamFeverA).toBe(0);
    expect(p1.feverActive).toBe(true);

    // 3. Fire a shot during Fever Blitz -> emits isFeverShot, triggers blazing ball.feverTimer & exceeds standard speed cap
    const physics = new PhysicsEngine(() => 0.5);
    const bounds = createArenaBounds(1.0, 'classic');
    const params = createDefaultPhysicsParams('classic');
    params.controlStyle = 'dribble';

    const shooter = makePlayer({ id: 1, team: 'A', x: 300, y: ARENA_CONSTANTS.CENTER_Y, facingX: 1, facingY: 0, feverActive: true });
    const ball = makeBall(shooter.x + 12, shooter.y, 0, 0, { carrierId: shooter.id });
    const feverMods = {
      A: { ...createDefaultTeamModifiers(), shotPowerMult: 1.18, feverActive: true },
      B: createDefaultTeamModifiers(),
    };
    const inputs = new Map<number, PlayerInput>();
    inputs.set(shooter.id, { ...createEmptyInput(), moveX: 1, kickHeld: true });
    physics.step(FIXED_DT, [ball], [shooter], inputs, bounds, params, true, feverMods);
    // Fully charge kick then release
    shooter.chargeTime = ARENA_CONSTANTS.MAX_CHARGE_TIME;
    inputs.set(shooter.id, { ...createEmptyInput(), moveX: 1, kickJustReleased: true });
    const res = physics.step(FIXED_DT, [ball], [shooter], inputs, bounds, params, true, feverMods);

    const shotEv = res.events.find((e) => e.type === 'kick');
    expect(shotEv?.type).toBe('kick');
    if (shotEv?.type === 'kick') {
      expect(shotEv.isFeverShot).toBe(true);
    }
    expect(ball.feverTimer).toBeGreaterThan(0.5);
    expect(Math.hypot(ball.vx, ball.vy)).toBeGreaterThan(params.maxBallSpeed);
  });

  it('cycles Team Tactics cleanly and shifts AI support bot positions between Attack+ and Defend+', () => {
    const match = new MatchState(() => 0.5);
    match.startMatch({
      mode: '4v4_ai',
      arena: 'classic',
      pitchSize: 'xl',
      difficulty: 'pro',
      durationSeconds: 90,
      mutatorsEnabled: false,
      replayEnabled: false,
      controlStyle: 'dribble',
    });
    match.phase = 'PLAYING';
    match.phaseTimer = 0;

    expect(match.getTeamTactic('A')).toBe('balanced');
    const tacEvents1 = match.update(FIXED_DT, {
      p1: { ...createEmptyInput(), tacticCycleJustPressed: true },
      p2: createEmptyInput(),
    });
    expect(match.getTeamTactic('A')).toBe('attack');
    expect(tacEvents1.some((e) => e.type === 'tactic_change' && e.tactic === 'attack')).toBe(true);

    match.update(FIXED_DT, {
      p1: { ...createEmptyInput(), tacticCycleJustPressed: true },
      p2: createEmptyInput(),
    });
    expect(match.getTeamTactic('A')).toBe('defend');

    match.update(FIXED_DT, {
      p1: { ...createEmptyInput(), tacticCycleJustPressed: true },
      p2: createEmptyInput(),
    });
    expect(match.getTeamTactic('A')).toBe('balanced');

    // Verify AI support bots adopt noticeably higher X in 'attack' vs 'defend'
    const ai = new AIController(() => 0.5);
    const bounds = createArenaBounds(1.0, 'classic', 'xl');
    const carrier = makePlayer({ id: 1, team: 'A', humanSlot: 1, x: bounds.centerX + 30, y: bounds.centerY });
    const makeSupport = () =>
      makePlayer({
        id: 2,
        team: 'A',
        humanSlot: null,
        x: bounds.centerX - 10,
        y: bounds.top + 80,
        aiDecisionTimer: 0,
      });
    const wingAtk = makeSupport();
    const wingDef = makeSupport();
    const ball = makeBall(carrier.x + 12, carrier.y, 0, 0, { carrierId: carrier.id });

    ai.computeInput(FIXED_DT, wingAtk, [carrier, wingAtk], [ball], bounds, 'pro', 'attack');
    ai.computeInput(FIXED_DT, wingDef, [carrier, wingDef], [ball], bounds, 'pro', 'defend');

    expect(wingAtk.aiTargetX).toBeGreaterThan(wingDef.aiTargetX + 35);
  });

  it('maps Keyboard Pass/Fever/Tactics and External Gamepad X/RB/LB triggers cleanly', () => {
    const winTarget = new EventTarget();
    const hadWindow = 'window' in globalThis && typeof globalThis.window !== 'undefined';
    const origWindow = hadWindow ? globalThis.window : undefined;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: winTarget,
    });
    cleanups.push(() => {
      if (hadWindow) {
        Object.defineProperty(globalThis, 'window', {
          configurable: true,
          writable: true,
          value: origWindow,
        });
      } else {
        delete (globalThis as Record<string, unknown>).window;
      }
    });

    const input = new InputManager();
    cleanups.push(() => input.destroy());

    const origGetGamepads = navigator.getGamepads?.bind(navigator);
    let activePads: Array<Gamepad | null> = [null];
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => activePads,
    });
    cleanups.push(() => {
      Object.defineProperty(navigator, 'getGamepads', {
        configurable: true,
        value: origGetGamepads,
      });
    });

    // Edge trigger Pass (buttons[2]=X), Tactics (buttons[4]=LB), Fever (buttons[5]=RB)
    activePads = [createMockGamepad([2, 4, 5])];
    const padInputs = input.getPlayerInputs(false);
    expect(padInputs.p1.passJustPressed).toBe(true);
    expect(padInputs.p1.tacticCycleJustPressed).toBe(true);
    expect(padInputs.p1.feverJustPressed).toBe(true);
    expect(padInputs.p1.kickHeld).toBe(false);
    input.endFrame();

    // Holding same buttons on next frame should NOT re-fire justPressed edges
    const heldPadInputs = input.getPlayerInputs(false);
    expect(heldPadInputs.p1.passJustPressed).toBe(false);
    expect(heldPadInputs.p1.tacticCycleJustPressed).toBe(false);
    expect(heldPadInputs.p1.feverJustPressed).toBe(false);
    input.endFrame();

    activePads = [null];

    // Keyboard check for P1 (E, C, Tab) & P2 (Period, Backslash, BracketRight)
    const dispatchKey = (code: string) => {
      let prevented = false;
      const ev = Object.assign(new Event('keydown'), {
        code,
        preventDefault: () => {
          prevented = true;
        },
      });
      winTarget.dispatchEvent(ev);
      return prevented;
    };
    dispatchKey('KeyE');
    dispatchKey('KeyC');
    const tabPrevented = dispatchKey('Tab');
    dispatchKey('Period');
    dispatchKey('Backslash');
    dispatchKey('BracketRight');

    expect(tabPrevented).toBe(true);
    const kbInputs = input.getPlayerInputs(true);
    expect(kbInputs.p1.passJustPressed).toBe(true);
    expect(kbInputs.p1.feverJustPressed).toBe(true);
    expect(kbInputs.p1.tacticCycleJustPressed).toBe(true);
    expect(kbInputs.p2.passJustPressed).toBe(true);
    expect(kbInputs.p2.feverJustPressed).toBe(true);
    expect(kbInputs.p2.tacticCycleJustPressed).toBe(true);
    input.endFrame();
  });
});
