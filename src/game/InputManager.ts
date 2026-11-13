import { ControlStyle, DisplayMode, PlayerInput } from '../types.ts';
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
  onSkipReplay: () => void;
  onSandboxAction: (action: string) => void;
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
}

export class InputManager {
  private heldCodes = new Set<string>();
  private justPressedCodes = new Set<string>();
  private justReleasedCodes = new Set<string>();

  private prevGamepadButtons: boolean[][] = [];
  private displayMode: DisplayMode = 'auto';
  private hasTouchSeen = false;
  private mobileOverlayShowing = false;
  private touchMoveX = 0;
  private touchMoveY = 0;
  private touchKickHeld = false;
  private touchKickJustReleased = false;
  private touchDashJustPressed = false;
  private touchSwitchJustPressed = false;
  private resetTouchVisuals: (() => void) | null = null;
  private mobileHandlers: MobileActionHandlers | null = null;

  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;
  private boundBlur: () => void;

  constructor() {
    this.boundKeyDown = (e: KeyboardEvent) => this.onKeyDown(e);
    this.boundKeyUp = (e: KeyboardEvent) => this.onKeyUp(e);
    this.boundBlur = () => this.clearAll();

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.boundKeyDown);
      window.addEventListener('keyup', this.boundKeyUp);
      window.addEventListener('blur', this.boundBlur);
    }
    this.setupTouchControls();
  }

  destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.boundKeyDown);
      window.removeEventListener('keyup', this.boundKeyUp);
      window.removeEventListener('blur', this.boundBlur);
    }
  }

  private clearAll(): void {
    this.heldCodes.clear();
    this.justPressedCodes.clear();
    this.justReleasedCodes.clear();
    this.resetActiveTouchInput();
  }

  private resetActiveTouchInput(): void {
    this.touchMoveX = 0;
    this.touchMoveY = 0;
    this.touchKickHeld = false;
    this.resetTouchVisuals?.();
  }

  private onKeyDown(e: KeyboardEvent): void {
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
    });
  }

  isTouchEnabled(): boolean {
    return this.isMobileLayoutActive();
  }

  /**
   * Synchronizes the mobile arcade deck / floating touch controls with live match state.
   */
  syncMobileHud(state: MobileHudSyncState): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const wrapper = document.getElementById('game-wrapper');
    const touchRoot = document.getElementById('touch-controls');
    const playPad = document.getElementById('touch-play-pad');
    const switchBtn = document.getElementById('touch-switch');
    const replayBar = document.getElementById('touch-replay-bar');
    const sandboxBar = document.getElementById('touch-sandbox-bar');
    const dashBtn = document.getElementById('touch-dash');
    const dashLabel = document.getElementById('touch-dash-label');
    const dashSub = dashBtn?.querySelector('.touch-btn-sub') as HTMLElement | null;
    const kickCharge = document.getElementById('touch-kick-charge');
    const muteBtn = document.getElementById('touch-mute');
    const viewBtn = document.getElementById('touch-view');

    const { visibility } = state;
    const orientation = getMobileOrientation(window.innerWidth, window.innerHeight);

    if (wrapper) {
      wrapper.classList.toggle('in-match-deck', state.portraitDeck && visibility.showOverlay);
    }

    if (this.mobileOverlayShowing && !visibility.showGameplayControls) {
      this.resetActiveTouchInput();
    }
    this.mobileOverlayShowing = visibility.showGameplayControls;

    if (!touchRoot) return;

    touchRoot.classList.toggle('active', visibility.showOverlay);
    touchRoot.classList.toggle('portrait', orientation === 'portrait');
    touchRoot.classList.toggle('landscape', orientation === 'landscape');
    touchRoot.style.top =
      state.portraitDeck && state.portraitDeckTopPx != null && visibility.showOverlay
        ? `${state.portraitDeckTopPx}px`
        : '';

    if (playPad) {
      playPad.style.display = visibility.showGameplayControls ? 'flex' : 'none';
    }
    if (switchBtn) {
      switchBtn.style.display = visibility.showSwitchButton ? 'flex' : 'none';
    }
    if (replayBar) {
      replayBar.style.display = visibility.showReplaySkip ? 'flex' : 'none';
    }
    if (sandboxBar) {
      sandboxBar.style.display = visibility.showSandboxBar ? 'flex' : 'none';
    }
    if (dashLabel) {
      dashLabel.textContent = state.controlStyle === 'dribble' ? 'TACKLE' : 'DASH';
    }
    if (dashSub) {
      dashSub.textContent = state.controlStyle === 'dribble' ? 'STEAL' : 'BURST';
    }
    if (dashBtn) {
      dashBtn.classList.toggle('on-cd', state.dashOnCooldown);
    }
    if (kickCharge) {
      const pct = Math.max(0, Math.min(100, Math.round(state.kickChargeRatio * 100)));
      kickCharge.style.height = `${pct}%`;
    }
    if (muteBtn) {
      muteBtn.textContent = state.muted ? 'SFX:OFF' : 'SFX:ON';
      muteBtn.classList.toggle('muted', state.muted);
    }
    if (viewBtn) {
      viewBtn.textContent = `VIEW:${getDisplayModeLabel(state.displayMode)}`;
    }
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
        Boolean(pad0?.dashJustPressed),
      pause:
        this.justPressedCodes.has('Escape') ||
        this.justPressedCodes.has('KeyP') ||
        Boolean(pad0?.startJustPressed),
      mute: this.justPressedCodes.has('KeyM'),
    };
  }

  private readGamepads(): Array<{
    moveX: number;
    moveY: number;
    kickHeld: boolean;
    kickJustPressed: boolean;
    kickJustReleased: boolean;
    dashJustPressed: boolean;
    switchJustPressed: boolean;
    startJustPressed: boolean;
    upJustPressed: boolean;
    downJustPressed: boolean;
    leftJustPressed: boolean;
    rightJustPressed: boolean;
  } | null> {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return [null, null];
    const gamepads = navigator.getGamepads();
    const out: Array<{
      moveX: number;
      moveY: number;
      kickHeld: boolean;
      kickJustPressed: boolean;
      kickJustReleased: boolean;
      dashJustPressed: boolean;
      switchJustPressed: boolean;
      startJustPressed: boolean;
      upJustPressed: boolean;
      downJustPressed: boolean;
      leftJustPressed: boolean;
      rightJustPressed: boolean;
    } | null> = [null, null];

    let slot = 0;
    for (const gp of gamepads) {
      if (!gp || !gp.connected) continue;
      if (slot > 1) break;

      const prev = this.prevGamepadButtons[slot] ?? [];
      const cur = gp.buttons.map((b) => b.pressed);
      const justPressed = (idx: number) => Boolean(cur[idx] && !prev[idx]);
      const justReleased = (idx: number) => Boolean(!cur[idx] && prev[idx]);

      let mx = Math.abs(gp.axes[0] ?? 0) > 0.22 ? gp.axes[0] : 0;
      let my = Math.abs(gp.axes[1] ?? 0) > 0.22 ? gp.axes[1] : 0;
      if (cur[14]) mx = -1;
      if (cur[15]) mx = 1;
      if (cur[12]) my = -1;
      if (cur[13]) my = 1;

      out[slot] = {
        moveX: mx,
        moveY: my,
        kickHeld: Boolean(cur[0] || cur[2]),
        kickJustPressed: justPressed(0) || justPressed(2),
        kickJustReleased: justReleased(0) || justReleased(2),
        dashJustPressed: justPressed(1) || justPressed(5),
        switchJustPressed: justPressed(3) || justPressed(4),
        startJustPressed: justPressed(9),
        upJustPressed: justPressed(12),
        downJustPressed: justPressed(13),
        leftJustPressed: justPressed(14),
        rightJustPressed: justPressed(15),
      };

      this.prevGamepadButtons[slot] = cur;
      slot++;
    }
    return out;
  }

  private setupTouchControls(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const stickBase = document.getElementById('touch-stick-base');
    const stickKnob = document.getElementById('touch-stick-knob');
    const kickBtn = document.getElementById('touch-kick');
    const dashBtn = document.getElementById('touch-dash');
    const switchBtn = document.getElementById('touch-switch');
    const pauseBtn = document.getElementById('touch-pause');
    const muteBtn = document.getElementById('touch-mute');
    const viewBtn = document.getElementById('touch-view');
    const skipBtn = document.getElementById('touch-skip');
    const sandboxBtns = document.querySelectorAll<HTMLElement>('#touch-sandbox-bar .sandbox-btn');

    if (!stickBase || !stickKnob || !kickBtn || !dashBtn || !switchBtn) return;

    window.addEventListener(
      'touchstart',
      () => {
        this.hasTouchSeen = true;
      },
      { passive: true }
    );

    let stickPointerId: number | null = null;
    let kickPointerId: number | null = null;
    let dashPointerId: number | null = null;
    let switchPointerId: number | null = null;

    this.resetTouchVisuals = () => {
      stickPointerId = null;
      kickPointerId = null;
      dashPointerId = null;
      switchPointerId = null;
      stickKnob.style.transform = 'translate(0px, 0px)';
      kickBtn.classList.remove('pressed');
      dashBtn.classList.remove('pressed');
      switchBtn.classList.remove('pressed');
    };

    const updateStick = (clientX: number, clientY: number) => {
      const rect = stickBase.getBoundingClientRect();
      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.5;
      const maxR = rect.width * 0.36;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > maxR && dist > 0) {
        dx = (dx / dist) * maxR;
        dy = (dy / dist) * maxR;
      }
      stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.touchMoveX = Math.abs(dx) < 6 ? 0 : dx / maxR;
      this.touchMoveY = Math.abs(dy) < 6 ? 0 : dy / maxR;
    };

    stickBase.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.pointerType === 'touch') this.hasTouchSeen = true;
      stickPointerId = e.pointerId;
      stickBase.setPointerCapture?.(e.pointerId);
      updateStick(e.clientX, e.clientY);
    });

    stickBase.addEventListener('pointermove', (e) => {
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
    stickBase.addEventListener('pointerup', releaseStick);
    stickBase.addEventListener('pointercancel', releaseStick);

    kickBtn.addEventListener('pointerdown', (e) => {
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
    kickBtn.addEventListener('pointerup', endKick);
    kickBtn.addEventListener('pointercancel', endKick);

    dashBtn.addEventListener('pointerdown', (e) => {
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
    dashBtn.addEventListener('pointerup', endDash);
    dashBtn.addEventListener('pointercancel', endDash);

    switchBtn.addEventListener('pointerdown', (e) => {
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
    switchBtn.addEventListener('pointerup', endSwitch);
    switchBtn.addEventListener('pointercancel', endSwitch);

    const bindSpecialButton = (el: HTMLElement | null, handler: () => void) => {
      if (!el) return;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.pointerType === 'touch') this.hasTouchSeen = true;
        handler();
      });
    };

    bindSpecialButton(pauseBtn, () => this.mobileHandlers?.onPause());
    bindSpecialButton(muteBtn, () => this.mobileHandlers?.onToggleMute());
    bindSpecialButton(viewBtn, () => this.mobileHandlers?.onCycleView());
    bindSpecialButton(skipBtn, () => this.mobileHandlers?.onSkipReplay());

    sandboxBtns.forEach((btn) => {
      const action = btn.dataset.sb;
      if (!action) return;
      bindSpecialButton(btn, () => this.mobileHandlers?.onSandboxAction(action));
    });
  }
}
