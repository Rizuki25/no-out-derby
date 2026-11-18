import { describe, expect, it } from 'vitest';
import { InputManager } from '../game/InputManager.ts';
import { createEmptyInput, MatchState } from '../game/MatchState.ts';
import { createArenaBounds } from '../engine/ArenaGeometry.ts';
import { createDefaultPhysicsParams, PhysicsEngine } from '../engine/PhysicsEngine.ts';
import { drawPixelText } from '../render/PixelFont.ts';
import { ARENA_CONSTANTS, Ball, FIXED_DT, GameEvent, MatchConfig, Player, PlayerInput } from '../types.ts';
import { MutatorManager } from '../game/MutatorManager.ts';
import { DerbyCupState } from '../game/DerbyCup.ts';
import { ParticleSystem } from '../render/ParticleSystem.ts';
import { CareerRecordsStore } from '../game/CareerRecords.ts';

const empty = () => ({ p1: createEmptyInput(), p2: createEmptyInput() });

function makeBall(overrides: Partial<Ball> = {}): Ball {
  return {
    id: 1,
    x: ARENA_CONSTANTS.CENTER_X,
    y: ARENA_CONSTANTS.CENTER_Y,
    vx: 0,
    vy: 0,
    z: 0,
    vz: 0,
    radius: ARENA_CONSTANTS.BASE_BALL_RADIUS,
    mass: 1,
    spin: 0,
    rollAngle: 0,
    lastTouchTeam: null,
    lastTouchPlayerId: null,
    lastKickPower: 0,
    untouchedTimer: 0,
    hotPotatoBeepAccum: 0,
    isExtraBall: false,
    ...overrides,
  };
}

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 1,
    team: 'A',
    role: 'outfield',
    humanSlot: 1,
    x: 150,
    y: ARENA_CONSTANTS.CENTER_Y,
    vx: 0,
    vy: 0,
    radius: ARENA_CONSTANTS.PLAYER_RADIUS,
    facingX: 1,
    facingY: 0,
    isCharging: false,
    chargeTime: 0,
    kickSwingTimer: 0,
    kickSwingPower: 0,
    kickSwingDirX: 1,
    kickSwingDirY: 0,
    dashTimer: 0,
    dashCooldown: 0,
    dashDirX: 1,
    dashDirY: 0,
    stunTimer: 0,
    kickContactCooldown: 0,
    pickupCooldown: 0,
    animState: 'idle',
    animTime: 0,
    aiState: 'CHASE_BALL',
    aiDecisionTimer: 0,
    aiTargetX: 150,
    aiTargetY: ARENA_CONSTANTS.CENTER_Y,
    aiWantCharge: false,
    aiChargeTarget: 0,
    aiWantDash: false,
    ...overrides,
  };
}

function stubGamepad(pressed: boolean[]) {
  const gp = { connected: true, axes: [0, 0, 0, 0], buttons: pressed.map((p) => ({ pressed: p })) };
  Object.defineProperty(globalThis, 'navigator', {
    value: { getGamepads: () => [gp], maxTouchPoints: 0 },
    configurable: true,
  });
  return gp;
}

