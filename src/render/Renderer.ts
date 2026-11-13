import {
  ArenaBounds,
  ArenaId,
  GameEvent,
  NATIVE_HEIGHT,
  NATIVE_WIDTH,
  TeamKitId,
} from '../types.ts';
import { getArenaOctagonVertices } from '../engine/ArenaGeometry.ts';
import type { ReplayBallSnapshot, ReplayFrame, ReplayPlayerSnapshot } from '../engine/ReplayBuffer.ts';
import { MatchState } from '../game/MatchState.ts';
import { PALETTE } from './Palette.ts';
import { ParticleSystem } from './ParticleSystem.ts';
import { drawPixelBall, drawPixelPlayer } from './PixelSprites.ts';
import { drawPixelText } from './PixelFont.ts';

interface Spectator {
  x: number;
  y: number;
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

export class Renderer {
  private shakeTimer = 0;
  private shakeIntensity = 0;
  private goalFlashTimer = 0;
  private crowdExciteTimer = 0;
  private spectators: Spectator[] = [];
  private animClock = 0;
  private callouts: FloatingCallout[] = [];

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
    for (let x = 22; x <= NATIVE_WIDTH - 22; x += 11) {
      this.spectators.push({
        x: x + ((x * 7) % 3) - 1,
        y: 23 + ((x * 3) % 4),
        shirt: colors[(x / 11) % colors.length | 0],
        phase: x * 0.37,
      });
    }
  }

  clearEffects(): void {
    this.shakeTimer = 0;
    this.shakeIntensity = 0;
    this.goalFlashTimer = 0;
    this.crowdExciteTimer = 0;
    this.callouts.length = 0;
  }

