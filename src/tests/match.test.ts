import { describe, expect, it } from 'vitest';
import { createEmptyInput, MatchState } from '../game/MatchState.ts';
import { FIXED_DT, GameMode } from '../types.ts';

describe('MatchState', () => {
  it('spawns correct player and keeper setups across all 5 game modes', () => {
    const match = new MatchState();

    const cases: Array<{ mode: GameMode; totalPlayers: number; p1Count: number; p2Count: number; keepers: number }> = [
      { mode: '1v1_ai', totalPlayers: 4, p1Count: 1, p2Count: 0, keepers: 2 },
      { mode: '1v1_local', totalPlayers: 4, p1Count: 1, p2Count: 1, keepers: 2 },
      { mode: '2v2_ai', totalPlayers: 4, p1Count: 1, p2Count: 0, keepers: 0 },
      { mode: '2v2_local', totalPlayers: 4, p1Count: 1, p2Count: 1, keepers: 0 },
      { mode: '2v2_coop', totalPlayers: 4, p1Count: 1, p2Count: 1, keepers: 0 },
    ];

    for (const c of cases) {
      match.startMatch({
        mode: c.mode,
        arena: 'classic',
        difficulty: 'pro',
        durationSeconds: 90,
        mutatorsEnabled: true,
      });
      expect(match.players.length).toBe(c.totalPlayers);
      expect(match.players.filter((p) => p.humanSlot === 1).length).toBe(c.p1Count);
      expect(match.players.filter((p) => p.humanSlot === 2).length).toBe(c.p2Count);
      expect(match.players.filter((p) => p.role === 'keeper').length).toBe(c.keepers);
      expect(match.balls.length).toBe(1);
    }
  });

  it('transitions into Golden Goal when tied at 0:00 and finishes cleanly on first goal', () => {
    const match = new MatchState();
    match.startMatch({
      mode: '1v1_local',
      arena: 'classic',
      difficulty: 'pro',
      durationSeconds: 60,
      mutatorsEnabled: false,
      replayEnabled: false,
    });

    const empty = { p1: createEmptyInput(), p2: createEmptyInput() };

    // Finish kickoff
    for (let i = 0; i < 60; i++) {
      match.update(FIXED_DT, empty);
    }
    expect(match.phase).toBe('PLAYING');

    // Fast-forward to end of 60s with 0-0 score
    match.timeRemaining = FIXED_DT * 2;
    for (let i = 0; i < 5; i++) {
      match.update(FIXED_DT, empty);
    }
    expect(match.isGoldenGoal).toBe(true);
    expect(match.phase).toBe('GOLDEN_GOAL_INTRO');

    // Advance past Golden Goal intro
    for (let i = 0; i < 70; i++) {
      match.update(FIXED_DT, empty);
    }
    expect(match.phase).toBe('PLAYING');

    // Score for Team A in right goal
    match.balls[0].x = match.bounds.right + 4;
    match.balls[0].y = match.bounds.centerY;
    match.update(FIXED_DT, empty);

    expect(match.scoreA).toBe(1);
    expect(match.phase).toBe('GOAL_CELEBRATION');

    // Finish celebration -> FULL_TIME
    for (let i = 0; i < 40; i++) {
      match.update(FIXED_DT, empty);
    }
    expect(match.phase).toBe('FULL_TIME');
    expect(match.winner).toBe('A');

    // Rematch resets everything cleanly
    match.rematch();
    expect(match.phase).toBe('KICKOFF');
    expect(match.scoreA).toBe(0);
    expect(match.scoreB).toBe(0);
    expect(match.isGoldenGoal).toBe(false);
    expect(match.timeRemaining).toBe(60);
  });

  it('supports manual teammate switch in 2v2 mode', () => {
    const match = new MatchState();
    match.startMatch({
      mode: '2v2_ai',
      arena: 'classic',
      difficulty: 'pro',
      durationSeconds: 90,
      mutatorsEnabled: false,
    });

    const empty = { p1: createEmptyInput(), p2: createEmptyInput() };
    for (let i = 0; i < 60; i++) match.update(FIXED_DT, empty);

    const initialHuman = match.players.find((p) => p.humanSlot === 1);
    expect(initialHuman).toBeDefined();

    match.update(FIXED_DT, {
      p1: { ...createEmptyInput(), switchJustPressed: true },
      p2: createEmptyInput(),
    });

    const newHuman = match.players.find((p) => p.humanSlot === 1);
    expect(newHuman).toBeDefined();
    expect(newHuman?.id).not.toBe(initialHuman?.id);
    expect(newHuman?.team).toBe('A');
  });

  it('never auto-switches player focus when ball moves behind human in 2v2/3v3', () => {
    for (const mode of ['2v2_ai', '3v3_ai'] as const) {
      const match = new MatchState();
      match.startMatch({
        mode,
        arena: 'classic',
        difficulty: 'pro',
        durationSeconds: 90,
        mutatorsEnabled: false,
      });

      const empty = { p1: createEmptyInput(), p2: createEmptyInput() };
      for (let i = 0; i < 60; i++) match.update(FIXED_DT, empty);

      const teamAOut = match.players.filter((p) => p.team === 'A' && p.role === 'outfield');
      const human = teamAOut.find((p) => p.humanSlot === 1)!;
      const botMate = teamAOut.find((p) => p.humanSlot === null)!;

      // Place human far upfield, and put ball right next to bot teammate behind human
      human.x = match.bounds.centerX + 120;
      human.y = match.bounds.centerY;
      botMate.x = match.bounds.centerX - 80;
      botMate.y = match.bounds.centerY;
      match.balls[0].x = botMate.x + 14;
      match.balls[0].y = botMate.y;
      match.balls[0].vx = -40;
      match.balls[0].vy = 0;

      for (let i = 0; i < 30; i++) {
        match.update(FIXED_DT, empty);
      }

      expect(human.humanSlot).toBe(1);
      expect(botMate.humanSlot).toBeNull();
    }
  });

  it('completes a full intensive 90s AI-vs-AI simulation with mutators without NaNs or out-of-bounds bugs', () => {
    const match = new MatchState(() => 0.42);
    match.startMatch({
      mode: '2v2_ai',
      arena: 'classic',
      difficulty: 'tarkam',
      durationSeconds: 90,
      mutatorsEnabled: true,
      replayEnabled: false,
    });
    // Let AI control all 4 players for automated soak test
    for (const p of match.players) {
      p.humanSlot = null;
    }

    const empty = { p1: createEmptyInput(), p2: createEmptyInput() };
    let frames = 0;
    const maxFrames = 140 * 60; // Up to 140s including celebration/golden goal

    while (match.phase !== 'FULL_TIME' && frames < maxFrames) {
      match.update(FIXED_DT, empty);
      frames++;

      for (const b of match.balls) {
        expect(Number.isFinite(b.x)).toBe(true);
        expect(Number.isFinite(b.y)).toBe(true);
        expect(b.x).toBeGreaterThanOrEqual(match.bounds.left - match.bounds.goalDepth);
        expect(b.x).toBeLessThanOrEqual(match.bounds.right + match.bounds.goalDepth);
        expect(b.y).toBeGreaterThanOrEqual(match.bounds.top);
        expect(b.y).toBeLessThanOrEqual(match.bounds.bottom);
      }
      for (const p of match.players) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
        expect(p.x).toBeGreaterThanOrEqual(match.bounds.left);
        expect(p.x).toBeLessThanOrEqual(match.bounds.right);
        expect(p.y).toBeGreaterThanOrEqual(match.bounds.top);
        expect(p.y).toBeLessThanOrEqual(match.bounds.bottom);
      }

      // If tied into Golden Goal and neither AI scores within 25s, force a decisive shot
      if (match.isGoldenGoal && frames > 120 * 60 && match.phase === 'PLAYING') {
        match.balls[0].x = match.bounds.right + 4;
        match.balls[0].y = match.bounds.centerY;
      }
    }

    expect(match.phase).toBe('FULL_TIME');
    expect(match.winner).not.toBeNull();
    expect(match.stats.teamAShots + match.stats.teamBShots).toBeGreaterThan(0);
    expect(match.stats.wallBounces).toBeGreaterThan(0);
  });
});
