import { DisplayMode, MatchPhase, NATIVE_HEIGHT, NATIVE_WIDTH } from '../types.ts';

export const DISPLAY_MODE_LIST: readonly DisplayMode[] = ['auto', 'mobile', 'desktop'];

export interface MobileEnvMetrics {
  hasTouch: boolean;
  coarsePointer: boolean;
  viewportWidth: number;
  viewportHeight: number;
  hasExternalGamepad?: boolean;
}

export interface CanvasDisplayMetrics {
  width: number;
  height: number;
  orientation: 'portrait' | 'landscape';
  portraitDeck: boolean;
}

export interface TouchHudVisibility {
  showOverlay: boolean;
  showMenuBar: boolean;
  showGameplayControls: boolean;
  showSwitchButton: boolean;
  showTacticButton: boolean;
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
  if (env.hasExternalGamepad) return false;
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
    // Upper screen fills 100% width; during a match, reserve lower deck for joystick/buttons
    const maxW = vw;
    const maxH = inMatchPhase
      ? Math.max(124, Math.floor(vh * 0.45))
      : Math.max(150, Math.floor(vh * 0.78));
    const scale = Math.min(maxW / NATIVE_WIDTH, maxH / NATIVE_HEIGHT);
    return {
      width: Math.floor(NATIVE_WIDTH * scale),
      height: Math.floor(NATIVE_HEIGHT * scale),
      orientation,
      portraitDeck: true,
    };
  }

  // Landscape (mobile & fullscreen) expands edge-to-edge preserving crisp 16:9 ratio
  const fitScale = Math.min(vw / NATIVE_WIDTH, vh / NATIVE_HEIGHT);
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
  mobileActive: boolean,
  canTactics = false
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
      showMenuBar: mobileActive && !isGameplayPhase,
      showGameplayControls: false,
      showSwitchButton: false,
      showTacticButton: false,
      showReplaySkip: false,
      showSandboxBar: false,
    };
  }

  const isReplay = phase === 'REPLAY';
  return {
    showOverlay: true,
    showMenuBar: false,
    showGameplayControls: !isReplay,
    showSwitchButton: !isReplay && canSwitch,
    showTacticButton: !isReplay && canTactics && !isSandbox,
    showReplaySkip: isReplay,
    showSandboxBar: isSandbox && (phase === 'PLAYING' || phase === 'KICKOFF'),
  };
}