describe('Gamepad input', () => {
  it('keeps button edges alive for the gameplay poll that runs after the menu poll', () => {
    const pressed = new Array(16).fill(false);
    const gp = stubGamepad(pressed);
    const sync = () => {
      gp.buttons = pressed.map((p) => ({ pressed: p }));
    };
    const input = new InputManager();
    sync();
    input.getMenuActions();
    input.getPlayerInputs(false);
    input.endFrame();

    pressed[0] = true;
    sync();
    input.getMenuActions();
    expect(input.getPlayerInputs(false).p1.kickHeld).toBe(true);
    input.endFrame();

    pressed[0] = false;
    sync();
    input.getMenuActions();
    expect(input.getPlayerInputs(false).p1.kickJustReleased).toBe(true);
    input.endFrame();

    pressed[1] = true;
    sync();
    input.getMenuActions();
    expect(input.getPlayerInputs(false).p1.dashJustPressed).toBe(true);
    input.endFrame();

    sync();
    input.getMenuActions();
    const repeat = input.getPlayerInputs(false).p1;
    expect(repeat.dashJustPressed).toBe(false);
    expect(repeat.kickJustReleased).toBe(false);
  });

  it('uses smooth 360 radial deadzone, stick menu navigation, analog triggers, POV hat, and rumble', () => {
    const pressed = new Array(16).fill(false);
    const rumbleCalls: unknown[] = [];
    const gp = {
      connected: true,
      index: 0,
      id: 'Xbox Wireless Controller (STANDARD GAMEPAD)',
      mapping: 'standard',
      axes: [0.95, -0.16, 0, 0],
      buttons: pressed.map((p) => ({ pressed: p, value: p ? 1 : 0 })),
      vibrationActuator: {
        playEffect: (type: string, opts: unknown) => {
          rumbleCalls.push({ type, opts });
          return Promise.resolve('complete');
        },
      },
    };
    const phantomHid = {
      connected: true,
      index: 0,
      id: 'Touchscreen digitizer',
      mapping: '',
      axes: [],
      buttons: [],
    };
    Object.defineProperty(globalThis, 'navigator', {
      value: { getGamepads: () => [phantomHid, gp], maxTouchPoints: 0 },
      configurable: true,
    });

    const input = new InputManager();
    const p1 = input.getPlayerInputs(false).p1;
    // Slight -0.16 vertical tilt must NOT snap to 0 like old per-axis deadzone
    expect(p1.moveX).toBeGreaterThan(0.9);
    expect(p1.moveY).toBeLessThan(-0.12);
    expect(input.getConnectedGamepads()).toHaveLength(1);
    expect(input.getConnectedGamepads()[0].shortName).toBe('XBOX PAD');
    expect(input.drainGamepadNotices()[0]).toEqual({
      connected: true,
      slot: 1,
      shortName: 'XBOX PAD',
    });

    // Stick inside deadzone returns exact 0
    gp.axes = [0.06, -0.05, 0, 0];
    input.endFrame();
    expect(input.getPlayerInputs(false).p1.moveX).toBe(0);
    expect(input.getPlayerInputs(false).p1.moveY).toBe(0);

    // Analog left stick tilt generates single-edge menu navigation
    gp.axes = [0, -0.8, 0, 0];
    input.endFrame();
    expect(input.getMenuActions().up).toBe(true);
    input.endFrame();
    expect(input.getMenuActions().up).toBe(false);

    // Analog RT (buttons[7].value > 0.35) triggers kick & LT (buttons[6]) triggers dash
    gp.axes = [0, 0, 0, 0];
    gp.buttons[7] = { pressed: false, value: 0.75 };
    gp.buttons[6] = { pressed: false, value: 0.8 };
    input.endFrame();
    const triggerIn = input.getPlayerInputs(false).p1;
    expect(triggerIn.kickHeld).toBe(true);
    expect(triggerIn.dashJustPressed).toBe(true);

    // Non-standard DirectInput POV hat switch on axes[9]
    gp.mapping = '';
    gp.buttons[7] = { pressed: false, value: 0 };
    gp.buttons[6] = { pressed: false, value: 0 };
    gp.axes = [0, 0, 0, 0, 0, 0, 0, 0, 0, -0.428]; // Right on DirectInput hat
    input.endFrame();
    const hatIn = input.getPlayerInputs(false).p1;
    expect(hatIn.moveX).toBeCloseTo(1, 2);
    expect(hatIn.moveY).toBeCloseTo(0, 2);

    // Rumble triggers safely
    input.triggerRumble(1, 90, 0.4, 0.3);
    expect(rumbleCalls.length).toBe(1);
  });

  it('scales movement throttle smoothly on partial analog stick tilt in PhysicsEngine', () => {
    const physics = new PhysicsEngine();
    const bounds = createArenaBounds();
    const params = createDefaultPhysicsParams();

    const gentle = makePlayer({ id: 1, x: 150, y: 120 });
    const sprint = makePlayer({ id: 2, x: 150, y: 180 });
    const inputs = new Map<number, PlayerInput>();
    for (let i = 0; i < 40; i++) {
      inputs.set(1, { ...createEmptyInput(), moveX: 0.35, moveY: 0 });
      inputs.set(2, { ...createEmptyInput(), moveX: 1.0, moveY: 0 });
      physics.step(FIXED_DT, [], [gentle, sprint], inputs, bounds, params, true);
    }

    expect(gentle.vx).toBeGreaterThan(35);
    expect(gentle.vx).toBeLessThan(sprint.vx * 0.7);
  });
});

