import {
  AIDifficulty,
  AIState,
  ArenaBounds,
  Ball,
  Player,
  PlayerInput,
} from '../types.ts';

interface DifficultyProfile {
  reactionInterval: number;
  aimJitter: number;
  dashChance: number;
  chargeChance: number;
  useBankShots: boolean;
  predictionSeconds: number;
  speedScale: number;
}

const DIFFICULTY_PROFILES: Record<AIDifficulty, DifficultyProfile> = {
  rookie: {
    reactionInterval: 0.22,
    aimJitter: 0.26,
    dashChance: 0.08,
    chargeChance: 0.12,
    useBankShots: false,
    predictionSeconds: 0.08,
    speedScale: 0.82,
  },
  pro: {
    reactionInterval: 0.09,
    aimJitter: 0.09,
    dashChance: 0.42,
    chargeChance: 0.55,
    useBankShots: false,
    predictionSeconds: 0.22,
    speedScale: 0.96,
  },
  tarkam: {
    reactionInterval: 0.03,
    aimJitter: 0.025,
    dashChance: 0.78,
    chargeChance: 0.82,
    useBankShots: true,
    predictionSeconds: 0.36,
    speedScale: 1.0,
  },
};

export function createEmptyInput(): PlayerInput {
  return {
    moveX: 0,
    moveY: 0,
    kickHeld: false,
    kickJustReleased: false,
    dashJustPressed: false,
    switchJustPressed: false,
  };
}

export class AIController {
  computeInput(
    dt: number,
    player: Player,
    allPlayers: Player[],
    balls: Ball[],
    bounds: ArenaBounds,
    difficulty: AIDifficulty
  ): PlayerInput {
    const profile = DIFFICULTY_PROFILES[difficulty];
    if (balls.length === 0) return createEmptyInput();

    if (player.role === 'keeper') {
      return this.computeKeeperInput(player, balls, bounds, profile);
    }

    return this.computeOutfieldInput(dt, player, allPlayers, balls, bounds, profile);
  }

  private computeKeeperInput(
    keeper: Player,
    balls: Ball[],
    bounds: ArenaBounds,
    profile: DifficultyProfile
  ): PlayerInput {
    const input = createEmptyInput();
    const isTeamA = keeper.team === 'A';
    const homeX = isTeamA ? bounds.left + 9.5 : bounds.right - 9.5;

    // Pick the ball threatening our goal most
    let targetBall = balls[0];
    let bestScore = Infinity;
    for (const b of balls) {
      const dist = Math.hypot(b.x - homeX, b.y - keeper.y);
      const movingTowardUs = isTeamA ? b.vx < -20 : b.vx > 20;
      const threat = dist - (movingTowardUs ? 60 : 0);
      if (threat < bestScore) {
        bestScore = threat;
        targetBall = b;
      }
    }

    // Predict where ball crosses keeper X
    let aimY = targetBall.y;
    const vxTowardGoal = isTeamA ? -targetBall.vx : targetBall.vx;
    if (vxTowardGoal > 25) {
      const timeToLine = Math.abs(targetBall.x - homeX) / vxTowardGoal;
      const clampedT = Math.min(profile.predictionSeconds * 1.4, timeToLine);
      aimY = targetBall.y + targetBall.vy * clampedT;
      // Reflect predicted Y off top/bottom walls if needed
      if (aimY < bounds.top + 8) aimY = bounds.top + 8 + (bounds.top + 8 - aimY);
      if (aimY > bounds.bottom - 8) aimY = bounds.bottom - 8 - (aimY - (bounds.bottom - 8));
    }

    const minGoalY = bounds.goalTopY + keeper.radius * 0.7;
    const maxGoalY = bounds.goalBottomY - keeper.radius * 0.7;
    const clampedY = Math.max(minGoalY, Math.min(maxGoalY, aimY));

    // Step slightly forward if ball is close to cut down angle
    const distToGoal = Math.abs(targetBall.x - homeX);
    const stepOut = distToGoal < 65 ? (isTeamA ? 4.5 : -4.5) : 0;
    const targetX = homeX + stepOut;

    const dx = targetX - keeper.x;
    const dy = clampedY - keeper.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 1.5) {
      input.moveX = (dx / dist) * profile.speedScale;
      input.moveY = (dy / dist) * profile.speedScale;
    }

