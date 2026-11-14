import { describe, expect, it } from 'vitest';
import { createArenaBounds } from '../engine/ArenaGeometry.ts';
import { AIController } from '../game/AIController.ts';
import { ARENA_CONSTANTS, Ball, FIXED_DT, Player } from '../types.ts';

function makeAIPlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 2,
    team: 'B',
    role: 'outfield',
    humanSlot: null,
    x: 320,
    y: ARENA_CONSTANTS.CENTER_Y,
    vx: 0,
    vy: 0,
    radius: ARENA_CONSTANTS.PLAYER_RADIUS,
    facingX: -1,
    facingY: 0,
    isCharging: false,
    chargeTime: 0,
    kickSwingTimer: 0,
    kickSwingPower: 0,
    kickSwingDirX: -1,
    kickSwingDirY: 0,
    dashTimer: 0,
    dashCooldown: 0,
    dashDirX: -1,
    dashDirY: 0,
    stunTimer: 0,
    kickContactCooldown: 0,
    animState: 'idle',
    animTime: 0,
    aiState: 'CHASE_BALL',
    aiDecisionTimer: 0,
    aiTargetX: 320,
    aiTargetY: ARENA_CONSTANTS.CENTER_Y,
    aiWantCharge: false,
    aiChargeTarget: 0,
    aiWantDash: false,
    ...overrides,
  };
}

function makeBall(x: number, y: number, vx = 0, vy = 0): Ball {
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
  };
}

describe('AIController', () => {
  it('transitions to RECOVER when on the wrong side of the ball and CHASE/ALIGN when behind ball', () => {
    const ai = new AIController();
    const bounds = createArenaBounds(1.0);

    // Team B attacks left. Ball is at x=360 (behind Team B AI at x=250) -> wrong side!
    const aiPlayer = makeAIPlayer({ x: 250, y: 146, aiDecisionTimer: 0 });
    const ballBehind = makeBall(360, 146);
    ai.computeInput(FIXED_DT, aiPlayer, [aiPlayer], [ballBehind], bounds, 'tarkam');
    expect(aiPlayer.aiState).toBe('RECOVER');

    // Now place ball ahead of AI (at x=220) -> ALIGN_SHOT
    aiPlayer.aiDecisionTimer = 0;
    const ballAhead = makeBall(220, 146);
    ai.computeInput(FIXED_DT, aiPlayer, [aiPlayer], [ballAhead], bounds, 'tarkam');
    expect(aiPlayer.aiState).toBe('ALIGN_SHOT');
  });

  it('tracks ball inside goal mouth bounds for Mini Auto-Keeper', () => {
    const ai = new AIController();
    const bounds = createArenaBounds(1.0);
    const keeper = makeAIPlayer({
      id: 4,
      team: 'B',
      role: 'keeper',
      x: bounds.right - 9.5,
      y: bounds.centerY,
      radius: ARENA_CONSTANTS.KEEPER_RADIUS,
    });

    // Ball way up near top corner
    const highBall = makeBall(bounds.centerX, bounds.top + 8, 120, -40);
    const inp = ai.computeInput(FIXED_DT, keeper, [keeper], [highBall], bounds, 'pro');
    expect(inp.moveY).toBeLessThan(0);

    // Keeper already at top goal post boundary should not move above goalTopY
    keeper.y = bounds.goalTopY + keeper.radius * 0.7;
    const inpAtTop = ai.computeInput(FIXED_DT, keeper, [keeper], [highBall], bounds, 'pro');
    expect(inpAtTop.moveY).toBeGreaterThanOrEqual(-0.3);
  });

  it('has teammate bot assist defensively when opponent threatens and support/pass in attack', () => {
    const ai = new AIController();
    const bounds = createArenaBounds(1.0);

    // 1. Human carrier upfield on Team A -> bot teammate pushes forward into open opposite lane
    const humanA = makeAIPlayer({
      id: 1,
      team: 'A',
      humanSlot: 1,
      x: bounds.centerX + 35,
      y: bounds.centerY - 40,
      aiDecisionTimer: 0,
    });
    const botA = makeAIPlayer({
      id: 2,
      team: 'A',
      humanSlot: null,
      x: bounds.centerX - 40,
      y: bounds.centerY,
      aiDecisionTimer: 0,
    });
    const carryBall = makeBall(humanA.x + 10, humanA.y, 40, 0);
    carryBall.carrierId = humanA.id;

    ai.computeInput(FIXED_DT, botA, [humanA, botA], [carryBall], bounds, 'pro');
    expect(botA.aiState).toBe('ALIGN_SHOT');
    expect(botA.aiTargetX).toBeGreaterThan(bounds.centerX);
    expect(botA.aiTargetY).toBeGreaterThan(bounds.centerY);

    // 2. Opponent carrier in Team A half -> bot drops to DEFEND_GOAL between ball and own goal
    const oppB = makeAIPlayer({
      id: 3,
      team: 'B',
      humanSlot: null,
      x: bounds.centerX - 50,
      y: bounds.centerY - 15,
      aiDecisionTimer: 0,
    });
    const threatBall = makeBall(oppB.x - 10, oppB.y, -50, 0);
    threatBall.carrierId = oppB.id;
    humanA.x = bounds.centerX - 60;
    botA.x = bounds.left + 85;
    botA.aiDecisionTimer = 0;

    ai.computeInput(FIXED_DT, botA, [humanA, botA, oppB], [threatBall], bounds, 'pro');
    expect(botA.aiState).toBe('DEFEND_GOAL');
    expect(botA.aiTargetX).toBeLessThan(bounds.centerX);

    // 3. Bot steals/carries in midfield while human striker is open ahead -> passes forward
    const botCarrier = makeAIPlayer({
      id: 2,
      team: 'A',
      humanSlot: null,
      x: bounds.left + 80,
      y: bounds.centerY,
      aiDecisionTimer: 0,
    });
    const openHuman = makeAIPlayer({
      id: 1,
      team: 'A',
      humanSlot: 1,
      x: bounds.centerX + 45,
      y: bounds.centerY + 30,
      aiDecisionTimer: 0,
    });
    const botBall = makeBall(botCarrier.x + 12, botCarrier.y, 0, 0);
    botBall.carrierId = botCarrier.id;

    const passInput = ai.computeInput(
      FIXED_DT,
      botCarrier,
      [openHuman, botCarrier],
      [botBall],
      bounds,
      'pro'
    );
    expect(passInput.passJustPressed).toBe(true);
    expect(passInput.moveX).toBeGreaterThan(0.5);
  });
});