describe('Match result recording', () => {
  it('still records the match when the player skips the replay that ends the game', () => {
    // Regression: skipReplay() moves the match to FULL_TIME during input handling, which made the
    // frame's `simPaused` check true. The result write lived inside the `!simPaused` branch, so
    // skipping a match-ending replay silently dropped the whole match from career records.
    const config: MatchConfig = {
      mode: '1v1_ai',
      arena: 'classic',
      pitchSize: 'standard',
      difficulty: 'pro',
      durationSeconds: 60,
      mutatorsEnabled: false,
      replayEnabled: true,
      controlStyle: 'dribble',
      displayMode: 'auto',
      teamAKit: 'garuda',
      teamBKit: 'cyber',
    };
    const pausedPhases = ['MENU', 'PAUSED', 'FULL_TIME', 'PERK_SELECT', 'CUP_CHAMPION'];

    const simulate = (skipReplay: boolean) => {
      const match = new MatchState(() => 0.5);
      match.startMatch(config);
      const career = new CareerRecordsStore(null);
      let recorded = false;
      const recordCompletedIfNeeded = () => {
        if (match.phase === 'FULL_TIME' && !recorded) {
          career.recordCompletedMatch({
            isPracticeSandbox: match.isPracticeSandbox(),
            winner: match.winner,
            scoreA: match.scoreA,
            stats: match.stats,
          });
          recorded = true;
        }
      };

      // A golden-goal winner whose replay ends the match.
      match.phase = 'REPLAY';
      match.isGoldenGoal = true;
      match.scoreA = 2;
      match.scoreB = 1;
      match.winner = 'A';
      (match as unknown as { pendingFullTimeAfterGoal: boolean }).pendingFullTimeAfterGoal = true;

      // Read through a function so TypeScript does not keep the literal 'REPLAY' narrowing:
      // skipReplay()/update() change the phase during the loop.
      const phase = () => match.phase as string;

      for (let frame = 0; frame < 900; frame++) {
        if (skipReplay && frame === 0 && phase() === 'REPLAY') {
          match.skipReplay();
        }
        const simPaused = pausedPhases.includes(phase());
        if (!simPaused && phase() === 'REPLAY') {
          match.update(FIXED_DT, empty());
        }
        // Mirrors main.ts: recording happens every fixed frame, outside the simPaused branches.
        recordCompletedIfNeeded();
        if (phase() === 'FULL_TIME' && frame > 3) break;
      }
      return career.getRecords();
    };

    const skipped = simulate(true);
    expect(skipped.matchesPlayed).toBe(1);
    expect(skipped.wins).toBe(1);
    expect(skipped.goalsScored).toBe(2);

    const played = simulate(false);
    expect(played).toMatchObject({ matchesPlayed: 1, wins: 1, goalsScored: 2 });
  });
});