    return input;
  }

  private computeOutfieldInput(
    dt: number,
    player: Player,
    allPlayers: Player[],
    balls: Ball[],
    bounds: ArenaBounds,
    profile: DifficultyProfile
  ): PlayerInput {
    const input = createEmptyInput();
    const isTeamA = player.team === 'A';
    const attackDir = isTeamA ? 1 : -1;
    const ownGoalX = isTeamA ? bounds.left : bounds.right;
    const oppGoalX = isTeamA ? bounds.right : bounds.left;
    const goalCenterY = bounds.centerY;

    // Pick closest ball
    let ball = balls[0];
    let bestBallDist = Infinity;
    for (const b of balls) {
      const d = Math.hypot(b.x - player.x, b.y - player.y);
      if (d < bestBallDist) {
        bestBallDist = d;
        ball = b;
      }
    }

    // Predict ball future position
    const predX = Math.max(
      bounds.left + 10,
      Math.min(bounds.right - 10, ball.x + ball.vx * profile.predictionSeconds)
    );
    const predY = Math.max(
      bounds.top + 10,
      Math.min(bounds.bottom - 10, ball.y + ball.vy * profile.predictionSeconds)
    );

    // Multi-outfield role check: am I the primary chaser on my team?
    const teammates = allPlayers.filter(
      (p) => p.team === player.team && p.role === 'outfield' && p.id !== player.id
    );
    const isCarrier = ball.carrierId === player.id;
    let isPrimaryChaser = true;
    if (!isCarrier) {
      for (const mate of teammates) {
        if (ball.carrierId === mate.id) {
          isPrimaryChaser = false;
          break;
        }
        const mateDist = Math.hypot(mate.x - ball.x, mate.y - ball.y);
        // Human teammate or closer teammate takes priority unless we're noticeably closer
        const bias = mate.humanSlot !== null ? -18 : -4;
        if (mateDist + bias < bestBallDist) {
          isPrimaryChaser = false;
          break;
        }
      }
    }

    // Update strategic state periodically based on reactionInterval
    player.aiDecisionTimer -= dt;
    if (player.aiDecisionTimer <= 0) {
      player.aiDecisionTimer = profile.reactionInterval;
      this.chooseAIState(
        player,
        allPlayers,
        ball,
        predX,
        predY,
        isPrimaryChaser,
        ownGoalX,
        oppGoalX,
        goalCenterY,
        attackDir,
        bounds,
        profile
      );
    }

    // Handle active charging / kick release
    const distToBallNow = Math.hypot(ball.x - player.x, ball.y - player.y);
    const kickTriggerDist = player.radius + ball.radius + 7;

    if (player.isCharging) {
      // Aim toward target shot point while charging
      const aimVec = this.computeShotVector(
        player,
        ball,
        allPlayers,
        oppGoalX,
        goalCenterY,
        bounds,
        profile
      );
      input.moveX = aimVec.x * 0.8;
      input.moveY = aimVec.y * 0.8;

      if (player.chargeTime >= player.aiChargeTarget || (!isCarrier && distToBallNow > kickTriggerDist + 14)) {
        input.kickHeld = false;
        input.kickJustReleased = true;
        player.aiWantCharge = false;
      } else {
        input.kickHeld = true;
      }
      return input;
    }

    // Move toward current AI target
    const dx = player.aiTargetX - player.x;
    const dy = player.aiTargetY - player.y;
    const distToTarget = Math.hypot(dx, dy);

    if (distToTarget > 3) {
      input.moveX = (dx / distToTarget) * profile.speedScale;
      input.moveY = (dy / distToTarget) * profile.speedScale;
    }

    const oppCarrier =
      ball.carrierId != null && !isCarrier
        ? allPlayers.find((o) => o.id === ball.carrierId && o.team !== player.team)
        : undefined;

    if (isCarrier) {
      // In Dribble Mode, carry the ball toward goal and shoot when in range or heavily pressured
      const distToOppGoal = Math.abs(oppGoalX - player.x);
      let closestOppDist = Infinity;
      for (const opp of allPlayers) {
        if (opp.team !== player.team && opp.role === 'outfield' && opp.stunTimer <= 0) {
          const d = Math.hypot(opp.x - player.x, opp.y - player.y);
          if (d < closestOppDist) closestOppDist = d;
        }
      }
      const inShotRange = distToOppGoal < 108;
      const pressuredAdvance = closestOppDist < 24 && distToOppGoal < 175;
      if (inShotRange || pressuredAdvance) {
        const aimVec = this.computeShotVector(
          player,
          ball,
          allPlayers,
          oppGoalX,
          goalCenterY,
          bounds,
          profile
        );
        input.moveX = aimVec.x;
        input.moveY = aimVec.y;
        if (player.aiWantCharge && player.aiChargeTarget > 0.16 && closestOppDist > 30) {
          input.kickHeld = true;
        } else {
          input.kickJustReleased = true;
        }
      }
    } else if (distToBallNow <= kickTriggerDist + 2) {
      // Classic bounce kick / loose-ball poke
      const ballInFrontOfGoalSide = isTeamA ? ball.x >= player.x - 4 : ball.x <= player.x + 4;
      if (ballInFrontOfGoalSide || player.aiState === 'DEFEND_GOAL') {
        const aimVec = this.computeShotVector(
          player,
          ball,
          allPlayers,
          oppGoalX,
          goalCenterY,
          bounds,
          profile
        );
        // Point facing directly toward shot vector for accurate kick
        input.moveX = aimVec.x;
        input.moveY = aimVec.y;

        if (player.aiWantCharge && player.aiChargeTarget > 0.16) {
          input.kickHeld = true;
        } else {
          // Instant tap kick
          input.kickJustReleased = true;
        }
      }
    }

    // Decide dash tackle / intercept (closer threshold when lunging at an active carrier)
    const distToCarrier = oppCarrier ? Math.hypot(oppCarrier.x - player.x, oppCarrier.y - player.y) : Infinity;
    const canTackleCarrier = oppCarrier != null && distToCarrier >= 10 && distToCarrier <= 46;
    if (player.aiWantDash && player.dashCooldown <= 0 && (canTackleCarrier || distToTarget > 20)) {
      input.dashJustPressed = true;
      player.aiWantDash = false;
    }

    return input;
  }

  private chooseAIState(
    player: Player,
    allPlayers: Player[],
    ball: Ball,
    predX: number,
    predY: number,
    isPrimaryChaser: boolean,
    ownGoalX: number,
    oppGoalX: number,
    goalCenterY: number,
    attackDir: number,
    bounds: ArenaBounds,
    profile: DifficultyProfile
  ): void {
    player.aiWantDash = false;

    if (player.stunTimer > 0) {
      player.aiState = 'RECOVER';
      player.aiTargetX = (ownGoalX + bounds.centerX) * 0.5;
      player.aiTargetY = goalCenterY;
      return;
    }

    // Dribble Mode: active carrier advances into shooting corridor
    if (ball.carrierId === player.id) {
      player.aiState = 'ALIGN_SHOT';
      const oppKeeper = allPlayers.find((p) => p.team !== player.team && p.role === 'keeper');
      let targetY = oppKeeper
        ? oppKeeper.y > goalCenterY
          ? bounds.goalTopY + 14
          : bounds.goalBottomY - 14
        : goalCenterY;

      let closestOppDist = Infinity;
      for (const opp of allPlayers) {
        if (opp.team !== player.team && opp.role === 'outfield' && opp.stunTimer <= 0) {
          const d = Math.hypot(opp.x - player.x, opp.y - player.y);
          if (d < closestOppDist) {
            closestOppDist = d;
            // Dodge slightly around oncoming tackler
            if (d < 46 && (opp.x - player.x) * attackDir > -4) {
              targetY = opp.y > player.y ? Math.max(bounds.top + 22, player.y - 36) : Math.min(bounds.bottom - 22, player.y + 36);
            }
          }
        }
      }

      player.aiTargetX = oppGoalX - attackDir * 52;
      player.aiTargetY = targetY;
      player.aiWantCharge = Math.random() < profile.chargeChance * 0.8;
      player.aiChargeTarget = player.aiWantCharge ? 0.22 + Math.random() * 0.25 : 0;

      if (closestOppDist < 34 && Math.abs(oppGoalX - player.x) > 105 && Math.random() < profile.dashChance * 0.45) {
        player.aiWantDash = true;
      }
      return;
    }

    // 2v2 / 3v3 Support / Rotation role when teammate is closer or carrying
    if (!isPrimaryChaser) {
      const ballThreateningUs =
        attackDir === 1 ? ball.x < bounds.centerX + 20 : ball.x > bounds.centerX - 20;
      if (ballThreateningUs) {
        player.aiState = 'DEFEND_GOAL';
        // Guard between ball and own goal
        player.aiTargetX = ownGoalX + attackDir * 52;
        player.aiTargetY = Math.max(
          bounds.goalTopY - 12,
          Math.min(bounds.goalBottomY + 12, (ball.y + goalCenterY) * 0.5)
        );
      } else {
        // Support open wing opposite to ball Y for pass / rebound
        player.aiState = 'ALIGN_SHOT';
        player.aiTargetX = bounds.centerX + attackDir * 56;
        player.aiTargetY = ball.y < goalCenterY ? goalCenterY + 48 : goalCenterY - 48;
      }
      return;
    }

    // In Dribble Mode, if an opponent carries the ball, press and dash-tackle directly
    const oppCarrier =
      ball.carrierId != null
        ? allPlayers.find((o) => o.id === ball.carrierId && o.team !== player.team)
        : undefined;
    if (oppCarrier) {
      const distToCarrier = Math.hypot(oppCarrier.x - player.x, oppCarrier.y - player.y);
      const behindCarrier =
        attackDir === 1 ? player.x > oppCarrier.x + 18 : player.x < oppCarrier.x - 18;
      player.aiState = behindCarrier ? 'RECOVER' : 'CHASE_BALL';
      // Aim slightly toward own-goal side of carrier to cut off dribble lane, or through carrier to tackle
      player.aiTargetX = Math.max(
        bounds.left + 14,
        Math.min(bounds.right - 14, oppCarrier.x - attackDir * (behindCarrier ? 18 : 0))
      );
      player.aiTargetY = oppCarrier.y + oppCarrier.facingY * 5;
      if (distToCarrier < 44 && Math.random() < Math.max(0.2, profile.dashChance * 0.85)) {
        player.aiWantDash = true;
      }
      return;
    }

    // Check if player is on the wrong side of the ball (ball is closer to own goal than player is)
    const wrongSide = attackDir === 1 ? player.x > ball.x + 12 : player.x < ball.x - 12;

    if (wrongSide) {
      player.aiState = 'RECOVER';
      // Loop around ball rather than running straight into it toward own goal!
      const loopOffsetY = player.y <= ball.y ? -26 : 26;
      let targetY = ball.y + loopOffsetY;
      if (targetY < bounds.top + 18) targetY = ball.y + 28;
      if (targetY > bounds.bottom - 18) targetY = ball.y - 28;
      player.aiTargetX = Math.max(bounds.left + 16, Math.min(bounds.right - 16, predX - attackDir * 24));
      player.aiTargetY = targetY;

      // Dash back defensively if ball is dangerously close to own goal
      const ballNearOwnGoal = Math.abs(ball.x - ownGoalX) < 120;
      if (ballNearOwnGoal && Math.random() < profile.dashChance * 0.55) {
        player.aiWantDash = true;
      }
      return;
    }

    // Ball is ahead of player -> align behind ball toward goal/bank-shot vector
    const distToBall = Math.hypot(ball.x - player.x, ball.y - player.y);
    if (distToBall < 48) {
      player.aiState = 'ALIGN_SHOT';
      const shotVec = this.computeShotVector(
        player,
        ball,
        allPlayers,
        oppGoalX,
        goalCenterY,
        bounds,
        profile
      );
      // Position slightly behind ball opposite to shot vector
      player.aiTargetX = predX - shotVec.x * 8;
      player.aiTargetY = predY - shotVec.y * 8;
      player.aiWantCharge = Math.random() < profile.chargeChance;
      player.aiChargeTarget = player.aiWantCharge ? 0.25 + Math.random() * 0.3 : 0;
    } else {
      player.aiState = 'CHASE_BALL';
      // Approach slightly from own-goal side of ball
      player.aiTargetX = Math.max(bounds.left + 14, Math.min(bounds.right - 14, predX - attackDir * 8));
      player.aiTargetY = predY;

      // Dash to beat opponent to loose ball or tackle carrier
      const oppNearBall = allPlayers.some(
        (o) =>
          o.team !== player.team &&
          o.role === 'outfield' &&
          Math.hypot(o.x - ball.x, o.y - ball.y) < 34
      );
      if (oppNearBall && distToBall < 85 && Math.random() < profile.dashChance * 0.5) {
        player.aiWantDash = true;
      }
    }
  }

  private computeShotVector(
    player: Player,
    ball: Ball,
    allPlayers: Player[],
    oppGoalX: number,
    goalCenterY: number,
    bounds: ArenaBounds,
    profile: DifficultyProfile
  ): { x: number; y: number } {
    // Check if an opponent keeper or defender blocks direct center line
    const defenders = allPlayers.filter((p) => p.team !== player.team);
    let targetY = goalCenterY;

    // Aim toward upper or lower corner of goal away from keeper
    const oppKeeper = defenders.find((d) => d.role === 'keeper');
    if (oppKeeper) {
      targetY = oppKeeper.y > goalCenterY ? bounds.goalTopY + 11 : bounds.goalBottomY - 11;
    }

    let aimX = oppGoalX;
    let aimY = targetY;

    // Tarkam Legend uses smart bank shots off top/bottom wall when direct lane is crowded
    if (profile.useBankShots) {
      const directBlocked = defenders.some((d) => {
        const betweenX =
          oppGoalX > ball.x ? d.x > ball.x && d.x < oppGoalX : d.x < ball.x && d.x > oppGoalX;
        return betweenX && Math.abs(d.y - (ball.y + targetY) * 0.5) < 18;
      });
      if (directBlocked) {
        // Reflect target goal across top or bottom wall for crisp bank shot!
        const useTopBank = ball.y < goalCenterY;
        aimY = useTopBank ? 2 * bounds.top - targetY : 2 * bounds.bottom - targetY;
      }
    }

    const dx = aimX - player.x;
    const dy = aimY - player.y;
    const baseAngle = Math.atan2(dy, dx);
    // Deterministic slight aim variance scaled by difficulty
    const jitterOffset = Math.sin(player.animTime * 7.3 + player.id) * profile.aimJitter;
    const angle = baseAngle + jitterOffset;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  }

  static getStateLabel(state: AIState): string {
    return state;
  }
}
