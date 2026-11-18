import { GameEvent, Team, TeamKitId } from '../types.ts';
import { PALETTE } from './Palette.ts';
import { getTeamKit } from './TeamKits.ts';

interface PixelParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  life: number;
  maxLife: number;
  gravity: number;
  shape?: 'square' | 'ribbon';
  angle?: number;
  spin?: number;
  drag?: number;
}

interface Shockwave {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  color: string;
  life: number;
  maxLife: number;
}

const MAX_PARTICLES = 420;
const MAX_SHOCKWAVES = 12;

export class ParticleSystem {
  private particles: PixelParticle[] = [];
  private shockwaves: Shockwave[] = [];
  private teamAKit: TeamKitId = 'garuda';
  private teamBKit: TeamKitId = 'cyber';

  setTeamKits(teamAKit: TeamKitId, teamBKit: TeamKitId): void {
    this.teamAKit = teamAKit;
    this.teamBKit = teamBKit;
  }

  clear(): void {
    this.particles.length = 0;
    this.shockwaves.length = 0;
  }

  /** Pushes a particle, dropping the oldest ones so burst-heavy mutators stay bounded. */
  private pushParticle(p: PixelParticle): void {
    if (this.particles.length >= MAX_PARTICLES) {
      this.particles.splice(0, this.particles.length - MAX_PARTICLES + 1);
    }
    this.particles.push(p);
  }

  private pushShockwave(s: Shockwave): void {
    if (this.shockwaves.length >= MAX_SHOCKWAVES) {
      this.shockwaves.shift();
    }
    this.shockwaves.push(s);
  }

  emitDust(x: number, y: number, count = 2, icy = false): void {
    for (let i = 0; i < count; i++) {
      this.pushParticle({
        x: x + (Math.random() - 0.5) * 6,
        y: y + (Math.random() - 0.5) * 3,
        vx: (Math.random() - 0.5) * 26,
        vy: -8 - Math.random() * 18,
        size: 2,
        color: icy ? PALETTE.iceCyan : PALETTE.offWhite,
        life: 0.25 + Math.random() * 0.15,
        maxLife: 0.4,
        gravity: 0,
      });
    }
  }

  emitBallTrail(x: number, y: number, color: string, size = 2): void {
    this.pushParticle({
      x: x + (Math.random() - 0.5) * 3,
      y: y + (Math.random() - 0.5) * 3,
      vx: (Math.random() - 0.5) * 12,
      vy: (Math.random() - 0.5) * 12,
      size,
      color,
      life: 0.18,
      maxLife: 0.18,
      gravity: 0,
    });
  }

