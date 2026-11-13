import { describe, expect, it } from 'vitest';
import { createArenaBounds } from '../engine/ArenaGeometry.ts';
import { createDefaultPhysicsParams, PhysicsEngine } from '../engine/PhysicsEngine.ts';
import { createEmptyInput } from '../game/AIController.ts';
import { MatchState } from '../game/MatchState.ts';
import { cycleTeamKit, getTeamKit, TEAM_KIT_LIST } from '../render/TeamKits.ts';
import {
  ARENA_CONSTANTS,
  Ball,
  FIXED_DT,
  GameEvent,
  Player,
  PlayerInput,
  Team,
} from '../types.ts';

function makePlayer(
  id: number,
  team: Team,
  role: 'outfield' | 'keeper',
  x: number,
  y: number
): Player {
  return {
    id,
    team,
    role,
    humanSlot: null,
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
    animState: 'idle',
    animTime: 0,
    aiState: 'CHASE_BALL',
    aiDecisionTimer: 0,
    aiTargetX: x,
    aiTargetY: y,
    aiWantCharge: false,
    aiChargeTarget: 0,
    aiWantDash: false,
    shirtNumber: id,
  };
}

function makeBall(x: number = ARENA_CONSTANTS.CENTER_X, y: number = ARENA_CONSTANTS.CENTER_Y): Ball {
  return {
    id: 1,
    x,
    y,
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
    oneTimerTimer: 0,
  };
}

