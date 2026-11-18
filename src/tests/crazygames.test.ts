import { describe, expect, it } from 'vitest';
import { SoundEngine } from '../audio/SoundEngine.ts';
import { CareerRecordsStore } from '../game/CareerRecords.ts';
import { MatchState } from '../game/MatchState.ts';
import {
  CrazyGamesAdCallbacks,
  CrazyGamesBridge,
  CrazyGamesSdkV3,
  CrazyGamesSettings,
  isCrazyGamesHost,
  resolveCrazyGamesMode,
} from '../platform/CrazyGames.ts';
import { ParticleSystem } from '../render/ParticleSystem.ts';
import { Renderer } from '../render/Renderer.ts';
import { UIRenderer } from '../render/UIRenderer.ts';

function createMockCanvasCtx() {
  const noop = () => {};
  const grad = { addColorStop: noop };
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
    lineJoin: 'miter',
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    closePath: noop,
    fill: noop,
    stroke: noop,
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    arc: noop,
    ellipse: noop,
    clip: noop,
    fillText: noop,
    strokeText: noop,
    measureText: (t: string) => ({ width: t.length * 5 }),
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
  } as unknown as CanvasRenderingContext2D;
}

describe('CrazyGames platform detection & SDK v3 bridge', () => {
  it('identifies CrazyGames hosts/flags cleanly while keeping normal web domains online-capable', () => {
    expect(isCrazyGamesHost('games.crazygames.com')).toBe(true);
    expect(isCrazyGamesHost('12345.game-files.crazygames.com')).toBe(true);
    expect(isCrazyGamesHost('www.1001juegos.com')).toBe(true);
    expect(isCrazyGamesHost('no-out-derby.vercel.app')).toBe(false);
    expect(isCrazyGamesHost('localhost', '?useLocalSdk=true')).toBe(true);

    expect(
      resolveCrazyGamesMode({ buildFlag: false, hostname: 'no-out-derby.vercel.app', sdkEnvironment: 'disabled' })
    ).toBe(false);
    expect(
      resolveCrazyGamesMode({ buildFlag: true, hostname: 'localhost', sdkEnvironment: 'local' })
    ).toBe(true);
    expect(
      resolveCrazyGamesMode({ buildFlag: false, hostname: 'custom.preview.dev', sdkEnvironment: 'crazygames' })
    ).toBe(true);
  });

  it('initializes v3 SDK lifecycle, de-duplicates gameplayStart/Stop, and enforces platform muteAudio', async () => {
    const calls: string[] = [];
    let settingsCb: ((s: CrazyGamesSettings) => void) | undefined;
    const sdk: CrazyGamesSdkV3 = {
      environment: 'crazygames',
      init: async () => {
        calls.push('init');
      },
      game: {
        loadingStart: () => calls.push('loadingStart'),
        loadingStop: () => calls.push('loadingStop'),
        gameplayStart: () => calls.push('gameplayStart'),
        gameplayStop: () => calls.push('gameplayStop'),
        happytime: () => calls.push('happytime'),
        settings: { muteAudio: true },
        addSettingsChangeListener: (cb) => {
          settingsCb = cb;
        },
      },
      ad: {
        requestAd: () => undefined,
      },
    };

    const bridge = new CrazyGamesBridge({ getSdk: () => sdk, hostname: 'games.crazygames.com' });
    // Queue gameplay start before async SDK init finishes; should flush once ready.
    bridge.setGameplayActive(true);
    bridge.setGameplayActive(true);

    const muteStates: boolean[] = [];
    await bridge.initialize(undefined, (muted) => muteStates.push(muted));

    bridge.setGameplayActive(true); // redundant, should NOT double fire
    bridge.happytime();
    bridge.setGameplayActive(false);

    settingsCb?.({ muteAudio: false });

    expect(calls).toEqual([
      'init',
      'loadingStart',
      'loadingStop',
      'gameplayStart',
      'happytime',
      'gameplayStop',
    ]);
    expect(muteStates).toEqual([true, false]);
    expect(bridge.shouldDisableOnline()).toBe(true);
  });

  it('pauses gameplay, mutes audio, blocks double clicks during midgame ads, and recovers from errors/adblockers', async () => {
    const events: string[] = [];
    const captured: { cbs?: CrazyGamesAdCallbacks } = {};
    const sdk: CrazyGamesSdkV3 = {
      environment: 'crazygames',
      init: async () => undefined,
      game: {
        gameplayStart: () => events.push('gameplayStart'),
        gameplayStop: () => events.push('gameplayStop'),
      },
      ad: {
        requestAd: (type, cbs) => {
          events.push(`request:${type}`);
          captured.cbs = cbs;
        },
      },
    };

    const bridge = new CrazyGamesBridge({
      getSdk: () => sdk,
      buildFlag: true,
      adStartTimeoutMs: 50,
    });
    await bridge.initialize();
    bridge.setGameplayActive(true);

    let completed = 0;
    const audioMutes: boolean[] = [];
    const blockStates: Array<[boolean, string]> = [];

    bridge.requestMidgameAd({
      onStateChange: (blocking, state) => blockStates.push([blocking, state]),
      onAudioMuteChange: (muted) => audioMutes.push(muted),
      onComplete: () => {
        completed++;
      },
    });
    // Duplicate click while loading ad must be ignored cleanly
    bridge.requestMidgameAd({
      onComplete: () => {
        completed++;
      },
    });

    expect(bridge.isAdBlocking()).toBe(true);
    expect(events).toEqual(['gameplayStart', 'gameplayStop', 'request:midgame']);

    captured.cbs?.adStarted?.();
    expect(bridge.getAdState()).toBe('playing');
    expect(audioMutes).toEqual([true]);

    captured.cbs?.adFinished?.();
    expect(bridge.isAdBlocking()).toBe(false);
    expect(completed).toBe(1);
    expect(audioMutes).toEqual([true, false]);
    expect(blockStates).toEqual([
      [true, 'loading'],
      [true, 'playing'],
      [false, 'idle'],
    ]);

    // Simulated AdBlocker / offline fallback completes immediately with zero lock
    const adBlockBridge = new CrazyGamesBridge({ getSdk: () => null, buildFlag: true });
    await adBlockBridge.initialize();
    let fallbackDone = false;
    adBlockBridge.requestMidgameAd({
      onComplete: () => {
        fallbackDone = true;
      },
    });
    expect(fallbackDone).toBe(true);
    expect(adBlockBridge.isAdBlocking()).toBe(false);

    // Timeout safety net if auction hangs before adStarted
    const stalledBridge = new CrazyGamesBridge({
      getSdk: () => ({
        environment: 'crazygames',
        init: async () => undefined,
        ad: { requestAd: () => undefined },
      }),
      buildFlag: true,
      adStartTimeoutMs: 25,
    });
    await stalledBridge.initialize();
    await new Promise<void>((resolve) => {
      stalledBridge.requestMidgameAd({ onComplete: resolve });
    });
    expect(stalledBridge.isAdBlocking()).toBe(false);
  });

  it('resumes gameplay when the ad SDK never reports completion after adStarted', async () => {
    // Real-world failure: ad iframe crashes or the network drops, so neither adFinished nor
    // adError ever fires. Without a playback watchdog the game stays paused behind the ad
    // overlay forever and the player has to reload the page.
    const captured: { cbs?: CrazyGamesAdCallbacks } = {};
    const sdk: CrazyGamesSdkV3 = {
      environment: 'crazygames',
      init: async () => undefined,
      game: { gameplayStart: () => undefined, gameplayStop: () => undefined },
      ad: {
        requestAd: (_type, cbs) => {
          captured.cbs = cbs;
        },
      },
    };

    const bridge = new CrazyGamesBridge({
      getSdk: () => sdk,
      buildFlag: true,
      adStartTimeoutMs: 30,
      adPlaybackTimeoutMs: 30,
    });
    await bridge.initialize();
    bridge.setGameplayActive(true);

    const blockStates: Array<[boolean, string]> = [];
    const audioMutes: boolean[] = [];
    let completed = 0;
    bridge.requestMidgameAd({
      onStateChange: (blocking, state) => blockStates.push([blocking, state]),
      onAudioMuteChange: (muted) => audioMutes.push(muted),
      onComplete: () => {
        completed++;
      },
    });

    captured.cbs?.adStarted?.();
    expect(bridge.getAdState()).toBe('playing');
    expect(bridge.isAdBlocking()).toBe(true);

    await new Promise<void>((resolve) => setTimeout(resolve, 90));

    expect(completed).toBe(1);
    expect(bridge.isAdBlocking()).toBe(false);
    expect(bridge.getAdState()).toBe('idle');
    expect(audioMutes).toEqual([true, false]);
    expect(blockStates).toEqual([
      [true, 'loading'],
      [true, 'playing'],
      [false, 'idle'],
    ]);

    // A late SDK callback after the watchdog must not fire the completion twice.
    captured.cbs?.adFinished?.();
    expect(completed).toBe(1);
  });

  it('keeps SoundEngine user preference separate from temporary ad/platform mute overrides', () => {
    const sound = new SoundEngine();
    expect(sound.isMuted()).toBe(false);
    expect(sound.isUserMuted()).toBe(false);

    sound.setExternalMute('crazygames_ad', true);
    expect(sound.isMuted()).toBe(true);
    expect(sound.isUserMuted()).toBe(false);

    // Global muteAudio override stays active until lifted
    sound.setExternalMute('crazygames_setting', true);
    sound.setExternalMute('crazygames_ad', false);
    expect(sound.isMuted()).toBe(true);

    // User toggling mute cannot bypass an active platform mute
    sound.toggleMute();
    expect(sound.isUserMuted()).toBe(true);
    sound.toggleMute();
    expect(sound.isUserMuted()).toBe(false);
    expect(sound.isMuted()).toBe(true);

    sound.setExternalMute('crazygames_setting', false);
    expect(sound.isMuted()).toBe(false);
  });

  it('hides Online menu entry when onlineEnabled is false and blocks click zones during ad break', () => {
    const match = new MatchState();
    const ui = new UIRenderer();
    const career = new CareerRecordsStore({
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    const ctx = createMockCanvasCtx();
    const noop = () => undefined;
    let onlineOpened = false;
    const callbacks = {
      onStartMatch: noop,
      onUpdateConfig: noop,
      onResume: noop,
      onRematch: noop,
      onRestartRound: noop,
      onAdvanceCup: noop,
      onSelectPerk: noop,
      onQuitToMenu: noop,
      onToggleMute: noop,
      onTogglePause: noop,
      onSkipReplay: noop,
      onOpenGuide: noop,
      onOpenRecords: noop,
      onCloseOverlay: noop,
      onChangeGuidePage: noop,
      onResetRecords: noop,
      onCycleDisplayMode: noop,
      onToggleFullscreen: noop,
      onOpenOnlineLobby: () => {
        onlineOpened = true;
      },
    };

    // With onlineEnabled=true, Hero CTA row (y === 162) has two click zones (PLAY NOW + ONLINE)
    ui.hasBackdrop = true;
    ui.onlineEnabled = true;
    ui.render(ctx, match, match.config, false, career.getRecords(), callbacks);
    const withOnlineCtaZones = ui.getClickZones().filter((z) => z.y === 162);
    expect(withOnlineCtaZones.length).toBe(2);

    // With onlineEnabled=false, Hero CTA row has only full-width PLAY NOW button (Online zone hidden)
    ui.onlineEnabled = false;
    ui.render(ctx, match, match.config, false, career.getRecords(), callbacks);
    const offlineCtaZones = ui.getClickZones().filter((z) => z.y === 162);
    expect(offlineCtaZones.length).toBe(1);
    offlineCtaZones[0].action();
    expect(onlineOpened).toBe(false);

    // Customize modal overlay & in-game KICKOFF onboarding hints render safely
    ui.menuOverlay = 'customize';
    ui.render(ctx, match, match.config, false, career.getRecords(), callbacks);
    expect(ui.getClickZones().length).toBeGreaterThanOrEqual(10);
    ui.menuOverlay = 'none';

    match.startMatch(match.config);
    ui.render(ctx, match, match.config, false, career.getRecords(), callbacks);

    // Unified overlays, Goal celebration banner, and Concrete/Rooftop arenas render safely
    const particles = new ParticleSystem();
    const renderer = new Renderer(particles);
    particles.emitGoalConfetti(240, 135, 'A');
    particles.emitGoalCannons(36, 444, 44, 'A');
    particles.update(0.05);
    particles.render(ctx);

    for (const arena of ['classic', 'concrete', 'rooftop'] as const) {
      match.startMatch({ ...match.config, arena });
      renderer.renderArenaAndEntities(ctx, match, 1);
    }

    ui.triggerGoalHighlight('ONE-TIMER!');
    match.lastScoringTeam = 'A';
    match.phase = 'GOAL_CELEBRATION';
    ui.render(ctx, match, match.config, false, career.getRecords(), callbacks);

    match.phase = 'PAUSED';
    ui.render(ctx, match, match.config, false, career.getRecords(), callbacks);
    expect(ui.getClickZones().length).toBeGreaterThanOrEqual(6);

    match.phase = 'FULL_TIME';
    match.winner = 'A';
    ui.render(ctx, match, match.config, false, career.getRecords(), callbacks);

    match.cup.startNewCup();
    match.cup.preparePerkOffer();
    match.phase = 'PERK_SELECT';
    ui.render(ctx, match, match.config, false, career.getRecords(), callbacks);
    expect(ui.getClickZones().length).toBeGreaterThanOrEqual(3);

    match.phase = 'CUP_CHAMPION';
    ui.render(ctx, match, match.config, false, career.getRecords(), callbacks);

    // During ad break, all canvas click zones are blocked
    ui.adOverlayLabel = 'AD BREAK...';
    ui.render(ctx, match, match.config, false, career.getRecords(), callbacks);
    expect(ui.getClickZones()).toEqual([]);
  });
});
