import { ARENA_CONSTANTS, ArenaBounds, MutatorType, PlayerAnimState, TeamKitId } from '../types.ts';
import { resolveShotAim } from '../engine/ArenaGeometry.ts';
import type { ReplayBallSnapshot, ReplayPlayerSnapshot } from '../engine/ReplayBuffer.ts';
import { PALETTE } from './Palette.ts';
import { getTeamKit } from './TeamKits.ts';

export interface ActiveTeamKits {
  teamAKit?: TeamKitId;
  teamBKit?: TeamKitId;
}

const snapHalf = (v: number): number => Math.round(v * 2) / 2;

/**
 * Draws an expressive 16-bit style futsal athlete centered at foot position (x, y).
 * Coordinates use 0.5 logical pixel steps so 2x (960x540) canvas output stays razor crisp.
 */
export function drawPixelPlayer(
  ctx: CanvasRenderingContext2D,
  p: ReplayPlayerSnapshot,
  kits?: ActiveTeamKits
): void {
  const px = snapHalf(p.x);
  const py = snapHalf(p.y);
  const isKeeper = p.role === 'keeper';
  const facingRight = p.facingX >= 0;
  const dir = facingRight ? 1 : -1;

  const kit = getTeamKit(p.team === 'A' ? kits?.teamAKit : kits?.teamBKit, p.team);
  const jersey = kit.primary;
  const jerseyDark = kit.dark;
  const jerseyLight = kit.light;
  const trim = kit.trim;
  const shorts = kit.shorts;

  // Soft two-tier turf drop shadow
  ctx.save();
  ctx.fillStyle = 'rgba(8, 12, 18, 0.34)';
  ctx.beginPath();
  ctx.ellipse(px, py + 0.5, isKeeper ? 6.5 : 7, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(8, 12, 18, 0.25)';
  ctx.beginPath();
  ctx.ellipse(px, py + 0.5, isKeeper ? 4.5 : 5, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Fever aura ring under feet
  if (p.feverActive) {
    const pulse = Math.floor(p.animTime * 16) % 2 === 0;
    ctx.strokeStyle = pulse ? PALETTE.gold : PALETTE.amber;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.ellipse(px, py + 0.5, 9.5, 4.2, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Active human control halo ring beneath feet
  if (p.humanSlot !== null) {
    const ringColor = p.humanSlot === 1 ? PALETTE.gold : PALETTE.iceCyan;
    ctx.strokeStyle = PALETTE.inkBlack;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(px, py + 0.5, 8, 3.4, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(px, py + 0.5, 8, 3.4, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Feint phantom afterimage silhouette
  if ((p.feintTimer ?? 0) > 0 && !isKeeper) {
    const phantomX = snapHalf(px - p.facingX * 5.5);
    ctx.fillStyle = 'rgba(115, 239, 255, 0.34)';
    ctx.beginPath();
    ctx.ellipse(phantomX, py - 7, 4.5, 7, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  let bobY = 0;
  let legOffsetL = 0;
  let legOffsetR = 0;
  let armSwing = 0;
  let leanX = 0;
  let kickFootX = 0;
  let isActiveKickSwing = false;

  const state: PlayerAnimState = p.animState;
  if (state === 'idle') {
    const breath = Math.sin(p.animTime * 4.5);
    bobY = breath > 0.35 ? -0.5 : 0;
  } else if (state === 'run') {
    const frame = Math.floor(p.animTime * 12) % 4;
    bobY = frame % 2 === 1 ? -1 : 0;
    if (frame === 0) {
      legOffsetL = -1.5;
      legOffsetR = 1.5;
      armSwing = 1.5;
    } else if (frame === 2) {
      legOffsetL = 1.5;
      legOffsetR = -1.5;
      armSwing = -1.5;
    }
  } else if (state === 'kick') {
    const windup = p.isCharging && Math.floor(p.animTime * 12) % 2 === 0;
    leanX = dir * (windup ? -1 : 1.5);
    kickFootX = dir * (windup ? -2.5 : 4.5);
    bobY = windup ? 0 : -1;
    armSwing = windup ? -2 : 2;
    isActiveKickSwing = !p.isCharging;
  } else if (state === 'dash') {
    leanX = dir * 2;
    bobY = 1;
    legOffsetL = -dir * 2.5;
    legOffsetR = dir * 2.5;
    armSwing = -2;
  } else if (state === 'stun') {
    leanX = Math.floor(p.animTime * 14) % 2 === 0 ? -1 : 1;
  }

  const cx = snapHalf(px + leanX);
  const topY = snapHalf(py - (isKeeper ? 15.5 : 17.5) + bobY);

  // Kick motion smear arc behind follow-through leg
  if (isActiveKickSwing && !isKeeper) {
    ctx.strokeStyle = 'rgba(255, 210, 63, 0.72)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (facingRight) {
      ctx.arc(cx + 1, py - 2.5, 6.5, -0.7, 0.45);
    } else {
      ctx.arc(cx - 1, py - 2.5, 6.5, Math.PI - 0.45, Math.PI + 0.7);
    }
    ctx.stroke();
  }

  // Outer crisp 0.5px dark silhouette outline
  ctx.fillStyle = PALETTE.inkBlack;
  ctx.fillRect(cx - 4.5, topY, 9, 7); // Head outline
  ctx.fillRect(cx - 5.5, topY + 6.5, 11, 7.5); // Torso/arms outline

  if (isKeeper) {
    // Keeper Head + Visor Cap
    ctx.fillStyle = PALETTE.skinLight;
    ctx.fillRect(cx - 3.5, topY + 2.5, 7, 4);
    ctx.fillStyle = PALETTE.skinDark;
    ctx.fillRect(facingRight ? cx - 3.5 : cx + 1.5, topY + 3, 2, 3.5);

    ctx.fillStyle = trim;
    ctx.fillRect(cx - 4, topY + 0.5, 8, 2.5);
    ctx.fillStyle = PALETTE.pureWhite;
    ctx.fillRect(cx - 3, topY + 0.5, 4, 1);
    ctx.fillRect(facingRight ? cx + 1 : cx - 5.5, topY + 2, 4.5, 1); // Cap brim

    // Expressive eyes
    ctx.fillStyle = PALETTE.pureWhite;
    ctx.fillRect(facingRight ? cx + 0.5 : cx - 2.5, topY + 4, 2, 1.5);
    ctx.fillStyle = PALETTE.inkBlack;
    ctx.fillRect(facingRight ? cx + 1.5 : cx - 2.5, topY + 4, 1, 1.5);

    // Keeper Torso + Stripe
    ctx.fillStyle = jersey;
    ctx.fillRect(cx - 4, topY + 7, 8, 5);
    ctx.fillStyle = jerseyDark;
    ctx.fillRect(facingRight ? cx - 4 : cx + 2, topY + 7, 2, 5);
    ctx.fillStyle = jerseyLight;
    ctx.fillRect(cx - 1, topY + 7, 2, 4.5);

    // Padded Keeper Gloves (left & right)
    ctx.fillStyle = PALETTE.inkBlack;
    ctx.fillRect(cx - 6.5, topY + 7, 2.5, 4);
    ctx.fillRect(cx + 4, topY + 7, 2.5, 4);
    ctx.fillStyle = PALETTE.pureWhite;
    ctx.fillRect(cx - 6, topY + 7.5, 1.5, 3);
    ctx.fillRect(cx + 4.5, topY + 7.5, 1.5, 3);
    ctx.fillStyle = trim;
    ctx.fillRect(cx - 6, topY + 7.5, 1.5, 1);
    ctx.fillRect(cx + 4.5, topY + 7.5, 1.5, 1);

    // Shorts + Legs + Cleats
    ctx.fillStyle = shorts;
    ctx.fillRect(cx - 3.5, topY + 12, 7, 2);
    ctx.fillStyle = PALETTE.inkBlack;
    ctx.fillRect(cx - 3.5 + legOffsetL, py - 2.5, 2.5, 2.5);
    ctx.fillRect(cx + 1 + legOffsetR, py - 2.5, 2.5, 2.5);
    ctx.fillStyle = PALETTE.pureWhite;
    ctx.fillRect(cx - 3 + legOffsetL, py - 2, 2, 1.5);
    ctx.fillRect(cx + 1 + legOffsetR, py - 2, 2, 1.5);
  } else {
    // Outfield Hair + Top Highlight + Headband
    ctx.fillStyle = kit.hair;
    ctx.fillRect(cx - 4, topY + 0.5, 8, 2.5);
    ctx.fillRect(facingRight ? cx - 4 : cx + 2.5, topY + 2, 1.5, 2);
    ctx.fillStyle = trim;
    ctx.fillRect(cx - 4, topY + 2, 8, 1);

    // Face + Cheek Shading
    ctx.fillStyle = PALETTE.skinLight;
    ctx.fillRect(cx - 3.5, topY + 3, 7, 3.5);
    ctx.fillStyle = PALETTE.skinDark;
    ctx.fillRect(facingRight ? cx - 3.5 : cx + 2, topY + 3.5, 1.5, 3);

    // Eyes with bright sclera highlight
    const eyeX1 = facingRight ? cx - 0.5 : cx - 3;
    const eyeX2 = facingRight ? cx + 1.5 : cx - 1;
    ctx.fillStyle = PALETTE.pureWhite;
    ctx.fillRect(eyeX1, topY + 4, 1.5, 1.5);
    ctx.fillRect(eyeX2, topY + 4, 1.5, 1.5);
    ctx.fillStyle = PALETTE.inkBlack;
    ctx.fillRect(facingRight ? eyeX1 + 0.5 : eyeX1, topY + 4, 1, 1.5);
    ctx.fillRect(facingRight ? eyeX2 + 0.5 : eyeX2, topY + 4, 1, 1.5);

    // Jersey Torso, Shoulder Accent, Collar & Vertical Stripe
    ctx.fillStyle = jersey;
    ctx.fillRect(cx - 4, topY + 7, 8, 5.5);
    ctx.fillStyle = jerseyDark;
    ctx.fillRect(facingRight ? cx - 4 : cx + 2, topY + 7, 2, 5.5);
    ctx.fillStyle = jerseyLight;
    ctx.fillRect(facingRight ? cx + 1 : cx - 3, topY + 7.5, 2, 1.5);
    ctx.fillStyle = trim;
    ctx.fillRect(cx - 1, topY + 7, 2, 5);
    // White V-collar
    ctx.fillStyle = PALETTE.pureWhite;
    ctx.fillRect(cx - 1.5, topY + 7, 3, 1);

    // Animated Arms & Sleeves
    const armLy = snapHalf(topY + 7.5 + armSwing * 0.5);
    const armRy = snapHalf(topY + 7.5 - armSwing * 0.5);
    ctx.fillStyle = jerseyDark;
    ctx.fillRect(cx - 5, armLy, 1.5, 2);
    ctx.fillRect(cx + 3.5, armRy, 1.5, 2);
    ctx.fillStyle = PALETTE.skinLight;
    ctx.fillRect(cx - 5, armLy + 2, 1.5, 2);
    ctx.fillRect(cx + 3.5, armRy + 2, 1.5, 2);

    // Shorts with crisp side trim
    ctx.fillStyle = shorts;
    ctx.fillRect(cx - 4, topY + 12.5, 8, 2);
    ctx.fillStyle = trim;
    ctx.fillRect(cx - 4, topY + 12.5, 1, 2);
    ctx.fillRect(cx + 3, topY + 12.5, 1, 2);

    // Legs, Team Socks & Cleats
    const lx = snapHalf(cx - 3 + legOffsetL);
    const rx = snapHalf(cx + 1 + legOffsetR + kickFootX);
    ctx.fillStyle = PALETTE.inkBlack;
    ctx.fillRect(lx - 0.5, py - 3.5, 3, 3.5);
    ctx.fillRect(rx - 0.5, py - 3.5, 3, 3.5);
    ctx.fillStyle = PALETTE.skinLight;
    ctx.fillRect(lx, py - 3, 2, 1);
    ctx.fillRect(rx, py - 3, 2, 1);
    ctx.fillStyle = jersey;
    ctx.fillRect(lx, py - 2, 2, 1);
    ctx.fillRect(rx, py - 2, 2, 1);
    ctx.fillStyle = PALETTE.pureWhite;
    ctx.fillRect(lx, py - 1, 2.5, 1);
    ctx.fillRect(rx, py - 1, 2.5, 1);
  }

  // Dizzy stars above head when stunned
  if (p.stunTimer > 0) {
    const orbit = p.animTime * 9;
    for (let i = 0; i < 3; i++) {
      const sx = snapHalf(cx + Math.cos(orbit + (i * Math.PI * 2) / 3) * 5.5);
      const sy = snapHalf(topY - 3 + Math.sin(orbit + (i * Math.PI * 2) / 3) * 1.5);
      ctx.fillStyle = PALETTE.inkBlack;
      ctx.fillRect(sx - 1, sy - 1, 2.5, 2.5);
      ctx.fillStyle = i === 0 ? PALETTE.gold : PALETTE.pureWhite;
      ctx.fillRect(sx - 0.5, sy - 0.5, 1.5, 1.5);
    }
  }

  // World-space Charge Bar right under player feet
  if (p.isCharging && p.chargeTime > 0.03) {
    const ratio = Math.min(1, p.chargeTime / ARENA_CONSTANTS.MAX_CHARGE_TIME);
    const barW = 15;
    const bx = snapHalf(px - barW * 0.5);
    const by = py + 4;
    ctx.fillStyle = PALETTE.inkBlack;
    ctx.fillRect(bx - 1, by - 1, barW + 2, 4);
    ctx.fillStyle = PALETTE.slateDark;
    ctx.fillRect(bx, by, barW, 2);
    ctx.fillStyle = ratio >= 0.8 ? PALETTE.dangerRed : ratio >= 0.45 ? PALETTE.gold : PALETTE.pureWhite;
    ctx.fillRect(bx, by, Math.max(1, snapHalf(barW * ratio)), 2);
  } else if (p.humanSlot !== null && p.dashCooldown > 0) {
    const readyRatio = Math.max(0, 1 - p.dashCooldown / 1.2);
    const bx = px - 5;
    const by = py + 4;
    ctx.fillStyle = PALETTE.inkBlack;
    ctx.fillRect(bx - 0.5, by - 0.5, 11, 2.5);
    ctx.fillStyle = PALETTE.iceCyan;
    ctx.fillRect(bx, by, snapHalf(10 * readyRatio), 1.5);
  }

  // Crisp 2x-detailed arrow above active P1 / P2
  if (p.humanSlot !== null) {
    const arrowY = snapHalf(topY - (p.stunTimer > 0 ? 7.5 : 5));
    const arrowColor = p.humanSlot === 1 ? PALETTE.gold : PALETTE.iceCyan;
    ctx.fillStyle = PALETTE.inkBlack;
    ctx.beginPath();
    ctx.moveTo(px - 3.5, arrowY - 1);
    ctx.lineTo(px + 3.5, arrowY - 1);
    ctx.lineTo(px, arrowY + 3);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = arrowColor;
    ctx.beginPath();
    ctx.moveTo(px - 2.5, arrowY - 0.5);
    ctx.lineTo(px + 2.5, arrowY - 0.5);
    ctx.lineTo(px, arrowY + 2);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

/**
 * Draws a crisp directional aim arrow showing the exact resolved shot trajectory while
 * dribbling or charging a kick. Turns gold when lined up inside the opponent goalmouth.
 */
export function drawShotAimArrow(
  ctx: CanvasRenderingContext2D,
  player: ReplayPlayerSnapshot,
  anchorBall: ReplayBallSnapshot | null,
  bounds: ArenaBounds,
  animClock = 0
): void {
  const originX = anchorBall ? anchorBall.x : player.x + player.facingX * 11;
  const originY = anchorBall ? anchorBall.y : player.y + player.facingY * 11;
  const ballRadius = anchorBall ? anchorBall.radius : ARENA_CONSTANTS.BASE_BALL_RADIUS;
  const aim = resolveShotAim(
    player.x,
    player.y,
    player.facingX,
    player.facingY,
    player.team,
    bounds,
    originX,
    originY
  );

  const chargeRatio = player.isCharging
    ? Math.min(1, player.chargeTime / ARENA_CONSTANTS.MAX_CHARGE_TIME)
    : 0;
  const pulseFlash = chargeRatio >= 0.8 && Math.floor(animClock * 16) % 2 === 0;
  const arrowColor = pulseFlash
    ? PALETTE.dangerRed
    : aim.isGoalLocked
      ? PALETTE.gold
      : chargeRatio >= 0.45
        ? PALETTE.amber
        : player.humanSlot === 1
          ? PALETTE.pureWhite
          : PALETTE.iceCyan;

  const startDist = ballRadius + 4;
  const arrowLen = 22 + chargeRatio * 20;
  const headLen = 6.5 + chargeRatio * 2;
  const headHalfW = 4.2 + chargeRatio * 0.9;

  const sx = originX + aim.x * startDist;
  const sy = originY + aim.y * startDist;
  const shaftEnd = startDist + arrowLen - headLen + 1;
  const ex = originX + aim.x * shaftEnd;
  const ey = originY + aim.y * shaftEnd;
  const tipDist = startDist + arrowLen;
  const tipX = originX + aim.x * tipDist;
  const tipY = originY + aim.y * tipDist;
  const baseX = originX + aim.x * (tipDist - headLen);
  const baseY = originY + aim.y * (tipDist - headLen);
  const perpX = -aim.y;
  const perpY = aim.x;

  ctx.save();

  if (aim.isGoalLocked || chargeRatio > 0.15) {
    const pipCount = aim.isGoalLocked ? 3 : 2;
    for (let i = 1; i <= pipCount; i++) {
      const pipDist = tipDist + i * 8;
      const px = originX + aim.x * pipDist;
      const py = originY + aim.y * pipDist;
      if (
        px < bounds.left - bounds.goalDepth + 2 ||
        px > bounds.right + bounds.goalDepth - 2 ||
        py < bounds.top + 2 ||
        py > bounds.bottom - 2
      ) {
        break;
      }
      const rx = snapHalf(px);
      const ry = snapHalf(py);
      ctx.globalAlpha = 0.92 - i * 0.16;
      ctx.fillStyle = PALETTE.inkBlack;
      ctx.fillRect(rx - 1.5, ry - 1.5, 3, 3);
      ctx.fillStyle = arrowColor;
      ctx.fillRect(rx - 0.5, ry - 0.5, 1.5, 1.5);
    }
    ctx.globalAlpha = 1;
  }

  ctx.strokeStyle = PALETTE.inkBlack;
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();

  ctx.fillStyle = PALETTE.inkBlack;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(baseX + perpX * headHalfW, baseY + perpY * headHalfW);
  ctx.lineTo(baseX - perpX * headHalfW, baseY - perpY * headHalfW);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();

  ctx.strokeStyle = arrowColor;
  ctx.lineWidth = 1.75;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();

  ctx.fillStyle = arrowColor;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(baseX + perpX * headHalfW, baseY + perpY * headHalfW);
  ctx.lineTo(baseX - perpX * headHalfW, baseY - perpY * headHalfW);
  ctx.closePath();
  ctx.fill();

  if (aim.isGoalLocked || chargeRatio > 0.25) {
    const cx = snapHalf(originX + aim.x * (tipDist - headLen * 0.55));
    const cy = snapHalf(originY + aim.y * (tipDist - headLen * 0.55));
    ctx.fillStyle = PALETTE.pureWhite;
    ctx.fillRect(cx - 0.5, cy - 0.5, 1, 1);
  }

  ctx.restore();
}

/**
 * Draws a pulsing cyan target marker showing where a smart teammate pass will lead.
 */
export function drawPassTargetRing(
  ctx: CanvasRenderingContext2D,
  targetX: number,
  targetY: number,
  animClock = 0
): void {
  const tx = snapHalf(targetX);
  const ty = snapHalf(targetY);
  const expand = Math.sin(animClock * 10) > 0 ? 1 : 0;
  const r = 7 + expand;
  ctx.save();
  ctx.strokeStyle = PALETTE.inkBlack;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(tx, ty, r + 1, (r + 1) * 0.65, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = PALETTE.iceCyan;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(tx, ty, r, r * 0.65, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = PALETTE.iceCyan;
  ctx.fillRect(tx - 1, ty - 1, 2, 2);
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
  isCarried = false,
  isFeverBall = false
): void {
  const bx = snapHalf(x);
  const shadowY = snapHalf(y + radius * 0.45);
  const drawY = snapHalf(y - z * 0.65);

  ctx.save();
  if (isFeverBall) {
    ctx.strokeStyle = PALETTE.amber;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(bx, drawY, radius + 2.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (isCarried) {
    ctx.strokeStyle = PALETTE.gold;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(bx, snapHalf(y + 1), radius + 3, radius + 1.2, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Smooth ground elliptical drop shadow
  const shadowScale = Math.max(0.55, 1 - z * 0.02);
  const sr = Math.max(2, radius * shadowScale);
  ctx.fillStyle = 'rgba(8, 12, 18, 0.42)';
  ctx.beginPath();
  ctx.ellipse(bx, shadowY, sr, sr * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();

  const isDangerFlash =
    hotPotatoActive &&
    hotPotatoTimer >= 4.0 &&
    Math.floor(hotPotatoTimer * (6 + (hotPotatoTimer - 4) * 5)) % 2 === 0;

  // Crisp outline
  ctx.fillStyle = PALETTE.inkBlack;
  ctx.beginPath();
  ctx.arc(bx, drawY, radius + 1, 0, Math.PI * 2);
  ctx.fill();

  // Base sphere
  ctx.fillStyle = isDangerFlash ? PALETTE.dangerRed : PALETTE.pureWhite;
  ctx.beginPath();
  ctx.arc(bx, drawY, radius, 0, Math.PI * 2);
  ctx.fill();

  // Shading crescent clipped cleanly to ball
  ctx.save();
  ctx.beginPath();
  ctx.arc(bx, drawY, radius, 0, Math.PI * 2);
  ctx.clip();

  ctx.fillStyle = isDangerFlash ? PALETTE.teamADark : '#c4d2e4';
  ctx.beginPath();
  ctx.arc(bx + radius * 0.35, drawY + radius * 0.35, radius, 0, Math.PI * 2);
  ctx.strokeStyle = 'transparent';
  ctx.fill();

  ctx.fillStyle = isDangerFlash ? PALETTE.dangerRed : PALETTE.pureWhite;
  ctx.beginPath();
  ctx.arc(bx - radius * 0.2, drawY - radius * 0.2, radius * 0.88, 0, Math.PI * 2);
  ctx.fill();

  // Rotating soccer pentagon patches
  const patchColor = isDangerFlash ? PALETTE.gold : PALETTE.deepNavy;
  const patchSize = Math.max(1.5, radius * 0.42);
  const p1x = snapHalf(bx + Math.cos(rollAngle) * (radius * 0.44));
  const p1y = snapHalf(drawY + Math.sin(rollAngle) * (radius * 0.38));
  const p2x = snapHalf(bx + Math.cos(rollAngle + 2.2) * (radius * 0.52));
  const p2y = snapHalf(drawY + Math.sin(rollAngle + 2.2) * (radius * 0.46));
  ctx.fillStyle = patchColor;
  ctx.beginPath();
  ctx.arc(p1x, p1y, patchSize * 0.65, 0, Math.PI * 2);
  ctx.arc(p2x, p2y, patchSize * 0.48, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Specular highlight pixel
  ctx.fillStyle = PALETTE.pureWhite;
  ctx.beginPath();
  ctx.arc(bx - radius * 0.35, drawY - radius * 0.35, Math.max(1, radius * 0.24), 0, Math.PI * 2);
  ctx.fill();

  // Hot Potato countdown fuse bar above ball
  if (hotPotatoActive && hotPotatoTimer >= 2.5) {
    const fuseRatio = Math.min(1, hotPotatoTimer / 6.0);
    const barW = 14;
    const fy = snapHalf(drawY - radius - 6);
    ctx.fillStyle = PALETTE.inkBlack;
    ctx.fillRect(bx - 7, fy, barW, 3);
    ctx.fillStyle = hotPotatoTimer >= 4.0 ? PALETTE.dangerRed : PALETTE.amber;
    ctx.fillRect(bx - 6, fy + 1, Math.max(1, snapHalf((barW - 2) * fuseRatio)), 1);
  }
  ctx.restore();
}

export function drawMutatorIcon(ctx: CanvasRenderingContext2D, type: MutatorType, x: number, y: number): void {
  const ix = snapHalf(x);
  const iy = snapHalf(y);
  ctx.fillStyle = PALETTE.inkBlack;
  ctx.fillRect(ix, iy, 12, 12);
  ctx.fillStyle = PALETTE.slateDark;
  ctx.fillRect(ix + 1, iy + 1, 10, 10);

  switch (type) {
    case 'giant_ball':
      ctx.fillStyle = PALETTE.pureWhite;
      ctx.beginPath();
      ctx.arc(ix + 6, iy + 6, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PALETTE.inkBlack;
      ctx.fillRect(ix + 5, iy + 5, 2, 2);
      break;
    case 'slippery_pitch':
      ctx.fillStyle = PALETTE.iceCyan;
      ctx.fillRect(ix + 5.5, iy + 2, 1, 8);
      ctx.fillRect(ix + 2, iy + 5.5, 8, 1);
      ctx.fillRect(ix + 3.5, iy + 3.5, 5, 5);
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
      ctx.beginPath();
      ctx.arc(ix + 6, iy + 7, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PALETTE.gold;
      ctx.fillRect(ix + 6, iy + 2.5, 2, 2);
      break;
    case 'wide_goals':
      ctx.fillStyle = PALETTE.pureWhite;
      ctx.fillRect(ix + 2, iy + 3, 8, 2);
      ctx.fillRect(ix + 2, iy + 3, 2, 6);
      ctx.fillRect(ix + 8, iy + 3, 2, 6);
      break;
    case 'multi_ball':
      ctx.fillStyle = PALETTE.pureWhite;
      ctx.beginPath();
      ctx.arc(ix + 4.5, iy + 4.5, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ix + 7.5, iy + 7.5, 2, 0, Math.PI * 2);
      ctx.fill();
      break;
  }
}
