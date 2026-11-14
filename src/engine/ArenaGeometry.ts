import { ARENA_CONSTANTS, ArenaBounds, ArenaId, PitchSize, Vec2 } from '../types.ts';
import { ARENA_PRESETS, PITCH_SIZE_PRESETS } from './ArenaPresets.ts';

export interface WallSegment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Outward-into-pitch unit normal (points toward playable interior) */
  nx: number;
  ny: number;
  isNet: boolean;
}

export interface GoalPost {
  x: number;
  y: number;
  radius: number;
  team: 'A' | 'B';
}

/**
 * Generates symmetric octagon arena bounds and goal geometry.
 */
export function createArenaBounds(
  goalWidthMultiplier = 1,
  arenaId: ArenaId = 'classic',
  pitchSize: PitchSize = 'standard',
): ArenaBounds {
  const preset = ARENA_PRESETS[arenaId];
  const sizePreset = PITCH_SIZE_PRESETS[pitchSize] ?? PITCH_SIZE_PRESETS.standard;
  const centerX = Math.round((preset.left + preset.right) * 0.5);
  const centerY = Math.round((preset.top + preset.bottom) * 0.5);

  if (pitchSize === 'standard' || sizePreset.scale === 1) {
    const halfGoal = preset.baseGoalHalfHeight * goalWidthMultiplier;
    return {
      left: preset.left,
      right: preset.right,
      top: preset.top,
      bottom: preset.bottom,
      chamfer: preset.chamfer,
      centerX,
      centerY,
      goalTopY: Math.round(centerY - halfGoal),
      goalBottomY: Math.round(centerY + halfGoal),
      goalDepth: ARENA_CONSTANTS.GOAL_DEPTH,
      postRadius: ARENA_CONSTANTS.POST_RADIUS,
    };
  }

  const baseHalfW = (preset.right - preset.left) * 0.5;
  const baseHalfH = (preset.bottom - preset.top) * 0.5;
  const halfW = Math.round(baseHalfW * sizePreset.scale);
  const halfH = Math.round(baseHalfH * sizePreset.scale);
  const chamfer = Math.round(preset.chamfer * (1 + (sizePreset.scale - 1) * 0.5));
  const halfGoal = preset.baseGoalHalfHeight * sizePreset.goalScale * goalWidthMultiplier;

  return {
    left: centerX - halfW,
    right: centerX + halfW,
    top: centerY - halfH,
    bottom: centerY + halfH,
    chamfer,
    centerX,
    centerY,
    goalTopY: Math.round(centerY - halfGoal),
    goalBottomY: Math.round(centerY + halfGoal),
    goalDepth: ARENA_CONSTANTS.GOAL_DEPTH,
    postRadius: ARENA_CONSTANTS.POST_RADIUS,
  };
}

