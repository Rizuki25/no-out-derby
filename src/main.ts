import {
  DEFAULT_ADAPTIVE_RESOLUTION,
  sampleAdaptiveResolution,
} from './game/AdaptiveResolution.ts';
import {
  AIDifficulty,
  ARENA_CONSTANTS,
  ArenaId,
  ControlStyle,
  FIXED_DT,
  GameEvent,
  GameMode,
  MatchConfig,
  MatchDurationOption,
  NATIVE_HEIGHT,
  NATIVE_WIDTH,
  PitchSize,
  Team,
  TeamTactic,
} from './types.ts';
import { ARENA_LIST, PITCH_SIZE_LIST } from './engine/ArenaPresets.ts';
import { GameLoop } from './engine/GameLoop.ts';
import { CareerRecordsStore } from './game/CareerRecords.ts';
import { isFullscreenActive, syncFullscreenFallback, toggleAppFullscreen } from './game/Fullscreen.ts';
import { createEmptyInput, MatchState } from './game/MatchState.ts';
import { InputManager } from './game/InputManager.ts';
import {
  computeCanvasDisplaySize,
  cycleDisplayMode,
  getTouchHudVisibility,
} from './game/MobileLayout.ts';
import { ALL_MUTATORS } from './game/MutatorManager.ts';
import { createOnlineController, type OnlineController } from './net/OnlineFeature.ts';
import { CrazyGamesBridge, isOnlineFeatureEnabled } from './platform/CrazyGames.ts';
import { SoundEngine } from './audio/SoundEngine.ts';
import { ParticleSystem } from './render/ParticleSystem.ts';
import { clearTextSpriteCache } from './render/PixelFont.ts';
import { Renderer } from './render/Renderer.ts';
import { cycleTeamKit } from './render/TeamKits.ts';
import { UIRenderer } from './render/UIRenderer.ts';

const MODE_LIST: GameMode[] = [
  '1v1_ai',
  '2v2_ai',
  '3v3_ai',
  '4v4_ai',
  'derby_cup_1v1',
  'derby_cup_2v2',
  'derby_cup_3v3',
  'derby_cup_4v4',
  '1v1_local',
  '2v2_local',
  '3v3_local',
  '4v4_local',
  '2v2_coop',
  '3v3_coop',
  '4v4_coop',
  'practice_sandbox',
];
const DIFF_LIST: AIDifficulty[] = ['rookie', 'pro', 'tarkam'];
const CONTROL_LIST: ControlStyle[] = ['classic', 'dribble'];
const DUR_LIST: MatchDurationOption[] = [60, 90, 120];
/** Crisp 2x backing store on capable devices; drops to 1x only if frames are consistently slow. */
const RENDER_SCALE = DEFAULT_ADAPTIVE_RESOLUTION.maxScale;

const HOME_CARD_GROUPS: ReadonlyArray<{ modes: readonly GameMode[]; defaultMode: GameMode }> = [
  { modes: ['1v1_ai', '2v2_ai', '3v3_ai', '4v4_ai'], defaultMode: '2v2_ai' },
  { modes: ['derby_cup_1v1', 'derby_cup_2v2', 'derby_cup_3v3', 'derby_cup_4v4'], defaultMode: 'derby_cup_2v2' },
  {
    modes: ['1v1_local', '2v2_local', '3v3_local', '4v4_local', '2v2_coop', '3v3_coop', '4v4_coop'],
    defaultMode: '1v1_local',
  },
  { modes: ['practice_sandbox'], defaultMode: 'practice_sandbox' },
];

function detectCardForMode(mode: GameMode): number {
  if (mode.startsWith('derby_cup_')) return 1;
  if (mode.endsWith('_local') || mode.endsWith('_coop')) return 2;
  if (mode === 'practice_sandbox') return 3;
  return 0;
}

function cycleValue<T>(list: readonly T[], current: T, dir: 1 | -1): T {
  const idx = list.indexOf(current);
  const safeIdx = idx >= 0 ? idx : 0;
  return list[(safeIdx + dir + list.length) % list.length];
}

