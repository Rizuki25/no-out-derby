import { describe, expect, it } from 'vitest';
import { createArenaBounds, isInsidePitchOctagon } from '../engine/ArenaGeometry.ts';
import { ARENA_PRESETS, PITCH_SIZE_PRESETS } from '../engine/ArenaPresets.ts';
import { createDefaultPhysicsParams } from '../engine/PhysicsEngine.ts';
import { CareerRecordsStore, StorageLike } from '../game/CareerRecords.ts';
import { MatchState } from '../game/MatchState.ts';
import { MutatorManager } from '../game/MutatorManager.ts';
import { createEmptyInput } from '../game/AIController.ts';
import { ArenaId, FIXED_DT, GameEvent, MatchConfig } from '../types.ts';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

describe('Pitch Size Presets & Scaling', () => {
  it('keeps standard pitch dimensions identical to legacy arena presets', () => {
    const arenas: ArenaId[] = ['classic', 'concrete', 'rooftop'];
    for (const arenaId of arenas) {
      const preset = ARENA_PRESETS[arenaId];
      const base = createArenaBounds(1.0, arenaId);
      const explicitStandard = createArenaBounds(1.0, arenaId, 'standard');

      expect(base).toEqual(explicitStandard);
      expect(explicitStandard.left).toBe(preset.left);
      expect(explicitStandard.right).toBe(preset.right);
      expect(explicitStandard.top).toBe(preset.top);
      expect(explicitStandard.bottom).toBe(preset.bottom);
      expect(explicitStandard.chamfer).toBe(preset.chamfer);
      expect(explicitStandard.goalBottomY - explicitStandard.goalTopY).toBe(preset.baseGoalHalfHeight * 2);
    }
  });

  it('scales large and xl pitches symmetrically with wider goals and valid octagon interiors', () => {
    const standard = createArenaBounds(1.0, 'classic', 'standard');
    const large = createArenaBounds(1.0, 'classic', 'large');
    const xl = createArenaBounds(1.0, 'classic', 'xl');

    expect(large.centerX).toBe(standard.centerX);
    expect(large.centerY).toBe(standard.centerY);
    expect(xl.centerX).toBe(standard.centerX);
    expect(xl.centerY).toBe(standard.centerY);

    const stdW = standard.right - standard.left;
    const stdH = standard.bottom - standard.top;
    const largeW = large.right - large.left;
    const largeH = large.bottom - large.top;
    const xlW = xl.right - xl.left;
    const xlH = xl.bottom - xl.top;

    expect(largeW).toBe(Math.round(stdW * 0.5 * PITCH_SIZE_PRESETS.large.scale) * 2);
    expect(largeH).toBe(Math.round(stdH * 0.5 * PITCH_SIZE_PRESETS.large.scale) * 2);
    expect(xlW).toBeGreaterThan(largeW);
    expect(xlH).toBeGreaterThan(largeH);

    // Goal height scales cleanly without exceeding pitch interior
    expect(large.goalBottomY - large.goalTopY).toBeGreaterThan(standard.goalBottomY - standard.goalTopY);
    expect(xl.goalBottomY - xl.goalTopY).toBeGreaterThan(large.goalBottomY - large.goalTopY);
    expect(xl.goalTopY).toBeGreaterThan(xl.top + xl.chamfer);
    expect(xl.goalBottomY).toBeLessThan(xl.bottom - xl.chamfer);

    // Expanded outer corridor is strictly inside enlarged octagon
    expect(isInsidePitchOctagon(standard.right + 30, standard.centerY, large)).toBe(true);
    expect(isInsidePitchOctagon(large.right + 20, large.centerY, xl)).toBe(true);
  });

  it('preserves enlarged pitchSize across MutatorManager wide_goals activation and clearAll', () => {
    const mutators = new MutatorManager(() => 0.1);
    mutators.reset(90, true, 'classic', 'xl');

    const params = createDefaultPhysicsParams('classic');
    const xlBase = createArenaBounds(1.0, 'classic', 'xl');
    const events: GameEvent[] = [];

    const wideBounds = mutators.activateMutator('wide_goals', [], params, events);
    expect(wideBounds.left).toBe(xlBase.left);
    expect(wideBounds.right).toBe(xlBase.right);
    expect(wideBounds.goalBottomY - wideBounds.goalTopY).toBeGreaterThan(xlBase.goalBottomY - xlBase.goalTopY);

    const clearedBounds = mutators.clearAll([], params);
    expect(clearedBounds).toEqual(xlBase);
  });

  it('scales MatchState kickoff spacing on xl while keeping standard kickoff untouched and snapshotting replay bounds', () => {
    const baseCfg: MatchConfig = {
      mode: '3v3_ai',
      arena: 'classic',
      pitchSize: 'standard',
      difficulty: 'pro',
      durationSeconds: 90,
      mutatorsEnabled: false,
      replayEnabled: true,
      controlStyle: 'dribble',
      teamAKit: 'garuda',
      teamBKit: 'cyber',
    };

    const stdMatch = new MatchState(() => 0.5);
    stdMatch.startMatch(baseCfg);
    const stdOutfield = stdMatch.players.filter((p) => p.team === 'A' && p.role === 'outfield');
    expect(stdMatch.bounds.left).toBe(36);
    expect(stdOutfield[0].x).toBe(stdMatch.bounds.centerX - 48);
    expect(stdOutfield[1].x).toBe(stdMatch.bounds.centerX - 96);

    const xlMatch = new MatchState(() => 0.5);
    xlMatch.startMatch({ ...baseCfg, pitchSize: 'xl' });
    const xlOutfield = xlMatch.players.filter((p) => p.team === 'A' && p.role === 'outfield');
    const xlKeeperA = xlMatch.players.find((p) => p.team === 'A' && p.role === 'keeper');

    expect(xlMatch.bounds.right - xlMatch.bounds.left).toBeGreaterThan(640);
    expect(xlOutfield[0].x).toBeLessThan(stdOutfield[0].x);
    expect(xlOutfield[1].x).toBeLessThan(stdOutfield[1].x);
    expect(xlKeeperA?.x).toBe(xlMatch.bounds.left + 10);

    // Step past kickoff countdown so ReplayBuffer records frames with enlarged bounds
    const empty = { p1: createEmptyInput(), p2: createEmptyInput() };
    for (let i = 0; i < 100; i++) {
      xlMatch.update(FIXED_DT, empty);
    }
    expect(xlMatch.phase).toBe('PLAYING');
    expect(xlMatch.replay.startPlayback('SPECTACULAR GOAL!', 'A')).toBe(true);
    const frame = xlMatch.replay.getCurrentPlaybackFrame();
    expect(frame?.bounds.right! - frame?.bounds.left!).toBeGreaterThan(640);
  });

  it('persists and sanitizes pitchSize in CareerRecordsStore preferences', () => {
    const storage = createMemoryStorage();
    const store = new CareerRecordsStore(storage);

    const fallback: MatchConfig = {
      mode: '1v1_ai',
      arena: 'classic',
      pitchSize: 'standard',
      difficulty: 'pro',
      durationSeconds: 90,
      mutatorsEnabled: true,
      replayEnabled: true,
      controlStyle: 'dribble',
      teamAKit: 'garuda',
      teamBKit: 'cyber',
    };

    store.savePreferences({ ...fallback, pitchSize: 'xl' }, false);
    const loaded = store.loadPreferences(fallback);
    expect(loaded.config.pitchSize).toBe('xl');

    storage.setItem(
      'no_out_derby_preferences_v1',
      JSON.stringify({ mode: '1v1_ai', arena: 'classic', pitchSize: 'massive_invalid' })
    );
    const sanitized = store.loadPreferences(fallback);
    expect(sanitized.config.pitchSize).toBe('standard');
  });
});
