/**
 * Pure decision logic for adaptive canvas resolution.
 *
 * Render cost scales with the square of the backing-store scale, so dropping from 2x to 1x on a
 * slow device cuts fill-rate ~4x. The downgrade is one-way on purpose: resizing the canvas clears
 * it and invalidates the cached text sprites, so oscillating between scales would be worse than
 * staying at the lower one.
 */
export interface AdaptiveResolutionConfig {
  maxScale: number;
  minScale: number;
  /** Frame time (ms) that counts as "too slow" for the device. */
  slowFrameMs: number;
  /** Consecutive slow frames required before downgrading. */
  slowFrameStreak: number;
}

export const DEFAULT_ADAPTIVE_RESOLUTION: AdaptiveResolutionConfig = {
  maxScale: 2,
  minScale: 1,
  slowFrameMs: 23,
  slowFrameStreak: 45,
};

export interface FrameSampleResult {
  scale: number;
  slowStreak: number;
  changed: boolean;
}

/**
 * Feeds one wall-clock frame duration into the controller and returns the scale to render at.
 *
 * Frames are only judged while a fast scale is still active; sustained slowness downgrades one
 * step (2 -> 1) and a single fast frame resets the streak so isolated hitches (GC, tab switch,
 * asset decode) never trigger a downgrade.
 */
export function sampleAdaptiveResolution(
  currentScale: number,
  slowStreak: number,
  frameMs: number,
  config: AdaptiveResolutionConfig = DEFAULT_ADAPTIVE_RESOLUTION
): FrameSampleResult {
  const minScale = Math.max(1, Math.min(config.minScale, config.maxScale));
  const scale = Math.max(minScale, Math.min(config.maxScale, currentScale));
  if (scale <= minScale) {
    return { scale, slowStreak: 0, changed: false };
  }
  // Ignore non-finite/negative deltas (clock skew, first frame) instead of counting them as slow.
  if (!Number.isFinite(frameMs) || frameMs < 0) {
    return { scale, slowStreak, changed: false };
  }
  if (frameMs < config.slowFrameMs) {
    return { scale, slowStreak: 0, changed: false };
  }
  const nextStreak = slowStreak + 1;
  if (nextStreak < Math.max(1, config.slowFrameStreak)) {
    return { scale, slowStreak: nextStreak, changed: false };
  }
  return { scale: minScale, slowStreak: 0, changed: scale !== minScale };
}
