import {
  ARENA_CONSTANTS,
  ArenaBounds,
  ArenaId,
  Ball,
  ControlStyle,
  GameEvent,
  PHYSICS_SUBSTEPS,
  PhysicsParams,
  Player,
  PlayerInput,
  Team,
  TeamModifiers,
} from '../types.ts';
import {
  clampInsideArena,
  closestPointOnSegment,
  getBallArenaSegments,
  getGoalPosts,
  getPlayerArenaSegments,
  WallSegment,
} from './ArenaGeometry.ts';
import { ARENA_PRESETS } from './ArenaPresets.ts';
import { createDefaultTeamModifiers } from '../game/DerbyCup.ts';

export function createDefaultPhysicsParams(arenaId: ArenaId = 'classic'): PhysicsParams {
  const preset = ARENA_PRESETS[arenaId];
  return {
    ballFriction: 0.986,
    wallRestitution: preset.wallRestitution,
    arenaBaseRestitution: preset.wallRestitution,
    maxBallSpeed: 500,
    ballRadius: ARENA_CONSTANTS.BASE_BALL_RADIUS,
    ballMass: 1.0,
    playerAccel: 1080,
    playerFriction: 0.80,
    playerMaxSpeed: 118,
    goalWidthMultiplier: 1.0,
    hotPotatoActive: false,
    pinballActive: false,
    windX: 0,
    windY: 0,
    controlStyle: 'classic',
  };
}

export interface PhysicsStepResult {
  scoredBy: Team | null;
  scoredBallPos: { x: number; y: number } | null;
  events: GameEvent[];
}

const DEFAULT_TEAM_MODS: { A: TeamModifiers; B: TeamModifiers } = {
  A: createDefaultTeamModifiers(),
  B: createDefaultTeamModifiers(),
};

export class PhysicsEngine {
  /**
   * Advances simulation by fixed dt (1/60s) using sub-stepping for tunneling-free bounces.
   * When allowScoring is false (e.g. during goal slow-motion celebration), balls still settle inside the net.
   */
  step(
    dt: number,
    balls: Ball[],
    players: Player[],
    inputs: Map<number, PlayerInput>,
    bounds: ArenaBounds,
    params: PhysicsParams,
    allowScoring: boolean,
    teamModifiers: { A: TeamModifiers; B: TeamModifiers } = DEFAULT_TEAM_MODS
  ): PhysicsStepResult {
    const events: GameEvent[] = [];
    let scoredBy: Team | null = null;
    let scoredBallPos: { x: number; y: number } | null = null;

    const playerById = new Map<number, Player>();
    for (const p of players) {
      playerById.set(p.id, p);
    }

    // 1. Process high-level player timers & input state once per frame
    if (allowScoring) {
      this.processPlayerInputs(dt, players, inputs, teamModifiers, events);
    } else {
      // During goal celebration slow-mo, bleed off player momentum smoothly
      for (const p of players) {
        p.vx *= 0.85;
        p.vy *= 0.85;
        p.isCharging = false;
        p.chargeTime = 0;
        p.animTime += dt;
      }
    }

    const controlStyle: ControlStyle = params.controlStyle ?? 'classic';
    this.syncCarriedBallsState(balls, playerById, controlStyle, allowScoring);

    for (const ball of balls) {
      if (ball.oneTimerTimer && ball.oneTimerTimer > 0) {
        ball.oneTimerTimer = Math.max(0, ball.oneTimerTimer - dt);
      }
    }

    // 2. Update Hot Potato timers on balls
    if (allowScoring && params.hotPotatoActive) {
      for (const ball of balls) {
        if (ball.carrierId != null) {
          ball.untouchedTimer = 0;
          ball.hotPotatoBeepAccum = 0;
          continue;
        }
        ball.untouchedTimer += dt;
        if (ball.untouchedTimer >= 4.0 && ball.untouchedTimer < 6.0) {
          const urgency = (ball.untouchedTimer - 4.0) / 2.0; // 0..1
          const beepInterval = 0.36 - urgency * 0.24;
          ball.hotPotatoBeepAccum += dt;
          if (ball.hotPotatoBeepAccum >= beepInterval) {
            ball.hotPotatoBeepAccum = 0;
            events.push({ type: 'hot_potato_tick', x: ball.x, y: ball.y, urgency });
          }
        }
        if (ball.untouchedTimer >= 6.0) {
          this.triggerHotPotatoExplosion(ball, players, bounds, events);
        }
      }
    } else {
      for (const ball of balls) {
        ball.untouchedTimer = 0;
        ball.hotPotatoBeepAccum = 0;
      }
    }

    // 3. Run sub-stepped continuous collision & integration
    const subDt = dt / PHYSICS_SUBSTEPS;
    const ballSegments = getBallArenaSegments(bounds);
    const playerSegments = getPlayerArenaSegments(bounds);
    const posts = getGoalPosts(bounds);

    // Track per-frame events so substeps don't spam duplicate sound triggers
    const kickedBallsThisFrame = new Set<number>();
    const tackledPlayersThisFrame = new Set<number>();
    const savedBallsThisFrame = new Set<number>();

    for (let stepIdx = 0; stepIdx < PHYSICS_SUBSTEPS; stepIdx++) {
      // Integrate players
      if (allowScoring) {
        for (const p of players) {
          const input = inputs.get(p.id);
          const isCarryingBall = controlStyle === 'dribble' && balls.some((b) => b.carrierId === p.id);
          this.integratePlayer(subDt, p, input, params, teamModifiers[p.team], isCarryingBall);
        }
      }

      // Player vs Player & Dash Tackle
      for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
          this.resolvePlayerVsPlayer(
            players[i],
            players[j],
            allowScoring,
            balls,
            tackledPlayersThisFrame,
            teamModifiers,
            controlStyle,
            events
          );
        }
      }