function makeSegment(ax: number, ay: number, bx: number, by: number, interiorPoint: Vec2, isNet = false): WallSegment {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  // Orient normal so it points toward the interior point
  const midX = (ax + bx) * 0.5;
  const midY = (ay + by) * 0.5;
  if ((interiorPoint.x - midX) * nx + (interiorPoint.y - midY) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  return { ax, ay, bx, by, nx, ny, isNet };
}

export function getArenaOctagonVertices(bounds: ArenaBounds): Vec2[] {
  const { left: L, right: R, top: T, bottom: B, chamfer: C } = bounds;
  return [
    { x: L + C, y: T },
    { x: R - C, y: T },
    { x: R, y: T + C },
    { x: R, y: B - C },
    { x: R - C, y: B },
    { x: L + C, y: B },
    { x: L, y: B - C },
    { x: L, y: T + C },
  ];
}

export function getBallArenaSegments(bounds: ArenaBounds): WallSegment[] {
  const { left: L, right: R, top: T, bottom: B, chamfer: C, goalTopY, goalBottomY, goalDepth } = bounds;
  const center = { x: bounds.centerX, y: bounds.centerY };

  return [
    // Top wall & top-right chamfer
    makeSegment(L + C, T, R - C, T, center),
    makeSegment(R - C, T, R, T + C, center),
    // Right upper end wall
    makeSegment(R, T + C, R, goalTopY, center),
    // Right goal net pocket
    makeSegment(R, goalTopY, R + goalDepth, goalTopY, { x: R + goalDepth * 0.5, y: bounds.centerY }, true),
    makeSegment(R + goalDepth, goalTopY, R + goalDepth, goalBottomY, center, true),
    makeSegment(R + goalDepth, goalBottomY, R, goalBottomY, { x: R + goalDepth * 0.5, y: bounds.centerY }, true),
    // Right lower end wall & bottom-right chamfer
    makeSegment(R, goalBottomY, R, B - C, center),
    makeSegment(R, B - C, R - C, B, center),
    // Bottom wall & bottom-left chamfer
    makeSegment(R - C, B, L + C, B, center),
    makeSegment(L + C, B, L, B - C, center),
    // Left lower end wall
    makeSegment(L, B - C, L, goalBottomY, center),
    // Left goal net pocket
    makeSegment(L, goalBottomY, L - goalDepth, goalBottomY, { x: L - goalDepth * 0.5, y: bounds.centerY }, true),
    makeSegment(L - goalDepth, goalBottomY, L - goalDepth, goalTopY, center, true),
    makeSegment(L - goalDepth, goalTopY, L, goalTopY, { x: L - goalDepth * 0.5, y: bounds.centerY }, true),
    // Left upper end wall & top-left chamfer
    makeSegment(L, goalTopY, L, T + C, center),
    makeSegment(L, T + C, L + C, T, center),
  ];
}

export function getPlayerArenaSegments(bounds: ArenaBounds): WallSegment[] {
  const { left: L, right: R, top: T, bottom: B, chamfer: C } = bounds;
  const center = { x: bounds.centerX, y: bounds.centerY };
  return [
    makeSegment(L + C, T, R - C, T, center),
    makeSegment(R - C, T, R, T + C, center),
    makeSegment(R, T + C, R, B - C, center),
    makeSegment(R, B - C, R - C, B, center),
    makeSegment(R - C, B, L + C, B, center),
    makeSegment(L + C, B, L, B - C, center),
    makeSegment(L, B - C, L, T + C, center),
    makeSegment(L, T + C, L + C, T, center),
  ];
}

export function getGoalPosts(bounds: ArenaBounds): GoalPost[] {
  return [
    { x: bounds.left, y: bounds.goalTopY, radius: bounds.postRadius, team: 'A' },
    { x: bounds.left, y: bounds.goalBottomY, radius: bounds.postRadius, team: 'A' },
    { x: bounds.right, y: bounds.goalTopY, radius: bounds.postRadius, team: 'B' },
    { x: bounds.right, y: bounds.goalBottomY, radius: bounds.postRadius, team: 'B' },
  ];
}

export function closestPointOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): Vec2 {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq <= 1e-8) return { x: ax, y: ay };
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lenSq));
  return { x: ax + abx * t, y: ay + aby * t };
}

/**
 * Checks whether a point is strictly inside the playable octagonal pitch (excluding goal net pockets).
 */
export function isInsidePitchOctagon(x: number, y: number, bounds: ArenaBounds, margin = 0): boolean {
  const L = bounds.left + margin;
  const R = bounds.right - margin;
  const T = bounds.top + margin;
  const B = bounds.bottom - margin;
  if (x < L || x > R || y < T || y > B) return false;

  // Signed distance to each 45-degree chamfer line must be at least `margin`.
  // For a line x + y = left + top + chamfer the signed distance is (x + y - left - top - chamfer) / sqrt(2).
  const invSqrt2 = Math.SQRT1_2;
  if ((x - bounds.left + (y - bounds.top) - bounds.chamfer) * invSqrt2 < margin) return false;
  if ((bounds.right - x + (y - bounds.top) - bounds.chamfer) * invSqrt2 < margin) return false;
  if ((bounds.right - x + (bounds.bottom - y) - bounds.chamfer) * invSqrt2 < margin) return false;
  if ((x - bounds.left + (bounds.bottom - y) - bounds.chamfer) * invSqrt2 < margin) return false;
  return true;
}

/**
 * Hard safety clamp inside the arena (including goal pockets for balls if inside goal opening).
 */
