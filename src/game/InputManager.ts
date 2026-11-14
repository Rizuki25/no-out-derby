import { ControlStyle, DisplayMode, PlayerInput, TeamTactic } from '../types.ts';
import {
  TouchHudVisibility,
  getDisplayModeLabel,
  getMobileOrientation,
  shouldShowMobilePad,
} from './MobileLayout.ts';

export interface MobileActionHandlers {
  onPause: () => void;
  onToggleMute: () => void;
  onCycleView: () => void;
  onToggleFullscreen: () => void;
  onSkipReplay: () => void;
  onSandboxAction: (action: string) => void;
  onCycleTactic?: () => void;
}

export interface ConnectedGamepadInfo {
  index: number;
  slot: 1 | 2;
  id: string;
  shortName: string;
  mapping: string;
  hasRumble: boolean;
}

export interface GamepadConnectionNotice {
  connected: boolean;
  slot: 1 | 2;
  shortName: string;
}

export interface GamepadSnapshot {
  moveX: number;
  moveY: number;
  kickHeld: boolean;
  kickJustPressed: boolean;
  kickJustReleased: boolean;
  dashJustPressed: boolean;
  switchJustPressed: boolean;
  passJustPressed: boolean;
  feverJustPressed: boolean;
  tacticCycleJustPressed: boolean;
  startJustPressed: boolean;
  backJustPressed: boolean;
  upJustPressed: boolean;
  downJustPressed: boolean;
  leftJustPressed: boolean;
  rightJustPressed: boolean;
}

export interface MobileHudSyncState {
  visibility: TouchHudVisibility;
  controlStyle: ControlStyle;
  displayMode: DisplayMode;
  muted: boolean;
  kickChargeRatio: number;
  dashOnCooldown: boolean;
  portraitDeck: boolean;
  portraitDeckTopPx?: number | null;
  isFullscreen: boolean;
  isPortrait: boolean;
  showFeintHint?: boolean;
  teamFeverPct?: number;
  teamFeverActive?: boolean;
  teamTactic?: TeamTactic;
}

export class InputManager {
  private heldCodes = new Set<string>();
  private justPressedCodes = new Set<string>();
  private justReleasedCodes = new Set<string>();

  private prevGamepadButtons: boolean[][] = [];
  private lastGamepadButtons: boolean[][] = [];
  private prevStickNavDirs: Array<{ up: boolean; down: boolean; left: boolean; right: boolean }> = [];
  private lastStickNavDirs: Array<{ up: boolean; down: boolean; left: boolean; right: boolean }> = [];
  private connectedGamepads: ConnectedGamepadInfo[] = [];
  private prevConnectedKeys: Array<string | null> = [null, null];
  private gamepadNotices: GamepadConnectionNotice[] = [];
  private displayMode: DisplayMode = 'auto';
  private hasTouchSeen = false;
  private mobileOverlayShowing = false;
  private touchMoveX = 0;
  private touchMoveY = 0;
  private touchKickHeld = false;
  private touchKickJustReleased = false;
  private touchDashJustPressed = false;
  private touchSwitchJustPressed = false;
  private touchPassJustPressed = false;
  private touchFeverJustPressed = false;
  private resetTouchVisuals: (() => void) | null = null;
  private mobileHandlers: MobileActionHandlers | null = null;
  private readonly touchCleanups: Array<() => void> = [];

  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;
  private boundBlur: () => void;
  private boundGamepadChange: () => void;

