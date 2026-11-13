import { DisplayMode, MatchPhase, NATIVE_HEIGHT, NATIVE_WIDTH } from '../types.ts';

export const DISPLAY_MODE_LIST: readonly DisplayMode[] = ['auto', 'mobile', 'desktop'];

export interface MobileEnvMetrics {
  hasTouch: boolean;
  coarsePointer: boolean;
  viewportWidth: number;
  viewportHeight: number;
}

export interface CanvasDisplayMetrics {
  width: number;
  height: number;
  orientation: 'portrait' | 'landscape';
  portraitDeck: boolean;
}

export interface TouchHudVisibility {
  showOverlay: boolean;
  showGameplayControls: boolean;
  showSwitchButton: boolean;
  showReplaySkip: boolean;
  showSandboxBar: boolean;
}

/**
 * Cycles display mode (`auto` -> `mobile` -> `desktop`).
 */
export function cycleDisplayMode(current: DisplayMode = 'auto', dir: 1 | -1 = 1): DisplayMode {
  const idx = DISPLAY_MODE_LIST.indexOf(current);
  const safeIdx = idx >= 0 ? idx : 0;
  return DISPLAY_MODE_LIST[(safeIdx + dir + DISPLAY_MODE_LIST.length) % DISPLAY_MODE_LIST.length];
}

/**
 * Returns crisp pixel-font uppercase label for UI pills and pause rows.
 */
export function getDisplayModeLabel(mode: DisplayMode = 'auto'): string {
  if (mode === 'mobile') return 'MOBILE';
  if (mode === 'desktop') return 'PC';
  return 'AUTO';
}

/**
 * Determines whether mobile touch controls & layout should be active.
 */
export function shouldShowMobilePad(displayMode: DisplayMode, env: MobileEnvMetrics): boolean {
  if (displayMode === 'mobile') return true;
  if (displayMode === 'desktop') return false;
  if (env.coarsePointer) return true;
  return env.hasTouch && (env.viewportWidth <= 1024 || env.viewportHeight <= 640);
}

/**
 * Determines mobile layout orientation from viewport aspect ratio.
 */
export function getMobileOrientation(
  viewportWidth: number,
  viewportHeight: number
): 'portrait' | 'landscape' {
  return viewportHeight > viewportWidth ? 'portrait' : 'landscape';
}

/**
 * Computes responsive canvas pixel dimensions that preserve 16:9 aspect ratio
 * and leave an unobstructed handheld controller deck in portrait mobile mode.
 */
export function computeCanvasDisplaySize(
  viewportWidth: number,
  viewportHeight: number,
  mobileActive: boolean,
  inMatchPhase: boolean
): CanvasDisplayMetrics {
  const vw = Math.max(240, viewportWidth);
  const vh = Math.max(200, viewportHeight);
  const orientation = getMobileOrientation(vw, vh);
  const portraitDeck = mobileActive && orientation === 'portrait';

  if (portraitDeck) {
    // Upper screen holds the 16:9 pitch/menu; bottom deck stays clear of the field
    const maxW = Math.max(220, vw - 12);
    const maxH = inMatchPhase ? Math.max(124, Math.floor(vh * 0.44)) : Math.max(150, Math.floor(vh * 0.62));
    const scale = Math.min(maxW / NATIVE_WIDTH, maxH / NATIVE_HEIGHT);
    return {
      width: Math.floor(NATIVE_WIDTH * scale),
      height: Math.floor(NATIVE_HEIGHT * scale),
      orientation,
      portraitDeck: true,
    };
  }

  // Landscape mobile reserves subtle side breathing room when playing so edge pads feel airy
  const padX = mobileActive && inMatchPhase ? Math.min(28, Math.floor(vw * 0.03)) : 0;
  const padY = mobileActive && inMatchPhase ? Math.min(10, Math.floor(vh * 0.02)) : 0;
  const availW = Math.max(240, vw - padX);
  const availH = Math.max(160, vh - padY);
  const fitScale = Math.min(availW / NATIVE_WIDTH, availH / NATIVE_HEIGHT);
  const intScale = Math.floor(fitScale);
  const useScale =
    !mobileActive && intScale >= 1 && intScale / fitScale >= 0.72 ? intScale : fitScale;

  return {
    width: Math.floor(NATIVE_WIDTH * useScale),
    height: Math.floor(NATIVE_HEIGHT * useScale),
    orientation,
    portraitDeck: false,
  };
}

/**
 * Returns phase-aware visibility flags so menus/overlays stay unobstructed
 * and special actions (Switch, Skip Replay, Sandbox hotkeys) appear only when relevant.
 */
export function getTouchHudVisibility(
  phase: MatchPhase,
  isSandbox: boolean,
  canSwitch: boolean,
  mobileActive: boolean
): TouchHudVisibility {
  const isGameplayPhase =
    phase === 'KICKOFF' ||
    phase === 'PLAYING' ||
    phase === 'GOAL_CELEBRATION' ||
    phase === 'GOLDEN_GOAL_INTRO' ||
    phase === 'REPLAY';

  if (!mobileActive || !isGameplayPhase) {
    return {
      showOverlay: false,
      showGameplayControls: false,
      showSwitchButton: false,
      showReplaySkip: false,
      showSandboxBar: false,
    };
  }

  const isReplay = phase === 'REPLAY';
  return {
    showOverlay: true,
    showGameplayControls: !isReplay,
    showSwitchButton: !isReplay && canSwitch,
    showReplaySkip: isReplay,
    showSandboxBar: isSandbox && (phase === 'PLAYING' || phase === 'KICKOFF'),
  };
}