export function clampInsideArena(
  entity: { x: number; y: number },
  radius: number,
  bounds: ArenaBounds,
  allowGoalPocket: boolean
): void {
  const inGoalY = entity.y > bounds.goalTopY + radius * 0.25 && entity.y < bounds.goalBottomY - radius * 0.25;
  const minX = allowGoalPocket && inGoalY ? bounds.left - bounds.goalDepth + radius : bounds.left + radius;
  const maxX = allowGoalPocket && inGoalY ? bounds.right + bounds.goalDepth - radius : bounds.right - radius;

  if (entity.x < minX) entity.x = minX;
  if (entity.x > maxX) entity.x = maxX;
  if (entity.y < bounds.top + radius) entity.y = bounds.top + radius;
  if (entity.y > bounds.bottom - radius) entity.y = bounds.bottom - radius;

  // Also enforce the 4 chamfered half-planes if not inside a goal pocket
  if (entity.x >= bounds.left && entity.x <= bounds.right) {
    const req = bounds.chamfer + radius * Math.SQRT2;
    const tl = entity.x - bounds.left + (entity.y - bounds.top);
    if (tl < req) {
      const push = (req - tl) * 0.5;
      entity.x += push;
      entity.y += push;
    }
    const tr = bounds.right - entity.x + (entity.y - bounds.top);
    if (tr < req) {
      const push = (req - tr) * 0.5;
      entity.x -= push;
      entity.y += push;
    }
    const br = bounds.right - entity.x + (bounds.bottom - entity.y);
    if (br < req) {
      const push = (req - br) * 0.5;
      entity.x -= push;
      entity.y -= push;
    }
    const bl = entity.x - bounds.left + (bounds.bottom - entity.y);
    if (bl < req) {
      const push = (req - bl) * 0.5;
      entity.x += push;
      entity.y -= push;
    }
  }
}

export interface ShotAimResult {
  x: number;
  y: number;
  /** True when the resolved shot trajectory threads inside the opponent goalmouth */
  isGoalLocked: boolean;
}

/**
 * Resolves a human player's kick/shot aim vector against the opponent goalmouth.
 * Keeps backward passes, lateral crosses, and deep clearances 100% manual while applying
 * a forgiving goal-cone assist in attacking range so 8-way keys and touch sticks can
 * aim cleanly inside the goalposts without fighting wall bank shots.
 */
export function resolveShotAim(
  playerX: number,
  playerY: number,
  facingX: number,
  facingY: number,
  team: 'A' | 'B',
  bounds: ArenaBounds,
  originX = playerX,
  originY = playerY
): ShotAimResult {
  const len = Math.hypot(facingX, facingY);
  const rawX = len > 0.001 ? facingX / len : team === 'A' ? 1 : -1;
  const rawY = len > 0.001 ? facingY / len : 0;

  const forwardX = team === 'A' ? 1 : -1;
  const oppGoalX = team === 'A' ? bounds.right : bounds.left;
  const dxToGoal = oppGoalX - originX;
  const pitchSpanX = bounds.right - bounds.left;

  // Keep defensive-zone clearances, sideways passes, and back-passes strictly manual.
  if (
    rawX * forwardX <= 0.38 ||
    dxToGoal * forwardX <= 4 ||
    (originX - bounds.centerX) * forwardX < -pitchSpanX * 0.14
  ) {
    return { x: rawX, y: rawY, isGoalLocked: false };
  }

  const goalHeight = bounds.goalBottomY - bounds.goalTopY;
  const postSafeMargin = Math.min(goalHeight * 0.28, bounds.postRadius + 5.5);
  const safeTopY = bounds.goalTopY + postSafeMargin;
  const safeBottomY = bounds.goalBottomY - postSafeMargin;

  // Extrapolate raw facing ray onto the opponent goal plane
  const t = dxToGoal / rawX;
  const rayY = originY + rawY * t;

  if (rayY >= safeTopY && rayY <= safeBottomY) {
    return { x: rawX, y: rawY, isGoalLocked: true };
  }

  const targetY = Math.max(safeTopY, Math.min(safeBottomY, rayY));
  const txRaw = oppGoalX - originX;
  const tyRaw = targetY - originY;
  const tLen = Math.hypot(txRaw, tyRaw) || 1;
  const tx = txRaw / tLen;
  const ty = tyRaw / tLen;

  const dot = Math.max(-1, Math.min(1, rawX * tx + rawY * ty));
  const angleDiff = Math.acos(dot);

  const fullLockAngle = 0.30; // ~17.2 deg: cleanly threads past the near goalpost
  const maxAssistAngle = 0.41; // ~23.5 deg: tapers off so steep bank shots stay manual
  if (angleDiff >= maxAssistAngle) {
    return { x: rawX, y: rawY, isGoalLocked: false };
  }

  const falloff =
    angleDiff <= fullLockAngle
      ? 1
      : 1 - (angleDiff - fullLockAngle) / (maxAssistAngle - fullLockAngle);
  const smoothBlend = angleDiff <= fullLockAngle ? 1 : falloff * falloff * (3 - 2 * falloff);

  const bx = rawX + (tx - rawX) * smoothBlend;
  const by = rawY + (ty - rawY) * smoothBlend;
  const bLen = Math.hypot(bx, by) || 1;
  const nx = bx / bLen;
  const ny = by / bLen;

  const finalT = nx * forwardX > 0.1 ? dxToGoal / nx : 0;
  const finalRayY = finalT > 0 ? originY + ny * finalT : rayY;
  const isGoalLocked = finalRayY >= bounds.goalTopY + 5 && finalRayY <= bounds.goalBottomY - 5;

  return { x: nx, y: ny, isGoalLocked };
}