describe('Game Feel, Actions & Team Kits', () => {
  it('cycles team kits without colliding with the opponent kit and preserves kits in MatchState + ReplayBuffer', () => {
    // Stepping forward from garuda when opponent has cyber skips cyber -> tarkam
    expect(cycleTeamKit('garuda', 'cyber', 1)).toBe('tarkam');
    expect(cycleTeamKit('tarkam', 'cyber', -1)).toBe('garuda');

    for (const oppKit of TEAM_KIT_LIST) {
      let cur = cycleTeamKit('garuda', oppKit, 1);
      for (let i = 0; i < TEAM_KIT_LIST.length; i++) {
        expect(cur).not.toBe(oppKit);
        const preset = getTeamKit(cur);
        expect(preset.tag.length).toBeGreaterThanOrEqual(3);
        expect(preset.name.length).toBeGreaterThan(0);
        expect(preset.primary).toMatch(/^#/);
        cur = cycleTeamKit(cur, oppKit, 1);
      }
    }

    const match = new MatchState();
    match.startMatch({
      mode: '1v1_local',
      arena: 'classic',
      difficulty: 'pro',
      durationSeconds: 90,
      mutatorsEnabled: false,
      replayEnabled: true,
      teamAKit: 'tarkam',
      teamBKit: 'shadow',
    });

    expect(match.config.teamAKit).toBe('tarkam');
    expect(match.config.teamBKit).toBe('shadow');

    const empty = { p1: createEmptyInput(), p2: createEmptyInput() };
    for (let i = 0; i < 60; i++) match.update(FIXED_DT, empty);
    for (let i = 0; i < 65; i++) match.update(FIXED_DT, empty);

    // Score a spectacular upper-corner shot past keeper to trigger REPLAY and verify snapshot keeps team kits
    match.balls[0].x = match.bounds.right - 2;
    match.balls[0].y = match.bounds.goalTopY + 8;
    match.balls[0].vx = 310;
    match.balls[0].lastKickPower = 0.9;
    match.update(FIXED_DT, empty);
    for (let i = 0; i < 35; i++) match.update(FIXED_DT, empty);

    expect(match.phase).toBe('REPLAY');
    const replayFrame = match.replay.getCurrentPlaybackFrame();
    expect(replayFrame).not.toBeNull();
    expect(replayFrame?.teamAKit).toBe('tarkam');
    expect(replayFrame?.teamBKit).toBe('shadow');
  });

  it('launches powered One-Timer volley on fast incoming loose pass, but not on stationary tap or carried dribble', () => {
    const engine = new PhysicsEngine();
    const bounds = createArenaBounds(1.0);
    const params = createDefaultPhysicsParams('classic');

    // Case 1: Incoming fast loose pass from teammate -> One-Timer!
    const kicker = makePlayer(1, 'A', 'outfield', bounds.centerX, bounds.centerY);
    kicker.kickSwingTimer = 0.14;
    kicker.kickSwingPower = 0.35;
    kicker.kickSwingDirX = 1;
    kicker.kickSwingDirY = 0;

    const incomingBall = makeBall(bounds.centerX + 12, bounds.centerY);
    incomingBall.vx = -155;
    incomingBall.vy = 0;
    incomingBall.lastTouchPlayerId = 3; // teammate pass
    incomingBall.lastTouchTeam = 'A';

    const inputs = new Map<number, PlayerInput>([[1, createEmptyInput()]]);
    const eventsOneTimer: GameEvent[] = [];
    for (let i = 0; i < 4; i++) {
      const res = engine.step(FIXED_DT, [incomingBall], [kicker], inputs, bounds, params, true);
      eventsOneTimer.push(...res.events);
    }

    const oneTimerKick = eventsOneTimer.find((e) => e.type === 'kick');
    expect(oneTimerKick).toBeDefined();
    expect(oneTimerKick?.type === 'kick' && oneTimerKick.isOneTimer).toBe(true);
    const oneTimerSpeed = Math.hypot(incomingBall.vx, incomingBall.vy);
    expect(oneTimerSpeed).toBeGreaterThan(240);
    expect(incomingBall.oneTimerTimer ?? 0).toBeGreaterThan(0);

    // Case 2: Stationary ball kicked with same swing power -> NOT One-Timer, slower
    const kicker2 = makePlayer(1, 'A', 'outfield', bounds.centerX, bounds.centerY);
    kicker2.kickSwingTimer = 0.14;
    kicker2.kickSwingPower = 0.35;
    kicker2.kickSwingDirX = 1;
    kicker2.kickSwingDirY = 0;

    const staticBall = makeBall(bounds.centerX + 12, bounds.centerY);
    const eventsStatic: GameEvent[] = [];
    for (let i = 0; i < 4; i++) {
      const res = engine.step(FIXED_DT, [staticBall], [kicker2], inputs, bounds, params, true);
      eventsStatic.push(...res.events);
    }

    const staticKick = eventsStatic.find((e) => e.type === 'kick');
    expect(staticKick).toBeDefined();
    expect(staticKick?.type === 'kick' && staticKick.isOneTimer).toBe(false);
    expect(oneTimerSpeed).toBeGreaterThan(Math.hypot(staticBall.vx, staticBall.vy) + 40);

    // Case 3: Carried ball in Dribble mode -> NEVER triggers One-Timer
    const dribbleParams = { ...params, controlStyle: 'dribble' as const };
    const dribbler = makePlayer(1, 'A', 'outfield', bounds.centerX, bounds.centerY);
    dribbler.vx = 140;
    dribbler.kickSwingTimer = 0.14;
    dribbler.kickSwingPower = 0.4;
    dribbler.kickSwingDirX = 1;
    dribbler.kickSwingDirY = 0;

    const carriedBall = makeBall(bounds.centerX + 11, bounds.centerY);
    carriedBall.carrierId = 1;
    carriedBall.vx = 160;
    carriedBall.lastTouchPlayerId = 3;

    const eventsDribble: GameEvent[] = [];
    for (let i = 0; i < 3; i++) {
      const res = engine.step(
        FIXED_DT,
        [carriedBall],
        [dribbler],
        inputs,
        bounds,
        dribbleParams,
        true
      );
      eventsDribble.push(...res.events);
    }
    const dribbleKick = eventsDribble.find((e) => e.type === 'kick');
    expect(dribbleKick).toBeDefined();
    expect(dribbleKick?.type === 'kick' && dribbleKick.isOneTimer).toBe(false);
  });

  it('emits save events for keeper and goal-box defender blocks, and distinguishes steal vs empty tackle', () => {
    const engine = new PhysicsEngine();
    const bounds = createArenaBounds(1.0);
    const params = createDefaultPhysicsParams('classic');

    // 1. Keeper save on fast incoming shot
    const keeperB = makePlayer(2, 'B', 'keeper', bounds.right - 22, bounds.centerY);
    const shotToKeeper = makeBall(bounds.right - 34, bounds.centerY);
    shotToKeeper.vx = 230;
    shotToKeeper.vy = 0;
    shotToKeeper.lastTouchTeam = 'A';

    const keeperEvents: GameEvent[] = [];
    const emptyMap = new Map<number, PlayerInput>();
    for (let i = 0; i < 6; i++) {
      const res = engine.step(FIXED_DT, [shotToKeeper], [keeperB], emptyMap, bounds, params, true);
      keeperEvents.push(...res.events);
    }
    expect(keeperEvents.some((e) => e.type === 'save' && e.team === 'B')).toBe(true);
    expect(shotToKeeper.vx).toBeLessThan(0);

    // 2. Outfield goal-box block save on fast incoming shot
    const defenderB = makePlayer(3, 'B', 'outfield', bounds.right - 26, bounds.centerY);
    const shotToBox = makeBall(bounds.right - 40, bounds.centerY);
    shotToBox.vx = 220;
    shotToBox.vy = 0;
    shotToBox.lastTouchTeam = 'A';

    const boxEvents: GameEvent[] = [];
    for (let i = 0; i < 6; i++) {
      const res = engine.step(FIXED_DT, [shotToBox], [defenderB], emptyMap, bounds, params, true);
      boxEvents.push(...res.events);
    }
    expect(boxEvents.some((e) => e.type === 'save' && e.team === 'B')).toBe(true);

    // 3. Dash-Tackle steal on Dribble carrier emits stoleBall: true; empty tackle emits stoleBall: false
    const dribbleParams = { ...params, controlStyle: 'dribble' as const };
    const tackler = makePlayer(1, 'A', 'outfield', bounds.centerX - 18, bounds.centerY);
    tackler.dashTimer = 0.12;
    tackler.dashDirX = 1;
    tackler.dashDirY = 0;
    tackler.vx = 260;

    const carrier = makePlayer(2, 'B', 'outfield', bounds.centerX, bounds.centerY);
    const dribbleBall = makeBall(bounds.centerX + 10, bounds.centerY);
    dribbleBall.carrierId = 2;

    const stealEvents: GameEvent[] = [];
    for (let i = 0; i < 5; i++) {
      const res = engine.step(
        FIXED_DT,
        [dribbleBall],
        [tackler, carrier],
        emptyMap,
        bounds,
        dribbleParams,
        true
      );
      stealEvents.push(...res.events);
    }
    const stealTackle = stealEvents.find((e) => e.type === 'tackle');
    expect(stealTackle).toBeDefined();
    expect(stealTackle?.type === 'tackle' && stealTackle.stoleBall).toBe(true);
    expect(carrier.stunTimer).toBeGreaterThan(0);

    // Non-carrier tackle -> stoleBall: false
    const tackler2 = makePlayer(1, 'A', 'outfield', bounds.centerX - 18, bounds.centerY);
    tackler2.dashTimer = 0.12;
    tackler2.dashDirX = 1;
    tackler2.dashDirY = 0;
    tackler2.vx = 260;
    const victim2 = makePlayer(2, 'B', 'outfield', bounds.centerX, bounds.centerY);
    const farBall = makeBall(bounds.left + 30, bounds.centerY);

    const noStealEvents: GameEvent[] = [];
    for (let i = 0; i < 5; i++) {
      const res = engine.step(
        FIXED_DT,
        [farBall],
        [tackler2, victim2],
        emptyMap,
        bounds,
        dribbleParams,
        true
      );
      noStealEvents.push(...res.events);
    }
    const emptyTackle = noStealEvents.find((e) => e.type === 'tackle');
    expect(emptyTackle).toBeDefined();
    expect(emptyTackle?.type === 'tackle' && emptyTackle.stoleBall).toBe(false);
  });

  it('assigns accurate highlightTag for TOP BIN!, BANK SHOT!, and ONE-TIMER! goals in MatchState', () => {
    const empty = { p1: createEmptyInput(), p2: createEmptyInput() };

    // 1. TOP BIN! finesse corner placement (not rocket, no recent bounce)
    const matchTopBin = new MatchState();
    matchTopBin.startMatch({
      mode: '1v1_local',
      arena: 'classic',
      difficulty: 'rookie',
      durationSeconds: 90,
      mutatorsEnabled: false,
      replayEnabled: false,
    });
    for (let i = 0; i < 65; i++) matchTopBin.update(FIXED_DT, empty);

    matchTopBin.balls[0].x = matchTopBin.bounds.right - 1;
    matchTopBin.balls[0].y = matchTopBin.bounds.goalTopY + 7;
    matchTopBin.balls[0].vx = 220;
    matchTopBin.balls[0].vy = 0;
    matchTopBin.balls[0].lastKickPower = 0.55;
    let topBinGoal: GameEvent | undefined;
    for (let i = 0; i < 4; i++) {
      const evs = matchTopBin.update(FIXED_DT, empty);
      topBinGoal = evs.find((e) => e.type === 'goal');
      if (topBinGoal) break;
    }
    expect(topBinGoal?.type === 'goal' && topBinGoal.highlightTag).toBe('TOP BIN!');

    // 2. BANK SHOT! goal shortly after wall bounce
    const matchBank = new MatchState();
    matchBank.startMatch({
      mode: '1v1_local',
      arena: 'classic',
      difficulty: 'rookie',
      durationSeconds: 90,
      mutatorsEnabled: false,
      replayEnabled: false,
    });
    for (let i = 0; i < 65; i++) matchBank.update(FIXED_DT, empty);

    // Move Team B players clear of the goal mouth so the bank shot isn't intercepted
    for (const p of matchBank.players) {
      if (p.team === 'B') {
        p.x = matchBank.bounds.centerX - 80;
        p.y = matchBank.bounds.bottom - 30;
      }
    }

    // Bounce off top wall near (right - 85) so reflected angle enters dead center of right goal
    matchBank.balls[0].x = matchBank.bounds.right - 85;
    matchBank.balls[0].y = matchBank.bounds.top + matchBank.balls[0].radius + 1;
    matchBank.balls[0].vx = 185;
    matchBank.balls[0].vy = -250;
    let bankGoal: GameEvent | undefined;
    for (let i = 0; i < 45; i++) {
      const evs = matchBank.update(FIXED_DT, empty);
      bankGoal = evs.find((e) => e.type === 'goal');
      if (bankGoal) break;
    }
    expect(bankGoal).toBeDefined();
    expect(bankGoal?.type === 'goal' && bankGoal.highlightTag).toBe('BANK SHOT!');

    // 3. ONE-TIMER! goal following a genuine One-Timer volley in MatchState
    const matchVolley = new MatchState();
    matchVolley.startMatch({
      mode: '1v1_local',
      arena: 'classic',
      difficulty: 'rookie',
      durationSeconds: 90,
      mutatorsEnabled: false,
      replayEnabled: false,
    });
    for (let i = 0; i < 65; i++) matchVolley.update(FIXED_DT, empty);

    // Move B keeper aside and position A player near right goal to volley a fast incoming pass
    for (const p of matchVolley.players) {
      if (p.team === 'B') {
        p.x = matchVolley.bounds.centerX - 80;
        p.y = matchVolley.bounds.bottom - 30;
      } else if (p.humanSlot === 1) {
        p.x = matchVolley.bounds.right - 52;
        p.y = matchVolley.bounds.centerY;
        p.facingX = 1;
        p.facingY = 0;
        p.kickSwingTimer = 0.16;
        p.kickSwingPower = 0.45;
        p.kickSwingDirX = 1;
        p.kickSwingDirY = 0;
      }
    }
    matchVolley.balls[0].x = matchVolley.bounds.right - 40;
    matchVolley.balls[0].y = matchVolley.bounds.centerY;
    matchVolley.balls[0].vx = -150;
    matchVolley.balls[0].vy = 0;
    matchVolley.balls[0].lastTouchPlayerId = 99;

    let volleyGoal: GameEvent | undefined;
    for (let i = 0; i < 20; i++) {
      const evs = matchVolley.update(FIXED_DT, empty);
      volleyGoal = evs.find((e) => e.type === 'goal');
      if (volleyGoal) break;
    }
    expect(volleyGoal).toBeDefined();
    expect(volleyGoal?.type === 'goal' && volleyGoal.highlightTag).toBe('ONE-TIMER!');
  });
});