describe('Derby Cup restart', () => {
  it('restartCurrentRound keeps round and perks while rematch starts a fresh cup', () => {
    const match = new MatchState(() => 0.5);
    match.startMatch({
      mode: 'derby_cup_1v1',
      arena: 'classic',
      difficulty: 'pro',
      durationSeconds: 60,
      mutatorsEnabled: false,
      replayEnabled: false,
    });
    match.scoreA = 3;
    match.scoreB = 0;
    match.cup.recordRoundScore(3, 0);
    match.winner = 'A';
    match.advanceFromCupResult();
    expect(match.phase).toBe('PERK_SELECT');
    match.pickCupPerk(0);
    expect(match.cup.currentRoundIndex).toBe(1);
    const perks = [...match.cup.earnedPerks];

    match.restartCurrentRound();
    expect(match.cup.currentRoundIndex).toBe(1);
    expect(match.cup.earnedPerks).toEqual(perks);
    expect(match.config.arena).toBe('concrete');
    expect(match.phase).toBe('KICKOFF');

    match.rematch();
    expect(match.cup.currentRoundIndex).toBe(0);
    expect(match.cup.earnedPerks).toEqual([]);
  });

  it('behaves like a normal rematch outside the cup', () => {
    const match = new MatchState(() => 0.5);
    match.startMatch({
      mode: '1v1_ai',
      arena: 'rooftop',
      difficulty: 'pro',
      durationSeconds: 90,
      mutatorsEnabled: false,
      replayEnabled: false,
    });
    for (let i = 0; i < 60; i++) match.update(FIXED_DT, empty());
    match.scoreA = 2;
    match.restartCurrentRound();
    expect(match.phase).toBe('KICKOFF');
    expect(match.scoreA).toBe(0);
    expect(match.timeRemaining).toBe(90);
    expect(match.cup.active).toBe(false);
  });
});

describe('Shot statistics', () => {
  it('does not count keeper clears as shots', () => {
    const physics = new PhysicsEngine();
    const bounds = createArenaBounds(1.0, 'classic');
    const params = createDefaultPhysicsParams('classic');
    const keeper = makePlayer({
      id: 1,
      role: 'keeper',
      radius: ARENA_CONSTANTS.KEEPER_RADIUS,
      x: bounds.left + 10,
      y: bounds.centerY,
    });
    const ball = makeBall({ x: keeper.x + 8, y: bounds.centerY, vx: -220 });

    const res = physics.step(FIXED_DT, [ball], [keeper], new Map(), bounds, params, true);
    const kicks = res.events.filter((e) => e.type === 'kick');
    expect(kicks.length).toBeGreaterThan(0);
    expect(kicks.every((e) => e.type === 'kick' && e.isShot === false)).toBe(true);
  });

  it('still counts a real kick swing as a shot', () => {
    const physics = new PhysicsEngine();
    const bounds = createArenaBounds(1.0, 'classic');
    const params = createDefaultPhysicsParams('classic');
    const striker = makePlayer({
      id: 1,
      x: 200,
      y: bounds.centerY,
      facingX: 1,
      kickSwingTimer: 0.13,
      kickSwingPower: 0.8,
    });
    const ball = makeBall({ x: 210, y: bounds.centerY });

    const res = physics.step(FIXED_DT, [ball], [striker], new Map(), bounds, params, true);
    const kicks = res.events.filter((e) => e.type === 'kick');
    expect(kicks.length).toBe(1);
    expect(kicks[0].type === 'kick' && kicks[0].isShot).toBe(true);
  });

  it('aggregates match shot stats from shot attempts only', () => {
    const match = new MatchState(() => 0.5);
    match.startMatch({
      mode: '3v3_ai',
      arena: 'classic',
      difficulty: 'tarkam',
      durationSeconds: 120,
      mutatorsEnabled: false,
      replayEnabled: false,
      controlStyle: 'classic',
    });

    let shotsA = 0;
    let shotsB = 0;
    let nonShotKicks = 0;
    for (let i = 0; i < 60 * 40; i++) {
      for (const ev of match.update(FIXED_DT, empty())) {
        if (ev.type !== 'kick') continue;
        if (ev.isShot === false) {
          nonShotKicks++;
          continue;
        }
        if (ev.team === 'A') shotsA++;
        else shotsB++;
      }
      if (match.phase === 'FULL_TIME') break;
    }

    expect(nonShotKicks).toBeGreaterThan(0);
    expect(match.stats.teamAShots).toBe(shotsA);
    expect(match.stats.teamBShots).toBe(shotsB);
  });
});

