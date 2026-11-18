import {
  ArenaBounds,
  ArenaId,
  ControlStyle,
  GameEvent,
  NATIVE_HEIGHT,
  NATIVE_WIDTH,
  Team,
  TeamKitId,
} from '../types.ts';
import { getArenaOctagonVertices, resolvePassTarget } from '../engine/ArenaGeometry.ts';
import type { ReplayBallSnapshot, ReplayFrame, ReplayPlayerSnapshot } from '../engine/ReplayBuffer.ts';
import { MatchState } from '../game/MatchState.ts';
import { PALETTE } from './Palette.ts';
import { ParticleSystem } from './ParticleSystem.ts';
import {
  drawPassTargetRing,
  drawPixelBall,
  drawPixelPlayer,
  drawShotAimArrow,
} from './PixelSprites.ts';
import { drawArcadeText, drawPixelText } from './PixelFont.ts';
import { getTeamKit } from './TeamKits.ts';

interface Spectator {
  x: number;
  dy: number;
  shirt: string;
  phase: number;
}

interface FloatingCallout {
  text: string;
  x: number;
  y: number;
  vy: number;
  color: string;
  life: number;
  maxLife: number;
}

interface BallTrailPoint {
  x: number;
  y: number;
  z: number;
  radius: number;
  color: string;
}

interface WallFlash {
  x: number;
  y: number;
  color: string;
  life: number;
  maxLife: number;
}

export class Renderer {
  private shakeTimer = 0;
  private shakeIntensity = 0;
  private goalFlashTimer = 0;
  private goalFlashTeam: Team | null = null;
  private crowdExciteTimer = 0;
  private spectators: Spectator[] = [];
  private animClock = 0;
  private callouts: FloatingCallout[] = [];
  private ballTrails = new Map<number, BallTrailPoint[]>();
  private wallFlashes: WallFlash[] = [];
  private camX = 0;
  private camY = 0;
  private lastRawDt = 1 / 60;
  private lastBounds: ArenaBounds | null = null;
  private eventBounds: ArenaBounds | null = null;
  private wasReplayFrame = false;

  constructor(private readonly particles: ParticleSystem) {
    const colors = [
      PALETTE.teamAPrimary,
      PALETTE.teamBPrimary,
      PALETTE.gold,
      PALETTE.offWhite,
      PALETTE.amber,
      PALETTE.teamALight,
      PALETTE.teamBLight,
    ];
    for (let x = 20; x <= NATIVE_WIDTH - 20; x += 12) {
      this.spectators.push({
        x: x + ((x * 7) % 3) - 1,
        dy: 7 + ((x * 3) % 5),
        shirt: colors[Math.floor(x / 12) % colors.length],
        phase: x * 0.42,
      });
    }
  }

  clearEffects(): void {
    this.shakeTimer = 0;
    this.shakeIntensity = 0;
    this.goalFlashTimer = 0;
    this.goalFlashTeam = null;
    this.crowdExciteTimer = 0;
    this.callouts.length = 0;
    this.ballTrails.clear();
    this.wallFlashes.length = 0;
    this.camX = 0;
    this.camY = 0;
    this.lastBounds = null;
    this.eventBounds = null;
    this.wasReplayFrame = false;
  }

  private addCallout(text: string, x: number, y: number, color: string, life = 1.05): void {
    const recentDup = this.callouts.some((c) => c.text === text && c.life > c.maxLife - 0.35);
    if (recentDup) return;
    if (this.callouts.length >= 5) {
      this.callouts.shift();
    }
    // Prefer the bounds of the frame that produced the event; `lastBounds` is only updated at
    // render time, so using it here would clamp callouts to the previous arena size.
    const bounds = this.eventBounds ?? this.lastBounds;
    const minX = (bounds?.left ?? 36) + 14;
    const maxX = (bounds?.right ?? NATIVE_WIDTH - 36) - 14;
    const minY = (bounds?.top ?? 48) - 8;
    const maxY = (bounds?.bottom ?? NATIVE_HEIGHT - 18) - 14;
    this.callouts.push({
      text,
      x: Math.max(minX, Math.min(maxX, x)),
      y: Math.max(minY, Math.min(maxY, y - 10)),
      vy: -22,
      color,
      life,
      maxLife: life,
    });
  }

  triggerShake(intensity: number, duration: number): void {
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
    this.shakeTimer = Math.max(this.shakeTimer, duration);
  }

  handleEvents(events: GameEvent[], bounds?: ArenaBounds): void {
    if (bounds) {
      this.eventBounds = bounds;
    }
    for (const ev of events) {
      switch (ev.type) {
        case 'kick':
          if (ev.isFeverShot) {
            this.triggerShake(4.2, 0.18);
            this.addCallout('FEVER STRIKE!', ev.x, ev.y, PALETTE.amber, 1.0);
          } else if (ev.isOneTimer) {
            this.triggerShake(3.8, 0.16);
            this.addCallout('ONE-TIMER!', ev.x, ev.y, PALETTE.iceCyan);
          } else if (ev.power >= 0.78) {
            this.triggerShake(3.2, 0.14);
          } else if (ev.power >= 0.45) {
            this.triggerShake(1.4, 0.08);
          }
          break;
        case 'feint_dodge':
          this.triggerShake(1.8, 0.08);
          this.addCallout('ANKLE BREAKER!', ev.x, ev.y, PALETTE.iceCyan, 0.85);
          break;
        case 'fever_activate': {
          const eb = this.eventBounds;
          const cx = eb ? eb.centerX : NATIVE_WIDTH * 0.5;
          const cy = eb ? eb.top + 38 : 64;
          this.triggerShake(3.4, 0.2);
          this.addCallout(`TEAM ${ev.team} FEVER!`, cx, cy, PALETTE.gold, 1.15);
          break;
        }
        case 'tactic_change': {
          const eb = this.eventBounds;
          const cx = eb ? eb.centerX : NATIVE_WIDTH * 0.5;
          const cy = eb ? eb.top + 24 : 52;
          const label =
            ev.tactic === 'attack' ? 'ATTACK+' : ev.tactic === 'defend' ? 'DEFEND+' : 'BALANCED';
          this.addCallout(`TAC: ${label}`, cx, cy, PALETTE.iceCyan, 0.85);
          break;
        }
        case 'post_clang':
          this.triggerShake(3.0, 0.14);
          this.wallFlashes.push({ x: ev.x, y: ev.y, color: PALETTE.gold, life: 0.22, maxLife: 0.22 });
          if (ev.speed >= 85) {
            this.addCallout('CLANG!', ev.x, ev.y, PALETTE.gold, 0.85);
          }
          break;
        case 'wall_bounce':
          if (ev.isPinball || ev.speed >= 105) {
            this.wallFlashes.push({
              x: ev.x,
              y: ev.y,
              color: ev.isPinball ? PALETTE.pinballGlow : PALETTE.iceCyan,
              life: 0.18,
              maxLife: 0.18,
            });
          }
          break;
        case 'save':
          this.triggerShake(2.4, 0.12);
          this.addCallout('GREAT SAVE!', ev.x, ev.y, PALETTE.iceCyan);
          break;
        case 'tackle':
          this.triggerShake(2.2, 0.1);
          if (ev.stoleBall) {
            this.addCallout('STEAL!', ev.x, ev.y, PALETTE.gold, 0.85);
          }
          break;
        case 'hot_potato_boom':
          this.triggerShake(5.5, 0.25);
          this.goalFlashTimer = 0.09;
          break;
        case 'goal': {
          this.triggerShake(5.4, 0.32);
          this.goalFlashTimer = 0.22;
          this.goalFlashTeam = ev.scoringTeam;
          this.crowdExciteTimer = 2.0;
          const b = bounds ?? this.eventBounds ?? this.lastBounds;
          if (b) {
            this.particles.emitGoalCannons(b.left, b.right, b.top, ev.scoringTeam);
          }
          if (ev.highlightTag) {
            this.addCallout(ev.highlightTag, ev.x, ev.y - 8, PALETTE.gold, 1.35);
          }
          break;
        }
      }
    }
  }

