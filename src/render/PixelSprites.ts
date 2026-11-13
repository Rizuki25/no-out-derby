import { MutatorType, PlayerAnimState, Team, TeamKitId } from '../types.ts';
import type { ReplayPlayerSnapshot } from '../engine/ReplayBuffer.ts';
import { PALETTE } from './Palette.ts';
import { getTeamKit } from './TeamKits.ts';

export interface ActiveTeamKits {
  teamAKit?: TeamKitId;
  teamBKit?: TeamKitId;
}

/**
 * Draws a charming 3/4 top-down pixel character centered at foot position (x, y).
 * Supports 4 core animation states (idle, run, kick, dash/stun) with 2-4 frames each.
 */
export function drawPixelPlayer(
  ctx: CanvasRenderingContext2D,
  p: ReplayPlayerSnapshot,
  kits?: ActiveTeamKits
): void {
  const px = Math.round(p.x);
  const py = Math.round(p.y);
  const isKeeper = p.role === 'keeper';
  const facingRight = p.facingX >= 0;

  const kit = getTeamKit(p.team === 'A' ? kits?.teamAKit : kits?.teamBKit, p.team);
  const jersey = kit.primary;
  const jerseyDark = kit.dark;
  const trim = kit.trim;
  const shorts = kit.shorts;

  // Ground elliptical drop shadow
  ctx.fillStyle = 'rgba(11, 14, 20, 0.42)';
  const shadowW = isKeeper ? 10 : 12;
  ctx.fillRect(px - Math.floor(shadowW / 2), py - 2, shadowW, 4);
  ctx.fillRect(px - Math.floor(shadowW / 2) + 1, py - 3, shadowW - 2, 6);

  // Subtle active player ring under feet
  if (p.humanSlot !== null) {
    ctx.fillStyle = p.humanSlot === 1 ? PALETTE.gold : PALETTE.iceCyan;
    ctx.fillRect(px - 6, py + 2, 12, 1);
    ctx.fillRect(px - 7, py + 1, 2, 1);
    ctx.fillRect(px + 5, py + 1, 2, 1);
  }

  // Frame selection for 4 states
  let bobY = 0;
  let legOffsetL = 0;
  let legOffsetR = 0;
  let leanX = 0;
  let kickFootX = 0;

  const state: PlayerAnimState = p.animState;
  if (state === 'idle') {
    const frame = Math.floor(p.animTime * 4) % 2;
    bobY = frame === 1 ? -1 : 0;
  } else if (state === 'run') {
    const frame = Math.floor(p.animTime * 11) % 4;
    bobY = frame % 2 === 1 ? -1 : 0;
    if (frame === 0) {
      legOffsetL = -1;
      legOffsetR = 1;
    } else if (frame === 2) {
      legOffsetL = 1;
      legOffsetR = -1;
    }
  } else if (state === 'kick') {
    const frame = p.isCharging ? (Math.floor(p.animTime * 12) % 2) : 1;
    leanX = facingRight ? (frame === 0 ? -1 : 2) : (frame === 0 ? 1 : -2);
    kickFootX = facingRight ? (frame === 0 ? -2 : 4) : (frame === 0 ? 2 : -4);
    bobY = frame === 1 ? -1 : 0;
  } else if (state === 'dash') {
    leanX = facingRight ? 2 : -2;
    bobY = 1;
    legOffsetL = facingRight ? -2 : 2;
    legOffsetR = facingRight ? 2 : -2;
  } else if (state === 'stun') {
    const frame = Math.floor(p.animTime * 14) % 2;
    leanX = frame === 0 ? -1 : 1;
  }

  const cx = px + leanX;
  const topY = py - (isKeeper ? 14 : 16) + bobY;

  ctx.save();
  if (isKeeper) {
    // Slightly compact mini-keeper sprite
    // Outline base
    ctx.fillStyle = PALETTE.inkBlack;
    ctx.fillRect(cx - 5, topY, 10, 14);
    // Head + goalie cap
    ctx.fillStyle = PALETTE.skinLight;
    ctx.fillRect(cx - 3, topY + 2, 6, 4);
    ctx.fillStyle = trim;
    ctx.fillRect(cx - 4, topY + 1, 8, 2);
    ctx.fillRect(facingRight ? cx + 1 : cx - 5, topY + 2, 4, 1);
    // Eyes
    ctx.fillStyle = PALETTE.inkBlack;
    ctx.fillRect(facingRight ? cx + 1 : cx - 2, topY + 4, 1, 1);
    // Jersey + Keeper Gloves
    ctx.fillStyle = jersey;
    ctx.fillRect(cx - 4, topY + 6, 8, 5);
    ctx.fillStyle = PALETTE.pureWhite;
    ctx.fillRect(cx - 5, topY + 7, 2, 3);
    ctx.fillRect(cx + 3, topY + 7, 2, 3);
    // Shorts & Boots
    ctx.fillStyle = shorts;
    ctx.fillRect(cx - 3, topY + 11, 6, 2);
    ctx.fillStyle = PALETTE.pureWhite;
    ctx.fillRect(cx - 3 + legOffsetL, py - 2, 2, 2);
    ctx.fillRect(cx + 1 + legOffsetR, py - 2, 2, 2);
  } else {
    // Full outfield player 3/4 pixel sprite
    // Crisp 1px black silhouette outline
    ctx.fillStyle = PALETTE.inkBlack;
    ctx.fillRect(cx - 5, topY, 10, 15);
    ctx.fillRect(cx - 6, topY + 6, 12, 6);

    // Hair / Headband
    ctx.fillStyle = kit.hair;
    ctx.fillRect(cx - 4, topY + 1, 8, 2);
    ctx.fillStyle = trim;
    ctx.fillRect(cx - 4, topY + 2, 8, 1);

    // Face
    ctx.fillStyle = PALETTE.skinLight;
    ctx.fillRect(cx - 4, topY + 3, 8, 3);
    // Eyes facing direction
    ctx.fillStyle = PALETTE.inkBlack;
    if (facingRight) {
      ctx.fillRect(cx, topY + 4, 1, 1);
      ctx.fillRect(cx + 2, topY + 4, 1, 1);
    } else {
      ctx.fillRect(cx - 3, topY + 4, 1, 1);
      ctx.fillRect(cx - 1, topY + 4, 1, 1);
    }

    // Jersey torso + vertical team stripe
    ctx.fillStyle = jersey;
    ctx.fillRect(cx - 4, topY + 6, 8, 5);
    ctx.fillStyle = jerseyDark;
    ctx.fillRect(facingRight ? cx - 4 : cx + 2, topY + 6, 2, 5);
    ctx.fillStyle = trim;
    ctx.fillRect(cx - 1, topY + 6, 2, 4);

    // Arms
    ctx.fillStyle = PALETTE.skinDark;
    ctx.fillRect(cx - 5, topY + 7, 1, 3);
    ctx.fillRect(cx + 4, topY + 7, 1, 3);

    // Shorts
    ctx.fillStyle = shorts;
    ctx.fillRect(cx - 4, topY + 11, 8, 2);

    // Animated legs & cleats
    ctx.fillStyle = PALETTE.skinLight;
    ctx.fillRect(cx - 3 + legOffsetL, py - 3, 2, 2);
    ctx.fillRect(cx + 1 + legOffsetR + kickFootX, py - 3, 2, 2);
    ctx.fillStyle = PALETTE.pureWhite;
    ctx.fillRect(cx - 3 + legOffsetL, py - 1, 2, 2);
    ctx.fillRect(cx + 1 + legOffsetR + kickFootX, py - 1, 2, 2);
  }

  // Stun dizzy stars above head
  if (p.stunTimer > 0) {
    const orbit = p.animTime * 9;
    for (let i = 0; i < 2; i++) {
      const sx = Math.round(cx + Math.cos(orbit + i * Math.PI) * 5);
      const sy = Math.round(topY - 3 + Math.sin(orbit + i * Math.PI) * 1.5);
      ctx.fillStyle = PALETTE.gold;
      ctx.fillRect(sx - 1, sy - 1, 2, 2);
    }
  }

  // World-space Charge Bar right under player feet (PRD §6.3)
  if (p.isCharging && p.chargeTime > 0.03) {
    const ratio = Math.min(1, p.chargeTime / 0.6);
    const barW = 14;
    const bx = px - 7;
    const by = py + 4;
    ctx.fillStyle = PALETTE.inkBlack;
    ctx.fillRect(bx - 1, by - 1, barW + 2, 4);
    ctx.fillStyle = PALETTE.slateDark;
    ctx.fillRect(bx, by, barW, 2);
    ctx.fillStyle = ratio >= 0.8 ? PALETTE.dangerRed : ratio >= 0.45 ? PALETTE.gold : PALETTE.pureWhite;
    ctx.fillRect(bx, by, Math.max(1, Math.round(barW * ratio)), 2);
  } else if (p.humanSlot !== null && p.dashCooldown > 0) {
    // Subtle mini dash cooldown pip under feet
    const readyRatio = Math.max(0, 1 - p.dashCooldown / 1.2);
    const bx = px - 5;
    const by = py + 4;
    ctx.fillStyle = PALETTE.inkBlack;
    ctx.fillRect(bx, by, 10, 2);
    ctx.fillStyle = PALETTE.slateLight;
    ctx.fillRect(bx, by, Math.round(10 * readyRatio), 1);
  }

  // Player indicator arrow above head for P1 / P2
  if (p.humanSlot !== null) {
    const arrowY = topY - (p.stunTimer > 0 ? 7 : 5);
    const arrowColor = p.humanSlot === 1 ? PALETTE.gold : PALETTE.iceCyan;
    ctx.fillStyle = PALETTE.inkBlack;
    ctx.fillRect(px - 3, arrowY - 1, 6, 2);
    ctx.fillRect(px - 2, arrowY + 1, 4, 1);
    ctx.fillRect(px - 1, arrowY + 2, 2, 1);
    ctx.fillStyle = arrowColor;
    ctx.fillRect(px - 2, arrowY - 1, 4, 1);
    ctx.fillRect(px - 1, arrowY, 2, 2);
  }

  ctx.restore();
}