  constructor() {
    this.boundKeyDown = (e: KeyboardEvent) => this.onKeyDown(e);
    this.boundKeyUp = (e: KeyboardEvent) => this.onKeyUp(e);
    this.boundBlur = () => this.clearAll();
    this.boundGamepadChange = () => {
      this.readGamepads();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.boundKeyDown);
      window.addEventListener('keyup', this.boundKeyUp);
      window.addEventListener('blur', this.boundBlur);
      window.addEventListener('gamepadconnected', this.boundGamepadChange);
      window.addEventListener('gamepaddisconnected', this.boundGamepadChange);
    }
    this.setupTouchControls();
  }

  destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.boundKeyDown);
      window.removeEventListener('keyup', this.boundKeyUp);
      window.removeEventListener('blur', this.boundBlur);
      window.removeEventListener('gamepadconnected', this.boundGamepadChange);
      window.removeEventListener('gamepaddisconnected', this.boundGamepadChange);
    }
    // Touch/pointer listeners live on persistent DOM nodes, so they must be released explicitly.
    for (const cleanup of this.touchCleanups) {
      cleanup();
    }
    this.touchCleanups.length = 0;
    this.resetTouchVisuals = null;
    this.hudEls = null;
    this.hudWritten.clear();
  }

  /** Adds a listener and records how to remove it, so destroy() leaves no handlers behind. */
  private listen<E extends Event>(
    target: EventTarget,
    type: string,
    handler: (e: E) => void,
    options?: AddEventListenerOptions | boolean
  ): void {
    const bound = handler as unknown as EventListener;
    target.addEventListener(type, bound, options);
    this.touchCleanups.push(() => target.removeEventListener(type, bound, options));
  }

  private clearAll(): void {
    this.heldCodes.clear();
    this.justPressedCodes.clear();
    this.justReleasedCodes.clear();
    this.prevGamepadButtons = [];
    this.lastGamepadButtons = [];
    this.prevStickNavDirs = [];
    this.lastStickNavDirs = [];
    this.resetActiveTouchInput();
  }

  private resetActiveTouchInput(): void {
    this.touchMoveX = 0;
    this.touchMoveY = 0;
    this.touchKickHeld = false;
    this.resetTouchVisuals?.();
  }

  private isTextInputTarget(target: EventTarget | null): boolean {
    if (!target || typeof target !== 'object') {
      return false;
    }
    if (
      (typeof HTMLInputElement !== 'undefined' &&
        target instanceof HTMLInputElement) ||
      (typeof HTMLTextAreaElement !== 'undefined' &&
        target instanceof HTMLTextAreaElement) ||
      (typeof HTMLElement !== 'undefined' &&
        target instanceof HTMLElement &&
        target.isContentEditable)
    ) {
      return true;
    }
    const maybeEl = target as { tagName?: unknown; isContentEditable?: unknown };
    const tag =
      typeof maybeEl.tagName === 'string' ? maybeEl.tagName.toUpperCase() : '';
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      maybeEl.isContentEditable === true
    );
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.isTextInputTarget(e.target)) {
      return;
    }
    const preventKeys = [
      'Space',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Enter',
      'Numpad0',
      'Numpad1',
      'Numpad2',
      'Tab',
    ];
    if (preventKeys.includes(e.code)) {
      e.preventDefault();
    }
    if (!this.heldCodes.has(e.code)) {
      this.justPressedCodes.add(e.code);
    }
    this.heldCodes.add(e.code);
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (this.heldCodes.has(e.code)) {
      this.heldCodes.delete(e.code);
      this.justReleasedCodes.add(e.code);
    }
  }

  /** Must be called at the end of every fixed frame/poll cycle to clear edge triggers */
  endFrame(): void {
    this.justPressedCodes.clear();
    this.justReleasedCodes.clear();
    this.touchKickJustReleased = false;
    this.touchDashJustPressed = false;
    this.touchSwitchJustPressed = false;
    this.touchPassJustPressed = false;
    this.touchFeverJustPressed = false;
    // Commit gamepad state once per frame so every poll in the same frame sees the same edges.
    this.prevGamepadButtons = this.lastGamepadButtons.map((buttons) => [...buttons]);
    this.prevStickNavDirs = this.lastStickNavDirs.map((dir) => ({ ...dir }));
  }

  getConnectedGamepads(): ConnectedGamepadInfo[] {
    return this.connectedGamepads.map((g) => ({ ...g }));
  }

  hasExternalGamepad(): boolean {
    if (this.connectedGamepads.length > 0) return true;
    if (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
      this.readGamepads();
    }
    return this.connectedGamepads.length > 0;
  }

  drainGamepadNotices(): GamepadConnectionNotice[] {
    if (this.gamepadNotices.length === 0) return [];
    const copy = [...this.gamepadNotices];
    this.gamepadNotices.length = 0;
    return copy;
  }

  triggerRumble(
    slot: 1 | 2 | 'all',
    durationMs: number,
    strongMagnitude: number,
    weakMagnitude: number
  ): void {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const rawPads = navigator.getGamepads();
    for (const info of this.connectedGamepads) {
      if (slot !== 'all' && info.slot !== slot) continue;
      const raw = rawPads[info.index] as
        | (Gamepad & {
            vibrationActuator?: {
              playEffect?: (
                type: string,
                params: {
                  duration: number;
                  strongMagnitude: number;
                  weakMagnitude: number;
                }
              ) => Promise<unknown>;
            };
          })
        | null
        | undefined;
      try {
        void raw?.vibrationActuator?.playEffect?.('dual-rumble', {
          duration: Math.max(20, Math.round(durationMs)),
          strongMagnitude: Math.max(0, Math.min(1, strongMagnitude)),
          weakMagnitude: Math.max(0, Math.min(1, weakMagnitude)),
        });
      } catch {
        // Ignore browsers or controllers that reject rumble requests.
      }
    }
  }

  wasKeyJustPressed(code: string): boolean {
    return this.justPressedCodes.has(code);
  }

  setDisplayMode(mode: DisplayMode): void {
    this.displayMode = mode;
    if (!this.isMobileLayoutActive()) {
      this.resetActiveTouchInput();
    }
  }

  getDisplayMode(): DisplayMode {
    return this.displayMode;
  }

  setMobileActionHandlers(handlers: MobileActionHandlers): void {
    this.mobileHandlers = handlers;
  }

  isMobileLayoutActive(): boolean {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return this.displayMode === 'mobile';
    }
    const coarse = Boolean(window.matchMedia?.('(pointer: coarse)').matches);
    const hasTouch = this.hasTouchSeen || (navigator.maxTouchPoints ?? 0) > 0;
    return shouldShowMobilePad(this.displayMode, {
      hasTouch,
      coarsePointer: coarse,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      hasExternalGamepad: this.hasExternalGamepad(),
    });
  }

  isTouchEnabled(): boolean {
    return this.isMobileLayoutActive();
  }

  /**
   * Synchronizes the mobile arcade deck / floating touch controls with live match state.
   */
  private hudEls: {
    root: HTMLElement | null;
    wrapper: HTMLElement | null;
    touchRoot: HTMLElement | null;
    playPad: HTMLElement | null;
    switchBtn: HTMLElement | null;
    passBtn: HTMLElement | null;
    feverBtn: HTMLElement | null;
    feverSub: HTMLElement | null;
    replayBar: HTMLElement | null;
    sandboxBar: HTMLElement | null;
    dashBtn: HTMLElement | null;
    dashLabel: HTMLElement | null;
    dashSub: HTMLElement | null;
    kickCharge: HTMLElement | null;
    tacticBtn: HTMLElement | null;
    muteBtn: HTMLElement | null;
    viewBtn: HTMLElement | null;
    fsBtn: HTMLElement | null;
    menuBar: HTMLElement | null;
    menuFsBtn: HTMLElement | null;
    menuPadBtn: HTMLElement | null;
  } | null = null;

  /** Last value written per HUD key so identical frames never touch the DOM. */
  private hudWritten = new Map<string, string>();

  private resolveHudEls(): NonNullable<InputManager['hudEls']> {
    if (this.hudEls) return this.hudEls;
    const byId = (id: string) => document.getElementById(id);
    const dashBtn = byId('touch-dash');
    this.hudEls = {
      root: document.documentElement,
      wrapper: byId('game-wrapper'),
      touchRoot: byId('touch-controls'),
      playPad: byId('touch-play-pad'),
      switchBtn: byId('touch-switch'),
      passBtn: byId('touch-pass'),
      feverBtn: byId('touch-fever'),
      feverSub: byId('touch-fever-sub'),
      replayBar: byId('touch-replay-bar'),
      sandboxBar: byId('touch-sandbox-bar'),
      dashBtn,
      dashLabel: byId('touch-dash-label'),
      dashSub: dashBtn?.querySelector('.touch-btn-sub') as HTMLElement | null,
      kickCharge: byId('touch-kick-charge'),
      tacticBtn: byId('touch-tactic'),
      muteBtn: byId('touch-mute'),
      viewBtn: byId('touch-view'),
      fsBtn: byId('touch-fullscreen'),
      menuBar: byId('mobile-menu-bar'),
      menuFsBtn: byId('mobile-menu-fs'),
      menuPadBtn: byId('mobile-menu-pad'),
    };
    return this.hudEls;
  }

  private writeText(key: string, el: HTMLElement | null, value: string): void {
    if (!el || this.hudWritten.get(key) === value) return;
    this.hudWritten.set(key, value);
    el.textContent = value;
  }

  private writeClass(key: string, el: Element | null, cls: string, on: boolean): void {
    if (!el) return;
    const k = `${key}:${cls}`;
    const v = on ? '1' : '0';
    if (this.hudWritten.get(k) === v) return;
    this.hudWritten.set(k, v);
    el.classList.toggle(cls, on);
  }

  private writeDisplay(key: string, el: HTMLElement | null, value: string): void {
    if (!el) return;
    const k = `${key}:display`;
    if (this.hudWritten.get(k) === value) return;
    this.hudWritten.set(k, value);
    el.style.display = value;
  }

  private writeTop(el: HTMLElement | null, value: string): void {
    if (!el || this.hudWritten.get('touchRoot:top') === value) return;
    this.hudWritten.set('touchRoot:top', value);
    el.style.top = value;
  }

  private writeHeight(el: HTMLElement | null, value: string): void {
    if (!el || this.hudWritten.get('kickCharge:height') === value) return;
    this.hudWritten.set('kickCharge:height', value);
    el.style.height = value;
  }

  /**
   * Synchronizes the mobile arcade deck / floating touch controls with live match state.
   * Runs every animation frame, so all DOM nodes are resolved once and every write is diffed
   * against the previously written value to avoid per-frame layout/style thrash.
   */
  syncMobileHud(state: MobileHudSyncState): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const els = this.resolveHudEls();
    const { visibility } = state;
    const orientation = getMobileOrientation(window.innerWidth, window.innerHeight);

    this.writeClass('root', els.root, 'immersive-fallback', state.isFullscreen);
    this.writeClass('wrapper', els.wrapper, 'in-match-deck', state.portraitDeck && visibility.showOverlay);

    this.writeClass('menuBar', els.menuBar, 'active', visibility.showMenuBar);
    this.writeClass('menuBar', els.menuBar, 'portrait', state.isPortrait);
    this.writeClass('menuBar', els.menuBar, 'landscape', !state.isPortrait);
    this.writeText('menuFs', els.menuFsBtn, state.isFullscreen ? 'KELUAR FULLSCREEN' : '[ ] FULLSCREEN MODE');
    this.writeClass('menuFs', els.menuFsBtn, 'active', state.isFullscreen);
    this.writeText('menuPad', els.menuPadBtn, `PAD:${getDisplayModeLabel(state.displayMode)}`);

    if (this.mobileOverlayShowing && !visibility.showGameplayControls) {
      this.resetActiveTouchInput();
    }
    this.mobileOverlayShowing = visibility.showGameplayControls;

    if (!els.touchRoot) return;

    this.writeClass('touchRoot', els.touchRoot, 'active', visibility.showOverlay);
    this.writeClass('touchRoot', els.touchRoot, 'portrait', orientation === 'portrait');
    this.writeClass('touchRoot', els.touchRoot, 'landscape', orientation === 'landscape');
    this.writeTop(
      els.touchRoot,
      state.portraitDeck && state.portraitDeckTopPx != null && visibility.showOverlay
        ? `${state.portraitDeckTopPx}px`
        : ''
    );

    this.writeDisplay('playPad', els.playPad, visibility.showGameplayControls ? 'flex' : 'none');
    this.writeDisplay('switchBtn', els.switchBtn, visibility.showSwitchButton ? 'flex' : 'none');
    this.writeDisplay('tacticBtn', els.tacticBtn, visibility.showTacticButton ? 'inline-flex' : 'none');
    this.writeDisplay('replayBar', els.replayBar, visibility.showReplaySkip ? 'flex' : 'none');
    this.writeDisplay('sandboxBar', els.sandboxBar, visibility.showSandboxBar ? 'flex' : 'none');

    const isFeint = Boolean(state.showFeintHint && state.controlStyle === 'dribble');
    this.writeText(
      'dashLabel',
      els.dashLabel,
      isFeint ? 'FEINT' : state.controlStyle === 'dribble' ? 'TACKLE' : 'DASH'
    );
    this.writeText(
      'dashSub',
      els.dashSub,
      isFeint ? 'DODGE' : state.controlStyle === 'dribble' ? 'STEAL' : 'BURST'
    );
    this.writeClass('dashBtn', els.dashBtn, 'is-feint', isFeint);
    this.writeClass('dashBtn', els.dashBtn, 'on-cd', state.dashOnCooldown);

    const feverPct = Math.max(0, Math.min(100, Math.floor(state.teamFeverPct ?? 0)));
    const feverActive = Boolean(state.teamFeverActive);
    const feverReady = feverPct >= 100 && !feverActive;
    this.writeClass('feverBtn', els.feverBtn, 'ready', feverReady);
    this.writeClass('feverBtn', els.feverBtn, 'burning', feverActive);
    this.writeText('feverSub', els.feverSub, feverActive ? 'BLITZ!' : feverReady ? 'READY!' : `${feverPct}%`);

    const tac = state.teamTactic ?? 'balanced';
    this.writeText('tactic', els.tacticBtn, tac === 'attack' ? 'TAC:ATK' : tac === 'defend' ? 'TAC:DEF' : 'TAC:BAL');
    this.writeClass('tactic', els.tacticBtn, 'atk', tac === 'attack');
    this.writeClass('tactic', els.tacticBtn, 'def', tac === 'defend');

    const pct = Math.max(0, Math.min(100, Math.round(state.kickChargeRatio * 100)));
    this.writeHeight(els.kickCharge, `${pct}%`);

    this.writeText('mute', els.muteBtn, state.muted ? 'SFX:OFF' : 'SFX:ON');
    this.writeClass('mute', els.muteBtn, 'muted', state.muted);
    this.writeText('view', els.viewBtn, `VIEW:${getDisplayModeLabel(state.displayMode)}`);
    this.writeText('fs', els.fsBtn, state.isFullscreen ? 'EXIT FULL' : '[ ] FULL');
    this.writeClass('fs', els.fsBtn, 'active', state.isFullscreen);
  }

  getPlayerInputs(isTwoPlayer: boolean): { p1: PlayerInput; p2: PlayerInput } {
    const pads = this.readGamepads();

    // Player 1
    let p1x = 0;
    let p1y = 0;
    if (this.heldCodes.has('KeyA')) p1x -= 1;
    if (this.heldCodes.has('KeyD')) p1x += 1;
    if (this.heldCodes.has('KeyW')) p1y -= 1;
    if (this.heldCodes.has('KeyS')) p1y += 1;

    // Allow arrow keys for P1 in single-player vs AI mode for effortless onboarding
    if (!isTwoPlayer) {
      if (this.heldCodes.has('ArrowLeft')) p1x -= 1;
      if (this.heldCodes.has('ArrowRight')) p1x += 1;
      if (this.heldCodes.has('ArrowUp')) p1y -= 1;
      if (this.heldCodes.has('ArrowDown')) p1y += 1;
    }

    if (this.mobileOverlayShowing) {
      p1x += this.touchMoveX;
      p1y += this.touchMoveY;
    }
    if (pads[0]) {
      p1x += pads[0].moveX;
      p1y += pads[0].moveY;
    }

    p1x = Math.max(-1, Math.min(1, p1x));
    p1y = Math.max(-1, Math.min(1, p1y));

    const p1KickCodes = isTwoPlayer ? ['Space', 'KeyJ'] : ['Space', 'KeyJ', 'Enter'];
    const p1DashCodes = isTwoPlayer ? ['ShiftLeft', 'KeyK'] : ['ShiftLeft', 'ShiftRight', 'KeyK'];
    const p1SwitchCodes = ['KeyQ', 'KeyL'];
    const p1PassCodes = ['KeyE', 'KeyU'];
    const p1FeverCodes = ['KeyC', 'KeyR'];

    const p1: PlayerInput = {
      moveX: p1x,
      moveY: p1y,
      kickHeld:
        p1KickCodes.some((c) => this.heldCodes.has(c)) ||
        (this.mobileOverlayShowing && this.touchKickHeld) ||
        Boolean(pads[0]?.kickHeld),
      kickJustReleased:
        p1KickCodes.some((c) => this.justReleasedCodes.has(c)) ||
        this.touchKickJustReleased ||
        Boolean(pads[0]?.kickJustReleased),
      dashJustPressed:
        p1DashCodes.some((c) => this.justPressedCodes.has(c)) ||
        this.touchDashJustPressed ||
        Boolean(pads[0]?.dashJustPressed),
      switchJustPressed:
        p1SwitchCodes.some((c) => this.justPressedCodes.has(c)) ||
        this.touchSwitchJustPressed ||
        Boolean(pads[0]?.switchJustPressed),
      passJustPressed:
        p1PassCodes.some((c) => this.justPressedCodes.has(c)) ||
        this.touchPassJustPressed ||
        Boolean(pads[0]?.passJustPressed),
      feverJustPressed:
        p1FeverCodes.some((c) => this.justPressedCodes.has(c)) ||
        this.touchFeverJustPressed ||
        Boolean(pads[0]?.feverJustPressed),
      tacticCycleJustPressed:
        this.justPressedCodes.has('Tab') || Boolean(pads[0]?.tacticCycleJustPressed),
    };

    // Player 2
    let p2x = 0;
    let p2y = 0;
    if (this.heldCodes.has('ArrowLeft')) p2x -= 1;
    if (this.heldCodes.has('ArrowRight')) p2x += 1;
    if (this.heldCodes.has('ArrowUp')) p2y -= 1;
    if (this.heldCodes.has('ArrowDown')) p2y += 1;
    if (pads[1]) {
      p2x += pads[1].moveX;
      p2y += pads[1].moveY;
    }

    p2x = Math.max(-1, Math.min(1, p2x));
    p2y = Math.max(-1, Math.min(1, p2y));

    const p2KickCodes = ['Enter', 'Numpad1'];
    const p2DashCodes = ['ControlRight', 'Numpad2', 'ShiftRight'];
    const p2SwitchCodes = ['Numpad0', 'Slash'];
    const p2PassCodes = ['Period', 'Numpad3'];
    const p2FeverCodes = ['Backslash', 'NumpadDecimal'];
    const p2TacticCodes = ['KeyO', 'BracketRight'];

    const p2: PlayerInput = {
      moveX: p2x,
      moveY: p2y,
      kickHeld: p2KickCodes.some((c) => this.heldCodes.has(c)) || Boolean(pads[1]?.kickHeld),
      kickJustReleased:
        p2KickCodes.some((c) => this.justReleasedCodes.has(c)) || Boolean(pads[1]?.kickJustReleased),
      dashJustPressed:
        p2DashCodes.some((c) => this.justPressedCodes.has(c)) || Boolean(pads[1]?.dashJustPressed),
      switchJustPressed:
        p2SwitchCodes.some((c) => this.justPressedCodes.has(c)) || Boolean(pads[1]?.switchJustPressed),
      passJustPressed:
        p2PassCodes.some((c) => this.justPressedCodes.has(c)) || Boolean(pads[1]?.passJustPressed),
      feverJustPressed:
        p2FeverCodes.some((c) => this.justPressedCodes.has(c)) || Boolean(pads[1]?.feverJustPressed),
      tacticCycleJustPressed:
        p2TacticCodes.some((c) => this.justPressedCodes.has(c)) ||
        Boolean(pads[1]?.tacticCycleJustPressed),
    };

    return { p1, p2 };
  }

  /** Returns high-level UI navigation actions for menus, pause, and results screens */
  getMenuActions(): {
    up: boolean;
    down: boolean;
    left: boolean;
    right: boolean;
    confirm: boolean;
    back: boolean;
    pause: boolean;
    mute: boolean;
  } {
    const pads = this.readGamepads();
    const pad0 = pads[0];
    return {
      up:
        this.justPressedCodes.has('ArrowUp') ||
        this.justPressedCodes.has('KeyW') ||
        Boolean(pad0?.upJustPressed),
      down:
        this.justPressedCodes.has('ArrowDown') ||
        this.justPressedCodes.has('KeyS') ||
        Boolean(pad0?.downJustPressed),
      left:
        this.justPressedCodes.has('ArrowLeft') ||
        this.justPressedCodes.has('KeyA') ||
        Boolean(pad0?.leftJustPressed),
      right:
        this.justPressedCodes.has('ArrowRight') ||
        this.justPressedCodes.has('KeyD') ||
        Boolean(pad0?.rightJustPressed),
      confirm:
        this.justPressedCodes.has('Enter') ||
        this.justPressedCodes.has('Space') ||
        this.justPressedCodes.has('KeyJ') ||
        Boolean(pad0?.kickJustPressed),
      back:
        this.justPressedCodes.has('Escape') ||
        this.justPressedCodes.has('Backspace') ||
        Boolean(pad0?.backJustPressed),
      pause:
        this.justPressedCodes.has('Escape') ||
        this.justPressedCodes.has('KeyP') ||
        Boolean(pad0?.startJustPressed),
      mute: this.justPressedCodes.has('KeyM'),
    };
  }

  private formatGamepadName(rawId: string | undefined, slotNum: 1 | 2): string {
    if (!rawId) return `JOYSTICK P${slotNum}`;
    const trimmed = rawId.replace(/\([^)]*\)/g, '').trim();
    if (/xbox|xinput|microsoft/i.test(rawId)) return 'XBOX PAD';
    if (/dualsense|ps5/i.test(rawId)) return 'PS5 DUALSENSE';
    if (/dualshock|sony|ps4|wireless controller/i.test(rawId)) return 'PS CONTROLLER';
    if (/pro controller|nintendo|joy-con/i.test(rawId)) return 'SWITCH PRO';
    if (/logitech/i.test(rawId)) return 'LOGITECH PAD';
    if (/8bitdo/i.test(rawId)) return '8BITDO PAD';
    if (/gamesir/i.test(rawId)) return 'GAMESIR PAD';
    if (/ipega/i.test(rawId)) return 'IPEGA PAD';
    return (trimmed.toUpperCase().slice(0, 14) || `JOYSTICK P${slotNum}`).trim();
  }

  /**
   * Reads live gamepad state and derives edges against the state committed by the previous
   * `endFrame()`. Uses radial analog stick deadzone/rescaling for fluid 360-degree dribbling,
   * DirectInput POV hat fallback, analog triggers, and tracks plug/unplug notices.
   */
  private readGamepads(): Array<GamepadSnapshot | null> {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) {
      this.connectedGamepads = [];
      return [null, null];
    }
    const gamepads = navigator.getGamepads();
    const out: Array<GamepadSnapshot | null> = [null, null];
    const detected: ConnectedGamepadInfo[] = [];

    let slot = 0;
    for (let rawIdx = 0; rawIdx < gamepads.length; rawIdx++) {
      const gp = gamepads[rawIdx];
      if (!gp || !gp.connected) continue;
      if ((gp.buttons?.length ?? 0) < 4 && (gp.axes?.length ?? 0) < 2) continue;
      if (slot > 1) break;

      const slotNum: 1 | 2 = slot === 0 ? 1 : 2;
      const shortName = this.formatGamepadName(gp.id, slotNum);
      detected.push({
        index: rawIdx,
        slot: slotNum,
        id: gp.id ?? '',
        shortName,
        mapping: gp.mapping ?? '',
        hasRumble: Boolean((gp as { vibrationActuator?: unknown }).vibrationActuator),
      });

      const prev = this.prevGamepadButtons[slot] ?? [];
      const cur = gp.buttons.map((b) =>
        Boolean(b && (b.pressed || (typeof b.value === 'number' && b.value > 0.35)))
      );
      const justPressed = (idx: number) => Boolean(cur[idx] && !prev[idx]);
      const justReleased = (idx: number) => Boolean(!cur[idx] && prev[idx]);

      // Smooth 360-degree radial deadzone (eliminates stiff axis-snapping cross bands)
      const ax = gp.axes[0] ?? 0;
      const ay = gp.axes[1] ?? 0;
      const stickDist = Number.isFinite(ax) && Number.isFinite(ay) ? Math.hypot(ax, ay) : 0;
      const deadzone = 0.14;
      const outerCap = 0.92;
      let mx = 0;
      let my = 0;
      if (stickDist > deadzone) {
        const scaled = Math.min(1, (stickDist - deadzone) / (outerCap - deadzone));
        mx = (ax / stickDist) * scaled;
        my = (ay / stickDist) * scaled;
      }

      // Standard D-pad buttons + DirectInput POV hat switch fallback on axes[9]
      let dpadUp = Boolean(cur[12]);
      let dpadDown = Boolean(cur[13]);
      let dpadLeft = Boolean(cur[14]);
      let dpadRight = Boolean(cur[15]);
      if (gp.mapping !== 'standard' && (gp.axes?.length ?? 0) >= 10) {
        const hat = gp.axes[9];
        if (Number.isFinite(hat) && Math.abs(hat) > 0.05 && Math.abs(hat) <= 1.05) {
          if (hat < -0.55 || hat > 0.85) dpadUp = true;
          if (hat > -0.85 && hat < -0.05) dpadRight = true;
          if (hat > -0.25 && hat < 0.55) dpadDown = true;
          if (hat > 0.25) dpadLeft = true;
        }
      }

      if (dpadUp || dpadDown || dpadLeft || dpadRight) {
        const dx = (dpadRight ? 1 : 0) - (dpadLeft ? 1 : 0);
        const dy = (dpadDown ? 1 : 0) - (dpadUp ? 1 : 0);
        const dLen = Math.hypot(dx, dy);
        if (dLen > 0) {
          mx = dx / dLen;
          my = dy / dLen;
        }
      }

      const navCur = {
        up: dpadUp || my < -0.55,
        down: dpadDown || my > 0.55,
        left: dpadLeft || mx < -0.55,
        right: dpadRight || mx > 0.55,
      };
      const navPrev = this.prevStickNavDirs[slot] ?? {
        up: false,
        down: false,
        left: false,
        right: false,
      };

      out[slot] = {
        moveX: mx,
        moveY: my,
        kickHeld: Boolean(cur[0] || cur[7]),
        kickJustPressed: justPressed(0) || justPressed(7),
        kickJustReleased: justReleased(0) || justReleased(7),
        dashJustPressed: justPressed(1) || justPressed(6),
        switchJustPressed: justPressed(3),
        passJustPressed: justPressed(2),
        tacticCycleJustPressed: justPressed(4),
        feverJustPressed: justPressed(5),
        startJustPressed: justPressed(9),
        backJustPressed: justPressed(1) || justPressed(8),
        upJustPressed: navCur.up && !navPrev.up,
        downJustPressed: navCur.down && !navPrev.down,
        leftJustPressed: navCur.left && !navPrev.left,
        rightJustPressed: navCur.right && !navPrev.right,
      };

      this.lastGamepadButtons[slot] = cur;
      this.lastStickNavDirs[slot] = navCur;
      slot++;
    }

    // Drop stale history for disconnected slots so a reconnected pad does not report phantom edges.
    for (let i = slot; i < this.lastGamepadButtons.length; i++) {
      this.lastGamepadButtons[i] = [];
    }
    for (let i = slot; i < this.lastStickNavDirs.length; i++) {
      this.lastStickNavDirs[i] = { up: false, down: false, left: false, right: false };
    }

    // Track connection state transitions for UI badges & haptic confirmation
    for (let s = 0; s < 2; s++) {
      const info = detected[s] ?? null;
      const curKey = info ? `${info.index}:${info.shortName}` : null;
      const prevKey = this.prevConnectedKeys[s];
      if (curKey !== prevKey) {
        if (info) {
          this.gamepadNotices.push({
            connected: true,
            slot: s === 0 ? 1 : 2,
            shortName: info.shortName,
          });
        } else if (prevKey) {
          const prevName = prevKey.split(':').slice(1).join(':') || `JOYSTICK P${s + 1}`;
          this.gamepadNotices.push({
            connected: false,
            slot: s === 0 ? 1 : 2,
            shortName: prevName,
          });
        }
        this.prevConnectedKeys[s] = curKey;
      }
    }

    this.connectedGamepads = detected;
    return out;
  }

  private setupTouchControls(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const stickBase = document.getElementById('touch-stick-base');
    const stickKnob = document.getElementById('touch-stick-knob');
    const kickBtn = document.getElementById('touch-kick');
    const dashBtn = document.getElementById('touch-dash');
    const switchBtn = document.getElementById('touch-switch');
    const passBtn = document.getElementById('touch-pass');
    const feverBtn = document.getElementById('touch-fever');
    const tacticBtn = document.getElementById('touch-tactic');
    const pauseBtn = document.getElementById('touch-pause');
    const muteBtn = document.getElementById('touch-mute');
    const viewBtn = document.getElementById('touch-view');
    const fsBtn = document.getElementById('touch-fullscreen');
    const menuFsBtn = document.getElementById('mobile-menu-fs');
    const menuPadBtn = document.getElementById('mobile-menu-pad');
    const skipBtn = document.getElementById('touch-skip');
    const sandboxBtns = document.querySelectorAll<HTMLElement>('#touch-sandbox-bar .sandbox-btn');

    if (!stickBase || !stickKnob || !kickBtn || !dashBtn || !switchBtn) return;

    this.listen<Event>(window, 'touchstart', () => {
      this.hasTouchSeen = true;
    }, { passive: true });

    let stickPointerId: number | null = null;
    let kickPointerId: number | null = null;
    let dashPointerId: number | null = null;
    let switchPointerId: number | null = null;
    let passPointerId: number | null = null;
    let feverPointerId: number | null = null;

    this.resetTouchVisuals = () => {
      stickPointerId = null;
      kickPointerId = null;
      dashPointerId = null;
      switchPointerId = null;
      passPointerId = null;
      feverPointerId = null;
      stickKnob.style.transform = 'translate(0px, 0px)';
      kickBtn.classList.remove('pressed');
      dashBtn.classList.remove('pressed');
      switchBtn.classList.remove('pressed');
      passBtn?.classList.remove('pressed');
      feverBtn?.classList.remove('pressed');
    };

    const updateStick = (clientX: number, clientY: number) => {
      const rect = stickBase.getBoundingClientRect();
      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.5;
      const maxR = Math.max(12, rect.width * 0.36);
      const deadzone = 5.5;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > maxR && dist > 0) {
        dx = (dx / dist) * maxR;
        dy = (dy / dist) * maxR;
      }
      stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
      if (dist <= deadzone) {
        this.touchMoveX = 0;
        this.touchMoveY = 0;
      } else {
        // Radial deadzone keeps 360-degree touch aiming smooth around horizontal/vertical axes.
        const effectiveDist = Math.min(dist, maxR);
        const mag = 0.18 + 0.82 * ((effectiveDist - deadzone) / Math.max(1, maxR - deadzone));
        this.touchMoveX = (dx / dist) * mag;
        this.touchMoveY = (dy / dist) * mag;
      }
    };

    this.listen<PointerEvent>(stickBase, 'pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.pointerType === 'touch') this.hasTouchSeen = true;
      stickPointerId = e.pointerId;
      stickBase.setPointerCapture?.(e.pointerId);
      updateStick(e.clientX, e.clientY);
    });

    this.listen<PointerEvent>(stickBase, 'pointermove', (e: PointerEvent) => {
      if (e.pointerId !== stickPointerId) return;
      e.preventDefault();
      updateStick(e.clientX, e.clientY);
    });

    const releaseStick = (e: PointerEvent) => {
      if (e.pointerId !== stickPointerId) return;
      e.preventDefault();
      stickPointerId = null;
      stickKnob.style.transform = 'translate(0px, 0px)';
      this.touchMoveX = 0;
      this.touchMoveY = 0;
    };
    this.listen<PointerEvent>(stickBase, 'pointerup', releaseStick);
    this.listen<PointerEvent>(stickBase, 'pointercancel', releaseStick);

    this.listen<PointerEvent>(kickBtn, 'pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.pointerType === 'touch') this.hasTouchSeen = true;
      kickPointerId = e.pointerId;
      kickBtn.setPointerCapture?.(e.pointerId);
      this.touchKickHeld = true;
      kickBtn.classList.add('pressed');
    });
    const endKick = (e: PointerEvent) => {
      if (e.pointerId !== kickPointerId) return;
      e.preventDefault();
      kickPointerId = null;
      if (this.touchKickHeld) {
        this.touchKickHeld = false;
        this.touchKickJustReleased = true;
      }
      kickBtn.classList.remove('pressed');
    };
    this.listen<PointerEvent>(kickBtn, 'pointerup', endKick);
    this.listen<PointerEvent>(kickBtn, 'pointercancel', endKick);

    this.listen<PointerEvent>(dashBtn, 'pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.pointerType === 'touch') this.hasTouchSeen = true;
      dashPointerId = e.pointerId;
      dashBtn.setPointerCapture?.(e.pointerId);
      this.touchDashJustPressed = true;
      dashBtn.classList.add('pressed');
    });
    const endDash = (e: PointerEvent) => {
      if (e.pointerId !== dashPointerId) return;
      e.preventDefault();
      dashPointerId = null;
      dashBtn.classList.remove('pressed');
    };
    this.listen<PointerEvent>(dashBtn, 'pointerup', endDash);
    this.listen<PointerEvent>(dashBtn, 'pointercancel', endDash);

    this.listen<PointerEvent>(switchBtn, 'pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.pointerType === 'touch') this.hasTouchSeen = true;
      switchPointerId = e.pointerId;
      switchBtn.setPointerCapture?.(e.pointerId);
      this.touchSwitchJustPressed = true;
      switchBtn.classList.add('pressed');
    });
    const endSwitch = (e: PointerEvent) => {
      if (e.pointerId !== switchPointerId) return;
      e.preventDefault();
      switchPointerId = null;
      switchBtn.classList.remove('pressed');
    };
    this.listen<PointerEvent>(switchBtn, 'pointerup', endSwitch);
    this.listen<PointerEvent>(switchBtn, 'pointercancel', endSwitch);

    if (passBtn) {
      this.listen<PointerEvent>(passBtn, 'pointerdown', (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.pointerType === 'touch') this.hasTouchSeen = true;
        passPointerId = e.pointerId;
        passBtn.setPointerCapture?.(e.pointerId);
        this.touchPassJustPressed = true;
        passBtn.classList.add('pressed');
      });
      const endPass = (e: PointerEvent) => {
        if (e.pointerId !== passPointerId) return;
        e.preventDefault();
        passPointerId = null;
        passBtn.classList.remove('pressed');
      };
      this.listen<PointerEvent>(passBtn, 'pointerup', endPass);
      this.listen<PointerEvent>(passBtn, 'pointercancel', endPass);
    }

    if (feverBtn) {
      this.listen<PointerEvent>(feverBtn, 'pointerdown', (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.pointerType === 'touch') this.hasTouchSeen = true;
        feverPointerId = e.pointerId;
        feverBtn.setPointerCapture?.(e.pointerId);
        this.touchFeverJustPressed = true;
        feverBtn.classList.add('pressed');
      });
      const endFever = (e: PointerEvent) => {
        if (e.pointerId !== feverPointerId) return;
        e.preventDefault();
        feverPointerId = null;
        feverBtn.classList.remove('pressed');
      };
      this.listen<PointerEvent>(feverBtn, 'pointerup', endFever);
      this.listen<PointerEvent>(feverBtn, 'pointercancel', endFever);
    }

    const bindSpecialButton = (el: HTMLElement | null, handler: () => void) => {
      if (!el) return;
      this.listen<PointerEvent>(el, 'pointerdown', (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.pointerType === 'touch') this.hasTouchSeen = true;
        handler();
      });
    };

    const bindActivationButton = (el: HTMLElement | null, handler: () => void) => {
      if (!el) return;
      this.listen<PointerEvent>(el, 'pointerdown', (e: PointerEvent) => {
        e.stopPropagation();
        if (e.pointerType === 'touch') this.hasTouchSeen = true;
      });
      this.listen<PointerEvent>(el, 'click', (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        handler();
      });
    };

    bindSpecialButton(pauseBtn, () => this.mobileHandlers?.onPause());
    bindSpecialButton(tacticBtn, () => this.mobileHandlers?.onCycleTactic?.());
    bindSpecialButton(muteBtn, () => this.mobileHandlers?.onToggleMute());
    bindSpecialButton(viewBtn, () => this.mobileHandlers?.onCycleView());
    bindActivationButton(fsBtn, () => this.mobileHandlers?.onToggleFullscreen());
    bindActivationButton(menuFsBtn, () => this.mobileHandlers?.onToggleFullscreen());
    bindSpecialButton(menuPadBtn, () => this.mobileHandlers?.onCycleView());
    bindSpecialButton(skipBtn, () => this.mobileHandlers?.onSkipReplay());

    sandboxBtns.forEach((btn) => {
      const action = btn.dataset.sb;
      if (!action) return;
      bindSpecialButton(btn, () => this.mobileHandlers?.onSandboxAction(action));
    });
  }
}