  private addCallout(text: string, x: number, y: number, color: string, life = 1.05): void {
    const recentDup = this.callouts.some((c) => c.text === text && c.life > c.maxLife - 0.35);
    if (recentDup) return;
    if (this.callouts.length >= 5) {
      this.callouts.shift();
    }
    this.callouts.push({
      text,
      x: Math.max(56, Math.min(NATIVE_WIDTH - 56, x)),
      y: Math.max(34, Math.min(NATIVE_HEIGHT - 32, y - 10)),
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

  handleEvents(events: GameEvent[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'kick':
          if (ev.isOneTimer) {
            this.triggerShake(3.8, 0.16);
            this.addCallout('ONE-TIMER!', ev.x, ev.y, PALETTE.iceCyan);
          } else if (ev.power >= 0.78) {
            this.triggerShake(3.2, 0.14);
          } else if (ev.power >= 0.45) {
            this.triggerShake(1.4, 0.08);
          }
          break;
        case 'post_clang':
          this.triggerShake(3.0, 0.14);
          if (ev.speed >= 85) {
            this.addCallout('CLANG!', ev.x, ev.y, PALETTE.gold, 0.85);
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
        case 'goal':
          this.triggerShake(4.8, 0.28);
          this.goalFlashTimer = 0.12;
          this.crowdExciteTimer = 1.6;
          if (ev.highlightTag) {
            this.addCallout(ev.highlightTag, ev.x, ev.y - 8, PALETTE.gold, 1.35);
          }
          break;
      }
    }
  }

  updateEffects(rawDt: number, match: MatchState): void {
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
      }
      for (const b of match.balls) {
        const bSpeed = Math.hypot(b.vx, b.vy);
        const isOneTimer = (b.oneTimerTimer ?? 0) > 0;
        if (isOneTimer || bSpeed > 205 || match.params.pinballActive) {
          const trailColor = isOneTimer
            ? PALETTE.iceCyan
            : match.params.pinballActive
              ? PALETTE.pinballGlow
              : Math.abs(b.spin) > 0.5
                ? PALETTE.iceCyan
                : PALETTE.gold;
          if (isOneTimer || bSpeed > 155) {
            this.particles.emitBallTrail(b.x, b.y - b.z * 0.65, trailColor, b.radius > 7 || isOneTimer ? 3 : 2);
          }
        }
      }
    }
  }

  renderArenaAndEntities(ctx: CanvasRenderingContext2D, match: MatchState): void {
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
      true
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
      false
    );
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
    withShakeAndParticles: boolean
  ): void {
    ctx.save();

    if (withShakeAndParticles && this.shakeTimer > 0 && this.shakeIntensity > 0) {
      const sx = Math.round((Math.random() - 0.5) * 2 * this.shakeIntensity);
      const sy = Math.round((Math.random() - 0.5) * 2 * this.shakeIntensity);
      ctx.translate(sx, sy);
    }

    ctx.fillStyle = PALETTE.inkBlack;
    ctx.fillRect(-8, -8, NATIVE_WIDTH + 16, NATIVE_HEIGHT + 16);

    // Arena-specific backdrop (Classic Bleachers / Concrete Alley / Rooftop Night Skyline)
    this.drawArenaBackdrop(ctx, arenaId, bounds, crowdExcited);

    // Arena pitch, chamfered walls, markings, and goal mouths
    this.drawPitchAndWalls(ctx, arenaId, bounds, isIce, isPinball, windX, windY);

    // Back goal nets
    this.drawGoalNetsBack(ctx, bounds);

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
          item.ball.carrierId != null
        );
      }
    }

    // Foreground goalposts & crossbars
    this.drawGoalPostsForeground(ctx, bounds);

    if (withShakeAndParticles) {
      this.particles.render(ctx);
      this.renderCallouts(ctx);
      if (this.goalFlashTimer > 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.45, this.goalFlashTimer * 3.5)})`;
        ctx.fillRect(0, 0, NATIVE_WIDTH, NATIVE_HEIGHT);
      }
    }

    ctx.restore();
  }

  private renderCallouts(ctx: CanvasRenderingContext2D): void {
    for (const c of this.callouts) {
      if (c.life < 0.16 && Math.floor(c.life * 28) % 2 === 0) continue;
      const isFresh = c.life > c.maxLife - 0.12;
      drawPixelText(
        ctx,
        c.text,
        Math.round(c.x),
        Math.round(c.y),
        isFresh ? PALETTE.pureWhite : c.color,
        1,
        'center',
        PALETTE.inkBlack
      );
    }
  }

  private drawArenaBackdrop(
    ctx: CanvasRenderingContext2D,
    arenaId: ArenaId,
    bounds: ArenaBounds,
    excited: boolean
  ): void {
    if (arenaId === 'concrete') {
      // Brick alley surrounding courtyard
      ctx.fillStyle = '#1b1d24';
      ctx.fillRect(0, 17, NATIVE_WIDTH, NATIVE_HEIGHT - 17);

      // Brick wall strip along top alley
      ctx.fillStyle = PALETTE.brickWall;
      ctx.fillRect(0, 17, NATIVE_WIDTH, bounds.top - 17);
      ctx.fillStyle = '#4f221f';
      for (let y = 19; y < bounds.top - 4; y += 6) {
        const offset = (y % 12 === 1) ? 0 : 6;
        for (let x = offset; x < NATIVE_WIDTH; x += 12) {
          ctx.fillRect(x, y, 10, 4);
        }
      }

      // Street signs & alley lamps
      const signs = ['GANG BETON', 'PANTUL 24H', 'NO FOULS'];
      for (let i = 0; i < signs.length; i++) {
        const sx = 95 + i * 145;
        ctx.fillStyle = PALETTE.inkBlack;
        ctx.fillRect(sx - 38, 34, 76, 11);
        ctx.fillStyle = PALETTE.concreteLine;
        ctx.fillRect(sx - 37, 35, 74, 9);
        drawPixelText(ctx, signs[i], sx, 37, PALETTE.inkBlack, 1, 'center');
      }

      // Warm alley lamp pools on left/right curb
      ctx.fillStyle = 'rgba(255, 210, 63, 0.14)';
      ctx.fillRect(16, 48, 28, 196);
      ctx.fillRect(NATIVE_WIDTH - 44, 48, 28, 196);
      return;
    }

    if (arenaId === 'rooftop') {
      // Midnight skyline behind rooftop railing
      ctx.fillStyle = '#09101d';
      ctx.fillRect(0, 17, NATIVE_WIDTH, NATIVE_HEIGHT - 17);

      // Distant city buildings & lit pixel windows
      const buildings = [
        { x: 10, w: 38, h: 24 },
        { x: 52, w: 28, h: 18 },
        { x: 86, w: 46, h: 26 },
        { x: 140, w: 30, h: 16 },
        { x: 180, w: 50, h: 25 },
        { x: 240, w: 34, h: 20 },
        { x: 284, w: 48, h: 27 },
        { x: 342, w: 36, h: 17 },
        { x: 386, w: 42, h: 24 },
        { x: 434, w: 38, h: 21 },
      ];
      for (const b of buildings) {
        ctx.fillStyle = PALETTE.skylineSilhouette;
        ctx.fillRect(b.x, 45 - b.h, b.w, b.h);
        // Tiny lit windows
        ctx.fillStyle = PALETTE.gold;
        for (let wx = b.x + 4; wx < b.x + b.w - 4; wx += 7) {
          for (let wy = 45 - b.h + 4; wy < 40; wy += 6) {
            if (((wx * 3 + wy * 7) % 5) !== 0) {
              ctx.fillRect(wx, wy, 2, 2);
            }
          }
        }
      }

      // Rooftop safety railing
      ctx.fillStyle = PALETTE.slateMid;
      ctx.fillRect(36, 40, NATIVE_WIDTH - 72, 2);
      for (let rx = 44; rx < NATIVE_WIDTH - 40; rx += 24) {
        ctx.fillRect(rx, 38, 2, 7);
      }
      return;
    }

    // Classic Stadium Bleachers & Reactive Spectators
    ctx.fillStyle = PALETTE.deepNavy;
    ctx.fillRect(0, 17, NATIVE_WIDTH, 28);
    ctx.fillStyle = PALETTE.slateDark;
    ctx.fillRect(0, 31, NATIVE_WIDTH, 13);

    const bounceSpeed = excited ? 14 : 3.2;
    for (const sp of this.spectators) {
      const jump = Math.round(Math.max(0, Math.sin(this.animClock * bounceSpeed + sp.phase)) * (excited ? 3 : 1));
      const sx = Math.round(sp.x);
      const sy = Math.round(sp.y - jump);
      ctx.fillStyle = PALETTE.inkBlack;
      ctx.fillRect(sx - 2, sy - 1, 5, 7);
      ctx.fillStyle = PALETTE.skinLight;
      ctx.fillRect(sx - 1, sy, 3, 2);
      ctx.fillStyle = sp.shirt;
      ctx.fillRect(sx - 1, sy + 2, 3, 3);
    }

    ctx.fillStyle = PALETTE.slateMid;
    ctx.fillRect(68, 36, 344, 7);
    const boards = ['NO-OUT DERBY', 'FUTSAL PANTUL', 'ZERO FOULS', 'PINBALL ARENA'];
    for (let i = 0; i < boards.length; i++) {
      const bx = 72 + i * 86;
      ctx.fillStyle = i % 2 === 0 ? PALETTE.deepNavy : '#232d40';
      ctx.fillRect(bx, 37, 82, 5);
      drawPixelText(ctx, boards[i], bx + 41, 38, i % 2 === 0 ? PALETTE.gold : PALETTE.offWhite, 1, 'center');
    }

    ctx.fillStyle = PALETTE.deepNavy;
    ctx.fillRect(0, 250, NATIVE_WIDTH, 20);
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
      // Subtle concrete tile joints
      ctx.fillStyle = turfB;
      const tileW = 47;
      for (let x = bounds.left; x < bounds.right; x += tileW * 2) {
        ctx.fillRect(x, bounds.top, tileW, bounds.bottom - bounds.top);
      }
      ctx.fillStyle = 'rgba(11, 14, 20, 0.25)';
      for (let y = bounds.top + 46; y < bounds.bottom; y += 46) {
        ctx.fillRect(bounds.left, y, bounds.right - bounds.left, 1);
      }
    } else {
      const stripeW = 34;
      ctx.fillStyle = turfB;
      for (let x = bounds.left; x < bounds.right; x += stripeW * 2) {
        ctx.fillRect(x, bounds.top, stripeW, bounds.bottom - bounds.top);
      }
    }

    if (isIce) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
      for (let i = 0; i < 6; i++) {
        const gx = bounds.left + 40 + i * 64;
        const gy = bounds.top + 35 + ((i * 47) % 120);
        ctx.fillRect(gx, gy, 18, 2);
        ctx.fillRect(gx + 6, gy - 4, 10, 1);
      }
    }

    // Drifting rooftop wind streaks across the pitch
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

    // Pitch markings
    ctx.fillStyle = lineColor;
    ctx.fillRect(bounds.centerX - 1, bounds.top, 2, bounds.bottom - bounds.top);

    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(bounds.centerX, bounds.centerY, 32, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillRect(bounds.centerX - 2, bounds.centerY - 2, 4, 4);

    const boxW = 34;
    const boxHalfH = Math.round((bounds.goalBottomY - bounds.goalTopY) * 0.5 + 15);
    ctx.strokeRect(bounds.left - 1, bounds.centerY - boxHalfH, boxW, boxHalfH * 2);
    ctx.strokeRect(bounds.right - boxW + 1, bounds.centerY - boxHalfH, boxW, boxHalfH * 2);

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

    ctx.strokeStyle = arenaId === 'concrete' ? PALETTE.brickWall : PALETTE.wallFace;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) {
      ctx.lineTo(verts[i].x, verts[i].y);
    }
    ctx.closePath();
    ctx.stroke();

    ctx.strokeStyle = wallBorderColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = turfA;
    ctx.fillRect(bounds.left - 4, bounds.goalTopY, 8, bounds.goalBottomY - bounds.goalTopY);
    ctx.fillRect(bounds.right - 4, bounds.goalTopY, 8, bounds.goalBottomY - bounds.goalTopY);

    ctx.fillStyle = lineColor;
    ctx.fillRect(bounds.left - 1, bounds.goalTopY, 2, bounds.goalBottomY - bounds.goalTopY);
    ctx.fillRect(bounds.right - 1, bounds.goalTopY, 2, bounds.goalBottomY - bounds.goalTopY);
  }

  private drawGoalNetsBack(ctx: CanvasRenderingContext2D, bounds: ArenaBounds): void {
    const drawNet = (isLeft: boolean) => {
      const x0 = isLeft ? bounds.left - bounds.goalDepth : bounds.right;
      const w = bounds.goalDepth;
      const y0 = bounds.goalTopY;
      const h = bounds.goalBottomY - bounds.goalTopY;

      ctx.fillStyle = isLeft ? 'rgba(158, 28, 50, 0.25)' : 'rgba(25, 74, 153, 0.25)';
      ctx.fillRect(x0, y0, w, h);

      ctx.fillStyle = 'rgba(220, 229, 242, 0.32)';
      for (let gx = x0 + 3; gx < x0 + w; gx += 4) {
        ctx.fillRect(gx, y0, 1, h);
      }
      for (let gy = y0 + 3; gy < y0 + h; gy += 4) {
        ctx.fillRect(x0, gy, w, 1);
      }

      ctx.strokeStyle = PALETTE.postShadow;
      ctx.lineWidth = 2;
      ctx.strokeRect(x0, y0, w, h);
    };

    drawNet(true);
    drawNet(false);
  }

  private drawGoalPostsForeground(ctx: CanvasRenderingContext2D, bounds: ArenaBounds): void {
    const drawPost = (x: number, y: number, r: number) => {
      const px = Math.round(x);
      const py = Math.round(y);
      const pr = Math.round(r);

      ctx.fillStyle = 'rgba(11, 14, 20, 0.5)';
      ctx.fillRect(px - pr, py + 1, pr * 2, pr);

      ctx.fillStyle = PALETTE.inkBlack;
      ctx.beginPath();
      ctx.arc(px, py, pr + 1, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = PALETTE.postShadow;
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = PALETTE.postMetal;
      ctx.beginPath();
      ctx.arc(px, py - 1, Math.max(2, pr - 1), 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = PALETTE.pureWhite;
      ctx.fillRect(px - 1, py - 2, 2, 2);
    };

    drawPost(bounds.left, bounds.goalTopY, bounds.postRadius);
    drawPost(bounds.left, bounds.goalBottomY, bounds.postRadius);
    drawPost(bounds.right, bounds.goalTopY, bounds.postRadius);
    drawPost(bounds.right, bounds.goalBottomY, bounds.postRadius);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.fillRect(bounds.left - bounds.goalDepth, bounds.goalTopY - 2, bounds.goalDepth, 2);
    ctx.fillRect(bounds.right, bounds.goalTopY - 2, bounds.goalDepth, 2);
  }
}