export function drawPixelBall(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  z: number,
  radius: number,
  rollAngle: number,
  hotPotatoTimer: number,
  hotPotatoActive: boolean,
  isCarried = false
): void {
  const bx = Math.round(x);
  const shadowY = Math.round(y + radius * 0.4);
  const drawY = Math.round(y - z * 0.65);

  if (isCarried) {
    ctx.strokeStyle = PALETTE.gold;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(bx, Math.round(y + 1), Math.round(radius + 3), Math.round(radius + 1), 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Drop shadow scales slightly smaller as ball rises vertically (PRD §6.1)
  const shadowScale = Math.max(0.55, 1 - z * 0.02);
  const sr = Math.max(2, Math.round(radius * shadowScale));
  ctx.fillStyle = 'rgba(11, 14, 20, 0.45)';
  ctx.fillRect(bx - sr, shadowY - 1, sr * 2, 3);
  ctx.fillRect(bx - sr + 1, shadowY - 2, Math.max(1, sr * 2 - 2), 5);

  const r = Math.round(radius);
  // Crisp 1px black outline circle
  const isDangerFlash =
    hotPotatoActive &&
    hotPotatoTimer >= 4.0 &&
    Math.floor(hotPotatoTimer * (6 + (hotPotatoTimer - 4) * 5)) % 2 === 0;

  ctx.fillStyle = PALETTE.inkBlack;
  ctx.beginPath();
  ctx.arc(bx, drawY, r + 1, 0, Math.PI * 2);
  ctx.fill();

  // Base ball body
  ctx.fillStyle = isDangerFlash ? PALETTE.dangerRed : PALETTE.pureWhite;
  ctx.beginPath();
  ctx.arc(bx, drawY, r, 0, Math.PI * 2);
  ctx.fill();

  // Lower right crescent shading
  ctx.fillStyle = isDangerFlash ? PALETTE.teamADark : PALETTE.netColor;
  ctx.beginPath();
  ctx.arc(bx + 1, drawY + 1, Math.max(1, r - 1), 0.1, Math.PI * 0.95);
  ctx.fill();

  // Rotating soccer pentagon patch
  const patchX = Math.round(bx + Math.cos(rollAngle) * (r * 0.42));
  const patchY = Math.round(drawY + Math.sin(rollAngle) * (r * 0.38));
  const patchSize = r >= 8 ? 4 : 2;
  ctx.fillStyle = isDangerFlash ? PALETTE.gold : PALETTE.deepNavy;
  ctx.fillRect(patchX - Math.floor(patchSize / 2), patchY - Math.floor(patchSize / 2), patchSize, patchSize);

  // Highlight pixel
  ctx.fillStyle = PALETTE.pureWhite;
  ctx.fillRect(bx - Math.max(1, Math.floor(r * 0.45)), drawY - Math.max(1, Math.floor(r * 0.45)), r >= 8 ? 3 : 2, r >= 8 ? 2 : 1);

  // Hot Potato countdown arc / fuse bar above ball
  if (hotPotatoActive && hotPotatoTimer >= 2.5) {
    const fuseRatio = Math.min(1, hotPotatoTimer / 6.0);
    const barW = 14;
    const fy = drawY - r - 6;
    ctx.fillStyle = PALETTE.inkBlack;
    ctx.fillRect(bx - 7, fy, barW, 3);
    ctx.fillStyle = hotPotatoTimer >= 4.0 ? PALETTE.dangerRed : PALETTE.amber;
    ctx.fillRect(bx - 6, fy + 1, Math.max(1, Math.round((barW - 2) * fuseRatio)), 1);
  }
}

export function drawMutatorIcon(ctx: CanvasRenderingContext2D, type: MutatorType, x: number, y: number): void {
  const ix = Math.round(x);
  const iy = Math.round(y);
  ctx.fillStyle = PALETTE.inkBlack;
  ctx.fillRect(ix, iy, 12, 12);
  ctx.fillStyle = PALETTE.slateDark;
  ctx.fillRect(ix + 1, iy + 1, 10, 10);

  switch (type) {
    case 'giant_ball':
      ctx.fillStyle = PALETTE.pureWhite;
      ctx.fillRect(ix + 3, iy + 3, 6, 6);
      ctx.fillStyle = PALETTE.inkBlack;
      ctx.fillRect(ix + 5, iy + 5, 2, 2);
      break;
    case 'slippery_pitch':
      ctx.fillStyle = PALETTE.iceCyan;
      ctx.fillRect(ix + 5, iy + 2, 2, 8);
      ctx.fillRect(ix + 2, iy + 5, 8, 2);
      ctx.fillRect(ix + 3, iy + 3, 6, 6);
      break;
    case 'pinball_mode':
      ctx.fillStyle = PALETTE.pinballGlow;
      ctx.fillRect(ix + 2, iy + 2, 3, 3);
      ctx.fillRect(ix + 7, iy + 7, 3, 3);
      ctx.fillStyle = PALETTE.gold;
      ctx.fillRect(ix + 4, iy + 4, 4, 4);
      break;
    case 'hot_potato':
      ctx.fillStyle = PALETTE.dangerRed;
      ctx.fillRect(ix + 3, iy + 4, 6, 6);
      ctx.fillStyle = PALETTE.gold;
      ctx.fillRect(ix + 6, iy + 2, 2, 2);
      break;
    case 'wide_goals':
      ctx.fillStyle = PALETTE.pureWhite;
      ctx.fillRect(ix + 2, iy + 3, 8, 2);
      ctx.fillRect(ix + 2, iy + 3, 2, 6);
      ctx.fillRect(ix + 8, iy + 3, 2, 6);
      break;
    case 'multi_ball':
      ctx.fillStyle = PALETTE.pureWhite;
      ctx.fillRect(ix + 2, iy + 3, 4, 4);
      ctx.fillStyle = PALETTE.gold;
      ctx.fillRect(ix + 6, iy + 5, 4, 4);
      break;
  }
}

export function getTeamColor(team: Team): string {
  return team === 'A' ? PALETTE.teamAPrimary : PALETTE.teamBPrimary;
}