function initApp(): void {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('Canvas #game-canvas not found');

  canvas.width = NATIVE_WIDTH * RENDER_SCALE;
  canvas.height = NATIVE_HEIGHT * RENDER_SCALE;

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('2D context unavailable');
  ctx.imageSmoothingEnabled = false;

  // Adaptive resolution: keep 2x when the device keeps up, fall back to 1x after a sustained
  // stretch of slow frames so low-end phones and integrated GPUs stay playable. One-way downgrade
  // only — bouncing the backing store size would reallocate canvases and thrash text sprites.
  let renderScale = RENDER_SCALE;
  let slowFrameStreak = 0;
  const sampleFrameTime = (frameMs: number) => {
    const next = sampleAdaptiveResolution(renderScale, slowFrameStreak, frameMs);
    slowFrameStreak = next.slowStreak;
    if (!next.changed) return;
    renderScale = next.scale;
    canvas.width = NATIVE_WIDTH * renderScale;
    canvas.height = NATIVE_HEIGHT * renderScale;
    // Sprites are rasterized per device scale, so rebuild them for the new resolution.
    clearTextSpriteCache();
    ctx.imageSmoothingEnabled = false;
  };

  const match = new MatchState();
  const input = new InputManager();
  const sound = new SoundEngine();
  const particles = new ParticleSystem();
  const renderer = new Renderer(particles);
  const demoMatch = new MatchState();
  const demoParticles = new ParticleSystem();
  const demoRenderer = new Renderer(demoParticles);
  const ui = new UIRenderer();
  const career = new CareerRecordsStore();
  const crazyGames = new CrazyGamesBridge();
  let onlineEnabled = isOnlineFeatureEnabled();
  ui.onlineEnabled = onlineEnabled;

  const loadedPrefs = career.loadPreferences({
    ...match.config,
    pitchSize: 'standard',
    controlStyle: 'dribble',
    displayMode: 'auto',
    teamAKit: 'garuda',
    teamBKit: 'cyber',
  });
  let menuConfig: MatchConfig = loadedPrefs.config;
  ui.homeCard = detectCardForMode(menuConfig.mode);
  input.setDisplayMode(menuConfig.displayMode ?? 'auto');

  const restartDemoScrimmage = () => {
    const cfg: MatchConfig = {
      mode: '3v3_ai',
      arena: menuConfig.arena ?? 'classic',
      pitchSize: 'standard',
      difficulty: 'pro',
      durationSeconds: 60,
      mutatorsEnabled: false,
      replayEnabled: false,
      controlStyle: 'dribble',
      displayMode: 'auto',
      teamAKit: menuConfig.teamAKit ?? 'garuda',
      teamBKit: menuConfig.teamBKit ?? 'cyber',
    };
    demoParticles.clear();
    demoParticles.setTeamKits(cfg.teamAKit ?? 'garuda', cfg.teamBKit ?? 'cyber');
    demoRenderer.clearEffects();
    demoMatch.startMatch(cfg);
    for (const p of demoMatch.players) {
      p.humanSlot = null;
    }
    const emptyDemoInputs = { p1: createEmptyInput(), p2: createEmptyInput() };
    // Pre-step 90 frames (~1.5s) so opening frame already renders live kickoff action
    for (let i = 0; i < 90; i++) {
      const evs = demoMatch.update(FIXED_DT, emptyDemoInputs);
      demoParticles.handleEvents(evs);
      demoRenderer.handleEvents(evs, demoMatch.bounds);
      demoParticles.update(FIXED_DT);
      demoRenderer.updateEffects(FIXED_DT, demoMatch);
    }
  };
  restartDemoScrimmage();
  if (loadedPrefs.muted && !sound.isMuted()) {
    sound.toggleMute();
  }
  let recordedCurrentResult = false;
  let localOnlinePaused = false;
  let pendingGuestDirectTactic: TeamTactic | null = null;
  let lastCanvasW = 0;
  let lastCanvasH = 0;

  const clearRoomQueryParam = () => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('room')) {
        url.searchParams.delete('room');
        window.history.replaceState({}, '', url.toString());
      }
    } catch {
      // Ignore URL history restrictions
    }
  };

  let online!: OnlineController;

  const syncMobileLayoutAndHud = () => {
    const mobileActive = input.isMobileLayoutActive();
    const isOnline = online?.isActive() ?? false;
    const effectivePhase =
      isOnline && (localOnlinePaused || online.getDisconnectNotice())
        ? 'PAUSED'
        : match.phase;
    const visibility = getTouchHudVisibility(
      effectivePhase,
      match.isPracticeSandbox(),
      match.canHumanSwitchPlayer(),
      mobileActive,
      match.hasTwoOutfieldPerTeam()
    );
    const metrics = computeCanvasDisplaySize(
      window.innerWidth,
      window.innerHeight,
      mobileActive,
      visibility.showOverlay
    );
    if (metrics.width !== lastCanvasW || metrics.height !== lastCanvasH) {
      lastCanvasW = metrics.width;
      lastCanvasH = metrics.height;
      canvas.style.width = `${metrics.width}px`;
      canvas.style.height = `${metrics.height}px`;
    }
    const localSlot = online?.getLocalHumanSlot() ?? 1;
    const localTeam = online?.getLocalTeam() ?? 'A';
    const localPlayer = match.players.find((p) => p.humanSlot === localSlot);
    const activeControlStyle = isOnline
      ? match.config.controlStyle ?? 'dribble'
      : menuConfig.controlStyle ?? 'classic';
    const isCarrying =
      activeControlStyle === 'dribble' &&
      Boolean(localPlayer && match.balls.some((b) => b.carrierId === localPlayer.id));
    const chargeRatio = localPlayer?.isCharging
      ? Math.min(1, localPlayer.chargeTime / ARENA_CONSTANTS.MAX_CHARGE_TIME)
      : 0;
    input.syncMobileHud({
      visibility,
      controlStyle: activeControlStyle,
      displayMode: menuConfig.displayMode ?? 'auto',
      muted: sound.isMuted(),
      kickChargeRatio: chargeRatio,
      dashOnCooldown: Boolean(localPlayer && localPlayer.dashCooldown > 0),
      portraitDeck: metrics.portraitDeck,
      portraitDeckTopPx:
        metrics.portraitDeck && visibility.showOverlay ? metrics.height + 16 : null,
      isFullscreen: isFullscreenActive(document),
      isPortrait: metrics.orientation === 'portrait',
      showFeintHint: isCarrying,
      teamFeverPct: localTeam === 'B' ? match.teamFeverB : match.teamFeverA,
      teamFeverActive:
        localTeam === 'B' ? match.teamFeverTimerB > 0 : match.teamFeverTimerA > 0,
      teamTactic: localTeam === 'B' ? match.teamTacticB : match.teamTacticA,
    });
  };
  window.addEventListener('resize', syncMobileLayoutAndHud);
  window.addEventListener('orientationchange', syncMobileLayoutAndHud);
  const handleFullscreenChange = () => {
    syncFullscreenFallback(document);
    syncMobileLayoutAndHud();
  };
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
  syncMobileLayoutAndHud();

  const handleEvents = (events: GameEvent[]) => {
    if (events.length === 0) return;
    sound.handleEvents(events);
    particles.handleEvents(events);
    renderer.handleEvents(events, match.bounds);

    for (const ev of events) {
      if (ev.type === 'kick' && (ev.isOneTimer || ev.isFeverShot || ev.power >= 0.78)) {
        loop.triggerHitstop(ev.isFeverShot ? 0.062 : ev.isOneTimer ? 0.058 : 0.05);
        const kickerSlot = match.players.find((p) => p.id === ev.playerId)?.humanSlot ?? null;
        if (kickerSlot) {
          input.triggerRumble(
            kickerSlot,
            ev.isFeverShot ? 130 : ev.isOneTimer ? 115 : 85,
            ev.isFeverShot ? 0.65 : ev.isOneTimer ? 0.52 : 0.4,
            ev.isFeverShot ? 0.45 : 0.25
          );
        }
      } else if (ev.type === 'feint_dodge') {
        const dodgerSlot =
          match.players.find((p) => p.team === ev.team && p.humanSlot !== null)?.humanSlot ?? 'all';
        input.triggerRumble(dodgerSlot, 75, 0.35, 0.45);
      } else if (ev.type === 'fever_activate') {
        const slot =
          match.players.find((p) => p.team === ev.team && p.humanSlot !== null)?.humanSlot ?? 'all';
        input.triggerRumble(slot, 165, 0.7, 0.55);
      } else if (ev.type === 'tactic_change') {
        sound.playMenuBlip(false);
      } else if (ev.type === 'tackle') {
        const tacklerSlot =
          match.players.find((p) => p.team === ev.team && p.humanSlot !== null)?.humanSlot ?? null;
        const victimTeam = ev.team === 'A' ? 'B' : 'A';
        const victimSlot =
          match.players.find((p) => p.team === victimTeam && p.humanSlot !== null)?.humanSlot ?? null;
        if (tacklerSlot) input.triggerRumble(tacklerSlot, 95, 0.5, 0.3);
        if (victimSlot) input.triggerRumble(victimSlot, 130, 0.65, 0.45);
      } else if (ev.type === 'post_clang') {
        input.triggerRumble('all', 80, 0.2, 0.55);
      } else if (ev.type === 'hot_potato_boom') {
        loop.triggerHitstop(0.055);
        input.triggerRumble('all', 180, 0.75, 0.65);
      } else if (ev.type === 'goal') {
        ui.triggerGoalHighlight(ev.highlightTag ?? null);
        loop.triggerSlowMo(0.72, 0.34);
        input.triggerRumble('all', 240, 0.75, 0.6);
      } else if (ev.type === 'mutator_start') {
        ui.triggerMutatorBanner(ev.label, ev.subtitle);
      }
    }
  };

  const resetVisualsForMatch = (cfg: MatchConfig = menuConfig) => {
    sound.setBgmFastMode(false);
    particles.clear();
    particles.setTeamKits(cfg.teamAKit ?? 'garuda', cfg.teamBKit ?? 'cyber');
    renderer.clearEffects();
    loop.clearEffects();
    recordedCurrentResult = false;
    localOnlinePaused = false;
    pendingGuestDirectTactic = null;
    ui.menuOverlay = 'none';
    ui.pauseGuideOpen = false;
    ui.resetArmed = false;
    ui.resultRow = 0;
    ui.pauseRow = 0;
    ui.perkIndex = 0;
    ui.championRow = 0;
  };

  const syncCrazyGamesGameplay = () => {
    const inMatchLifecycle =
      match.phase === 'KICKOFF' ||
      match.phase === 'PLAYING' ||
      match.phase === 'GOLDEN_GOAL_INTRO' ||
      match.phase === 'GOAL_CELEBRATION' ||
      match.phase === 'REPLAY';
    const active =
      inMatchLifecycle &&
      !localOnlinePaused &&
      !crazyGames.isAdBlocking() &&
      !(online.isActive() && Boolean(online.getDisconnectNotice()));
    crazyGames.setGameplayActive(active);
  };

  const runWithPostMatchAd = (shouldOfferAd: boolean, nextAction: () => void) => {
    if (!shouldOfferAd) {
      nextAction();
      return;
    }
    crazyGames.requestMidgameAd({
      onStateChange: (blocking, state) => {
        ui.adOverlayLabel = !blocking
          ? null
          : state === 'playing'
            ? 'AD BREAK...'
            : 'LOADING AD...';
        syncCrazyGamesGameplay();
        syncMobileLayoutAndHud();
      },
      onAudioMuteChange: (muted) => {
        sound.setExternalMute('crazygames_ad', muted);
        syncMobileLayoutAndHud();
      },
      onComplete: () => {
        ui.adOverlayLabel = null;
        nextAction();
        syncCrazyGamesGameplay();
        syncMobileLayoutAndHud();
      },
    });
  };

  const openOnlineLobby = (prefillCode?: string) => {
    if (!onlineEnabled || match.phase !== 'MENU' || crazyGames.isAdBlocking()) return;
    sound.unlock();
    sound.playMenuBlip(true);
    ui.menuOverlay = 'none';
    online.openLobby(prefillCode);
  };

  const startMatch = () => {
    if (crazyGames.isAdBlocking()) return;
    sound.unlock();
    sound.playMenuBlip(true);
    sound.startBgm();
    resetVisualsForMatch(menuConfig);
    const evs = match.startMatch(menuConfig);
    handleEvents(evs);
    syncCrazyGamesGameplay();
    syncMobileLayoutAndHud();
  };

  const rematch = () => {
    if (crazyGames.isAdBlocking()) return;
    if (online.isActive()) {
      if (online.getRole() === 'guest') {
        if (!online.getStatusBadge().localWantsRematch) {
          sound.playMenuBlip(true);
          online.requestRematch(() => {});
          ui.triggerToastBanner('REMATCH REQUESTED', 'WAITING FOR HOST...', '#7dffba', 2.2);
        }
        return;
      }
      online.requestRematch(() => {
        sound.unlock();
        sound.playMenuBlip(true);
        sound.startBgm();
        resetVisualsForMatch(match.config);
        const evs = match.rematch();
        handleEvents(evs);
        online.pushHostImmediateState(match, evs);
        syncCrazyGamesGameplay();
        syncMobileLayoutAndHud();
      });
      return;
    }

    runWithPostMatchAd(true, () => {
      sound.unlock();
      sound.playMenuBlip(true);
      sound.startBgm();
      resetVisualsForMatch(menuConfig);
      const evs = match.rematch();
      handleEvents(evs);
    });
  };

  /** Restarts the current round without wiping Derby Cup progress (round index + perks). */
  const restartRound = () => {
    if (online.isActive() || crazyGames.isAdBlocking()) return;
    sound.unlock();
    sound.playMenuBlip(true);
    sound.startBgm();
    resetVisualsForMatch(menuConfig);
    const evs = match.restartCurrentRound();
    handleEvents(evs);
    syncCrazyGamesGameplay();
  };

  const advanceCup = () => {
    if (crazyGames.isAdBlocking()) return;
    runWithPostMatchAd(true, () => {
      sound.playMenuBlip(true);
      ui.perkIndex = 0;
      ui.championRow = 0;
      match.advanceFromCupResult();
    });
  };

  const selectPerk = (choiceIdx: number) => {
    if (crazyGames.isAdBlocking()) return;
    sound.playMenuBlip(true);
    sound.startBgm();
    resetVisualsForMatch(menuConfig);
    const evs = match.pickCupPerk(choiceIdx);
    handleEvents(evs);
    syncCrazyGamesGameplay();
  };

  const skipReplay = () => {
    if (match.phase !== 'REPLAY' || crazyGames.isAdBlocking()) return;
    if (online.isActive() && online.getRole() === 'guest') return;
    sound.playMenuBlip(false);
    const evs = match.skipReplay();
    handleEvents(evs);
  };

  const quitToMenu = () => {
    if (crazyGames.isAdBlocking()) return;
    sound.playMenuBlip(false);
    sound.stopBgm();
    online.disconnect(true);
    clearRoomQueryParam();
    resetVisualsForMatch(menuConfig);
    match.returnToMenu();
    ui.menuRow = 0;
    ui.homeRow = 1;
    ui.menuFocusPlay = true;
    ui.homeCard = detectCardForMode(menuConfig.mode);
    syncCrazyGamesGameplay();
    syncMobileLayoutAndHud();
  };

  const togglePause = () => {
    if (crazyGames.isAdBlocking()) return;
    if (online.isActive()) {
      if (
        !online.getDisconnectNotice() &&
        (match.phase === 'PLAYING' || match.phase === 'KICKOFF' || match.phase === 'REPLAY')
      ) {
        sound.playMenuBlip(false);
        localOnlinePaused = !localOnlinePaused;
        ui.pauseRow = 0;
        ui.pauseGuideOpen = false;
        syncCrazyGamesGameplay();
        syncMobileLayoutAndHud();
      }
      return;
    }

    if (match.phase === 'PLAYING' || match.phase === 'KICKOFF' || match.phase === 'PAUSED') {
      sound.playMenuBlip(false);
      match.togglePause();
      ui.pauseRow = 0;
      ui.pauseGuideOpen = false;
      syncCrazyGamesGameplay();
    }
  };

  online = createOnlineController({
    getMenuConfig: () => menuConfig,
    onCancelPending: () => {
      online.disconnect(true);
      clearRoomQueryParam();
    },
    onCloseModal: () => {
      canvas.focus?.();
    },
    onPlayBlip: (confirm) => {
      sound.unlock();
      sound.playMenuBlip(confirm);
    },
    onMatchConnected: (matchCfg, role, transport) => {
      sound.unlock();
      sound.playMenuBlip(true);
      sound.startBgm();
      resetVisualsForMatch(matchCfg);
      const evs = match.startMatch(matchCfg);
      handleEvents(evs);
      if (role === 'host') {
        online.pushHostImmediateState(match, evs);
      }
      const channelDesc =
        transport === 'cloudflare-ws'
          ? 'EDGE WSS LIVE! KICK OFF!'
          : 'P2P LIVE! KICK OFF!';
      ui.triggerToastBanner(
        role === 'host' ? 'ONLINE CONNECTED (HOST P1)' : 'ONLINE CONNECTED (GUEST P2)',
        channelDesc,
        '#7dffba',
        2.4
      );
      syncCrazyGamesGameplay();
      syncMobileLayoutAndHud();
    },
    onRemoteEvents: (evs) => handleEvents(evs),
    onRemoteRematchRequested: () => {
      sound.playMenuBlip(true);
      ui.triggerToastBanner('OPPONENT WANTS REMATCH!', 'CLICK REMATCH / ENTER', '#ffd23f', 3.0);
    },
    onRemoteRematchStart: (matchCfg) => {
      sound.unlock();
      sound.playMenuBlip(true);
      sound.startBgm();
      resetVisualsForMatch(matchCfg);
      const evs = match.startMatch(matchCfg);
      handleEvents(evs);
      ui.triggerToastBanner('REMATCH STARTED!', 'ONLINE LIVE', '#7dffba', 2.0);
      syncCrazyGamesGameplay();
      syncMobileLayoutAndHud();
    },
    onDisconnected: (reason) => {
      localOnlinePaused = false;
      sound.playMenuBlip(false);
      sound.stopBgm();
      ui.triggerToastBanner('CONNECTION LOST', reason.slice(0, 34), '#ff647c', 3.5);
      syncCrazyGamesGameplay();
      syncMobileLayoutAndHud();
    },
  });

  const toggleMute = () => {
    if (crazyGames.isAdBlocking()) return;
    sound.unlock();
    sound.toggleMute();
    career.savePreferences(menuConfig, sound.isUserMuted());
  };

  const updateConfig = (patch: Partial<MatchConfig>) => {
    sound.playMenuBlip(false);
    menuConfig = { ...menuConfig, ...patch };
    ui.homeCard = detectCardForMode(menuConfig.mode);
    demoMatch.config.teamAKit = menuConfig.teamAKit ?? 'garuda';
    demoMatch.config.teamBKit = menuConfig.teamBKit ?? 'cyber';
    demoParticles.setTeamKits(demoMatch.config.teamAKit, demoMatch.config.teamBKit);
    if (patch.arena && patch.arena !== demoMatch.config.arena) {
      restartDemoScrimmage();
    }
    career.savePreferences(menuConfig, sound.isUserMuted());
  };

  const openCustomize = () => {
    if (match.phase !== 'MENU') return;
    sound.playMenuBlip(false);
    ui.menuRow = 0;
    ui.resetArmed = false;
    ui.menuOverlay = 'customize';
  };

  const cycleViewMode = () => {
    if (crazyGames.isAdBlocking()) return;
    sound.unlock();
    const next = cycleDisplayMode(menuConfig.displayMode ?? 'auto', 1);
    updateConfig({ displayMode: next });
    match.config.displayMode = next;
    input.setDisplayMode(next);
    syncMobileLayoutAndHud();
  };

  const toggleFullscreenAction = () => {
    if (crazyGames.isAdBlocking()) return;
    sound.unlock();
    sound.playMenuBlip(false);
    void toggleAppFullscreen(input.isMobileLayoutActive()).then(() => {
      syncMobileLayoutAndHud();
    });
  };

  const openGuide = () => {
    sound.playMenuBlip(false);
    ui.guidePage = 0;
    ui.resetArmed = false;
    if (match.phase === 'MENU') {
      ui.menuOverlay = 'guide';
    } else if (match.phase === 'PAUSED' || localOnlinePaused) {
      ui.pauseGuideOpen = true;
    }
  };

  const openRecords = () => {
    if (match.phase !== 'MENU') return;
    sound.playMenuBlip(false);
    ui.menuOverlay = 'records';
    ui.recordsRow = 0;
    ui.resetArmed = false;
  };

  const closeOverlay = () => {
    sound.playMenuBlip(false);
    ui.menuOverlay = 'none';
    ui.pauseGuideOpen = false;
    ui.resetArmed = false;
  };

  const changeGuidePage = (page: number) => {
    sound.playMenuBlip(false);
    ui.guidePage = ((page % 3) + 3) % 3;
  };

  const resetRecordsAction = () => {
    if (!ui.resetArmed) {
      sound.playMenuBlip(false);
      ui.resetArmed = true;
      return;
    }
    sound.playMenuBlip(true);
    career.resetRecords();
    ui.resetArmed = false;
  };

  const adjustMenuRow = (row: number, dir: 1 | -1) => {
    const isCup =
      menuConfig.mode === 'derby_cup_1v1' ||
      menuConfig.mode === 'derby_cup_2v2' ||
      menuConfig.mode === 'derby_cup_3v3' ||
      menuConfig.mode === 'derby_cup_4v4';
    const isFourVsFour =
      menuConfig.mode === '4v4_ai' ||
      menuConfig.mode === 'derby_cup_4v4' ||
      menuConfig.mode === '4v4_local' ||
      menuConfig.mode === '4v4_coop';
    const isSandbox = menuConfig.mode === 'practice_sandbox';
    const aiUsed = menuConfig.mode !== '1v1_local' && !isCup;
    const kitA = menuConfig.teamAKit ?? 'garuda';
    const kitB = menuConfig.teamBKit ?? 'cyber';

    if (row === 1) {
      updateConfig({ mode: cycleValue(MODE_LIST, menuConfig.mode, dir) });
    } else if (row === 2) {
      updateConfig({
        controlStyle: cycleValue<ControlStyle>(CONTROL_LIST, menuConfig.controlStyle ?? 'classic', dir),
      });
    } else if (row === 3 && !isCup) {
      updateConfig({ arena: cycleValue<ArenaId>(ARENA_LIST, menuConfig.arena ?? 'classic', dir) });
    } else if (row === 4 && !isFourVsFour) {
      updateConfig({
        pitchSize: cycleValue<PitchSize>(PITCH_SIZE_LIST, menuConfig.pitchSize ?? 'standard', dir),
      });
    } else if (row === 5) {
      updateConfig({ teamAKit: cycleTeamKit(kitA, kitB, dir) });
    } else if (row === 6) {
      updateConfig({ teamBKit: cycleTeamKit(kitB, kitA, dir) });
    } else if (row === 7 && aiUsed) {
      updateConfig({ difficulty: cycleValue(DIFF_LIST, menuConfig.difficulty, dir) });
    } else if (row === 8 && !isSandbox) {
      updateConfig({ mutatorsEnabled: !menuConfig.mutatorsEnabled });
    } else if (row === 9 && !isSandbox) {
      updateConfig({ durationSeconds: cycleValue(DUR_LIST, menuConfig.durationSeconds, dir) });
    }
  };

  const handleUiInput = () => {
    if (online.isLobbyOpen() || crazyGames.isAdBlocking()) return;

    const nav = input.getMenuActions();
    if (nav.mute) {
      toggleMute();
    }

    if (online.isActive() && online.getDisconnectNotice()) {
      if (nav.confirm || nav.back) {
        quitToMenu();
      }
      return;
    }

    if (match.phase === 'MENU') {
      if (ui.menuOverlay === 'guide') {
        if (nav.left) changeGuidePage(ui.guidePage - 1);
        else if (nav.right) changeGuidePage(ui.guidePage + 1);
        else if (input.wasKeyJustPressed('Digit1')) changeGuidePage(0);
        else if (input.wasKeyJustPressed('Digit2')) changeGuidePage(1);
        else if (input.wasKeyJustPressed('Digit3')) changeGuidePage(2);
        else if (nav.back || nav.confirm) closeOverlay();
        return;
      }

      if (ui.menuOverlay === 'records') {
        if (nav.left || nav.right || nav.up || nav.down) {
          sound.playMenuBlip(false);
          ui.recordsRow = ui.recordsRow === 0 ? 1 : 0;
          ui.resetArmed = false;
        } else if (nav.confirm) {
          if (ui.recordsRow === 0) closeOverlay();
          else resetRecordsAction();
        } else if (nav.back) {
          closeOverlay();
        }
        return;
      }

      if (ui.menuOverlay === 'customize') {
        if (nav.back || input.wasKeyJustPressed('KeyC')) {
          closeOverlay();
          return;
        }
        if (input.wasKeyJustPressed('KeyH')) {
          openGuide();
          return;
        }
        if (input.wasKeyJustPressed('KeyR')) {
          openRecords();
          return;
        }
        if (nav.up) {
          sound.playMenuBlip(false);
          ui.menuRow = (ui.menuRow + 9) % 10;
        } else if (nav.down) {
          sound.playMenuBlip(false);
          ui.menuRow = (ui.menuRow + 1) % 10;
        } else if (nav.left || nav.right) {
          adjustMenuRow(ui.menuRow, nav.right ? 1 : -1);
        } else if (nav.confirm) {
          if (ui.menuRow === 0) startMatch();
          else adjustMenuRow(ui.menuRow, 1);
        }
        return;
      }

      if (input.wasKeyJustPressed('KeyC')) {
        openCustomize();
        return;
      }
      if (input.wasKeyJustPressed('KeyH')) {
        openGuide();
        return;
      }
      if (input.wasKeyJustPressed('KeyR')) {
        openRecords();
        return;
      }
      if (input.wasKeyJustPressed('KeyV')) {
        cycleViewMode();
        return;
      }
      if (input.wasKeyJustPressed('KeyF')) {
        toggleFullscreenAction();
        return;
      }
      if (onlineEnabled && input.wasKeyJustPressed('KeyO')) {
        openOnlineLobby();
        return;
      }

      if (nav.up) {
        sound.playMenuBlip(false);
        ui.homeRow = ((ui.homeRow + 2) % 3) as 0 | 1 | 2;
      } else if (nav.down) {
        sound.playMenuBlip(false);
        ui.homeRow = ((ui.homeRow + 1) % 3) as 0 | 1 | 2;
      } else if (nav.left || nav.right) {
        const dir = nav.right ? 1 : -1;
        if (ui.homeRow === 0) {
          const nextCard = (ui.homeCard + (dir === 1 ? 1 : 3)) % 4;
          ui.homeCard = nextCard;
          const group = HOME_CARD_GROUPS[nextCard];
          if (!group.modes.includes(menuConfig.mode)) {
            updateConfig({ mode: group.defaultMode });
          } else {
            sound.playMenuBlip(false);
          }
        } else if (ui.homeRow === 1) {
          if (onlineEnabled) {
            sound.playMenuBlip(false);
            ui.menuFocusPlay = !ui.menuFocusPlay;
          }
        } else {
          sound.playMenuBlip(false);
          ui.homeFooterIdx = (ui.homeFooterIdx + (dir === 1 ? 1 : 2)) % 3;
        }
      } else if (nav.confirm) {
        if (ui.homeRow === 0) {
          const group = HOME_CARD_GROUPS[ui.homeCard];
          if (group.modes.includes(menuConfig.mode) && group.modes.length > 1) {
            const idx = group.modes.indexOf(menuConfig.mode);
            updateConfig({ mode: group.modes[(idx + 1) % group.modes.length] });
          } else if (menuConfig.mode === 'practice_sandbox') {
            startMatch();
          } else {
            updateConfig({ mode: group.defaultMode });
          }
        } else if (ui.homeRow === 1) {
          if (!onlineEnabled || ui.menuFocusPlay) startMatch();
          else openOnlineLobby();
        } else {
          if (ui.homeFooterIdx === 0) openCustomize();
          else if (ui.homeFooterIdx === 1) openGuide();
          else openRecords();
        }
      }
      return;
    }

    if (match.phase === 'REPLAY') {
      if (nav.confirm || nav.back || nav.pause) {
        skipReplay();
      }
      return;
    }

    if (match.phase === 'PERK_SELECT') {
      if (nav.left) {
        sound.playMenuBlip(false);
        ui.perkIndex = (ui.perkIndex + 2) % 3;
      } else if (nav.right) {
        sound.playMenuBlip(false);
        ui.perkIndex = (ui.perkIndex + 1) % 3;
      } else if (input.wasKeyJustPressed('Digit1')) {
        selectPerk(0);
      } else if (input.wasKeyJustPressed('Digit2')) {
        selectPerk(1);
      } else if (input.wasKeyJustPressed('Digit3')) {
        selectPerk(2);
      } else if (nav.confirm) {
        selectPerk(ui.perkIndex);
      }
      return;
    }

    if (match.phase === 'CUP_CHAMPION') {
      if (nav.up || nav.down || nav.left || nav.right) {
        sound.playMenuBlip(false);
        ui.championRow = ui.championRow === 0 ? 1 : 0;
      } else if (nav.confirm) {
        if (ui.championRow === 0) rematch();
        else quitToMenu();
      } else if (nav.back) {
        quitToMenu();
      }
      return;
    }

    const isPauseMenuOpen =
      match.phase === 'PAUSED' ||
      (online.isActive() && localOnlinePaused && match.phase !== 'FULL_TIME');

    if (isPauseMenuOpen) {
      if (ui.pauseGuideOpen) {
        if (nav.left) changeGuidePage(ui.guidePage - 1);
        else if (nav.right) changeGuidePage(ui.guidePage + 1);
        else if (input.wasKeyJustPressed('Digit1')) changeGuidePage(0);
        else if (input.wasKeyJustPressed('Digit2')) changeGuidePage(1);
        else if (input.wasKeyJustPressed('Digit3')) changeGuidePage(2);
        else if (nav.back || nav.pause || nav.confirm) closeOverlay();
        return;
      }

      if (input.wasKeyJustPressed('KeyH')) {
        openGuide();
        return;
      }
      if (input.wasKeyJustPressed('KeyF')) {
        toggleFullscreenAction();
        return;
      }
      if (nav.pause || nav.back) {
        togglePause();
        return;
      }
      if (nav.up) {
        sound.playMenuBlip(false);
        ui.pauseRow = (ui.pauseRow + 5) % 6;
      } else if (nav.down) {
        sound.playMenuBlip(false);
        ui.pauseRow = (ui.pauseRow + 1) % 6;
      } else if (nav.left || nav.right) {
        if (ui.pauseRow === 2) toggleFullscreenAction();
        else if (ui.pauseRow === 3) cycleViewMode();
      } else if (nav.confirm) {
        if (ui.pauseRow === 0) togglePause();
        else if (ui.pauseRow === 1) {
          if (!online.isActive()) restartRound();
        } else if (ui.pauseRow === 2) toggleFullscreenAction();
        else if (ui.pauseRow === 3) cycleViewMode();
        else if (ui.pauseRow === 4) openGuide();
        else quitToMenu();
      }
      return;
    }

    if (match.phase === 'FULL_TIME') {
      if (input.wasKeyJustPressed('KeyF')) {
        toggleFullscreenAction();
        return;
      }
      if (nav.up || nav.down || nav.left || nav.right) {
        sound.playMenuBlip(false);
        ui.resultRow = ui.resultRow === 0 ? 1 : 0;
      } else if (nav.confirm) {
        if (ui.resultRow === 0) {
          if (!online.isActive() && match.cup.active && match.winner === 'A') advanceCup();
          else rematch();
        } else {
          quitToMenu();
        }
      } else if (nav.back) {
        quitToMenu();
      }
      return;
    }

    if (nav.pause) {
      togglePause();
    }
  };

  const triggerSandboxCommand = (action: string) => {
    if (crazyGames.isAdBlocking()) return;
    if (!match.isPracticeSandbox() || (match.phase !== 'PLAYING' && match.phase !== 'KICKOFF')) {
      return;
    }
    if (action === 'clear') {
      sound.playMenuBlip(false);
      handleEvents(match.clearSandboxMutator());
      return;
    }
    if (action === 'feed') {
      sound.playMenuBlip(false);
      match.triggerSandboxFeedPass();
      return;
    }
    if (action === 'ball') {
      sound.playMenuBlip(false);
      match.resetSandboxBall();
      return;
    }
    if (action === 'def') {
      sound.playMenuBlip(true);
      match.toggleSandboxDefender();
      return;
    }
    if (action.startsWith('m')) {
      const idx = Number.parseInt(action.slice(1), 10);
      if (idx >= 0 && idx < ALL_MUTATORS.length) {
        sound.unlock();
        handleEvents(match.triggerSandboxMutator(ALL_MUTATORS[idx]));
      }
    }
  };

  input.setMobileActionHandlers({
    onPause: togglePause,
    onToggleMute: toggleMute,
    onCycleView: cycleViewMode,
    onToggleFullscreen: toggleFullscreenAction,
    onSkipReplay: skipReplay,
    onSandboxAction: triggerSandboxCommand,
    onCycleTactic: () => {
      if (crazyGames.isAdBlocking()) return;
      if (match.phase === 'PLAYING' && match.hasTwoOutfieldPerTeam()) {
        if (online.isActive() && online.getRole() === 'guest') {
          const order: TeamTactic[] = ['balanced', 'attack', 'defend'];
          const current = online.getLocalTeam() === 'B' ? match.teamTacticB : match.teamTacticA;
          pendingGuestDirectTactic = order[(order.indexOf(current) + 1) % order.length];
          return;
        }
        handleEvents(match.cycleTeamTactic('A'));
        syncMobileLayoutAndHud();
      }
    },
  });

  const handleMatchTacticHotkeys = () => {
    if (
      online.isLobbyOpen() ||
      crazyGames.isAdBlocking() ||
      localOnlinePaused ||
      match.isPracticeSandbox() ||
      match.phase !== 'PLAYING' ||
      !match.hasTwoOutfieldPerTeam()
    ) {
      return;
    }
    const chosen: TeamTactic | null = input.wasKeyJustPressed('Digit1')
      ? 'defend'
      : input.wasKeyJustPressed('Digit2')
        ? 'balanced'
        : input.wasKeyJustPressed('Digit3')
          ? 'attack'
          : null;
    if (!chosen) return;

    if (online.isActive() && online.getRole() === 'guest') {
      pendingGuestDirectTactic = chosen;
      return;
    }
    handleEvents(match.setTeamTactic('A', chosen));
  };

  const handleSandboxInput = () => {
    if (crazyGames.isAdBlocking()) return;
    if (!match.isPracticeSandbox()) return;
    if (match.phase !== 'PLAYING' && match.phase !== 'KICKOFF') return;

    const digitCodes = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'];
    for (let i = 0; i < digitCodes.length; i++) {
      if (input.wasKeyJustPressed(digitCodes[i])) {
        triggerSandboxCommand(`m${i}`);
        return;
      }
    }

    if (input.wasKeyJustPressed('Digit0')) {
      triggerSandboxCommand('clear');
    } else if (input.wasKeyJustPressed('KeyF')) {
      triggerSandboxCommand('feed');
    } else if (input.wasKeyJustPressed('KeyB')) {
      triggerSandboxCommand('ball');
    } else if (input.wasKeyJustPressed('KeyT')) {
      triggerSandboxCommand('def');
    }
  };

  canvas.addEventListener('pointerdown', () => {
    sound.unlock();
  });

  canvas.addEventListener('click', (e) => {
    if (crazyGames.isAdBlocking()) return;
    sound.unlock();
    const rect = canvas.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * NATIVE_WIDTH;
    const cy = ((e.clientY - rect.top) / rect.height) * NATIVE_HEIGHT;

    for (const zone of ui.getClickZones()) {
      if (cx >= zone.x && cx <= zone.x + zone.w && cy >= zone.y && cy <= zone.y + zone.h) {
        zone.action();
        break;
      }
    }
  });

  const processGamepadNotices = () => {
    const notices = input.drainGamepadNotices();
    if (notices.length === 0) return;
    for (const notice of notices) {
      if (notice.connected) {
        sound.playMenuBlip(true);
        ui.triggerToastBanner(
          `PAD P${notice.slot} CONNECTED!`,
          `${notice.shortName} (360 ANALOG ACTIVE)`,
          '#7dffba'
        );
        input.triggerRumble(notice.slot, 95, 0.35, 0.5);
      } else {
        ui.triggerToastBanner(
          `PAD P${notice.slot} DISCONNECTED`,
          notice.shortName,
          '#ffd23f'
        );
      }
    }
    syncMobileLayoutAndHud();
  };

  const recordCompletedIfNeeded = () => {
    if (match.phase === 'FULL_TIME' && !recordedCurrentResult) {
      const localTeam: Team = online.isActive() ? online.getLocalTeam() : 'A';
      const localWinner: Team | null =
        match.winner === null ? null : match.winner === localTeam ? 'A' : 'B';
      const localScore = localTeam === 'B' ? match.scoreB : match.scoreA;
      const wonCupTournament =
        !online.isActive() && match.cup.active && match.winner === 'A' && match.cup.isFinalRound();
      career.recordCompletedMatch({
        isPracticeSandbox: match.isPracticeSandbox(),
        winner: localWinner,
        scoreA: localScore,
        stats: match.stats,
        wonCupTournament,
      });
      recordedCurrentResult = true;
      sound.stopBgm();
      if (!online.isActive() && match.winner === 'A' && (wonCupTournament || match.isGoldenGoal)) {
        crazyGames.happytime();
      }
      syncCrazyGamesGameplay();
    }
  };

  const loop = new GameLoop(
    (dt) => {
      handleUiInput();
      if (!online.isActive()) {
        handleSandboxInput();
      }
      handleMatchTacticHotkeys();
      processGamepadNotices();

      const simPaused =
        crazyGames.isAdBlocking() ||
        match.phase === 'MENU' ||
        match.phase === 'PAUSED' ||
        match.phase === 'FULL_TIME' ||
        match.phase === 'PERK_SELECT' ||
        match.phase === 'CUP_CHAMPION' ||
        (online.isActive() && Boolean(online.getDisconnectNotice()));

      if (online.isActive()) {
        if (online.isConnected()) {
          if (online.getRole() === 'host' && !simPaused) {
            const localInput = localOnlinePaused
              ? createEmptyInput()
              : input.getPlayerInputs(false).p1;
            online.stepHostTick(dt, localInput, match, handleEvents);
            if (match.phase !== 'REPLAY') {
              particles.update(dt);
            }
            sound.setBgmFastMode(match.isFinalStretch() || match.isGoldenGoal);
          } else if (online.getRole() === 'guest') {
            if (!simPaused) {
              const localInput = localOnlinePaused
                ? createEmptyInput()
                : input.getPlayerInputs(false).p1;
              const dtTactic = pendingGuestDirectTactic;
              pendingGuestDirectTactic = null;
              online.sendGuestInput(localInput, dtTactic, dt);
            }
            online.syncGuestRenderState(performance.now(), match);
            if (match.phase !== 'REPLAY' && match.phase !== 'FULL_TIME') {
              particles.update(dt);
            }
            sound.setBgmFastMode(match.isFinalStretch() || match.isGoldenGoal);
          }
        }
      } else if (match.phase === 'MENU' && !crazyGames.isAdBlocking()) {
        const emptyDemoInputs = { p1: createEmptyInput(), p2: createEmptyInput() };
        const demoEvs = demoMatch.update(dt, emptyDemoInputs);
        demoParticles.handleEvents(demoEvs);
        demoRenderer.handleEvents(demoEvs, demoMatch.bounds);
        demoParticles.update(dt);
        if (demoMatch.phase === 'FULL_TIME') {
          restartDemoScrimmage();
        }
      } else if (!simPaused) {
        const humanInputs = input.getPlayerInputs(match.isTwoPlayerMode());
        const evs = match.update(dt, humanInputs);
        handleEvents(evs);
        if (match.phase !== 'REPLAY') {
          particles.update(dt);
        }
        sound.setBgmFastMode(match.isFinalStretch() || match.isGoldenGoal);
      }

      // Runs every fixed frame, outside the `simPaused` branches: a phase change made inside
      // handleUiInput() (e.g. skipReplay() ending the match) sets FULL_TIME before `simPaused`
      // is computed, which used to skip the result write and silently drop the whole match.
      recordCompletedIfNeeded();
      syncCrazyGamesGameplay();
      input.endFrame();
    },
    () => {
      ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
      ctx.imageSmoothingEnabled = false;
      if (online.isConnected() && online.getRole() === 'guest') {
        online.syncGuestRenderState(performance.now(), match);
      }
      if (match.phase === 'MENU') {
        demoRenderer.renderArenaAndEntities(ctx, demoMatch, null);
        ui.hasBackdrop = true;
      } else {
        ui.hasBackdrop = false;
        const showField = match.phase !== 'PERK_SELECT' && match.phase !== 'CUP_CHAMPION';
        if (showField) {
          renderer.renderArenaAndEntities(ctx, match, online.getLocalHumanSlot());
        }
      }
      ui.isMobileLayout = input.isMobileLayoutActive();
      const onlineBadge = {
        ...online.getStatusBadge(),
        localPaused: localOnlinePaused,
      };
      ui.render(
        ctx,
        match,
        menuConfig,
        sound.isMuted(),
        career.getRecords(),
        {
          onStartMatch: startMatch,
          onUpdateConfig: updateConfig,
          onResume: togglePause,
          onRematch: rematch,
          onRestartRound: restartRound,
          onAdvanceCup: advanceCup,
          onSelectPerk: selectPerk,
          onQuitToMenu: quitToMenu,
          onToggleMute: toggleMute,
          onTogglePause: togglePause,
          onSkipReplay: skipReplay,
          onOpenGuide: openGuide,
          onOpenRecords: openRecords,
          onCloseOverlay: closeOverlay,
          onChangeGuidePage: changeGuidePage,
          onResetRecords: resetRecordsAction,
          onCycleDisplayMode: cycleViewMode,
          onToggleFullscreen: toggleFullscreenAction,
          onOpenOnlineLobby: () => openOnlineLobby(),
          onOpenCustomize: openCustomize,
        },
        input.getConnectedGamepads(),
        onlineBadge
      );
    },
    (rawDt) => {
      // rawDt is the real wall-clock frame delta, so slow devices are detected even when the
      // fixed-step simulation is keeping up.
      sampleFrameTime(rawDt * 1000);
      ui.update(rawDt);
      if (match.phase === 'MENU') {
        demoRenderer.updateEffects(rawDt, demoMatch);
      } else {
        renderer.updateEffects(rawDt, match);
      }
      syncMobileLayoutAndHud();
    }
  );

  document.addEventListener('visibilitychange', () => {
    sound.setExternalMute('page_hidden', document.hidden);
  });

  void crazyGames.initialize(
    () => {
      onlineEnabled = !crazyGames.shouldDisableOnline();
      ui.onlineEnabled = onlineEnabled;
      if (!onlineEnabled && online.isLobbyOpen()) {
        online.closeLobby(false);
        online.disconnect(true);
      }
      syncCrazyGamesGameplay();
    },
    (cgMuted) => {
      sound.setExternalMute('crazygames_setting', cgMuted);
      syncMobileLayoutAndHud();
    }
  );

  loop.start();

  if (onlineEnabled) {
    const initialRoomParam = new URLSearchParams(window.location.search).get('room');
    if (initialRoomParam) {
      openOnlineLobby(initialRoomParam);
    }
  }
}

initApp();
