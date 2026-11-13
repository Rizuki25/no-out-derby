import { describe, expect, it } from 'vitest';
import { CareerRecordsStore, StorageLike } from '../game/CareerRecords.ts';
import {
  FullscreenDocLike,
  ScreenLike,
  canRequestNativeFullscreen,
  isFullscreenActive,
  resetFallbackFullscreen,
  toggleAppFullscreen,
} from '../game/Fullscreen.ts';
import { MatchState } from '../game/MatchState.ts';
import {
  computeCanvasDisplaySize,
  cycleDisplayMode,
  getDisplayModeLabel,
  getMobileOrientation,
  getTouchHudVisibility,
  shouldShowMobilePad,
} from '../game/MobileLayout.ts';
import { MatchConfig } from '../types.ts';

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

describe('Mobile Display Mode & Handheld Touch Layout', () => {
  it('cycles displayMode reliably and maps UI labels', () => {
    expect(cycleDisplayMode('auto', 1)).toBe('mobile');
    expect(cycleDisplayMode('mobile', 1)).toBe('desktop');
    expect(cycleDisplayMode('desktop', 1)).toBe('auto');
    expect(cycleDisplayMode('auto', -1)).toBe('desktop');

    expect(getDisplayModeLabel('auto')).toBe('AUTO');
    expect(getDisplayModeLabel('mobile')).toBe('MOBILE');
    expect(getDisplayModeLabel('desktop')).toBe('PC');
  });

  it('auto-detects touch/coarse viewports while honoring explicit mobile and desktop overrides', () => {
    const desktopEnv = {
      hasTouch: false,
      coarsePointer: false,
      viewportWidth: 1440,
      viewportHeight: 900,
    };
    const phoneEnv = {
      hasTouch: true,
      coarsePointer: true,
      viewportWidth: 390,
      viewportHeight: 844,
    };
    const touchLaptopEnv = {
      hasTouch: true,
      coarsePointer: false,
      viewportWidth: 1366,
      viewportHeight: 768,
    };

    expect(shouldShowMobilePad('auto', desktopEnv)).toBe(false);
    expect(shouldShowMobilePad('auto', phoneEnv)).toBe(true);
    expect(shouldShowMobilePad('auto', touchLaptopEnv)).toBe(false);

    // Explicit overrides work everywhere (including PC testing in browser)
    expect(shouldShowMobilePad('mobile', desktopEnv)).toBe(true);
    expect(shouldShowMobilePad('desktop', phoneEnv)).toBe(false);
  });

  it('keeps portrait canvas unobstructed above deck and preserves 16:9 ratio in landscape', () => {
    expect(getMobileOrientation(390, 844)).toBe('portrait');
    expect(getMobileOrientation(844, 390)).toBe('landscape');

    const portraitInMatch = computeCanvasDisplaySize(390, 844, true, true);
    expect(portraitInMatch.portraitDeck).toBe(true);
    expect(portraitInMatch.width).toBe(390);
    expect(portraitInMatch.height).toBeLessThanOrEqual(Math.floor(844 * 0.45));
    expect(Math.abs(portraitInMatch.width / portraitInMatch.height - 16 / 9)).toBeLessThan(0.05);

    const landscapeInMatch = computeCanvasDisplaySize(844, 390, true, true);
    expect(landscapeInMatch.portraitDeck).toBe(false);
    expect(landscapeInMatch.height).toBe(390);
    expect(landscapeInMatch.width).toBe(693);
    expect(Math.abs(landscapeInMatch.width / landscapeInMatch.height - 16 / 9)).toBeLessThan(0.05);
  });

  it('shows touch pad during gameplay, exposes special sandbox/replay/switch buttons, and shows menu fullscreen bar in menus', () => {
    const menuHud = getTouchHudVisibility('MENU', false, true, true);
    expect(menuHud.showOverlay).toBe(false);
    expect(menuHud.showMenuBar).toBe(true);

    const pausedHud = getTouchHudVisibility('PAUSED', false, true, true);
    expect(pausedHud.showOverlay).toBe(false);
    expect(pausedHud.showMenuBar).toBe(true);

    const ftHud = getTouchHudVisibility('FULL_TIME', false, true, true);
    expect(ftHud.showOverlay).toBe(false);
    expect(ftHud.showMenuBar).toBe(true);

    const desktopMenuHud = getTouchHudVisibility('MENU', false, true, false);
    expect(desktopMenuHud.showMenuBar).toBe(false);

    const playing3v3 = getTouchHudVisibility('PLAYING', false, true, true);
    expect(playing3v3.showOverlay).toBe(true);
    expect(playing3v3.showMenuBar).toBe(false);
    expect(playing3v3.showGameplayControls).toBe(true);
    expect(playing3v3.showSwitchButton).toBe(true);
    expect(playing3v3.showReplaySkip).toBe(false);
    expect(playing3v3.showSandboxBar).toBe(false);

    const replayHud = getTouchHudVisibility('REPLAY', false, true, true);
    expect(replayHud.showOverlay).toBe(true);
    expect(replayHud.showGameplayControls).toBe(false);
    expect(replayHud.showReplaySkip).toBe(true);

    const sandboxHud = getTouchHudVisibility('PLAYING', true, false, true);
    expect(sandboxHud.showOverlay).toBe(true);
    expect(sandboxHud.showSandboxBar).toBe(true);
    expect(sandboxHud.showSwitchButton).toBe(false);
  });

  it('exposes canHumanSwitchPlayer correctly on MatchState and persists displayMode in CareerRecordsStore', () => {
    const match = new MatchState();
    const base: MatchConfig = {
      mode: '3v3_ai',
      arena: 'classic',
      pitchSize: 'standard',
      controlStyle: 'dribble',
      displayMode: 'mobile',
      difficulty: 'pro',
      durationSeconds: 90,
      mutatorsEnabled: true,
    };

    match.startMatch(base);
    expect(match.canHumanSwitchPlayer()).toBe(true);

    match.startMatch({ ...base, mode: '3v3_coop' });
    expect(match.canHumanSwitchPlayer()).toBe(false);

    match.startMatch({ ...base, mode: '1v1_ai' });
    expect(match.canHumanSwitchPlayer()).toBe(false);

    const storage = createMemoryStorage();
    const store = new CareerRecordsStore(storage);
    store.savePreferences({ ...base, displayMode: 'mobile' }, false);
    expect(store.loadPreferences({ ...base, displayMode: 'auto' }).config.displayMode).toBe('mobile');

    storage.setItem('no_out_derby_preferences_v1', JSON.stringify({ displayMode: 'tablet_bad' }));
    expect(store.loadPreferences({ ...base, displayMode: 'auto' }).config.displayMode).toBe('auto');
  });
});

