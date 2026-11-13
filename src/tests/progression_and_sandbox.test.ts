import { describe, expect, it } from 'vitest';
import { createEmptyInput } from '../game/AIController.ts';
import { CareerRecordsStore, StorageLike } from '../game/CareerRecords.ts';
import { MatchState } from '../game/MatchState.ts';
import { ARENA_CONSTANTS, FIXED_DT, MatchConfig } from '../types.ts';

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

describe('Progression, Preferences & Practice Sandbox', () => {
  it('persists career stats and cup trophies across store instances, skips sandbox, and resets cleanly', () => {
    const storage = createMemoryStorage();
    const store = new CareerRecordsStore(storage);

    store.recordCompletedMatch({
      isPracticeSandbox: false,
      winner: 'A',
      scoreA: 3,
      stats: {
        teamAShots: 6,
        teamBShots: 2,
        wallBounces: 12,
        tackles: 4,
        topBallSpeed: 342,
        teamASaves: 2,
        teamBSaves: 1,
        teamASteals: 3,
        teamABankShots: 1,
        teamAOneTimers: 1,
      },
      wonCupTournament: false,
    });

    // Sandbox session must NOT mutate competitive career counters
    store.recordCompletedMatch({
      isPracticeSandbox: true,
      winner: 'A',
      scoreA: 99,
      stats: {
        teamAShots: 50,
        teamBShots: 0,
        wallBounces: 100,
        tackles: 10,
        topBallSpeed: 999,
        teamASaves: 10,
        teamBSaves: 0,
        teamASteals: 10,
        teamABankShots: 20,
        teamAOneTimers: 20,
      },
    });

    // Second competitive win + Derby Cup championship
    store.recordCompletedMatch({
      isPracticeSandbox: false,
      winner: 'A',
      scoreA: 5,
      stats: {
        teamAShots: 8,
        teamBShots: 3,
        wallBounces: 18,
        tackles: 5,
        topBallSpeed: 378,
        teamASaves: 3,
        teamBSaves: 2,
        teamASteals: 2,
        teamABankShots: 2,
        teamAOneTimers: 0,
      },
      wonCupTournament: true,
    });

    // Loss resets currentWinStreak but keeps bestWinStreak
    store.recordCompletedMatch({
      isPracticeSandbox: false,
      winner: 'B',
      scoreA: 1,
      stats: {
        teamAShots: 4,
        teamBShots: 7,
        wallBounces: 9,
        tackles: 2,
        topBallSpeed: 310,
        teamASaves: 1,
        teamBSaves: 3,
        teamASteals: 0,
        teamABankShots: 0,
        teamAOneTimers: 0,
      },
    });

    // Reload from same storage backend to ensure true persistence
    const reloaded = new CareerRecordsStore(storage);
    const rec = reloaded.getRecords();
    expect(rec.matchesPlayed).toBe(3);
    expect(rec.wins).toBe(2);
    expect(rec.losses).toBe(1);
    expect(rec.currentWinStreak).toBe(0);
    expect(rec.bestWinStreak).toBe(2);
    expect(rec.goalsScored).toBe(9);
    expect(rec.mostGoalsInMatch).toBe(5);
    expect(rec.bankShots).toBe(3);
    expect(rec.oneTimerGoals).toBe(1);
    expect(rec.saves).toBe(6);
    expect(rec.steals).toBe(5);
    expect(rec.topBallSpeed).toBe(378);
    expect(rec.cupTrophies).toBe(1);

    const cleared = reloaded.resetRecords();
    expect(cleared.matchesPlayed).toBe(0);
    expect(cleared.cupTrophies).toBe(0);
    expect(new CareerRecordsStore(storage).getRecords().wins).toBe(0);
  });

  it('persists user preferences and repairs invalid or colliding saved values safely', () => {
    const storage = createMemoryStorage();
    const store = new CareerRecordsStore(storage);
    const defaults: MatchConfig = {
      mode: '1v1_ai',
      arena: 'classic',
      controlStyle: 'dribble',
      teamAKit: 'garuda',
      teamBKit: 'cyber',
      difficulty: 'pro',
      durationSeconds: 90,
      mutatorsEnabled: true,
    };

    store.savePreferences(
      {
        ...defaults,
        mode: '3v3_ai',
        arena: 'rooftop',
        teamAKit: 'tarkam',
        teamBKit: 'shadow',
        durationSeconds: 120,
      },
      true
    );

    const restored = new CareerRecordsStore(storage).loadPreferences(defaults);
    expect(restored.config.mode).toBe('3v3_ai');
    expect(restored.config.arena).toBe('rooftop');
    expect(restored.config.teamAKit).toBe('tarkam');
    expect(restored.config.teamBKit).toBe('shadow');
    expect(restored.config.durationSeconds).toBe(120);
    expect(restored.muted).toBe(true);

    // Corrupted JSON or colliding team kits degrade gracefully
    storage.setItem(
      'no_out_derby_preferences_v1',
      JSON.stringify({ teamAKit: 'tarkam', teamBKit: 'tarkam', mode: 'bad_mode' })
    );
    const repaired = new CareerRecordsStore(storage).loadPreferences(defaults);
    expect(repaired.config.mode).toBe('1v1_ai');
    expect(repaired.config.teamAKit).toBe('tarkam');
    expect(repaired.config.teamBKit).not.toBe('tarkam');

    storage.setItem('no_out_derby_career_records_v1', '{broken-json');
    expect(new CareerRecordsStore(storage).getRecords().matchesPlayed).toBe(0);
  });

  it('runs Practice Sandbox with infinite time, manual mutator toggles, wing feed pass, and sparring defender', () => {
    const match = new MatchState();
    match.startMatch({
      mode: 'practice_sandbox',
      arena: 'classic',
      controlStyle: 'dribble',
      difficulty: 'pro',
      durationSeconds: 60,
      mutatorsEnabled: true,
      replayEnabled: true,
    });

    expect(match.isPracticeSandbox()).toBe(true);
    expect(match.config.replayEnabled).toBe(false);
    // P1 + Team A keeper + Team B keeper, zero Team B outfielders initially
    expect(match.players.some((p) => p.humanSlot === 1)).toBe(true);
    expect(match.players.filter((p) => p.role === 'keeper').length).toBe(2);
    expect(match.players.some((p) => p.team === 'B' && p.role === 'outfield')).toBe(false);

    const empty = { p1: createEmptyInput(), p2: createEmptyInput() };
    for (let i = 0; i < 30; i++) match.update(FIXED_DT, empty);
    expect(match.phase).toBe('PLAYING');

    // Simulate > 65 seconds of clock time: sandbox never expires to FULL_TIME
    for (let i = 0; i < 65 * 60; i++) match.update(FIXED_DT, empty);
    expect(match.phase).toBe('PLAYING');
    expect(match.timeRemaining).toBe(60);

    // Trigger Giant Ball manually -> stays active > 25 seconds until toggled off
    const startEvs = match.triggerSandboxMutator('giant_ball');
    expect(startEvs.some((e) => e.type === 'mutator_start' && e.mutator === 'giant_ball')).toBe(true);
    expect(match.balls[0].radius).toBe(ARENA_CONSTANTS.BASE_BALL_RADIUS * 2);

    for (let i = 0; i < 25 * 60; i++) match.update(FIXED_DT, empty);
    expect(match.mutators.getActive()?.type).toBe('giant_ball');

    // Calling same mutator toggles it off cleanly
    const endEvs = match.triggerSandboxMutator('giant_ball');
    expect(endEvs.some((e) => e.type === 'mutator_end' && e.mutator === 'giant_ball')).toBe(true);
    expect(match.mutators.getActive()).toBeNull();
    expect(match.balls[0].radius).toBe(ARENA_CONSTANTS.BASE_BALL_RADIUS);

    // Feed pass launches incoming ball toward P1 for One-Timer practice
    const p1 = match.players.find((p) => p.humanSlot === 1)!;
    match.triggerSandboxFeedPass();
    const fedBall = match.balls[0];
    expect(fedBall.carrierId).toBeNull();
    expect(fedBall.lastTouchPlayerId).toBe(999);
    expect(Math.hypot(fedBall.vx, fedBall.vy)).toBeGreaterThan(140);
    // Velocity points toward P1's vicinity
    const dot = (p1.x - fedBall.x) * fedBall.vx + (p1.y - fedBall.y) * fedBall.vy;
    expect(dot).toBeGreaterThan(0);

    // Toggle Sparring Defender ON & OFF
    expect(match.toggleSandboxDefender()).toBe(true);
    expect(match.players.some((p) => p.team === 'B' && p.role === 'outfield')).toBe(true);
    expect(match.toggleSandboxDefender()).toBe(false);
    expect(match.players.some((p) => p.team === 'B' && p.role === 'outfield')).toBe(false);

    // Reset ball returns to center
    match.resetSandboxBall();
    expect(match.balls[0].x).toBe(match.bounds.centerX);
    expect(match.balls[0].y).toBe(match.bounds.centerY);
  });

  it('tracks detailed Team A saves, steals, bank shots, and one-timers in MatchStats', () => {
    const match = new MatchState();
    match.startMatch({
      mode: '1v1_ai',
      arena: 'classic',
      controlStyle: 'dribble',
      difficulty: 'rookie',
      durationSeconds: 90,
      mutatorsEnabled: false,
      replayEnabled: false,
    });
    const empty = { p1: createEmptyInput(), p2: createEmptyInput() };
    for (let i = 0; i < 65; i++) match.update(FIXED_DT, empty);

    // Trigger a Team A keeper save
    match.balls[0].x = match.bounds.left + 22;
    match.balls[0].y = match.bounds.centerY;
    match.balls[0].vx = -220;
    match.balls[0].vy = 0;
    match.balls[0].lastTouchTeam = 'B';
    for (let i = 0; i < 6; i++) match.update(FIXED_DT, empty);
    expect(match.stats.teamASaves).toBeGreaterThanOrEqual(1);

    // Trigger a Team A Bank Shot goal
    for (const p of match.players) {
      if (p.team === 'B') {
        p.x = match.bounds.centerX - 80;
        p.y = match.bounds.bottom - 30;
      }
    }
    match.balls[0].x = match.bounds.right - 85;
    match.balls[0].y = match.bounds.top + match.balls[0].radius + 1;
    match.balls[0].vx = 185;
    match.balls[0].vy = -250;
    for (let i = 0; i < 45; i++) {
      if (match.phase !== 'PLAYING') break;
      match.update(FIXED_DT, empty);
    }
    expect(match.scoreA).toBe(1);
    expect(match.stats.teamABankShots).toBe(1);
  });
});