describe('Multi-ball goal attribution', () => {
  it('reads shot power from the ball that actually scored', () => {
    const match = new MatchState(() => 0.5);
    match.startMatch({
      mode: '1v1_ai',
      arena: 'classic',
      difficulty: 'pro',
      durationSeconds: 90,
      mutatorsEnabled: false,
      replayEnabled: false,
    });
    for (let i = 0; i < 60; i++) match.update(FIXED_DT, empty());
    expect(match.phase).toBe('PLAYING');

    // Primary ball sits still and was never kicked; the extra ball is a full-power rocket into goal.
    match.balls[0].x = match.bounds.centerX;
    match.balls[0].y = match.bounds.centerY;
    match.balls[0].vx = 0;
    match.balls[0].vy = 0;
    match.balls[0].lastKickPower = 0;
    const extra: Ball = makeBall({
      id: 100,
      x: match.bounds.right + 4,
      y: match.bounds.centerY,
      vx: 200,
      lastKickPower: 0.9,
      isExtraBall: true,
    });
    match.balls.push(extra);

    const events = match.update(FIXED_DT, empty());
    const goal = events.find((e): e is Extract<GameEvent, { type: 'goal' }> => e.type === 'goal');
    expect(match.scoreA).toBe(1);
    expect(goal?.highlightTag).toBe('ROCKET!');
  });
});

describe('Kickoff countdown', () => {
  it('emits a final beep before the kickoff whistle', () => {
    const match = new MatchState(() => 0.5);
    const startEvents = match.startMatch({
      mode: '1v1_ai',
      arena: 'classic',
      difficulty: 'pro',
      durationSeconds: 90,
      mutatorsEnabled: false,
      replayEnabled: false,
    });
    const beeps = [...startEvents];
    for (let i = 0; i < 80 && match.phase === 'KICKOFF'; i++) {
      beeps.push(...match.update(FIXED_DT, empty()));
    }
    const countdown = beeps.filter(
      (e): e is Extract<GameEvent, { type: 'countdown_beep' }> => e.type === 'countdown_beep'
    );
    expect(countdown.length).toBeGreaterThan(1);
    expect(countdown[countdown.length - 1].final).toBe(true);
    expect(countdown.slice(0, -1).every((b) => b.final === false)).toBe(true);
    expect(beeps.some((e) => e.type === 'whistle' && e.kind === 'kickoff')).toBe(true);
  });
});

describe('Pixel font coverage', () => {
  it('draws the caret, tilde, and pipe glyphs used by the HUD', () => {
    let painted = 0;
    const ctx = {
      fillStyle: '',
      fillRect: () => {
        painted++;
      },
    } as unknown as CanvasRenderingContext2D;

    for (const ch of ['^', '~', '|']) {
      painted = 0;
      drawPixelText(ctx, ch, 0, 0, '#ffffff');
      expect(painted, `glyph "${ch}" should render pixels`).toBeGreaterThan(0);
    }
  });
});