  emitSparks(x: number, y: number, color: string, count = 8): void {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 45 + Math.random() * 95;
      this.pushParticle({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        size: i % 2 === 0 ? 2 : 1,
        color,
        life: 0.22 + Math.random() * 0.15,
        maxLife: 0.37,
        gravity: 110,
      });
    }
  }

  emitGoalConfetti(x: number, y: number, scoringTeam: Team): void {
    const kit = getTeamKit(scoringTeam === 'A' ? this.teamAKit : this.teamBKit, scoringTeam);
    const colors = [kit.primary, kit.light, kit.trim, PALETTE.gold, PALETTE.pureWhite, PALETTE.iceCyan];
    // Swirling festive confetti ribbons
    for (let i = 0; i < 62; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 45 + Math.random() * 195;
      this.pushParticle({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 65,
        size: Math.random() < 0.55 ? 3.5 : 2.5,
        color: colors[i % colors.length],
        life: 0.95 + Math.random() * 0.75,
        maxLife: 1.7,
        gravity: 78,
        shape: 'ribbon',
        angle: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 14,
        drag: 0.94,
      });
    }
    // Bright impact firework sparks
    for (let i = 0; i < 26; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 85 + Math.random() * 165;
      this.pushParticle({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 20,
        size: i % 2 === 0 ? 2.5 : 1.5,
        color: i % 3 === 0 ? PALETTE.pureWhite : PALETTE.gold,
        life: 0.35 + Math.random() * 0.3,
        maxLife: 0.65,
        gravity: 95,
      });
    }
    this.pushShockwave({
      x,
      y,
      radius: 4,
      maxRadius: 56,
      color: kit.light,
      life: 0.38,
      maxLife: 0.38,
    });
    this.pushShockwave({
      x,
      y,
      radius: 8,
      maxRadius: 82,
      color: PALETTE.gold,
      life: 0.48,
      maxLife: 0.48,
    });
  }

  emitGoalCannons(leftX: number, rightX: number, topY: number, scoringTeam: Team): void {
    const kit = getTeamKit(scoringTeam === 'A' ? this.teamAKit : this.teamBKit, scoringTeam);
    const colors = [kit.light, PALETTE.gold, PALETTE.pureWhite, kit.primary, PALETTE.iceCyan];
    const cannons = [
      { x: leftX + 26, y: topY + 6, baseAng: 0.72 },
      { x: rightX - 26, y: topY + 6, baseAng: Math.PI - 0.72 },
    ];
    for (const c of cannons) {
      for (let i = 0; i < 22; i++) {
        const ang = c.baseAng + (Math.random() - 0.5) * 0.75;
        const spd = 95 + Math.random() * 135;
        this.pushParticle({
          x: c.x,
          y: c.y,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd - 18,
          size: Math.random() < 0.6 ? 3.5 : 2.5,
          color: colors[i % colors.length],
          life: 1.0 + Math.random() * 0.65,
          maxLife: 1.65,
          gravity: 68,
          shape: 'ribbon',
          angle: Math.random() * Math.PI * 2,
          spin: (Math.random() - 0.5) * 16,
          drag: 0.945,
        });
      }
    }
  }

  emitExplosion(x: number, y: number): void {
    const colors = [PALETTE.dangerRed, PALETTE.amber, PALETTE.gold, PALETTE.pureWhite];
    for (let i = 0; i < 36; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 65 + Math.random() * 145;
      this.pushParticle({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        size: Math.random() < 0.5 ? 3 : 2,
        color: colors[i % colors.length],
        life: 0.35 + Math.random() * 0.35,
        maxLife: 0.7,
        gravity: 30,
      });
    }
    this.pushShockwave({
      x,
      y,
      radius: 6,
      maxRadius: 94,
      color: PALETTE.amber,
      life: 0.32,
      maxLife: 0.32,
    });
  }

  emitOneTimerBurst(x: number, y: number): void {
    this.emitSparks(x, y, PALETTE.iceCyan, 10);
    this.emitSparks(x, y, PALETTE.gold, 8);
    this.pushShockwave({
      x,
      y,
      radius: 3,
      maxRadius: 28,
      color: PALETTE.iceCyan,
      life: 0.24,
      maxLife: 0.24,
    });
  }

  emitSaveBurst(x: number, y: number): void {
    this.emitSparks(x, y, PALETTE.iceCyan, 10);
    this.pushShockwave({
      x,
      y,
      radius: 3,
      maxRadius: 22,
      color: PALETTE.pureWhite,
      life: 0.22,
      maxLife: 0.22,
    });
  }

  handleEvents(events: GameEvent[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'kick':
          if (ev.isFeverShot) {
            this.emitSparks(ev.x, ev.y, PALETTE.amber, 14);
            this.pushShockwave({
              x: ev.x,
              y: ev.y,
              radius: 3,
              maxRadius: 30,
              color: PALETTE.gold,
              life: 0.24,
              maxLife: 0.24,
            });
          } else if (ev.isOneTimer) {
            this.emitOneTimerBurst(ev.x, ev.y);
          } else {
            this.emitSparks(
              ev.x,
              ev.y,
              ev.isPass ? PALETTE.iceCyan : ev.power >= 0.75 ? PALETTE.gold : PALETTE.pureWhite,
              ev.isPass ? 4 : ev.power >= 0.75 ? 10 : 4
            );
          }
          break;
        case 'feint_dodge':
          this.emitSparks(ev.x, ev.y, PALETTE.iceCyan, 10);
          this.pushShockwave({
            x: ev.x,
            y: ev.y,
            radius: 2,
            maxRadius: 20,
            color: PALETTE.iceCyan,
            life: 0.2,
            maxLife: 0.2,
          });
          break;
        case 'fever_activate':
          this.emitSparks(ev.x, ev.y, PALETTE.gold, 16);
          this.pushShockwave({
            x: ev.x,
            y: ev.y,
            radius: 4,
            maxRadius: 38,
            color: PALETTE.amber,
            life: 0.3,
            maxLife: 0.3,
          });
          break;
        case 'wall_bounce':
          if (ev.isPinball || ev.speed > 125) {
            const wallColor = ev.isPinball ? PALETTE.pinballGlow : PALETTE.gold;
            this.emitSparks(ev.x, ev.y, wallColor, ev.isPinball ? 9 : 5);
            if (ev.isPinball || ev.speed > 185) {
              this.pushShockwave({
                x: ev.x,
                y: ev.y,
                radius: 2,
                maxRadius: ev.isPinball ? 22 : 15,
                color: ev.isPinball ? PALETTE.pinballGlow : PALETTE.iceCyan,
                life: 0.2,
                maxLife: 0.2,
              });
            }
          }
          break;
        case 'post_clang':
          this.emitSparks(ev.x, ev.y, PALETTE.gold, 14);
          this.pushShockwave({
            x: ev.x,
            y: ev.y,
            radius: 2,
            maxRadius: 20,
            color: PALETTE.gold,
            life: 0.22,
            maxLife: 0.22,
          });
          break;
        case 'save':
          this.emitSaveBurst(ev.x, ev.y);
          break;
        case 'dash':
          this.emitDust(ev.x, ev.y, 6, false);
          break;
        case 'tackle':
          this.emitSparks(ev.x, ev.y, ev.stoleBall ? PALETTE.gold : PALETTE.amber, ev.stoleBall ? 14 : 10);
          break;
        case 'goal':
          this.emitGoalConfetti(ev.x, ev.y, ev.scoringTeam);
          break;
        case 'hot_potato_boom':
          this.emitExplosion(ev.x, ev.y);
          break;
      }
    }
  }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= p.drag ?? 0.96;
      if (p.shape === 'ribbon' && p.angle !== undefined && p.spin !== undefined) {
        p.angle += p.spin * dt;
        p.vx += Math.sin(p.angle) * 28 * dt;
      }
    }

    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.shockwaves.splice(i, 1);
        continue;
      }
      const prog = 1 - s.life / s.maxLife;
      s.radius = s.maxRadius * prog;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    for (const s of this.shockwaves) {
      const alpha = Math.max(0.15, s.life / s.maxLife);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(Math.round(s.x), Math.round(s.y), Math.round(s.radius), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    for (const p of this.particles) {
      const alpha = Math.min(1, (p.life / p.maxLife) * 1.4);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      if (p.shape === 'ribbon') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle ?? 0);
        const flutter = 0.45 + 0.55 * Math.abs(Math.cos((p.angle ?? 0) * 1.7));
        ctx.fillRect(-p.size * 0.6, -p.size * 0.35 * flutter, p.size * 1.35, Math.max(1.2, p.size * 0.7 * flutter));
        ctx.restore();
      } else {
        ctx.fillRect(Math.round(p.x - p.size * 0.5), Math.round(p.y - p.size * 0.5), p.size, p.size);
      }
    }
    ctx.globalAlpha = 1;
  }
}