  updateEffects(rawDt: number, match: MatchState): void {
    this.lastRawDt = Math.max(0, Math.min(0.05, rawDt));
    this.animClock += rawDt;
    if (this.shakeTimer > 0) {
      this.shakeTimer = Math.max(0, this.shakeTimer - rawDt);
      if (this.shakeTimer === 0) this.shakeIntensity = 0;
    }
    if (this.goalFlashTimer > 0) {
      this.goalFlashTimer = Math.max(0, this.goalFlashTimer - rawDt);
    }
    if (this.crowdExciteTimer > 0) {
      this.crowdExciteTimer = Math.max(0, this.crowdExciteTimer - rawDt);
    }

    for (let i = this.wallFlashes.length - 1; i >= 0; i--) {
      const wf = this.wallFlashes[i];
      wf.life -= rawDt;
      if (wf.life <= 0) {
        this.wallFlashes.splice(i, 1);
      }
    }

    for (let i = this.callouts.length - 1; i >= 0; i--) {
      const c = this.callouts[i];
      c.life -= rawDt;
      if (c.life <= 0) {
        this.callouts.splice(i, 1);
        continue;
      }
      c.y += c.vy * rawDt;
      c.vy *= 0.92;
    }

    if (match.phase === 'PLAYING') {
      const icy = match.mutators.getActive()?.type === 'slippery_pitch';
      for (const p of match.players) {
        const speed = Math.hypot(p.vx, p.vy);
        if ((p.dashTimer > 0 || speed > 96) && Math.random() < (p.dashTimer > 0 ? 0.85 : 0.24)) {
          this.particles.emitDust(p.x, p.y, 1, icy);
        }
        if (p.feverActive && Math.random() < 0.36) {
          this.particles.emitBallTrail(
            p.x + (Math.random() - 0.5) * 8,
            p.y - 6 + (Math.random() - 0.5) * 8,
            Math.random() < 0.5 ? PALETTE.gold : PALETTE.amber,
            2
          );
        }
      }
      const activeIds = new Set<number>();
      for (const b of match.balls) {
        activeIds.add(b.id);
        const bSpeed = Math.hypot(b.vx, b.vy);
        const isOneTimer = (b.oneTimerTimer ?? 0) > 0;
        const isFeverBall = (b.feverTimer ?? 0) > 0;
        let trail = this.ballTrails.get(b.id);
        if (!trail) {
          trail = [];
          this.ballTrails.set(b.id, trail);
        }
        if (isFeverBall || isOneTimer || bSpeed > 145) {
          const trailColor = isFeverBall
            ? PALETTE.amber
            : isOneTimer
              ? PALETTE.iceCyan
              : match.params.pinballActive
                ? PALETTE.pinballGlow
                : Math.abs(b.spin) > 0.5
                  ? PALETTE.iceCyan
                  : PALETTE.gold;
          trail.push({ x: b.x, y: b.y, z: b.z, radius: b.radius, color: trailColor });
          if (trail.length > 9) trail.shift();
          this.particles.emitBallTrail(
            b.x,
            b.y - b.z * 0.65,
            trailColor,
            b.radius > 7 || isOneTimer || isFeverBall ? 3 : 2
          );
        } else if (trail.length > 0) {
          trail.shift();
        }
      }
      for (const id of this.ballTrails.keys()) {
        if (!activeIds.has(id)) this.ballTrails.delete(id);
      }
    } else if (this.ballTrails.size > 0) {
      this.ballTrails.clear();
    }
  }

  renderArenaAndEntities(
    ctx: CanvasRenderingContext2D,
    match: MatchState,
    localHumanSlot: 1 | 2 | null = null
  ): void {
    const replayFrame = match.phase === 'REPLAY' ? match.replay.getCurrentPlaybackFrame() : null;
    if (replayFrame) {
      this.renderReplayScene(ctx, replayFrame);
      return;
    }

    const isIce = match.mutators.getActive()?.type === 'slippery_pitch';
    const crowdExcited = this.crowdExciteTimer > 0 || match.isFinalStretch() || match.isGoldenGoal;

    this.renderSceneCore(
      ctx,
      match.config.arena,
      match.config.teamAKit ?? 'garuda',
      match.config.teamBKit ?? 'cyber',
      match.bounds,
      match.players,
      match.balls,
      isIce,
      match.params.pinballActive,
      match.params.hotPotatoActive,
      match.params.windX,
      match.params.windY,
      crowdExcited,
      true,
      match.phase === 'PLAYING',
      match.config.controlStyle ?? 'classic',
      localHumanSlot
    );
  }

  private renderReplayScene(ctx: CanvasRenderingContext2D, frame: ReplayFrame): void {
    this.renderSceneCore(
      ctx,
      frame.arenaId,
      frame.teamAKit,
      frame.teamBKit,
      frame.bounds,
      frame.players,
      frame.balls,
      frame.isIce,
      frame.pinballActive,
      frame.hotPotatoActive,
      frame.windX,
      frame.windY,
      true,
      false,
      false,
      'classic'
    );
  }

