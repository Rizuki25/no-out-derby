import { PlayerInput } from '../types.ts';

export class InputManager {
  private heldCodes = new Set<string>();
  private justPressedCodes = new Set<string>();
  private justReleasedCodes = new Set<string>();

  private prevGamepadButtons: boolean[][] = [];
  private touchActive = false;
  private touchMoveX = 0;
  private touchMoveY = 0;
  private touchKickHeld = false;
  private touchKickJustReleased = false;
  private touchDashJustPressed = false;
  private touchSwitchJustPressed = false;

  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;
  private boundBlur: () => void;

  constructor() {
    this.boundKeyDown = (e: KeyboardEvent) => this.onKeyDown(e);
    this.boundKeyUp = (e: KeyboardEvent) => this.onKeyUp(e);
    this.boundBlur = () => this.clearAll();

    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);
    window.addEventListener('blur', this.boundBlur);
    this.setupTouchControls();
  }

  destroy(): void {
    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);
    window.removeEventListener('blur', this.boundBlur);
  }

  private clearAll(): void {
    this.heldCodes.clear();
    this.justPressedCodes.clear();
    this.justReleasedCodes.clear();
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

  isTouchEnabled(): boolean {
    return this.touchActive;
  }

  setTouchSwitchVisible(visible: boolean): void {
    const el = document.getElementById('touch-switch');
    if (el) {
      el.style.display = visible && this.touchActive ? 'flex' : 'none';
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

    if (this.touchActive) {
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
      kickHeld: p1KickCodes.some((c) => this.heldCodes.has(c)) || this.touchKickHeld || Boolean(pads[0]?.kickHeld),
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
    const touchRoot = document.getElementById('touch-controls');
    const stickBase = document.getElementById('touch-stick-base');
    const stickKnob = document.getElementById('touch-stick-knob');
    const kickBtn = document.getElementById('touch-kick');
    const dashBtn = document.getElementById('touch-dash');
    const switchBtn = document.getElementById('touch-switch');

    if (!touchRoot || !stickBase || !stickKnob || !kickBtn || !dashBtn || !switchBtn) return;

    const activateTouch = () => {
      if (!this.touchActive) {
        this.touchActive = true;
        touchRoot.classList.add('active');
      }
    };

    window.addEventListener(
      'touchstart',
      () => {
        activateTouch();
      },
      { passive: true }
    );

    let stickTouchId: number | null = null;
    const updateStick = (clientX: number, clientY: number) => {
      const rect = stickBase.getBoundingClientRect();
      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.5;
      const maxR = rect.width * 0.38;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > maxR) {
        dx = (dx / dist) * maxR;
        dy = (dy / dist) * maxR;
      }
      stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.touchMoveX = Math.abs(dx) < 6 ? 0 : dx / maxR;
      this.touchMoveY = Math.abs(dy) < 6 ? 0 : dy / maxR;
    };

    stickBase.addEventListener('touchstart', (e) => {
      e.preventDefault();
      activateTouch();
      const t = e.changedTouches[0];
      if (!t) return;
      stickTouchId = t.identifier;
      updateStick(t.clientX, t.clientY);
    });

    stickBase.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === stickTouchId) {
          updateStick(t.clientX, t.clientY);
          break;
        }
      }
    });

    const resetStick = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === stickTouchId) {
          stickTouchId = null;
          stickKnob.style.transform = 'translate(0px, 0px)';
          this.touchMoveX = 0;
          this.touchMoveY = 0;
          break;
        }
      }
    };
    stickBase.addEventListener('touchend', resetStick);
    stickBase.addEventListener('touchcancel', resetStick);

    kickBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      activateTouch();
      this.touchKickHeld = true;
      kickBtn.classList.add('pressed');
    });
    const endKick = (e: TouchEvent) => {
      e.preventDefault();
      if (this.touchKickHeld) {
        this.touchKickHeld = false;
        this.touchKickJustReleased = true;
      }
      kickBtn.classList.remove('pressed');
    };
    kickBtn.addEventListener('touchend', endKick);
    kickBtn.addEventListener('touchcancel', endKick);

    dashBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      activateTouch();
      this.touchDashJustPressed = true;
      dashBtn.classList.add('pressed');
    });
    const endDash = (e: TouchEvent) => {
      e.preventDefault();
      dashBtn.classList.remove('pressed');
    };
    dashBtn.addEventListener('touchend', endDash);
    dashBtn.addEventListener('touchcancel', endDash);

    switchBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      activateTouch();
      this.touchSwitchJustPressed = true;
      switchBtn.classList.add('pressed');
    });
    const endSwitch = (e: TouchEvent) => {
      e.preventDefault();
      switchBtn.classList.remove('pressed');
    };
    switchBtn.addEventListener('touchend', endSwitch);
    switchBtn.addEventListener('touchcancel', endSwitch);
  }
}
