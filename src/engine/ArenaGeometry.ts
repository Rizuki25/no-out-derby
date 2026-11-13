import { ARENA_CONSTANTS, ArenaBounds, ArenaId, Vec2 } from '../types.ts';
import { ARENA_PRESETS } from './ArenaPresets.ts';

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

export function createArenaBounds(goalWidthMultiplier = 1, arenaId: ArenaId = 'classic'): ArenaBounds {
  const preset = ARENA_PRESETS[arenaId];
  const centerX = Math.round((preset.left + preset.right) * 0.5);
  const centerY = Math.round((preset.top + preset.bottom) * 0.5);
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

  // 45-degree chamfer distance checks (|dx| + |dy| beyond corner)
  const invSqrt2 = Math.SQRT1_2;
  const cLimit = bounds.chamfer + margin * (Math.SQRT2 - 1);
  // Top-left: (x - left) + (y - top) >= chamfer adjusted by radius
  const cornerMargin = margin * invSqrt2;
  if (x - bounds.left + (y - bounds.top) < bounds.chamfer + cornerMargin * 2 - margin * 0) {
    // Exact signed distance to TL chamfer line: (x - (L0 + C) + y - T0) / sqrt(2) >= margin
    if ((x - bounds.left + (y - bounds.top) - bounds.chamfer) * invSqrt2 < margin) return false;
  }
  if ((bounds.right - x + (y - bounds.top) - bounds.chamfer) * invSqrt2 < margin) return false;
  if ((bounds.right - x + (bounds.bottom - y) - bounds.chamfer) * invSqrt2 < margin) return false;
  if ((x - bounds.left + (bounds.bottom - y) - bounds.chamfer) * invSqrt2 < margin) return false;
  void cLimit;
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