      // Player vs Walls & Posts
      for (const p of players) {
        this.resolveCircleVsSegments(p, p.radius, playerSegments, 0.25, false, false, events);
        for (const post of posts) {
          this.resolveCircleVsStaticCircle(p, p.radius, post.x, post.y, post.radius, 0.3, false, bounds, events);
        }
        clampInsideArena(p, p.radius, bounds, false);
      }

      // Integrate balls (or update carried ball position in dribble pocket)
      for (const ball of balls) {
        this.integrateBall(subDt, ball, params, playerById, controlStyle);
      }

      // Ball vs Ball (Multi-Ball, loose balls only)
      for (let i = 0; i < balls.length; i++) {
        for (let j = i + 1; j < balls.length; j++) {
          if (balls[i].carrierId == null && balls[j].carrierId == null) {
            this.resolveBallVsBall(balls[i], balls[j]);
          }
        }
      }

      // Ball vs Arena Walls & Goalposts
      for (const ball of balls) {
        const isCarried = ball.carrierId != null;
        const hitPinballWall = this.resolveCircleVsSegments(
          ball,
          ball.radius,
          ballSegments,
          isCarried ? 0.02 : params.wallRestitution,
          !isCarried,
          !isCarried && params.pinballActive,
          events
        );
        if (hitPinballWall) {
          const speed = Math.hypot(ball.vx, ball.vy);
          const cap = (ball.oneTimerTimer ?? 0) > 0 ? Math.max(params.maxBallSpeed * 1.18, 540) : params.maxBallSpeed;
          if (speed > cap) {
            const scale = cap / speed;
            ball.vx *= scale;
            ball.vy *= scale;
          }
        }

        for (const post of posts) {
          this.resolveCircleVsStaticCircle(
            ball,
            ball.radius,
            post.x,
            post.y,
            post.radius,
            isCarried ? 0.05 : 0.94,
            !isCarried,
            bounds,
            events
          );
        }

        clampInsideArena(ball, ball.radius, bounds, true);
      }

      // Player vs Ball (dribble pickup/release, kick, tackle steal, keeper clear)
      if (allowScoring) {
        for (const p of players) {
          const input = inputs.get(p.id);
          for (const ball of balls) {
            this.resolvePlayerVsBall(
              p,
              ball,
              balls,
              playerById,
              input,
              params,
              bounds,
              teamModifiers,
              kickedBallsThisFrame,
              tackledPlayersThisFrame,
              savedBallsThisFrame,
              events
            );
          }
        }
      } else {
        // Gentle settling inside net during goal slow-mo
        for (const ball of balls) {
          ball.vx *= 0.96;
          ball.vy *= 0.96;
        }
      }

