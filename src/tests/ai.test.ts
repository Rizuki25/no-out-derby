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
    shirtNumber: 10,
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
});