describe('Medium-priority fixes', () => {
  it('activates at most one scheduled mutator per frame', () => {
    const mutators = new MutatorManager(() => 0.4);
    mutators.reset(90, true, 'classic', 'standard');
    const params = createDefaultPhysicsParams('classic');
    const bounds = createArenaBounds(1.0, 'classic');
    const balls: Ball[] = [makeBall({})];
    const events: GameEvent[] = [];

    // Jump straight past both scheduled slots (second 30 and 60) in a single update.
    mutators.update(FIXED_DT, 95, false, balls, params, bounds, events);

    const starts = events.filter((e) => e.type === 'mutator_start');
    const ends = events.filter((e) => e.type === 'mutator_end');
    expect(starts.length).toBe(1);
    expect(ends.length).toBe(0);
    expect(mutators.getActive()).not.toBeNull();
  });

  it('never offers a perk twice or one that is already owned', () => {
    const cup = new DerbyCupState(() => 0.5);
    cup.startNewCup();
    cup.earnedPerks = ['turbo_boots', 'iron_leg', 'quick_dash', 'banana_curve'];

    const offer = cup.preparePerkOffer();
    expect(new Set(offer).size).toBe(offer.length);
    expect(offer.every((p) => !cup.earnedPerks.includes(p))).toBe(true);
  });

  it('caps particle count under burst-heavy effects', () => {
    const particles = new ParticleSystem();
    for (let i = 0; i < 200; i++) {
      particles.emitExplosion(100, 100);
      particles.emitGoalConfetti(100, 100, 'A');
    }
    const internals = particles as unknown as { particles: unknown[]; shockwaves: unknown[] };
    expect(internals.particles.length).toBeLessThanOrEqual(420);
    expect(internals.shockwaves.length).toBeLessThanOrEqual(12);
  });

  it('replays identically when the same seed is used', () => {
    const makeSeeded = () => {
      let seed = 12345;
      return () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
      };
    };

    const run = () => {
      const match = new MatchState(makeSeeded());
      match.startMatch({
        mode: '3v3_ai',
        arena: 'rooftop',
        pitchSize: 'large',
        difficulty: 'tarkam',
        durationSeconds: 90,
        mutatorsEnabled: true,
        replayEnabled: false,
        controlStyle: 'dribble',
      });
      for (let i = 0; i < 600; i++) match.update(FIXED_DT, empty());
      return {
        score: [match.scoreA, match.scoreB],
        balls: match.balls.map((b) => [b.x, b.y]),
        players: match.players.map((p) => [p.x, p.y]),
      };
    };

    expect(run()).toEqual(run());
  });

  it('round-trips replayEnabled through saved preferences', () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
    };
    const store = new CareerRecordsStore(storage);
    const base: MatchConfig = {
      mode: '1v1_ai',
      arena: 'classic',
      pitchSize: 'standard',
      difficulty: 'pro',
      durationSeconds: 90,
      mutatorsEnabled: true,
      replayEnabled: false,
      controlStyle: 'classic',
    };

    store.savePreferences({ ...base, replayEnabled: false }, false);
    // Load with defaults that say "true" so only the persisted value can produce false.
    expect(store.loadPreferences({ ...base, replayEnabled: true }).config.replayEnabled).toBe(false);
  });
});

