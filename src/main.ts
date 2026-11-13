import {
  AIDifficulty,
  ARENA_CONSTANTS,
  ArenaId,
  GameEvent,
  GameMode,
  MatchConfig,
  MatchDurationOption,
  NATIVE_HEIGHT,
  NATIVE_WIDTH,
  PitchSize,
} from './types.ts';
import { ARENA_LIST, PITCH_SIZE_LIST } from './engine/ArenaPresets.ts';
import { GameLoop } from './engine/GameLoop.ts';
import { CareerRecordsStore } from './game/CareerRecords.ts';
import { MatchState } from './game/MatchState.ts';
import { InputManager } from './game/InputManager.ts';
import {
  computeCanvasDisplaySize,
  cycleDisplayMode,
  getTouchHudVisibility,
} from './game/MobileLayout.ts';
import { ALL_MUTATORS } from './game/MutatorManager.ts';
import { SoundEngine } from './audio/SoundEngine.ts';
import { ParticleSystem } from './render/ParticleSystem.ts';
import { Renderer } from './render/Renderer.ts';
import { cycleTeamKit } from './render/TeamKits.ts';
import { UIRenderer } from './render/UIRenderer.ts';

const MODE_LIST: GameMode[] = [
  '1v1_ai',
  '2v2_ai',
  '3v3_ai',
  'derby_cup_1v1',
  'derby_cup_2v2',
  'derby_cup_3v3',
  '1v1_local',
  '2v2_local',
  '3v3_local',
  '2v2_coop',
  '3v3_coop',
  'practice_sandbox',
];
const DIFF_LIST: AIDifficulty[] = ['rookie', 'pro', 'tarkam'];
const DUR_LIST: MatchDurationOption[] = [60, 90, 120];

function cycleValue<T>(list: readonly T[], current: T, dir: 1 | -1): T {
  const idx = list.indexOf(current);
  const safeIdx = idx >= 0 ? idx : 0;
  return list[(safeIdx + dir + list.length) % list.length];
}