  private updateCamera(
    bounds: ArenaBounds,
    players: ReplayPlayerSnapshot[],
    balls: ReplayBallSnapshot[],
    isReplay: boolean,
    localHumanSlot: 1 | 2 | null = null
  ): { camX: number; camY: number; isEnlarged: boolean } {
    const isEnlarged = bounds.right - bounds.left > 420 || bounds.bottom - bounds.top > 212;
    if (!isEnlarged) {
      this.camX = 0;
      this.camY = 0;
      this.lastBounds = bounds;
      this.wasReplayFrame = isReplay;
      return { camX: 0, camY: 0, isEnlarged: false };
    }

    const focusBall = balls.find((b) => !b.isExtraBall) ?? balls[0];
    let focusX = focusBall ? focusBall.x : bounds.centerX;
    let focusY = focusBall ? focusBall.y : bounds.centerY;

    if (!isReplay && focusBall) {
      const localPlayer =
        localHumanSlot !== null
          ? players.find((p) => p.humanSlot === localHumanSlot)
          : null;
      if (localPlayer) {
        focusX = focusX * 0.84 + localPlayer.x * 0.16;
        focusY = focusY * 0.84 + localPlayer.y * 0.16;
      } else {
        const humans = players.filter((p) => p.humanSlot !== null);
        if (humans.length === 1) {
          focusX = focusX * 0.84 + humans[0].x * 0.16;
          focusY = focusY * 0.84 + humans[0].y * 0.16;
        }
      }
    }

    const minCamX = bounds.left - 34;
    const maxCamX = bounds.right + 34 - NATIVE_WIDTH;
    const rawTargetX = focusX - NATIVE_WIDTH * 0.5;
    const targetX =
      maxCamX <= minCamX
        ? (minCamX + maxCamX) * 0.5
        : Math.max(minCamX, Math.min(maxCamX, rawTargetX));

    const minCamY = bounds.top - 48;
    const maxCamY = bounds.bottom + 18 - NATIVE_HEIGHT;
    const rawTargetY = focusY - 144;
    const targetY =
      maxCamY <= minCamY
        ? (minCamY + maxCamY) * 0.5
        : Math.max(minCamY, Math.min(maxCamY, rawTargetY));

    const shouldSnap =
      !this.lastBounds ||
      this.wasReplayFrame !== isReplay ||
      Math.hypot(targetX - this.camX, targetY - this.camY) > 95;

    if (shouldSnap) {
      this.camX = targetX;
      this.camY = targetY;
    } else {
      const alpha = 1 - Math.exp(-this.lastRawDt * 10);
      this.camX += (targetX - this.camX) * alpha;
      this.camY += (targetY - this.camY) * alpha;
    }

    this.lastBounds = bounds;
    this.wasReplayFrame = isReplay;
    return {
      camX: Math.round(this.camX),
      camY: Math.round(this.camY),
      isEnlarged: true,
    };
  }

  private drawOffScreenIndicators(
    ctx: CanvasRenderingContext2D,
    players: ReplayPlayerSnapshot[],
    balls: ReplayBallSnapshot[],
    camX: number,
    camY: number,
    teamAKit: TeamKitId,
    teamBKit: TeamKitId
  ): void {
    const minSX = 12;
    const maxSX = NATIVE_WIDTH - 12;
    const minSY = 25;
    const maxSY = NATIVE_HEIGHT - 10;

    for (const p of players) {
      if (p.humanSlot === null) continue;
      const sx = p.x - camX;
      const sy = p.y - camY;
      if (sx >= 4 && sx <= NATIVE_WIDTH - 4 && sy >= 18 && sy <= NATIVE_HEIGHT - 4) continue;

      const bx = Math.round(Math.max(minSX, Math.min(maxSX, sx)));
      const by = Math.round(Math.max(minSY, Math.min(maxSY, sy)));
      const kit = getTeamKit(p.team === 'A' ? teamAKit : teamBKit, p.team);
      ctx.fillStyle = PALETTE.inkBlack;
      ctx.fillRect(bx - 8, by - 5, 16, 10);
      ctx.fillStyle = kit.primary;
      ctx.fillRect(bx - 7, by - 4, 14, 8);
      drawPixelText(ctx, `P${p.humanSlot}`, bx, by - 2, PALETTE.pureWhite, 1, 'center');
    }

    for (const b of balls) {
      const sx = b.x - camX;
      const sy = b.y - camY;
      if (sx >= 4 && sx <= NATIVE_WIDTH - 4 && sy >= 18 && sy <= NATIVE_HEIGHT - 4) continue;

      const bx = Math.round(Math.max(minSX, Math.min(maxSX, sx)));
      const by = Math.round(Math.max(minSY, Math.min(maxSY, sy)));
      ctx.fillStyle = PALETTE.inkBlack;
      ctx.fillRect(bx - 5, by - 5, 10, 10);
      ctx.fillStyle = PALETTE.gold;
      ctx.fillRect(bx - 4, by - 4, 8, 8);
      ctx.fillStyle = PALETTE.pureWhite;
      ctx.fillRect(bx - 2, by - 2, 4, 4);
    }
  }