describe('Fullscreen Helper & Orientation Lock', () => {
  it('detects native fullscreen capability across standard and webkit APIs', () => {
    expect(canRequestNativeFullscreen(null)).toBe(false);
    expect(canRequestNativeFullscreen({ fullscreenEnabled: false, documentElement: {} })).toBe(false);
    expect(
      canRequestNativeFullscreen({
        fullscreenEnabled: true,
        documentElement: { requestFullscreen: async () => undefined },
      })
    ).toBe(true);
    expect(
      canRequestNativeFullscreen({
        webkitFullscreenEnabled: true,
        documentElement: { webkitRequestFullscreen: () => undefined },
      })
    ).toBe(true);
  });

  it('enters native fullscreen, locks landscape on mobile, and exits cleanly with unlock', async () => {
    resetFallbackFullscreen();
    let lockedTo: string | null = null;
    let unlocked = false;
    let exitCount = 0;
    const fakeEl = {} as Element;

    const doc: FullscreenDocLike = {
      fullscreenEnabled: true,
      fullscreenElement: null,
      documentElement: {
        requestFullscreen: async () => {
          doc.fullscreenElement = fakeEl;
        },
      },
      exitFullscreen: async () => {
        exitCount++;
        doc.fullscreenElement = null;
      },
    };
    const scr: ScreenLike = {
      orientation: {
        lock: async (mode) => {
          lockedTo = mode;
        },
        unlock: () => {
          unlocked = true;
        },
      },
    };

    const enterRes = await toggleAppFullscreen(true, doc, scr);
    expect(enterRes).toEqual({ active: true, mode: 'native' });
    expect(isFullscreenActive(doc)).toBe(true);
    expect(lockedTo).toBe('landscape');

    const exitRes = await toggleAppFullscreen(true, doc, scr);
    expect(exitRes).toEqual({ active: false, mode: 'exited' });
    expect(exitCount).toBe(1);
    expect(unlocked).toBe(true);
    expect(isFullscreenActive(doc)).toBe(false);
  });

  it('falls back cleanly to immersive viewport mode when native fullscreen is unsupported or rejected', async () => {
    resetFallbackFullscreen();
    const unsupportedDoc: FullscreenDocLike = {
      fullscreenEnabled: false,
      documentElement: {},
    };

    const enterFallback = await toggleAppFullscreen(true, unsupportedDoc, null);
    expect(enterFallback).toEqual({ active: true, mode: 'fallback' });
    expect(isFullscreenActive(unsupportedDoc)).toBe(true);

    const exitFallback = await toggleAppFullscreen(true, unsupportedDoc, null);
    expect(exitFallback).toEqual({ active: false, mode: 'exited' });
    expect(isFullscreenActive(unsupportedDoc)).toBe(false);
  });
});