      // Final speed clamp & goal detection
      for (const ball of balls) {
        const spd = Math.hypot(ball.vx, ball.vy);
        const cap = (ball.oneTimerTimer ?? 0) > 0 ? Math.max(params.maxBallSpeed * 1.18, 540) : params.maxBallSpeed;
        if (spd > cap) {
          const s = cap / spd;
          ball.vx *= s;
          ball.vy *= s;
        }

        if (allowScoring && scoredBy === null) {
          const inMouthY = ball.y > bounds.goalTopY + 1 && ball.y < bounds.goalBottomY - 1;
          if (inMouthY) {
            if (ball.x + ball.radius * 0.15 < bounds.left) {
              scoredBy = 'B';
              scoredBallPos = { x: ball.x, y: ball.y };
            } else if (ball.x - ball.radius * 0.15 > bounds.right) {
              scoredBy = 'A';
              scoredBallPos = { x: ball.x, y: ball.y };
            }
          }
        }
      }
    }

    return { scoredBy, scoredBallPos, events };
  }

  private syncCarriedBallsState(
    balls: Ball[],
    playerById: Map<number, Player>,
    controlStyle: ControlStyle,
    allowScoring: boolean
  ): void {
    const claimedCarriers = new Set<number>();
    for (const ball of balls) {
      if (controlStyle !== 'dribble' || !allowScoring || ball.carrierId == null) {
        ball.carrierId = null;
        continue;
      }
      const carrier = playerById.get(ball.carrierId);
      if (!carrier || carrier.role !== 'outfield' || carrier.stunTimer > 0 || claimedCarriers.has(carrier.id)) {
        ball.carrierId = null;
        continue;
      }
      claimedCarriers.add(carrier.id);
    }
  }

  private processPlayerInputs(
    dt: number,
    players: Player[],
    inputs: Map<number, PlayerInput>,
    teamModifiers: { A: TeamModifiers; B: TeamModifiers },
    events: GameEvent[]
  ): void {
    for (const p of players) {
      const mods = teamModifiers[p.team];
      p.animTime += dt;
      if (p.dashCooldown > 0) p.dashCooldown = Math.max(0, p.dashCooldown - dt);
      if (p.kickContactCooldown > 0) p.kickContactCooldown = Math.max(0, p.kickContactCooldown - dt);
      if (p.kickSwingTimer > 0) p.kickSwingTimer = Math.max(0, p.kickSwingTimer - dt);
      if (p.pickupCooldown && p.pickupCooldown > 0) p.pickupCooldown = Math.max(0, p.pickupCooldown - dt);

      if (p.stunTimer > 0) {
        p.stunTimer = Math.max(0, p.stunTimer - dt);
        p.isCharging = false;
        p.chargeTime = 0;
        p.dashTimer = 0;
        p.animState = 'stun';
        continue;
      }

      if (p.dashTimer > 0) {
        p.dashTimer = Math.max(0, p.dashTimer - dt);
        p.animState = 'dash';
        continue;
      }

      const input = inputs.get(p.id);
      if (!input) {
        p.isCharging = false;
        p.chargeTime = 0;
        p.animState = Math.hypot(p.vx, p.vy) > 15 ? 'run' : 'idle';
        continue;
      }

      // Update facing from movement input
      const moveLen = Math.hypot(input.moveX, input.moveY);
      if (moveLen > 0.1) {
        p.facingX = input.moveX / moveLen;
        p.facingY = input.moveY / moveLen;
      }

      // Dash trigger (only for outfield players)
      if (p.role === 'outfield' && input.dashJustPressed && p.dashCooldown <= 0) {
        p.isCharging = false;
        p.chargeTime = 0;
        p.kickSwingTimer = 0;
        p.dashTimer = ARENA_CONSTANTS.DASH_DURATION;
        p.dashCooldown = ARENA_CONSTANTS.DASH_COOLDOWN * mods.dashCooldownMult;
        p.dashDirX = p.facingX;
        p.dashDirY = p.facingY;
        p.vx = p.dashDirX * ARENA_CONSTANTS.DASH_SPEED;
        p.vy = p.dashDirY * ARENA_CONSTANTS.DASH_SPEED;
        p.animState = 'dash';
        p.animTime = 0;
        events.push({ type: 'dash', x: p.x, y: p.y, team: p.team });
        continue;
      }

      // Kick / Charge handling (for outfield players)
      if (p.role === 'outfield') {
        if (input.kickHeld) {
          p.isCharging = true;
          p.chargeTime = Math.min(ARENA_CONSTANTS.MAX_CHARGE_TIME, p.chargeTime + dt);
        }
        if (input.kickJustReleased) {
          const chargeRatio = Math.min(1, p.chargeTime / ARENA_CONSTANTS.MAX_CHARGE_TIME);
          p.isCharging = false;
          p.chargeTime = 0;
          p.kickSwingTimer = 0.13;
          p.kickSwingPower = chargeRatio;
          p.kickSwingDirX = p.facingX;
          p.kickSwingDirY = p.facingY;
          p.animState = 'kick';
          p.animTime = 0;
        } else if (!input.kickHeld && p.isCharging) {
          p.isCharging = false;
          p.chargeTime = 0;
        }
      }

      // Animation state
      if (p.kickSwingTimer > 0) {
        p.animState = 'kick';
      } else if (p.isCharging) {
        p.animState = 'kick';
      } else if (Math.hypot(p.vx, p.vy) > 16) {
        p.animState = 'run';
      } else {
        p.animState = 'idle';
      }
    }
  }

  private integratePlayer(
    subDt: number,
    p: Player,
    input: PlayerInput | undefined,
    params: PhysicsParams,
    mods: TeamModifiers,
    isCarryingBall: boolean
  ): void {
    if (p.stunTimer > 0) {
      const damping = Math.pow(0.86, subDt * 60);
      p.vx *= damping;
      p.vy *= damping;
      p.x += p.vx * subDt;
      p.y += p.vy * subDt;
      return;
    }

    if (p.dashTimer > 0) {
      const dashSpeed = ARENA_CONSTANTS.DASH_SPEED * (0.5 + 0.5 * mods.moveSpeedMult);
      p.vx = p.dashDirX * dashSpeed;
      p.vy = p.dashDirY * dashSpeed;
      p.x += p.vx * subDt;
      p.y += p.vy * subDt;
      return;
    }

    const mx = input ? input.moveX : 0;
    const my = input ? input.moveY : 0;
    const mag = Math.hypot(mx, my);

    // 40% movement penalty while charging Power Shot (PRD §3.3); slight carry drag while dribbling
    const speedScale = p.isCharging ? 0.6 : 1.0;
    const roleScale = p.role === 'keeper' ? 0.78 : 1.0;
    const perkScale = p.role === 'outfield' ? mods.moveSpeedMult : 1.0;
    const carryScale = isCarryingBall ? 0.94 : 1.0;
    const maxSpeed = params.playerMaxSpeed * speedScale * roleScale * perkScale * carryScale;

    if (mag > 0.05) {
      const nx = mx / mag;
      const ny = my / mag;
      // Slightly less snappy acceleration on slippery ice pitch
      const accelFactor = params.playerFriction > 0.9 ? 0.55 : 1.0;
      const curSpeed = Math.hypot(p.vx, p.vy);
      if (curSpeed <= maxSpeed) {
        p.vx += nx * params.playerAccel * accelFactor * subDt;
        p.vy += ny * params.playerAccel * accelFactor * subDt;
        const nextSpeed = Math.hypot(p.vx, p.vy);
        if (nextSpeed > maxSpeed) {
          p.vx = (p.vx / nextSpeed) * maxSpeed;
          p.vy = (p.vy / nextSpeed) * maxSpeed;
        }
      } else {
        // Smoothly bleed excess speed (e.g. starting a charge while sprinting or knockback recovery)
        const targetVx = nx * maxSpeed;
        const targetVy = ny * maxSpeed;
        const blend = Math.min(1, 16 * subDt);
        p.vx += (targetVx - p.vx) * blend;
        p.vy += (targetVy - p.vy) * blend;
      }
    } else {
      const friction = Math.pow(params.playerFriction, subDt * 60);
      p.vx *= friction;
      p.vy *= friction;
      if (Math.hypot(p.vx, p.vy) < 1.5) {
        p.vx = 0;
        p.vy = 0;
      }
    }

    p.x += p.vx * subDt;
    p.y += p.vy * subDt;
  }

  private integrateBall(
    subDt: number,
    ball: Ball,
    params: PhysicsParams,
    playerById: Map<number, Player>,
    controlStyle: ControlStyle
  ): void {
    if (controlStyle === 'dribble' && ball.carrierId != null) {
      const carrier = playerById.get(ball.carrierId);
      if (carrier) {
        const carryDist = carrier.radius + ball.radius + 1.5;
        const targetX = carrier.x + carrier.facingX * carryDist;
        const targetY = carrier.y + carrier.facingY * carryDist;
        const blend = Math.min(1, 72 * subDt);
        ball.x += (targetX - ball.x) * blend;
        ball.y += (targetY - ball.y) * blend;
        ball.vx = carrier.vx;
        ball.vy = carrier.vy;
        ball.spin = 0;
        ball.z = Math.max(0, ball.z - 120 * subDt);
        ball.vz = 0;
        ball.rollAngle += Math.hypot(carrier.vx, carrier.vy) * subDt * 0.14;
        return;
      }
      ball.carrierId = null;
    }

    // Subtle lateral Magnus curve from spin
    const speed = Math.hypot(ball.vx, ball.vy);
    if (Math.abs(ball.spin) > 0.001 && speed > 25) {
      const perpX = -ball.vy / speed;
      const perpY = ball.vx / speed;
      const curveAccel = ball.spin * speed * 1.45;
      ball.vx += perpX * curveAccel * subDt;
      ball.vy += perpY * curveAccel * subDt;
      ball.spin *= Math.pow(0.975, subDt * 60);
    } else {
      ball.spin *= Math.pow(0.92, subDt * 60);
    }

    // Gentle rooftop side wind force (only affects moving or airborne ball, or light drift)
    if (Math.abs(params.windX) > 0.1 || Math.abs(params.windY) > 0.1) {
      ball.vx += params.windX * subDt;
      ball.vy += params.windY * subDt;
    }

    const damping = Math.pow(params.ballFriction, subDt * 60);
    ball.vx *= damping;
    ball.vy *= damping;

    if (Math.hypot(ball.vx, ball.vy) < 2.2 && Math.hypot(params.windX, params.windY) < 1) {
      ball.vx = 0;
      ball.vy = 0;
      ball.spin = 0;
    }

    ball.x += ball.vx * subDt;
    ball.y += ball.vy * subDt;
    ball.rollAngle += Math.hypot(ball.vx, ball.vy) * subDt * 0.14;

    // Visual vertical Z bounce arc
    if (ball.z > 0 || Math.abs(ball.vz) > 0.5) {
      ball.vz -= 340 * subDt;
      ball.z += ball.vz * subDt;
      if (ball.z <= 0) {
        ball.z = 0;
        if (Math.abs(ball.vz) > 28) {
          ball.vz = -ball.vz * 0.45;
        } else {
          ball.vz = 0;
        }
      }
    }
  }

  private resolvePlayerVsPlayer(
    a: Player,
    b: Player,
    allowScoring: boolean,
    balls: Ball[],
    tackledThisFrame: Set<number>,
    teamModifiers: { A: TeamModifiers; B: TeamModifiers },
    controlStyle: ControlStyle,
    events: GameEvent[]
  ): void {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const minDist = a.radius + b.radius;
    const distSq = dx * dx + dy * dy;
    if (distSq >= minDist * minDist) return;

    const dist = Math.sqrt(distSq) || 0.001;
    const nx = dx / dist;
    const ny = dy / dist;
    const overlap = minDist - dist;

    // Positional separation
    a.x -= nx * overlap * 0.5;
    a.y -= ny * overlap * 0.5;
    b.x += nx * overlap * 0.5;
    b.y += ny * overlap * 0.5;

    // Velocity exchange along collision normal
    const rvx = b.vx - a.vx;
    const rvy = b.vy - a.vy;
    const velAlongNormal = rvx * nx + rvy * ny;
    if (velAlongNormal < 0) {
      const impulse = -0.85 * velAlongNormal;
      a.vx -= nx * impulse;
      a.vy -= ny * impulse;
      b.vx += nx * impulse;
      b.vy += ny * impulse;
    }

    if (!allowScoring || a.team === b.team) return;

    // Dash tackle stun + ball steal if opponents collide while one is dashing
    if (a.dashTimer > 0 && b.role === 'outfield' && b.stunTimer <= 0 && !tackledThisFrame.has(b.id)) {
      this.applyTackleSteal(a, b, allowScoring, balls, tackledThisFrame, teamModifiers, controlStyle, events);
    } else if (b.dashTimer > 0 && a.role === 'outfield' && a.stunTimer <= 0 && !tackledThisFrame.has(a.id)) {
      this.applyTackleSteal(b, a, allowScoring, balls, tackledThisFrame, teamModifiers, controlStyle, events);
    }
  }

  private applyTackleSteal(
    tackler: Player,
    victim: Player,
    allowScoring: boolean,
    balls: Ball[],
    tackledThisFrame: Set<number>,
    teamModifiers: { A: TeamModifiers; B: TeamModifiers },
    controlStyle: ControlStyle,
    events: GameEvent[]
  ): void {
    if (
      !allowScoring ||
      tackler.team === victim.team ||
      tackler.dashTimer <= 0 ||
      victim.role !== 'outfield' ||
      victim.stunTimer > 0 ||
      tackledThisFrame.has(victim.id)
    ) {
      return;
    }

    const dx = victim.x - tackler.x;
    const dy = victim.y - tackler.y;
    const dist = Math.hypot(dx, dy);
    const kx = dist > 0.001 ? dx / dist : tackler.dashDirX;
    const ky = dist > 0.001 ? dy / dist : tackler.dashDirY;

    const stoleBall = controlStyle === 'dribble' && balls.some((b) => b.carrierId === victim.id);

    victim.stunTimer = ARENA_CONSTANTS.STUN_DURATION * teamModifiers[victim.team].stunMult;
    victim.isCharging = false;
    victim.chargeTime = 0;
    victim.pickupCooldown = 0.6;
    victim.vx = kx * 165;
    victim.vy = ky * 165;
    tackledThisFrame.add(victim.id);
    events.push({
      type: 'tackle',
      x: (tackler.x + victim.x) * 0.5,
      y: (tackler.y + victim.y) * 0.5,
      team: tackler.team,
      stoleBall,
    });

    if (controlStyle !== 'dribble') return;

    let tacklerHasBall = balls.some((b) => b.carrierId === tackler.id);
    for (const ball of balls) {
      if (ball.carrierId !== victim.id) continue;
      ball.lastTouchTeam = tackler.team;
      ball.lastTouchPlayerId = tackler.id;
      ball.untouchedTimer = 0;
      ball.hotPotatoBeepAccum = 0;
      ball.oneTimerTimer = 0;
      ball.spin = 0;
      if (!tacklerHasBall) {
        ball.carrierId = tackler.id;
        tacklerHasBall = true;
        tackler.kickContactCooldown = 0.14;
      } else {
        ball.carrierId = null;
        ball.vx = tackler.dashDirX * 190;
        ball.vy = tackler.dashDirY * 190;
        ball.vz = 30;
      }
    }
  }

  private resolveBallVsBall(a: Ball, b: Ball): void {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const minDist = a.radius + b.radius;
    const distSq = dx * dx + dy * dy;
    if (distSq >= minDist * minDist) return;

    const dist = Math.sqrt(distSq) || 0.001;
    const nx = dx / dist;
    const ny = dy / dist;
    const overlap = minDist - dist;

    a.x -= nx * overlap * 0.5;
    a.y -= ny * overlap * 0.5;
    b.x += nx * overlap * 0.5;
    b.y += ny * overlap * 0.5;

    const rvx = b.vx - a.vx;
    const rvy = b.vy - a.vy;
    const relNormal = rvx * nx + rvy * ny;
    if (relNormal < 0) {
      const restitution = 0.92;
      const j = (-(1 + restitution) * relNormal) / (1 / a.mass + 1 / b.mass);
      a.vx -= (j / a.mass) * nx;
      a.vy -= (j / a.mass) * ny;
      b.vx += (j / b.mass) * nx;
      b.vy += (j / b.mass) * ny;
    }
  }

  private resolveCircleVsSegments(
    entity: { x: number; y: number; vx: number; vy: number },
    radius: number,
    segments: WallSegment[],
    restitution: number,
    isBall: boolean,
    pinballActive: boolean,
    events: GameEvent[]
  ): boolean {
    let bounced = false;
    for (const seg of segments) {
      const cp = closestPointOnSegment(entity.x, entity.y, seg.ax, seg.ay, seg.bx, seg.by);
      const dx = entity.x - cp.x;
      const dy = entity.y - cp.y;
      const distSq = dx * dx + dy * dy;
      if (distSq >= radius * radius) continue;

      const dist = Math.sqrt(distSq);
      let nx: number;
      let ny: number;
      if (dist > 1e-5) {
        nx = dx / dist;
        ny = dy / dist;
        // Make sure normal points into pitch if entity somehow grazed center line
        if (nx * seg.nx + ny * seg.ny < 0) {
          nx = seg.nx;
          ny = seg.ny;
        }
      } else {
        nx = seg.nx;
        ny = seg.ny;
      }

      const overlap = radius - dist;
      entity.x += nx * overlap;
      entity.y += ny * overlap;

      const vn = entity.vx * nx + entity.vy * ny;
      if (vn < 0) {
        // Inside goal net pocket, damp heavily so ball settles in the net
        const effectiveRestitution = isBall && seg.isNet ? 0.32 : restitution;
        entity.vx -= (1 + effectiveRestitution) * vn * nx;
        entity.vy -= (1 + effectiveRestitution) * vn * ny;

        if (isBall && !seg.isNet) {
          // Pinball mode gives an extra tangential + normal speed kick per bounce
          if (pinballActive) {
            const curSpeed = Math.hypot(entity.vx, entity.vy);
            const boost = Math.max(curSpeed * 1.07, curSpeed + 26);
            if (curSpeed > 1) {
              entity.vx = (entity.vx / curSpeed) * boost;
              entity.vy = (entity.vy / curSpeed) * boost;
            }
          }
          const bounceSpeed = Math.abs(vn);
          if (bounceSpeed > 26) {
            bounced = true;
            events.push({
              type: 'wall_bounce',
              x: cp.x,
              y: cp.y,
              speed: bounceSpeed,
              isPinball: pinballActive,
            });
          }
        }
      }
    }
    return bounced;
  }

  private resolveCircleVsStaticCircle(
    entity: { x: number; y: number; vx: number; vy: number },
    radius: number,
    cx: number,
    cy: number,
    cRadius: number,
    restitution: number,
    isBall: boolean,
    bounds: ArenaBounds,
    events: GameEvent[]
  ): void {
    const dx = entity.x - cx;
    const dy = entity.y - cy;
    const minDist = radius + cRadius;
    const distSq = dx * dx + dy * dy;
    if (distSq >= minDist * minDist) return;

    const dist = Math.sqrt(distSq);
    let nx: number;
    let ny: number;
    if (dist > 1e-4) {
      nx = dx / dist;
      ny = dy / dist;
    } else {
      // Fallback push toward pitch center
      nx = cx < bounds.centerX ? 1 : -1;
      ny = 0;
    }

    const overlap = minDist - dist;
    entity.x += nx * overlap;
    entity.y += ny * overlap;

    const vn = entity.vx * nx + entity.vy * ny;
    if (vn < 0) {
      entity.vx -= (1 + restitution) * vn * nx;
      entity.vy -= (1 + restitution) * vn * ny;
      if (isBall && Math.abs(vn) > 28) {
        events.push({ type: 'post_clang', x: cx, y: cy, speed: Math.abs(vn) });
      }
    }
  }

  private resolvePlayerVsBall(
    p: Player,
    ball: Ball,
    balls: Ball[],
    playerById: Map<number, Player>,
    input: PlayerInput | undefined,
    params: PhysicsParams,
    bounds: ArenaBounds,
    teamModifiers: { A: TeamModifiers; B: TeamModifiers },
    kickedThisFrame: Set<number>,
    tackledThisFrame: Set<number>,
    savedThisFrame: Set<number>,
    events: GameEvent[]
  ): void {
    const dx = ball.x - p.x;
    const dy = ball.y - p.y;
    const dist = Math.hypot(dx, dy) || 0.001;
    const nx = dx / dist;
    const ny = dy / dist;
    const minDist = p.radius + ball.radius;
    const mods = teamModifiers[p.team];
    const controlStyle: ControlStyle = params.controlStyle ?? 'classic';
    const kickReach = minDist + 7.5 + mods.kickReachBonus;

    // 0. Handling an actively carried ball in Dribble Mode
    if (ball.carrierId != null) {
      if (ball.carrierId === p.id) {
        if (
          p.role === 'outfield' &&
          p.kickSwingTimer > 0 &&
          p.kickContactCooldown <= 0 &&
          !kickedThisFrame.has(ball.id)
        ) {
          ball.carrierId = null;
          p.pickupCooldown = 0.24;
          this.executePlayerKick(p, ball, nx, ny, mods, kickedThisFrame, events, false);
        }
        return;
      }

      const carrier = playerById.get(ball.carrierId);
      if (!carrier || carrier.team === p.team) return;

      // Keeper dispossesses opponent trying to walk the ball through goalmouth
      if (p.role === 'keeper' && dist < minDist) {
        ball.carrierId = null;
        carrier.pickupCooldown = Math.max(carrier.pickupCooldown ?? 0, 0.4);
        this.separateOverlap(p, ball, nx, ny, minDist - dist);
        this.executeKeeperClear(p, ball, bounds, kickedThisFrame, savedThisFrame, events, true);
        return;
      }

      // Outfielder Dash-Tackle Steal triggered cleanly even when clipping ball first
      if (p.role === 'outfield' && p.dashTimer > 0 && dist < minDist + 4.0) {
        this.applyTackleSteal(
          p,
          carrier,
          true,
          balls,
          tackledThisFrame,
          teamModifiers,
          controlStyle,
          events
        );
        return;
      }

      // Outfielder Kick-Poke can knock a carried ball loose if within swing reach
      if (
        p.role === 'outfield' &&
        p.kickSwingTimer > 0 &&
        p.kickContactCooldown <= 0 &&
        !kickedThisFrame.has(ball.id) &&
        dist <= kickReach
      ) {
        const dirDot = nx * p.kickSwingDirX + ny * p.kickSwingDirY;
        if (dirDot > -0.25 || dist < minDist + 1.5) {
          ball.carrierId = null;
          carrier.pickupCooldown = Math.max(carrier.pickupCooldown ?? 0, 0.35);
          this.executePlayerKick(p, ball, nx, ny, mods, kickedThisFrame, events, false);
        }
      }
      return;
    }

    // 1. Active Kick Swing on loose ball (supports One-Timer Volley!)
    if (
      p.role === 'outfield' &&
      p.kickSwingTimer > 0 &&
      p.kickContactCooldown <= 0 &&
      !kickedThisFrame.has(ball.id) &&
      dist <= kickReach
    ) {
      const dirDot = nx * p.kickSwingDirX + ny * p.kickSwingDirY;
      if (dirDot > -0.25 || dist < minDist + 1.5) {
        this.executePlayerKick(p, ball, nx, ny, mods, kickedThisFrame, events, true);
        return;
      }
    }

    // 2. Keeper overlap deflection
    if (p.role === 'keeper') {
      if (dist >= minDist) return;
      this.separateOverlap(p, ball, nx, ny, minDist - dist);
      this.executeKeeperClear(p, ball, bounds, kickedThisFrame, savedThisFrame, events, false);
      return;
    }

    // 3. Dribble Mode trap / dash-snatch on loose ball
    if (
      controlStyle === 'dribble' &&
      p.stunTimer <= 0 &&
      (p.pickupCooldown ?? 0) <= 0 &&
      p.kickSwingTimer <= 0 &&
      !balls.some((b) => b.carrierId === p.id)
    ) {
      const trapDist = minDist + (p.dashTimer > 0 ? 3.5 : 1.5);
      if (dist < trapDist) {
        const prevVx = ball.vx;
        const prevVy = ball.vy;
        const prevTeam = ball.lastTouchTeam;
        const ballSpeed = Math.hypot(prevVx, prevVy);
        if (ballSpeed <= 285 || p.dashTimer > 0 || prevTeam === p.team) {
          this.maybeEmitDefensiveSave(p, ball, prevVx, prevVy, prevTeam, bounds, savedThisFrame, events);
          ball.carrierId = p.id;
          ball.vx = p.vx;
          ball.vy = p.vy;
          ball.vz = 0;
          ball.spin = 0;
          ball.oneTimerTimer = 0;
          ball.lastTouchTeam = p.team;
          ball.lastTouchPlayerId = p.id;
          ball.untouchedTimer = 0;
          ball.hotPotatoBeepAccum = 0;
          return;
        }
        if (dist < minDist) {
          this.maybeEmitDefensiveSave(p, ball, prevVx, prevVy, prevTeam, bounds, savedThisFrame, events);
          this.separateOverlap(p, ball, nx, ny, minDist - dist);
          ball.vx *= 0.42;
          ball.vy *= 0.42;
          ball.spin = 0;
          ball.oneTimerTimer = 0;
          ball.lastTouchTeam = p.team;
          ball.lastTouchPlayerId = p.id;
          ball.untouchedTimer = 0;
          ball.hotPotatoBeepAccum = 0;
          p.pickupCooldown = 0.08;
        }
        return;
      }
    }

    // 4. Classic physical overlap collision (Dribble / Dash Poke)
    if (dist >= minDist) return;

    const prevVx = ball.vx;
    const prevVy = ball.vy;
    const prevTeam = ball.lastTouchTeam;
    this.maybeEmitDefensiveSave(p, ball, prevVx, prevVy, prevTeam, bounds, savedThisFrame, events);

    this.separateOverlap(p, ball, nx, ny, minDist - dist);

    // Dashing into ball delivers a sharp sliding clear/poke
    if (p.dashTimer > 0 && p.kickContactCooldown <= 0 && !kickedThisFrame.has(ball.id)) {
      const pokeSpeed = 232 / Math.sqrt(ball.mass);
      ball.vx = nx * pokeSpeed * 0.55 + p.dashDirX * pokeSpeed * 0.55;
      ball.vy = ny * pokeSpeed * 0.55 + p.dashDirY * pokeSpeed * 0.55;
      ball.vz = 40;
      ball.spin = 0;
      ball.oneTimerTimer = 0;
      p.kickContactCooldown = 0.16;
      kickedThisFrame.add(ball.id);
      events.push({
        type: 'kick',
        x: ball.x,
        y: ball.y,
        power: 0.45,
        curved: false,
        playerId: p.id,
        team: p.team,
      });
      return;
    }

    // Soft arcade dribble vs fast shot rebound
    const rvx = ball.vx - p.vx;
    const rvy = ball.vy - p.vy;
    const relNormal = rvx * nx + rvy * ny;
    if (relNormal < 0) {
      const isMovingIntoBall = input ? input.moveX * nx + input.moveY * ny > 0.2 : false;
      const restitution = isMovingIntoBall ? 0.25 : 0.55;
      const impulse = (-(1 + restitution) * relNormal) / (1 / 1.4 + 1 / ball.mass);
      ball.vx += (impulse / ball.mass) * nx;
      ball.vy += (impulse / ball.mass) * ny;

      // Gentle dribble forward cushion so running with the ball feels controlled
      if (isMovingIntoBall && Math.hypot(p.vx, p.vy) > 25) {
        const targetSpeed = Math.hypot(p.vx, p.vy) * 1.15;
        const curBallSpeed = Math.hypot(ball.vx, ball.vy);
        if (curBallSpeed < targetSpeed) {
          ball.vx = nx * targetSpeed * 0.65 + p.vx * 0.45;
          ball.vy = ny * targetSpeed * 0.65 + p.vy * 0.45;
        }
      }

      if (ball.mass > 1.5) {
        p.vx -= (impulse / 1.4) * nx * 0.5;
        p.vy -= (impulse / 1.4) * ny * 0.5;
      }
    }
  }

  private maybeEmitDefensiveSave(
    p: Player,
    ball: Ball,
    prevVx: number,
    prevVy: number,
    prevTeam: Team | null,
    bounds: ArenaBounds,
    savedThisFrame: Set<number>,
    events: GameEvent[]
  ): void {
    if (
      p.role !== 'outfield' ||
      p.kickContactCooldown > 0 ||
      savedThisFrame.has(ball.id) ||
      prevTeam == null ||
      prevTeam === p.team
    ) {
      return;
    }
    const speed = Math.hypot(prevVx, prevVy);
    const headingTowardOwnGoal = p.team === 'A' ? prevVx < -80 : prevVx > 80;
    const ownGoalX = p.team === 'A' ? bounds.left : bounds.right;
    const inGoalBox =
      Math.abs(ball.x - ownGoalX) <= 64 &&
      Math.abs(ball.y - bounds.centerY) <= (bounds.goalBottomY - bounds.goalTopY) * 0.78;
    if (speed >= 150 && headingTowardOwnGoal && inGoalBox) {
      savedThisFrame.add(ball.id);
      events.push({ type: 'save', x: ball.x, y: ball.y, team: p.team, speed });
    }
  }

  private separateOverlap(p: Player, ball: Ball, nx: number, ny: number, overlap: number): void {
    const playerShare = ball.mass > 1.5 ? 0.45 : 0.15;
    const ballShare = 1 - playerShare;
    p.x -= nx * overlap * playerShare;
    p.y -= ny * overlap * playerShare;
    ball.x += nx * overlap * ballShare;
    ball.y += ny * overlap * ballShare;

    ball.lastTouchTeam = p.team;
    ball.lastTouchPlayerId = p.id;
    ball.untouchedTimer = 0;
    ball.hotPotatoBeepAccum = 0;
  }

  private executePlayerKick(
    p: Player,
    ball: Ball,
    nx: number,
    ny: number,
    mods: TeamModifiers,
    kickedThisFrame: Set<number>,
    events: GameEvent[],
    allowOneTimer: boolean
  ): void {
    const dirDot = nx * p.kickSwingDirX + ny * p.kickSwingDirY;
    const power = p.kickSwingPower;
    let kx = p.kickSwingDirX;
    let ky = p.kickSwingDirY;
    if (dirDot > 0.1) {
      kx = p.kickSwingDirX * 0.78 + nx * 0.22;
      ky = p.kickSwingDirY * 0.78 + ny * 0.22;
    }
    const kLen = Math.hypot(kx, ky) || 1;
    kx /= kLen;
    ky /= kLen;

    const prevVx = ball.vx;
    const prevVy = ball.vy;
    const incomingSpeed = Math.hypot(prevVx, prevVy);
    const prevDot = prevVx * kx + prevVy * ky;
    const isOneTimer =
      allowOneTimer &&
      ((ball.lastTouchPlayerId !== p.id && incomingSpeed >= 115) ||
        (ball.lastTouchPlayerId === p.id && incomingSpeed >= 125 && prevDot < 25));

    const massScale = 1 / Math.sqrt(ball.mass);
    const baseSpeed = isOneTimer
      ? power < 0.16
        ? 265
        : 275 + power * 190 + Math.pow(power, 3) * 50
      : power < 0.16
        ? 198
        : 210 + power * 185 + Math.pow(power, 3) * 60;
    const speed = baseSpeed * (0.78 + 0.22 * massScale) * mods.shotPowerMult;
    ball.vx = kx * speed;
    ball.vy = ky * speed;
    ball.vz = isOneTimer ? Math.max(60, 62 + power * 60) : 42 + power * 82;
    ball.oneTimerTimer = isOneTimer ? 0.48 : 0;
    ball.lastTouchTeam = p.team;
    ball.lastTouchPlayerId = p.id;
    const reportedPower = isOneTimer ? Math.max(power, 0.88) : power;
    ball.lastKickPower = reportedPower;
    ball.untouchedTimer = 0;
    ball.hotPotatoBeepAccum = 0;

    // Curve spin: perpendicular component of player movement at release
    const lateralMove = p.vx * -ky + p.vy * kx;
    const spin = Math.max(-2.2, Math.min(2.2, lateralMove * 0.011 * mods.spinMult));
    ball.spin = spin;

    p.kickSwingTimer = 0;
    p.kickContactCooldown = 0.14;
    kickedThisFrame.add(ball.id);
    events.push({
      type: 'kick',
      x: ball.x,
      y: ball.y,
      power: reportedPower,
      curved: Math.abs(spin) > 0.45,
      playerId: p.id,
      team: p.team,
      isOneTimer,
    });
  }

  private executeKeeperClear(
    p: Player,
    ball: Ball,
    bounds: ArenaBounds,
    kickedThisFrame: Set<number>,
    savedThisFrame: Set<number>,
    events: GameEvent[],
    stoleCarrier: boolean
  ): void {
    const incomingSpeed = Math.hypot(ball.vx, ball.vy);
    const headingIntoGoal = p.team === 'A' ? ball.vx < -55 : ball.vx > 55;
    if (
      !savedThisFrame.has(ball.id) &&
      !kickedThisFrame.has(ball.id) &&
      p.kickContactCooldown <= 0 &&
      (stoleCarrier || (headingIntoGoal && incomingSpeed >= 115))
    ) {
      savedThisFrame.add(ball.id);
      events.push({ type: 'save', x: ball.x, y: ball.y, team: p.team, speed: incomingSpeed });
    }

    const clearDirX = p.team === 'A' ? 1 : -1;
    const wingSign = ball.y < bounds.centerY ? -0.45 : 0.45;
    const cLen = Math.hypot(clearDirX, wingSign);
    const speed = Math.max(180, incomingSpeed * 0.72);
    ball.vx = (clearDirX / cLen) * speed;
    ball.vy = (wingSign / cLen) * speed;
    ball.vz = 32;
    ball.spin = 0;
    ball.oneTimerTimer = 0;
    ball.lastTouchTeam = p.team;
    ball.lastTouchPlayerId = p.id;
    ball.untouchedTimer = 0;
    ball.hotPotatoBeepAccum = 0;
    if (!kickedThisFrame.has(ball.id) && p.kickContactCooldown <= 0) {
      p.kickContactCooldown = 0.14;
      kickedThisFrame.add(ball.id);
      events.push({
        type: 'kick',
        x: ball.x,
        y: ball.y,
        power: 0.35,
        curved: false,
        playerId: p.id,
        team: p.team,
      });
    }
  }

  private triggerHotPotatoExplosion(
    ball: Ball,
    players: Player[],
    bounds: ArenaBounds,
    events: GameEvent[]
  ): void {
    ball.untouchedTimer = 0;
    ball.hotPotatoBeepAccum = 0;
    ball.carrierId = null;

    // Blast players within 98px radius
    const blastRadius = 98;
    for (const p of players) {
      const dx = p.x - ball.x;
      const dy = p.y - ball.y;
      const dist = Math.hypot(dx, dy) || 0.001;
      if (dist < blastRadius) {
        const falloff = 1 - dist / blastRadius;
        const knock = 285 * (0.35 + 0.65 * falloff);
        p.vx += (dx / dist) * knock;
        p.vy += (dy / dist) * knock;
        if (p.role === 'outfield') {
          p.stunTimer = Math.max(p.stunTimer, 0.35 * falloff + 0.12);
          p.pickupCooldown = Math.max(p.pickupCooldown ?? 0, 0.55);
          p.isCharging = false;
          p.chargeTime = 0;
        }
      }
    }

    // Launch ball toward pitch center/random diagonal so it keeps action alive
    const toCenterX = bounds.centerX - ball.x;
    const toCenterY = bounds.centerY - ball.y;
    const angle = Math.atan2(toCenterY, toCenterX) + (Math.random() - 0.5) * 1.1;
    const launchSpeed = 230;
    ball.vx = Math.cos(angle) * launchSpeed;
    ball.vy = Math.sin(angle) * launchSpeed;
    ball.vz = 95;

    events.push({ type: 'hot_potato_boom', x: ball.x, y: ball.y });
  }
}