  private renderSceneCore(
    ctx: CanvasRenderingContext2D,
    arenaId: ArenaId,
    teamAKit: TeamKitId,
    teamBKit: TeamKitId,
    bounds: ArenaBounds,
    players: ReplayPlayerSnapshot[],
    balls: ReplayBallSnapshot[],
    isIce: boolean,
    isPinball: boolean,
    hotPotatoActive: boolean,
    windX: number,
    windY: number,
    crowdExcited: boolean,
    withShakeAndParticles: boolean,
    showAimIndicators = false,
    controlStyle: ControlStyle = 'classic',
    localHumanSlot: 1 | 2 | null = null
  ): void {
    ctx.save();

    if (withShakeAndParticles && this.shakeTimer > 0 && this.shakeIntensity > 0) {
      const sx = Math.round((Math.random() - 0.5) * 2 * this.shakeIntensity);
      const sy = Math.round((Math.random() - 0.5) * 2 * this.shakeIntensity);
      ctx.translate(sx, sy);
    }

    ctx.fillStyle = PALETTE.inkBlack;
    ctx.fillRect(-8, -8, NATIVE_WIDTH + 16, NATIVE_HEIGHT + 16);

    const { camX, camY, isEnlarged } = this.updateCamera(
      bounds,
      players,
      balls,
      !withShakeAndParticles,
      localHumanSlot
    );

    ctx.save();
    if (camX !== 0 || camY !== 0) {
      ctx.translate(-camX, -camY);
    }

    // Arena-specific backdrop (Classic Bleachers / Concrete Alley / Rooftop Night Skyline)
    this.drawArenaBackdrop(ctx, arenaId, bounds, crowdExcited, windX, windY);

    // Arena pitch, chamfered walls, markings, and goal mouths
    this.drawPitchAndWalls(ctx, arenaId, bounds, isIce, isPinball, windX, windY);

    // Back goal nets
    this.drawGoalNetsBack(ctx, bounds);

    // Shot aim indicators rendered flat on the pitch surface beneath players & ball
    if (showAimIndicators) {
      this.drawShotAimIndicators(ctx, bounds, players, balls, controlStyle, localHumanSlot);
    }

    if (withShakeAndParticles) {
      this.renderBallTrails(ctx);
      this.renderWallFlashes(ctx);
    }

    // Y-sorted players & balls
    type RenderItem =
      | { kind: 'player'; y: number; player: ReplayPlayerSnapshot }
      | { kind: 'ball'; y: number; ball: ReplayBallSnapshot };

    const items: RenderItem[] = [];
    for (const p of players) {
      items.push({ kind: 'player', y: p.y, player: p });
    }
    for (const b of balls) {
      items.push({ kind: 'ball', y: b.y, ball: b });
    }
    items.sort((a, b) => a.y - b.y);

    for (const item of items) {
      if (item.kind === 'player') {
        drawPixelPlayer(ctx, item.player, { teamAKit, teamBKit });
      } else {
        drawPixelBall(
          ctx,
          item.ball.x,
          item.ball.y,
          item.ball.z,
          item.ball.radius,
          item.ball.rollAngle,
          item.ball.untouchedTimer,
          hotPotatoActive,
          item.ball.carrierId != null,
          (item.ball.feverTimer ?? 0) > 0
        );
      }
    }

    // Foreground goalposts & crossbars
    this.drawGoalPostsForeground(ctx, bounds);

    if (withShakeAndParticles) {
      this.particles.render(ctx);
      this.renderCallouts(ctx);
    }

    ctx.restore();

    if (isEnlarged) {
      this.drawOffScreenIndicators(ctx, players, balls, camX, camY, teamAKit, teamBKit);
    }

    // Sweeping stadium celebration beams during goal hype
    if (withShakeAndParticles && this.crowdExciteTimer > 0) {
      const kit = getTeamKit(
        this.goalFlashTeam === 'B' ? teamBKit : teamAKit,
        this.goalFlashTeam ?? 'A'
      );
      const beamAlpha = Math.min(0.16, this.crowdExciteTimer * 0.08);
      const sweep = Math.sin(this.animClock * 7.5) * 34;
      ctx.save();
      ctx.globalAlpha = beamAlpha;
      ctx.fillStyle = kit.light;
      ctx.beginPath();
      ctx.moveTo(40, 14);
      ctx.lineTo(130 + sweep, NATIVE_HEIGHT);
      ctx.lineTo(190 + sweep, NATIVE_HEIGHT);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(NATIVE_WIDTH - 40, 14);
      ctx.lineTo(NATIVE_WIDTH - 190 - sweep, NATIVE_HEIGHT);
      ctx.lineTo(NATIVE_WIDTH - 130 - sweep, NATIVE_HEIGHT);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    if (withShakeAndParticles && this.goalFlashTimer > 0) {
      const flashAlpha = Math.min(0.42, this.goalFlashTimer * 2.1);
      ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha * 0.7})`;
      ctx.fillRect(0, 0, NATIVE_WIDTH, NATIVE_HEIGHT);
      if (this.goalFlashTeam) {
        const kit = getTeamKit(this.goalFlashTeam === 'B' ? teamBKit : teamAKit, this.goalFlashTeam);
        ctx.save();
        ctx.globalAlpha = flashAlpha * 0.45;
        ctx.strokeStyle = kit.light;
        ctx.lineWidth = 10;
        ctx.strokeRect(5, 5, NATIVE_WIDTH - 10, NATIVE_HEIGHT - 10);
        ctx.restore();
      }
    }

    ctx.restore();
  }

  private drawShotAimIndicators(
    ctx: CanvasRenderingContext2D,
    bounds: ArenaBounds,
    players: ReplayPlayerSnapshot[],
    balls: ReplayBallSnapshot[],
    controlStyle: ControlStyle,
    localHumanSlot: 1 | 2 | null = null
  ): void {
    for (const p of players) {
      if (p.humanSlot === null || p.role !== 'outfield' || p.stunTimer > 0) continue;
      if (localHumanSlot !== null && p.humanSlot !== localHumanSlot) continue;

      const carriedBall = balls.find((b) => b.carrierId === p.id) ?? null;
      let shouldDrawPassHint = Boolean(carriedBall);
      if (carriedBall) {
        drawShotAimArrow(ctx, p, carriedBall, bounds, this.animClock);
      } else {
        let closestBall: ReplayBallSnapshot | null = null;
        let closestDist = Infinity;
        for (const b of balls) {
          if (b.carrierId != null) continue;
          const d = Math.hypot(b.x - p.x, b.y - p.y);
          if (d < closestDist) {
            closestDist = d;
            closestBall = b;
          }
        }

        if (p.isCharging) {
          drawShotAimArrow(ctx, p, closestDist <= 38 ? closestBall : null, bounds, this.animClock);
          shouldDrawPassHint = true;
        } else if (controlStyle === 'classic' && closestBall && closestDist <= 24) {
          drawShotAimArrow(ctx, p, closestBall, bounds, this.animClock);
          shouldDrawPassHint = true;
        }
      }

      if (shouldDrawPassHint) {
        const originX = carriedBall ? carriedBall.x : p.x;
        const originY = carriedBall ? carriedBall.y : p.y;
        const passTarget = resolvePassTarget(p, players, bounds, p.facingX, p.facingY, originX, originY);
        if (passTarget) {
          drawPassTargetRing(ctx, passTarget.targetX, passTarget.targetY, this.animClock);
        }
      }
    }
  }

  private renderCallouts(ctx: CanvasRenderingContext2D): void {
    for (const c of this.callouts) {
      if (c.life < 0.16 && Math.floor(c.life * 28) % 2 === 0) continue;
      const isFresh = c.life > c.maxLife - 0.14;
      drawArcadeText(
        ctx,
        c.text,
        Math.round(c.x),
        Math.round(c.y) + 2,
        isFresh ? PALETTE.pureWhite : c.color,
        isFresh ? 10.5 : 9,
        'center',
        {
          weight: '900',
          italic: true,
          strokeColor: PALETTE.inkBlack,
          strokeWidth: 2.2,
          shadowColor: 'rgba(6, 9, 14, 0.7)',
        }
      );
    }
  }

  private renderBallTrails(ctx: CanvasRenderingContext2D): void {
    if (this.ballTrails.size === 0) return;
    ctx.save();
    for (const trail of this.ballTrails.values()) {
      for (let i = 0; i < trail.length; i++) {
        const pt = trail[i];
        const t = (i + 1) / trail.length;
        ctx.globalAlpha = t * 0.42;
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y - pt.z * 0.65, Math.max(1.2, pt.radius * t * 0.85), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private renderWallFlashes(ctx: CanvasRenderingContext2D): void {
    if (this.wallFlashes.length === 0) return;
    ctx.save();
    for (const wf of this.wallFlashes) {
      const ratio = wf.life / wf.maxLife;
      ctx.globalAlpha = Math.min(0.9, ratio);
      ctx.strokeStyle = PALETTE.pureWhite;
      ctx.lineWidth = 1.5;
      const r = 4 + (1 - ratio) * 9;
      ctx.beginPath();
      ctx.arc(wf.x, wf.y, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = wf.color;
      ctx.beginPath();
      ctx.arc(wf.x, wf.y, 2.5 + ratio * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawArenaBackdrop(
    ctx: CanvasRenderingContext2D,
    arenaId: ArenaId,
    bounds: ArenaBounds,
    excited: boolean,
    windX = 0,
    windY = 0
  ): void {
    const bandTop = bounds.top - 31;
    const spanLeft = Math.min(0, bounds.left - 64);
    const spanRight = Math.max(NATIVE_WIDTH, bounds.right + 64);
    const spanW = spanRight - spanLeft;

    if (arenaId === 'concrete') {
      ctx.fillStyle = '#14171f';
      ctx.fillRect(spanLeft, bandTop - 18, spanW, bounds.bottom - bandTop + 60);

      // Brick back wall + steel chain-link cage fence above it
      ctx.fillStyle = PALETTE.brickWall;
      ctx.fillRect(spanLeft, bandTop + 7, spanW, 24);
      ctx.fillStyle = '#4a1e1b';
      const brickStartX = Math.floor(spanLeft / 12) * 12;
      for (let y = bandTop + 8; y < bounds.top - 4; y += 6) {
        const offset = Math.abs(y - bandTop) % 12 < 6 ? 0 : 6;
        for (let x = brickStartX + offset; x < spanRight; x += 12) {
          ctx.fillRect(x, y, 10, 4);
        }
      }

      // Chain-link fence diamond wire above brick wall
      ctx.fillStyle = '#1d222c';
      ctx.fillRect(spanLeft, bandTop - 8, spanW, 15);
      ctx.strokeStyle = 'rgba(170, 185, 205, 0.25)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      for (let fx = Math.floor(spanLeft / 10) * 10; fx < spanRight + 10; fx += 10) {
        ctx.moveTo(fx, bandTop - 7);
        ctx.lineTo(fx + 10, bandTop + 7);
        ctx.moveTo(fx + 10, bandTop - 7);
        ctx.lineTo(fx, bandTop + 7);
      }
      ctx.stroke();

      // Fence top rail & steel support posts
      ctx.fillStyle = '#4a5568';
      ctx.fillRect(spanLeft, bandTop - 8, spanW, 1.5);
      ctx.fillRect(spanLeft, bandTop + 6, spanW, 2);
      for (let px = Math.floor(spanLeft / 48) * 48; px < spanRight; px += 48) {
        ctx.fillStyle = '#364052';
        ctx.fillRect(px - 1.5, bandTop - 9, 3, 17);
      }

      // Caution yellow/black curb stripes along wall base
      const curbStart = Math.floor(spanLeft / 12) * 12;
      for (let cx = curbStart; cx < spanRight; cx += 12) {
        ctx.fillStyle = Math.floor(cx / 12) % 2 === 0 ? '#e3b228' : '#181c24';
        ctx.fillRect(cx, bounds.top - 5, 12, 3);
      }

      // Riveted alley signs
      const signs = ['ALLEY COURT', 'WALL-BOUNCE', 'NO FOULS'];
      const signSpacing = 145;
      const startSignX = bounds.centerX - signSpacing;
      const endSignX = bounds.centerX + signSpacing + (spanW > NATIVE_WIDTH ? signSpacing : 0);
      for (let sx = startSignX - (spanW > NATIVE_WIDTH ? signSpacing : 0), idx = 0; sx <= endSignX; sx += signSpacing, idx++) {
        if (sx < spanLeft + 44 || sx > spanRight - 44) continue;
        ctx.fillStyle = PALETTE.inkBlack;
        ctx.fillRect(sx - 43, bandTop + 11, 86, 13);
        ctx.fillStyle = PALETTE.concreteLine;
        ctx.fillRect(sx - 42, bandTop + 12, 84, 11);
        ctx.fillStyle = '#e3b228';
        ctx.fillRect(sx - 40, bandTop + 13.5, 2, 2);
        ctx.fillRect(sx + 38, bandTop + 13.5, 2, 2);
        ctx.fillRect(sx - 40, bandTop + 20, 2, 2);
        ctx.fillRect(sx + 38, bandTop + 20, 2, 2);
        drawPixelText(ctx, signs[idx % signs.length], sx, bandTop + 14.5, PALETTE.inkBlack, 1, 'center');
      }

      // Warm sodium-vapor streetlamp housings + glowing pools on left & right walls
      for (const lx of [bounds.left - 14, bounds.right + 14]) {
        for (const ly of [bounds.top + 38, bounds.bottom - 38]) {
          const g = ctx.createRadialGradient(lx, ly, 2, lx, ly, 58);
          g.addColorStop(0, 'rgba(255, 214, 102, 0.32)');
          g.addColorStop(0.55, 'rgba(255, 180, 64, 0.10)');
          g.addColorStop(1, 'rgba(255, 206, 84, 0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(lx, ly, 58, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#333d4f';
          ctx.fillRect(lx - 4, ly - 3, 8, 6);
          ctx.fillStyle = '#ffe58f';
          ctx.fillRect(lx - 2.5, ly - 1.5, 5, 3);
        }
      }
      return;
    }

    if (arenaId === 'rooftop') {
      const skyGrad = ctx.createLinearGradient(0, bandTop - 22, 0, bounds.bottom + 44);
      skyGrad.addColorStop(0, '#050a14');
      skyGrad.addColorStop(0.55, '#0b1426');
      skyGrad.addColorStop(1, '#132038');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(spanLeft, bandTop - 22, spanW, bounds.bottom - bandTop + 66);

      // Glowing crescent moon in open sky gap (safely below top HUD bar)
      const moonX = bounds.left + 30;
      const moonY = bandTop + 10;
      const moonAura = ctx.createRadialGradient(moonX, moonY, 2, moonX, moonY, 26);
      moonAura.addColorStop(0, 'rgba(141, 240, 255, 0.28)');
      moonAura.addColorStop(1, 'rgba(141, 240, 255, 0)');
      ctx.fillStyle = moonAura;
      ctx.beginPath();
      ctx.arc(moonX, moonY, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e6f6ff';
      ctx.beginPath();
      ctx.arc(moonX, moonY, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#091121';
      ctx.beginPath();
      ctx.arc(moonX - 2.2, moonY - 1, 4.8, 0, Math.PI * 2);
      ctx.fill();

      // Twinkling night starfield
      ctx.fillStyle = PALETTE.pureWhite;
      for (let i = 0; i < 34; i++) {
        const sx = spanLeft + ((i * 53 + 17) % Math.max(100, spanW));
        const sy = bandTop - 10 + ((i * 19) % 24);
        const blink = (Math.floor(this.animClock * 2.5 + i) % 4) === 0 ? 0.3 : 0.9;
        ctx.globalAlpha = blink;
        ctx.fillRect(sx, sy, i % 5 === 0 ? 1.5 : 1, i % 5 === 0 ? 1.5 : 1);
      }
      ctx.globalAlpha = 1;

      const buildings = [
        { x: 10, w: 38, h: 22, spire: false },
        { x: 52, w: 28, h: 11, spire: false },
        { x: 86, w: 46, h: 28, spire: true },
        { x: 140, w: 30, h: 17, spire: false },
        { x: 180, w: 50, h: 27, spire: true },
        { x: 240, w: 34, h: 21, spire: false },
        { x: 284, w: 48, h: 29, spire: true },
        { x: 342, w: 36, h: 18, spire: false },
        { x: 386, w: 42, h: 25, spire: true },
        { x: 434, w: 38, h: 22, spire: false },
      ];
      const skyBaseY = bounds.top - 3;
      const startTile = Math.floor(spanLeft / 480) * 480;
      for (let tileX = startTile; tileX < spanRight; tileX += 480) {
        // Distant haze layer silhouette
        ctx.fillStyle = '#0e172a';
        for (const b of buildings) {
          const dx = tileX + b.x + 14;
          if (dx + b.w < spanLeft || dx > spanRight) continue;
          ctx.fillRect(dx, skyBaseY - b.h - 7, b.w - 4, b.h + 7);
        }

        // Foreground illuminated skyline with neon cornices & blinking spire beacons
        for (const b of buildings) {
          const bx = tileX + b.x;
          if (bx + b.w < spanLeft || bx > spanRight) continue;
          ctx.fillStyle = PALETTE.skylineSilhouette;
          ctx.fillRect(bx, skyBaseY - b.h, b.w, b.h);
          ctx.fillStyle = b.w > 40 ? PALETTE.rooftopLine : PALETTE.gold;
          ctx.fillRect(bx, skyBaseY - b.h, b.w, 1);
          if (b.spire) {
            const spireX = bx + b.w * 0.5;
            ctx.fillStyle = PALETTE.slateLight;
            ctx.fillRect(spireX - 0.5, skyBaseY - b.h - 6, 1, 6);
            const beaconOn = Math.floor(this.animClock * 2.2 + bx * 0.1) % 2 === 0;
            ctx.fillStyle = beaconOn ? PALETTE.dangerRed : '#551722';
            ctx.fillRect(spireX - 1, skyBaseY - b.h - 7, 2, 2);
          }
          ctx.fillStyle = b.w > 44 ? PALETTE.rooftopLine : PALETTE.gold;
          for (let wx = bx + 4; wx < bx + b.w - 4; wx += 7) {
            for (let wy = skyBaseY - b.h + 4; wy < skyBaseY - 5; wy += 6) {
              if ((Math.abs(wx * 3 + wy * 7) % 5) !== 0) {
                ctx.fillRect(wx, wy, 2, 2);
              }
            }
          }
        }
      }

      // Perimeter safety railing + animated directional wind pennants
      ctx.fillStyle = PALETTE.slateMid;
      ctx.fillRect(bounds.left, bounds.top - 8, bounds.right - bounds.left, 2);
      ctx.fillStyle = PALETTE.rooftopLine;
      ctx.fillRect(bounds.left, bounds.top - 8, bounds.right - bounds.left, 0.8);
      const windMag = Math.hypot(windX, windY);
      const windDirX = windMag > 1 ? windX / windMag : 1;
      const windDirY = windMag > 1 ? windY / windMag : 0.15;
      for (let rx = bounds.left + 12, pIdx = 0; rx < bounds.right - 8; rx += 34, pIdx++) {
        ctx.fillStyle = PALETTE.slateMid;
        ctx.fillRect(rx, bounds.top - 12, 2, 9);
        // Fluttering wind pennant flag reacting to live rooftop wind vector
        const wave = Math.sin(this.animClock * (5 + windMag * 0.08) + pIdx) * 1.8;
        ctx.fillStyle = pIdx % 2 === 0 ? PALETTE.rooftopLine : PALETTE.gold;
        ctx.beginPath();
        ctx.moveTo(rx + 1, bounds.top - 12);
        ctx.lineTo(rx + 1 + windDirX * 9, bounds.top - 10 + windDirY * 3 + wave);
        ctx.lineTo(rx + 1, bounds.top - 7.5);
        ctx.closePath();
        ctx.fill();
      }
      return;
    }

    // Classic Stadium: tiered bleachers, cheering fans, LED perimeter boards, and floodlight beams
    ctx.fillStyle = '#0e131e';
    ctx.fillRect(spanLeft, bandTop - 16, spanW, bounds.bottom - bandTop + 56);

    ctx.fillStyle = PALETTE.deepNavy;
    ctx.fillRect(spanLeft, bandTop, spanW, 28);
    ctx.fillStyle = PALETTE.slateDark;
    ctx.fillRect(spanLeft, bandTop + 13, spanW, 14);
    ctx.fillStyle = '#2a364d';
    ctx.fillRect(spanLeft, bandTop + 12, spanW, 1);

    const bounceSpeed = excited ? 14 : 3.2;
    const isStandard = spanLeft === 0 && spanRight === NATIVE_WIDTH;
    const tileStart = isStandard ? 0 : Math.floor(spanLeft / NATIVE_WIDTH) * NATIVE_WIDTH;
    for (let tileX = tileStart; tileX < spanRight; tileX += NATIVE_WIDTH) {
      for (const sp of this.spectators) {
        const sx = Math.round(tileX + sp.x);
        if (sx < spanLeft + 10 || sx > spanRight - 10) continue;
        const jump = Math.round(
          Math.max(0, Math.sin(this.animClock * bounceSpeed + sp.phase)) * (excited ? 3 : 1)
        );
        const sy = Math.round(bandTop + sp.dy - jump);
        // Spectator silhouette + head + shirt + scarf/arms when cheering
        ctx.fillStyle = PALETTE.inkBlack;
        ctx.fillRect(sx - 3, sy - 1.5, 6, 8);
        ctx.fillStyle = sp.shirt;
        ctx.fillRect(sx - 2, sy + 2, 4, 3.5);
        if (excited && (Math.floor(this.animClock * 10 + sp.phase) % 2 === 0)) {
          ctx.fillRect(sx - 3.5, sy + 0.5, 1.5, 2.5);
          ctx.fillRect(sx + 2, sy + 0.5, 1.5, 2.5);
        }
        ctx.fillStyle = PALETTE.skinLight;
        ctx.fillRect(sx - 1.5, sy - 0.5, 3, 2.5);
        ctx.fillStyle = (Math.round(sp.phase * 10) % 2 === 0) ? sp.shirt : PALETTE.hairDark;
        ctx.fillRect(sx - 1.5, sy - 1, 3, 1);
      }
    }

    // Illuminated Stadium LED Ad Boards
    const boardStartX = bounds.left + 32;
    const boardSpanW = Math.max(344, bounds.right - bounds.left - 64);
    ctx.fillStyle = PALETTE.inkBlack;
    ctx.fillRect(boardStartX - 1, bounds.top - 15, boardSpanW + 2, 11);
    ctx.fillStyle = PALETTE.slateMid;
    ctx.fillRect(boardStartX, bounds.top - 14, boardSpanW, 9);
    const boards = ['NO-OUT DERBY', 'WALL-BOUNCE', 'ZERO FOULS', 'PINBALL ARENA'];
    for (let bx = boardStartX + 4, idx = 0; bx + 82 <= boardStartX + boardSpanW; bx += 86, idx++) {
      const highlight = idx % 2 === 0;
      ctx.fillStyle = highlight ? '#1c2a44' : '#253147';
      ctx.fillRect(bx, bounds.top - 13.5, 82, 8);
      ctx.fillStyle = highlight ? PALETTE.gold : PALETTE.iceCyan;
      ctx.fillRect(bx, bounds.top - 13.5, 82, 0.5);
      drawPixelText(
        ctx,
        boards[idx % boards.length],
        bx + 41,
        bounds.top - 12.5,
        highlight ? PALETTE.gold : PALETTE.offWhite,
        1,
        'center'
      );
    }

    // Four Corner Stadium Floodlights
    const corners = [
      { x: bounds.left - 18, y: bounds.top - 12 },
      { x: bounds.right + 18, y: bounds.top - 12 },
      { x: bounds.left - 18, y: bounds.bottom + 12 },
      { x: bounds.right + 18, y: bounds.bottom + 12 },
    ];
    for (const c of corners) {
      ctx.fillStyle = PALETTE.slateMid;
      ctx.fillRect(c.x - 4, c.y - 3, 8, 6);
      ctx.fillStyle = PALETTE.pureWhite;
      ctx.fillRect(c.x - 3, c.y - 2, 2, 1.5);
      ctx.fillRect(c.x + 1, c.y - 2, 2, 1.5);
      ctx.fillRect(c.x - 3, c.y + 0.5, 2, 1.5);
      ctx.fillRect(c.x + 1, c.y + 0.5, 2, 1.5);
    }
  }

  private drawPitchAndWalls(
    ctx: CanvasRenderingContext2D,
    arenaId: ArenaId,
    bounds: ArenaBounds,
    isIce: boolean,
    isPinball: boolean,
    windX: number,
    windY: number
  ): void {
    const verts = getArenaOctagonVertices(bounds);

    let turfA: string = PALETTE.turfDark;
    let turfB: string = PALETTE.turfLight;
    let lineColor: string = PALETTE.turfLine;

    if (arenaId === 'concrete') {
      turfA = PALETTE.concreteDark;
      turfB = PALETTE.concreteLight;
      lineColor = PALETTE.concreteLine;
    } else if (arenaId === 'rooftop') {
      turfA = PALETTE.rooftopDark;
      turfB = PALETTE.rooftopLight;
      lineColor = PALETTE.rooftopLine;
    }

    if (isIce) {
      turfA = PALETTE.iceDark;
      turfB = PALETTE.iceLight;
      lineColor = PALETTE.iceLine;
    }

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) {
      ctx.lineTo(verts[i].x, verts[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = turfA;
    ctx.fill();
    ctx.clip();

    if (arenaId === 'concrete') {
      ctx.fillStyle = turfB;
      const tileW = 47;
      for (let x = bounds.left; x < bounds.right; x += tileW * 2) {
        ctx.fillRect(x, bounds.top, tileW, bounds.bottom - bounds.top);
      }
      // Expansion slab joints & subtle asphalt wear
      ctx.fillStyle = 'rgba(11, 14, 20, 0.28)';
      for (let y = bounds.top + 46; y < bounds.bottom; y += 46) {
        ctx.fillRect(bounds.left, y, bounds.right - bounds.left, 1);
      }
      for (let x = bounds.left + 47; x < bounds.right; x += 47) {
        ctx.fillRect(x, bounds.top, 1, bounds.bottom - bounds.top);
      }
      ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
      for (let i = 0; i < 28; i++) {
        const sx = bounds.left + 16 + ((i * 61) % Math.max(20, Math.round(bounds.right - bounds.left - 32)));
        const sy = bounds.top + 14 + ((i * 37) % Math.max(20, Math.round(bounds.bottom - bounds.top - 28)));
        ctx.fillRect(sx, sy, 2, 2);
      }
      // Subtle spray-painted street stencil outer ring at center court
      ctx.strokeStyle = 'rgba(227, 178, 40, 0.22)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(bounds.centerX, bounds.centerY, 37, 0, Math.PI * 2);
      ctx.stroke();
    } else if (arenaId === 'rooftop') {
      const stripeW = 34;
      ctx.fillStyle = turfB;
      for (let x = bounds.left; x < bounds.right; x += stripeW * 2) {
        ctx.fillRect(x, bounds.top, stripeW, bounds.bottom - bounds.top);
      }
      // Sleek penthouse geometric grid sheen
      ctx.fillStyle = 'rgba(72, 202, 228, 0.055)';
      for (let y = bounds.top; y < bounds.bottom; y += 22) {
        ctx.fillRect(bounds.left, y, bounds.right - bounds.left, 1);
      }
      for (let x = bounds.left; x < bounds.right; x += 22) {
        ctx.fillRect(x, bounds.top, 1, bounds.bottom - bounds.top);
      }
    } else {
      const stripeW = 34;
      ctx.fillStyle = turfB;
      for (let x = bounds.left; x < bounds.right; x += stripeW * 2) {
        ctx.fillRect(x, bounds.top, stripeW, bounds.bottom - bounds.top);
      }
      // Subtle cross-mow checkerboard sheen on turf
      ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
      for (let y = bounds.top; y < bounds.bottom; y += 28) {
        ctx.fillRect(bounds.left, y, bounds.right - bounds.left, 14);
      }
    }

    // Center stadium spotlight radial illumination
    const pitchW = bounds.right - bounds.left;
    const spot = ctx.createRadialGradient(
      bounds.centerX,
      bounds.centerY,
      18,
      bounds.centerX,
      bounds.centerY,
      pitchW * 0.62
    );
    spot.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
    spot.addColorStop(0.65, 'rgba(255, 255, 255, 0.015)');
    spot.addColorStop(1, 'rgba(11, 14, 20, 0.22)');
    ctx.fillStyle = spot;
    ctx.fillRect(bounds.left, bounds.top, pitchW, bounds.bottom - bounds.top);

    if (isIce) {
      const pitchH = bounds.bottom - bounds.top;
      const iceCount = pitchW > 460 ? 10 : 6;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.24)';
      for (let i = 0; i < iceCount; i++) {
        const gx = bounds.left + 40 + ((i * Math.floor((pitchW - 80) / iceCount)) % Math.max(40, pitchW - 80));
        const gy = bounds.top + 35 + ((i * 47) % Math.max(40, pitchH - 70));
        ctx.fillRect(gx, gy, 18, 2);
        ctx.fillRect(gx + 6, gy - 4, 10, 1);
      }
    }

    if (arenaId === 'rooftop' && Math.hypot(windX, windY) > 2) {
      ctx.fillStyle = 'rgba(141, 240, 255, 0.24)';
      for (let i = 0; i < 10; i++) {
        const wx =
          bounds.left +
          ((((i * 67 + this.animClock * windX * 4.5) % (bounds.right - bounds.left)) + (bounds.right - bounds.left)) %
            (bounds.right - bounds.left));
        const wy =
          bounds.top +
          ((((i * 43 + this.animClock * windY * 3.8) % (bounds.bottom - bounds.top)) + (bounds.bottom - bounds.top)) %
            (bounds.bottom - bounds.top));
        ctx.fillRect(Math.round(wx), Math.round(wy), 3, 6);
      }
    }

    // Crisp 0.5-aligned pitch markings + penalty arcs + center circle + spots
    const pitchScale = Math.max(1, (bounds.right - bounds.left) / 408);
    ctx.fillStyle = lineColor;
    ctx.fillRect(bounds.centerX - 0.75, bounds.top, 1.5, bounds.bottom - bounds.top);

    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(bounds.centerX, bounds.centerY, Math.round(32 * pitchScale), 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = lineColor;
    ctx.beginPath();
    ctx.arc(bounds.centerX, bounds.centerY, 2.5, 0, Math.PI * 2);
    ctx.fill();

    const boxW = Math.round(34 * pitchScale);
    const boxHalfH = Math.round((bounds.goalBottomY - bounds.goalTopY) * 0.5 + 15);
    ctx.strokeRect(bounds.left - 1, bounds.centerY - boxHalfH, boxW, boxHalfH * 2);
    ctx.strokeRect(bounds.right - boxW + 1, bounds.centerY - boxHalfH, boxW, boxHalfH * 2);

    // Penalty arcs + subtle team goalmouth turf glow
    ctx.beginPath();
    ctx.arc(bounds.left + boxW - 10, bounds.centerY, 16, -0.78, 0.78);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(bounds.right - boxW + 10, bounds.centerY, 16, Math.PI - 0.78, Math.PI + 0.78);
    ctx.stroke();

    // Inner shadow along top wall & diagonal corners for sunken 3D cage depth
    ctx.strokeStyle = 'rgba(11, 14, 20, 0.28)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y + 2);
    for (let i = 1; i < verts.length; i++) {
      ctx.lineTo(verts[i].x, verts[i].y + 2);
    }
    ctx.closePath();
    ctx.stroke();

    if (arenaId === 'rooftop') {
      ctx.strokeStyle = 'rgba(72, 202, 228, 0.18)';
      ctx.lineWidth = 4;
      ctx.stroke();
    }

    ctx.restore();

    const defaultWallBorder =
      arenaId === 'concrete'
        ? PALETTE.concreteLine
        : arenaId === 'rooftop'
          ? PALETTE.rooftopLine
          : PALETTE.wallBorder;

    const wallBorderColor = isPinball
      ? Math.floor(this.animClock * 12) % 2 === 0
        ? PALETTE.pinballGlow
        : PALETTE.gold
      : defaultWallBorder;

    // Thick outer bevel wall shell + crisp bright bounce rail
    ctx.strokeStyle = PALETTE.inkBlack;
    ctx.lineWidth = 8.5;
    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) {
      ctx.lineTo(verts[i].x, verts[i].y);
    }
    ctx.closePath();
    ctx.stroke();

    ctx.strokeStyle = arenaId === 'concrete' ? PALETTE.brickWall : PALETTE.wallFace;
    ctx.lineWidth = 6;
    ctx.stroke();

    ctx.strokeStyle = wallBorderColor;
    ctx.lineWidth = 1.75;
    ctx.stroke();

    // Highlight 45-degree bounce corners cleanly
    ctx.strokeStyle = isPinball ? PALETTE.pureWhite : PALETTE.gold;
    ctx.lineWidth = 2;
    const cornerPairs = [
      [verts[1], verts[2]],
      [verts[3], verts[4]],
      [verts[5], verts[6]],
      [verts[7], verts[0]],
    ];
    for (const [a, b] of cornerPairs) {
      const mx1 = a.x + (b.x - a.x) * 0.2;
      const my1 = a.y + (b.y - a.y) * 0.2;
      const mx2 = a.x + (b.x - a.x) * 0.8;
      const my2 = a.y + (b.y - a.y) * 0.8;
      ctx.beginPath();
      ctx.moveTo(mx1, my1);
      ctx.lineTo(mx2, my2);
      ctx.stroke();
    }

    ctx.fillStyle = turfA;
    ctx.fillRect(bounds.left - 4, bounds.goalTopY, 8, bounds.goalBottomY - bounds.goalTopY);
    ctx.fillRect(bounds.right - 4, bounds.goalTopY, 8, bounds.goalBottomY - bounds.goalTopY);

    ctx.fillStyle = lineColor;
    ctx.fillRect(bounds.left - 0.75, bounds.goalTopY, 1.5, bounds.goalBottomY - bounds.goalTopY);
    ctx.fillRect(bounds.right - 0.75, bounds.goalTopY, 1.5, bounds.goalBottomY - bounds.goalTopY);
  }

  private drawGoalNetsBack(ctx: CanvasRenderingContext2D, bounds: ArenaBounds): void {
    const drawNet = (isLeft: boolean) => {
      const x0 = isLeft ? bounds.left - bounds.goalDepth : bounds.right;
      const w = bounds.goalDepth;
      const y0 = bounds.goalTopY;
      const h = bounds.goalBottomY - bounds.goalTopY;

      ctx.fillStyle = isLeft ? 'rgba(158, 28, 50, 0.3)' : 'rgba(25, 74, 153, 0.3)';
      ctx.fillRect(x0, y0, w, h);

      // Subtle shaded roof inside cage
      ctx.fillStyle = 'rgba(11, 14, 20, 0.28)';
      ctx.fillRect(x0, y0, w, 5);

      ctx.fillStyle = 'rgba(220, 229, 242, 0.34)';
      for (let gx = x0 + 3; gx < x0 + w; gx += 4) {
        ctx.fillRect(gx, y0, 1, h);
      }
      for (let gy = y0 + 3; gy < y0 + h; gy += 4) {
        ctx.fillRect(x0, gy, w, 1);
      }

      ctx.strokeStyle = PALETTE.inkBlack;
      ctx.lineWidth = 3;
      ctx.strokeRect(x0, y0, w, h);
      ctx.strokeStyle = PALETTE.postShadow;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x0, y0, w, h);
    };

    drawNet(true);
    drawNet(false);
  }

  private drawGoalPostsForeground(ctx: CanvasRenderingContext2D, bounds: ArenaBounds): void {
    const drawPost = (x: number, y: number, r: number) => {
      const px = Math.round(x * 2) / 2;
      const py = Math.round(y * 2) / 2;

      ctx.fillStyle = 'rgba(11, 14, 20, 0.5)';
      ctx.beginPath();
      ctx.ellipse(px, py + r * 0.6, r, r * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = PALETTE.inkBlack;
      ctx.beginPath();
      ctx.arc(px, py, r + 1, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = PALETTE.postShadow;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = PALETTE.postMetal;
      ctx.beginPath();
      ctx.arc(px - 0.5, py - 0.5, Math.max(2, r - 0.8), 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = PALETTE.pureWhite;
      ctx.beginPath();
      ctx.arc(px - 1, py - 1.2, 1.1, 0, Math.PI * 2);
      ctx.fill();
    };

    drawPost(bounds.left, bounds.goalTopY, bounds.postRadius);
    drawPost(bounds.left, bounds.goalBottomY, bounds.postRadius);
    drawPost(bounds.right, bounds.goalTopY, bounds.postRadius);
    drawPost(bounds.right, bounds.goalBottomY, bounds.postRadius);

    // Metallic crossbar top glints
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillRect(bounds.left - bounds.goalDepth, bounds.goalTopY - 1.5, bounds.goalDepth, 1.5);
    ctx.fillRect(bounds.right, bounds.goalTopY - 1.5, bounds.goalDepth, 1.5);
  }
}