export interface PassCandidateSnapshot {
  id: number;
  team: 'A' | 'B';
  role: 'outfield' | 'keeper';
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  stunTimer?: number;
}

export interface PassTargetResult {
  targetPlayerId: number;
  targetX: number;
  targetY: number;
  dirX: number;
  dirY: number;
  dist: number;
}

/**
 * Selects the best open outfield teammate for an accurate pass (biased by aim direction and
 * attacking progression) and leads the pass slightly ahead of their velocity vector.
 */
export function resolvePassTarget(
  passer: PassCandidateSnapshot,
  allPlayers: readonly PassCandidateSnapshot[],
  bounds: ArenaBounds,
  aimX = passer.team === 'A' ? 1 : -1,
  aimY = 0,
  originX = passer.x,
  originY = passer.y
): PassTargetResult | null {
  const mates = allPlayers.filter(
    (m) =>
      m.team === passer.team &&
      m.role === 'outfield' &&
      m.id !== passer.id &&
      (m.stunTimer ?? 0) <= 0
  );
  if (mates.length === 0) return null;

  const forwardX = passer.team === 'A' ? 1 : -1;
  const aimLen = Math.hypot(aimX, aimY);
  const ax = aimLen > 0.1 ? aimX / aimLen : forwardX;
  const ay = aimLen > 0.1 ? aimY / aimLen : 0;
  const spanX = Math.max(120, bounds.right - bounds.left);

  let bestMate = mates[0];
  let bestScore = -Infinity;
  for (const m of mates) {
    const dx = m.x - passer.x;
    const dy = m.y - passer.y;
    const dist = Math.hypot(dx, dy);
    const nx = dist > 0.001 ? dx / dist : forwardX;
    const ny = dist > 0.001 ? dy / dist : 0;
    const dot = nx * ax + ny * ay;
    const forwardBonus = (dx * forwardX) / (spanX * 0.45);
    const score = dot * 2.2 + forwardBonus * 0.5 - dist / (spanX * 1.15);
    if (score > bestScore) {
      bestScore = score;
      bestMate = m;
    }
  }

  const rawDist = Math.hypot(bestMate.x - originX, bestMate.y - originY);
  const leadTime = Math.min(0.28, rawDist / 260);
  const targetX = Math.max(
    bounds.left + 14,
    Math.min(bounds.right - 14, bestMate.x + (bestMate.vx ?? 0) * leadTime + forwardX * 6)
  );
  const targetY = Math.max(
    bounds.top + 14,
    Math.min(bounds.bottom - 14, bestMate.y + (bestMate.vy ?? 0) * leadTime)
  );
  const px = targetX - originX;
  const py = targetY - originY;
  const dist = Math.hypot(px, py) || 1;

  return {
    targetPlayerId: bestMate.id,
    targetX,
    targetY,
    dirX: px / dist,
    dirY: py / dist,
    dist,
  };
}