describe('Mobile touch kick hold & release reliability', () => {
  it('fires touch kick release reliably across stray secondary touches, failed pointer capture, and off-button window release', () => {
    const createMockTarget = () => {
      const listeners = new Map<string, Set<(ev: Event) => void>>();
      const classes = new Set<string>();
      const style: Record<string, string> = {};
      return {
        style,
        dataset: {},
        textContent: '',
        innerWidth: 800,
        innerHeight: 450,
        querySelector: () => null,
        classList: {
          add: (c: string) => classes.add(c),
          remove: (c: string) => classes.delete(c),
          toggle: (c: string, force?: boolean) => {
            if (force === undefined) {
              if (classes.has(c)) classes.delete(c);
              else classes.add(c);
            } else if (force) classes.add(c);
            else classes.delete(c);
          },
          contains: (c: string) => classes.has(c),
        },
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 120, height: 120 }),
        setPointerCapture: () => {
          throw new Error('capture rejected');
        },
        addEventListener: (type: string, fn: (ev: Event) => void) => {
          let set = listeners.get(type);
          if (!set) {
            set = new Set();
            listeners.set(type, set);
          }
          set.add(fn);
        },
        removeEventListener: (type: string, fn: (ev: Event) => void) => {
          listeners.get(type)?.delete(fn);
        },
        dispatchEvent: (ev: Event & { currentTarget?: unknown }) => {
          for (const fn of [...(listeners.get(ev.type) ?? [])]) {
            fn({ ...ev, currentTarget: ev.currentTarget ?? undefined } as Event);
          }
          return true;
        },
      };
    };

    const winTarget = createMockTarget();
    const elements: Record<string, ReturnType<typeof createMockTarget>> = {
      'touch-stick-base': createMockTarget(),
      'touch-stick-knob': createMockTarget(),
      'touch-kick': createMockTarget(),
      'touch-dash': createMockTarget(),
      'touch-switch': createMockTarget(),
    };
    const origWindow = (globalThis as { window?: unknown }).window;
    const origDocument = (globalThis as { document?: unknown }).document;
    const origNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

    Object.defineProperty(globalThis, 'window', { value: winTarget, configurable: true });
    Object.defineProperty(globalThis, 'document', {
      value: {
        documentElement: createMockTarget(),
        getElementById: (id: string) => elements[id] ?? null,
        querySelectorAll: () => [],
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: { getGamepads: () => [], maxTouchPoints: 5 },
      configurable: true,
    });

    const input = new InputManager();
    try {
      input.syncMobileHud({
        visibility: {
          showOverlay: true,
          showMenuBar: false,
          showGameplayControls: true,
          showSwitchButton: false,
          showTacticButton: false,
          showReplaySkip: false,
          showSandboxBar: false,
        },
        controlStyle: 'dribble',
        displayMode: 'auto',
        muted: false,
        kickChargeRatio: 0,
        dashOnCooldown: false,
        portraitDeck: false,
        isFullscreen: false,
        isPortrait: false,
      });

      const makePtr = (type: string, pointerId: number) => ({
        type,
        pointerId,
        pointerType: 'touch',
        cancelable: true,
        clientX: 0,
        clientY: 0,
        preventDefault: () => undefined,
        stopPropagation: () => undefined,
      });

      const kickEl = elements['touch-kick'];
      // Hold with finger 1 (even if setPointerCapture throws, kickHeld must still engage)
      kickEl.dispatchEvent({ ...makePtr('pointerdown', 1), currentTarget: kickEl } as unknown as Event);
      expect(input.getPlayerInputs(false).p1.kickHeld).toBe(true);
      input.endFrame();

      // Secondary stray finger grazing kick button must not steal ownership or drop hold
      kickEl.dispatchEvent({ ...makePtr('pointerdown', 2), currentTarget: kickEl } as unknown as Event);
      winTarget.dispatchEvent(makePtr('pointerup', 2) as unknown as Event);
      expect(input.getPlayerInputs(false).p1.kickHeld).toBe(true);
      expect(input.getPlayerInputs(false).p1.kickJustReleased).toBe(false);
      input.endFrame();

      // Finger 1 sliding outside button fires pointerup on window -> must still fire kickJustReleased
      winTarget.dispatchEvent(makePtr('pointerup', 1) as unknown as Event);
      const released = input.getPlayerInputs(false).p1;
      expect(released.kickHeld).toBe(false);
      expect(released.kickJustReleased).toBe(true);
    } finally {
      input.destroy();
      Object.defineProperty(globalThis, 'window', { value: origWindow, configurable: true });
      Object.defineProperty(globalThis, 'document', { value: origDocument, configurable: true });
      if (origNav) Object.defineProperty(globalThis, 'navigator', origNav);
    }
  });

  it('still executes charged kick in PhysicsEngine if kickHeld drops without kickJustReleased', () => {
    const engine = new PhysicsEngine();
    const bounds = createArenaBounds(1.0);
    const params = createDefaultPhysicsParams();
    params.controlStyle = 'dribble';

    const shooter = makePlayer({
      id: 1,
      x: 240,
      y: ARENA_CONSTANTS.CENTER_Y,
      facingX: 1,
      facingY: 0,
      isCharging: true,
      chargeTime: 0.5,
    });
    const ball = makeBall({ x: 252, y: ARENA_CONSTANTS.CENTER_Y, carrierId: shooter.id });

    const res = engine.step(
      FIXED_DT,
      [ball],
      [shooter],
      new Map([[1, { ...createEmptyInput(), moveX: 1, kickHeld: false, kickJustReleased: false }]]),
      bounds,
      params,
      true
    );

    expect(res.events.some((e) => e.type === 'kick')).toBe(true);
    expect(shooter.isCharging).toBe(false);
    expect(ball.carrierId).toBeNull();
    expect(Math.hypot(ball.vx, ball.vy)).toBeGreaterThan(250);
  });
});
