import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ADAPTIVE_RESOLUTION,
  sampleAdaptiveResolution,
} from '../game/AdaptiveResolution.ts';

describe('Adaptive resolution', () => {
  it('keeps 2x while frames are healthy and ignores isolated hitches', () => {
    let scale = 2;
    let streak = 0;
    // 10 minutes of healthy 60fps frames
    for (let i = 0; i < 36000; i++) {
      const r = sampleAdaptiveResolution(scale, streak, 16.6);
      scale = r.scale;
      streak = r.slowStreak;
    }
    expect(scale).toBe(2);

    // A single long GC pause must not downgrade the whole game.
    const hitch = sampleAdaptiveResolution(scale, streak, 180);
    expect(hitch.scale).toBe(2);
    expect(hitch.changed).toBe(false);
    // ...and the very next healthy frame clears the streak again.
    const recovered = sampleAdaptiveResolution(hitch.scale, hitch.slowStreak, 16.6);
    expect(recovered.slowStreak).toBe(0);
    expect(recovered.scale).toBe(2);
  });

  it('downgrades to 1x only after a sustained run of slow frames and then stays put', () => {
    let scale = 2;
    let streak = 0;
    let changes = 0;
    for (let i = 0; i < DEFAULT_ADAPTIVE_RESOLUTION.slowFrameStreak; i++) {
      const r = sampleAdaptiveResolution(scale, streak, 30);
      if (r.changed) changes++;
      scale = r.scale;
      streak = r.slowStreak;
    }
    expect(changes).toBe(1);
    expect(scale).toBe(1);

    // Once at the floor it never resizes again, no matter how slow or fast frames get.
    for (let i = 0; i < 500; i++) {
      const r = sampleAdaptiveResolution(scale, streak, i % 2 === 0 ? 5 : 500);
      expect(r.changed).toBe(false);
      expect(r.scale).toBe(1);
      scale = r.scale;
      streak = r.slowStreak;
    }
  });

  it('ignores invalid frame deltas instead of treating them as slow', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const r = sampleAdaptiveResolution(2, 0, bad);
      expect(r.scale).toBe(2);
      expect(r.slowStreak).toBe(0);
      expect(r.changed).toBe(false);
    }
  });

  it('clamps out-of-range scales into the configured bounds', () => {
    expect(sampleAdaptiveResolution(5, 0, 16).scale).toBe(2);
    expect(sampleAdaptiveResolution(0.2, 0, 16).scale).toBe(1);
  });
});