function initApp(): void {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('Canvas #game-canvas not found');

  canvas.width = NATIVE_WIDTH;
  canvas.height = NATIVE_HEIGHT;

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('2D context unavailable');
  ctx.imageSmoothingEnabled = false;

  const match = new MatchState();
  const input = new InputManager();
  const sound = new SoundEngine();
  const particles = new ParticleSystem();
  const renderer = new Renderer(particles);
  const ui = new UIRenderer();
  const career = new CareerRecordsStore();

  const loadedPrefs = career.loadPreferences({
    ...match.config,
    pitchSize: 'standard',
    controlStyle: 'dribble',
    displayMode: 'auto',
    teamAKit: 'garuda',
    teamBKit: 'cyber',
  });
  let menuConfig: MatchConfig = loadedPrefs.config;
  input.setDisplayMode(menuConfig.displayMode ?? 'auto');
  if (loadedPrefs.muted && !sound.isMuted()) {
    sound.toggleMute();
  }
  let recordedCurrentResult = false;
  let lastCanvasW = 0;
  let lastCanvasH = 0;

  const syncMobileLayoutAndHud = () => {
    const mobileActive = input.isMobileLayoutActive();
    const visibility = getTouchHudVisibility(
      match.phase,
      match.isPracticeSandbox(),
      match.canHumanSwitchPlayer(),
      mobileActive
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
    const p1 = match.players.find((p) => p.humanSlot === 1);
    const chargeRatio = p1?.isCharging
      ? Math.min(1, p1.chargeTime / ARENA_CONSTANTS.MAX_CHARGE_TIME)
      : 0;
    input.syncMobileHud({
      visibility,
      controlStyle: (menuConfig.controlStyle ?? 'classic'),
      displayMode: menuConfig.displayMode ?? 'auto',
      muted: sound.isMuted(),
      kickChargeRatio: chargeRatio,
      dashOnCooldown: Boolean(p1 && p1.dashCooldown > 0),
      portraitDeck: metrics.portraitDeck,
      portraitDeckTopPx:
        metrics.portraitDeck && visibility.showOverlay ? metrics.height + 16 : null,
    });
  };
  window.addEventListener('resize', syncMobileLayoutAndHud);
  syncMobileLayoutAndHud();

  const handleEvents = (events: GameEvent[]) => {
    if (events.length === 0) return;
    sound.handleEvents(events);
    particles.handleEvents(events);
    renderer.handleEvents(events);

    for (const ev of events) {
      if (ev.type === 'kick' && (ev.isOneTimer || ev.power >= 0.78)) {
        loop.triggerHitstop(ev.isOneTimer ? 0.058 : 0.05);
      } else if (ev.type === 'hot_potato_boom') {
        loop.triggerHitstop(0.055);
      } else if (ev.type === 'goal') {
        loop.triggerSlowMo(0.72, 0.34);
      } else if (ev.type === 'mutator_start') {
        ui.triggerMutatorBanner(ev.label, ev.subtitle);
      }
    }
  };

  const resetVisualsForMatch = () => {
    sound.setBgmFastMode(false);
    particles.clear();
    particles.setTeamKits(menuConfig.teamAKit ?? 'garuda', menuConfig.teamBKit ?? 'cyber');
    renderer.clearEffects();
    loop.clearEffects();
    recordedCurrentResult = false;
    ui.menuOverlay = 'none';
    ui.pauseGuideOpen = false;
    ui.resetArmed = false;
    ui.resultRow = 0;
    ui.pauseRow = 0;
    ui.perkIndex = 0;
    ui.championRow = 0;
  };

  const startMatch = () => {
    sound.unlock();
    sound.playMenuBlip(true);
    sound.startBgm();
    resetVisualsForMatch();
    const evs = match.startMatch(menuConfig);
    handleEvents(evs);
    syncMobileLayoutAndHud();
  };

  const rematch = () => {
    sound.unlock();
    sound.playMenuBlip(true);
    resetVisualsForMatch();
    const evs = match.rematch();
    handleEvents(evs);
  };

  const advanceCup = () => {
    sound.playMenuBlip(true);
    ui.perkIndex = 0;
    ui.championRow = 0;
    match.advanceFromCupResult();
  };

  const selectPerk = (choiceIdx: number) => {
    sound.playMenuBlip(true);
    resetVisualsForMatch();
    const evs = match.pickCupPerk(choiceIdx);
    handleEvents(evs);
  };

  const skipReplay = () => {
    if (match.phase !== 'REPLAY') return;
    sound.playMenuBlip(false);
    const evs = match.skipReplay();
    handleEvents(evs);
  };

  const quitToMenu = () => {
    sound.playMenuBlip(false);
    resetVisualsForMatch();
    match.returnToMenu();
    ui.menuRow = 0;
  };

  const togglePause = () => {
    if (match.phase === 'PLAYING' || match.phase === 'KICKOFF' || match.phase === 'PAUSED') {
      sound.playMenuBlip(false);
      match.togglePause();
      ui.pauseRow = 0;
      ui.pauseGuideOpen = false;
    }
  };

  const toggleMute = () => {
    sound.unlock();
    sound.toggleMute();
    career.savePreferences(menuConfig, sound.isMuted());
  };

  const updateConfig = (patch: Partial<MatchConfig>) => {
    sound.playMenuBlip(false);
    menuConfig = { ...menuConfig, ...patch };
    career.savePreferences(menuConfig, sound.isMuted());
  };

  const cycleViewMode = () => {
    sound.unlock();
    const next = cycleDisplayMode(menuConfig.displayMode ?? 'auto', 1);
    updateConfig({ displayMode: next });
    match.config.displayMode = next;
    input.setDisplayMode(next);
    syncMobileLayoutAndHud();
  };

  const openGuide = () => {
    sound.playMenuBlip(false);
    ui.guidePage = 0;
    ui.resetArmed = false;
    if (match.phase === 'MENU') {
      ui.menuOverlay = 'guide';
    } else if (match.phase === 'PAUSED') {
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
      menuConfig.mode === 'derby_cup_3v3';
    const isSandbox = menuConfig.mode === 'practice_sandbox';
    const aiUsed = menuConfig.mode !== '1v1_local' && !isCup;
    const kitA = menuConfig.teamAKit ?? 'garuda';
    const kitB = menuConfig.teamBKit ?? 'cyber';

    if (row === 1) {
      updateConfig({ mode: cycleValue(MODE_LIST, menuConfig.mode, dir) });
    } else if (row === 2) {
      updateConfig({
        controlStyle: (menuConfig.controlStyle ?? 'classic') === 'dribble' ? 'classic' : 'dribble',
      });
    } else if (row === 3 && !isCup) {
      updateConfig({ arena: cycleValue<ArenaId>(ARENA_LIST, menuConfig.arena ?? 'classic', dir) });
    } else if (row === 4) {
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
    const nav = input.getMenuActions();
    if (nav.mute) {
      toggleMute();
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

    if (match.phase === 'PAUSED') {
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
      if (nav.pause || nav.back) {
        togglePause();
        return;
      }
      if (nav.up) {
        sound.playMenuBlip(false);
        ui.pauseRow = (ui.pauseRow + 4) % 5;
      } else if (nav.down) {
        sound.playMenuBlip(false);
        ui.pauseRow = (ui.pauseRow + 1) % 5;
      } else if ((nav.left || nav.right) && ui.pauseRow === 2) {
        cycleViewMode();
      } else if (nav.confirm) {
        if (ui.pauseRow === 0) togglePause();
        else if (ui.pauseRow === 1) rematch();
        else if (ui.pauseRow === 2) cycleViewMode();
        else if (ui.pauseRow === 3) openGuide();
        else quitToMenu();
      }
      return;
    }

    if (match.phase === 'FULL_TIME') {
      if (nav.up || nav.down || nav.left || nav.right) {
        sound.playMenuBlip(false);
        ui.resultRow = ui.resultRow === 0 ? 1 : 0;
      } else if (nav.confirm) {
        if (ui.resultRow === 0) {
          if (match.cup.active && match.winner === 'A') advanceCup();
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
    onSkipReplay: skipReplay,
    onSandboxAction: triggerSandboxCommand,
  });

  const handleSandboxInput = () => {
    if (!match.isPracticeSandbox() || match.phase !== 'PLAYING') return;

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

  canvas.addEventListener('pointerdown', (e) => {
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

  const loop = new GameLoop(
    (dt) => {
      handleUiInput();
      handleSandboxInput();

      const simPaused =
        match.phase === 'MENU' ||
        match.phase === 'PAUSED' ||
        match.phase === 'FULL_TIME' ||
        match.phase === 'PERK_SELECT' ||
        match.phase === 'CUP_CHAMPION';

      if (!simPaused) {
        const humanInputs = input.getPlayerInputs(match.isTwoPlayerMode());
        const evs = match.update(dt, humanInputs);
        handleEvents(evs);
        if (match.phase === 'FULL_TIME' && !recordedCurrentResult) {
          const wonCupTournament =
            match.cup.active && match.winner === 'A' && match.cup.isFinalRound();
          career.recordCompletedMatch({
            isPracticeSandbox: match.isPracticeSandbox(),
            winner: match.winner,
            scoreA: match.scoreA,
            stats: match.stats,
            wonCupTournament,
          });
          recordedCurrentResult = true;
        }
        if (match.phase !== 'REPLAY') {
          particles.update(dt);
        }
        sound.setBgmFastMode(match.isFinalStretch() || match.isGoldenGoal);
      }

      input.endFrame();
    },
    () => {
      ctx.imageSmoothingEnabled = false;
      const showField =
        match.phase !== 'MENU' && match.phase !== 'PERK_SELECT' && match.phase !== 'CUP_CHAMPION';
      if (showField) {
        renderer.renderArenaAndEntities(ctx, match);
      }
      ui.render(ctx, match, menuConfig, sound.isMuted(), career.getRecords(), {
        onStartMatch: startMatch,
        onUpdateConfig: updateConfig,
        onResume: togglePause,
        onRematch: rematch,
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
      });
    },
    (rawDt) => {
      ui.update(rawDt);
      renderer.updateEffects(rawDt, match);
      syncMobileLayoutAndHud();
    }
  );

  loop.start();
}

initApp();
