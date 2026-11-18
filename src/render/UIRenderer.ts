import {
  AIDifficulty,
  ArenaId,
  GameMode,
  MatchConfig,
  MatchDurationOption,
  NATIVE_HEIGHT,
  NATIVE_WIDTH,
  PerkType,
  PitchSize,
} from '../types.ts';
import {
  ARENA_LIST,
  ARENA_PRESETS,
  PITCH_SIZE_LIST,
  PITCH_SIZE_PRESETS,
} from '../engine/ArenaPresets.ts';
import { CareerRecordsData } from '../game/CareerRecords.ts';
import { PERK_CATALOG } from '../game/DerbyCup.ts';
import { ConnectedGamepadInfo } from '../game/InputManager.ts';
import { MatchState } from '../game/MatchState.ts';
import { isFullscreenActive } from '../game/Fullscreen.ts';
import { getDisplayModeLabel } from '../game/MobileLayout.ts';
import type { OnlineStatusBadge } from '../net/OnlineSession.ts';
import { PALETTE } from './Palette.ts';
import { ARCADE_DISPLAY_FONT, drawArcadeText, drawPixelText } from './PixelFont.ts';
import { drawMutatorIcon } from './PixelSprites.ts';
import { cycleTeamKit, getTeamKit } from './TeamKits.ts';

export interface ClickRect {
  x: number;
  y: number;
  w: number;
  h: number;
  action: () => void;
}

const MODE_OPTIONS: Array<{ value: GameMode; label: string }> = [
  { value: '1v1_ai', label: '1V1 VS AI' },
  { value: '2v2_ai', label: '2V2 VS AI' },
  { value: '3v3_ai', label: '3V3 (GK+2) VS AI' },
  { value: '4v4_ai', label: '4V4 (GK+3) VS AI' },
  { value: 'derby_cup_1v1', label: 'DERBY CUP 1V1' },
  { value: 'derby_cup_2v2', label: 'DERBY CUP 2V2' },
  { value: 'derby_cup_3v3', label: 'DERBY CUP 3V3' },
  { value: 'derby_cup_4v4', label: 'DERBY CUP 4V4' },
  { value: '1v1_local', label: '2P 1V1 VERSUS' },
  { value: '2v2_local', label: '2P 2V2 VERSUS' },
  { value: '3v3_local', label: '2P 3V3 VERSUS' },
  { value: '4v4_local', label: '2P 4V4 VERSUS' },
  { value: '2v2_coop', label: '2P 2V2 CO-OP' },
  { value: '3v3_coop', label: '2P 3V3 CO-OP' },
  { value: '4v4_coop', label: '2P 4V4 CO-OP' },
  { value: 'practice_sandbox', label: 'PRACTICE SANDBOX' },
];

const DIFFICULTY_OPTIONS: Array<{ value: AIDifficulty; label: string }> = [
  { value: 'rookie', label: 'ROOKIE' },
  { value: 'pro', label: 'PRO' },
  { value: 'tarkam', label: 'TARKAM LEGEND' },
];

const DURATION_OPTIONS: MatchDurationOption[] = [60, 90, 120];

export interface UICallbacks {
  onStartMatch: () => void;
  onUpdateConfig: (patch: Partial<MatchConfig>) => void;
  onResume: () => void;
  onRematch: () => void;
  onRestartRound: () => void;
  onAdvanceCup: () => void;
  onSelectPerk: (choiceIdx: number) => void;
  onQuitToMenu: () => void;
  onToggleMute: () => void;
  onTogglePause: () => void;
  onSkipReplay: () => void;
  onOpenGuide: () => void;
  onOpenRecords: () => void;
  onCloseOverlay: () => void;
  onChangeGuidePage: (page: number) => void;
  onResetRecords: () => void;
  onCycleDisplayMode: () => void;
  onToggleFullscreen: () => void;
  onOpenOnlineLobby: () => void;
  onOpenCustomize?: () => void;
}

export class UIRenderer {
  public menuRow = 0; // 0..9 (inside Customize Setup overlay)
  public homeRow: 0 | 1 | 2 = 1; // 0: mode cards, 1: PLAY/ONLINE CTA, 2: footer actions
  public homeCard = 0; // 0: Quick Match, 1: Derby Cup, 2: 2P Local, 3: Sandbox
  public homeFooterIdx = 0; // 0: Customize, 1: Guide, 2: Records
  public menuFocusPlay = true; // within homeRow === 1 when onlineEnabled
  public pauseRow = 0; // 0..5
  public resultRow = 0; // 0..1
  public perkIndex = 0; // 0..2
  public championRow = 0; // 0..1
  public menuOverlay: 'none' | 'customize' | 'guide' | 'records' = 'none';
  public guidePage = 0; // 0..2
  public recordsRow = 0; // 0..1
  public resetArmed = false;
  public onlineEnabled = true;
  public hasBackdrop = false;
  public isMobileLayout = false;
  public adOverlayLabel: string | null = null;
  public pauseGuideOpen = false;

  private mutatorBannerTimer = 0;
  private mutatorBannerLabel = '';
  private mutatorBannerSub = '';
  private toastBannerTimer = 0;
  private toastBannerTitle = '';
  private toastBannerSub = '';
  private toastBannerColor: string = PALETTE.iceCyan;
  private lastGoalHighlightTag: string | null = null;
  private clock = 0;

  private clickZones: ClickRect[] = [];

  triggerGoalHighlight(tag?: string | null): void {
    this.lastGoalHighlightTag = tag ?? null;
  }

  private drawModalShell(
    ctx: CanvasRenderingContext2D,
    bx: number,
    by: number,
    bw: number,
    bh: number,
    borderColor: string,
    title?: string,
    subtitle?: string
  ): void {
    // Soft ambient backdrop shadow behind modal
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(bx + 3, by + 4, bw, bh);

    const panelGrad = ctx.createLinearGradient(bx, by, bx, by + bh);
    panelGrad.addColorStop(0, 'rgba(18, 26, 42, 0.97)');
    panelGrad.addColorStop(1, 'rgba(10, 15, 25, 0.98)');
    ctx.fillStyle = panelGrad;
    ctx.fillRect(bx, by, bw, bh);

    // Top glaze bar & framed outer stroke
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.fillRect(bx + 2, by + 2, bw - 4, title ? 28 : 12);

    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);

    // Subtle corner metallic ticks
    ctx.fillStyle = PALETTE.gold;
    ctx.fillRect(bx + 2, by + 2, 5, 1.5);
    ctx.fillRect(bx + bw - 7, by + 2, 5, 1.5);

    if (title) {
      const titleSize = title.length * 12 > bw - 22 ? 11 : 13.5;
      drawArcadeText(ctx, title, bx + bw * 0.5, by + (subtitle ? 12 : 16), PALETTE.gold, titleSize, 'center', {
        weight: '900',
        family: ARCADE_DISPLAY_FONT,
        shadowColor: PALETTE.inkBlack,
        strokeColor: PALETTE.inkBlack,
        strokeWidth: 2,
      });
      if (subtitle) {
        drawPixelText(ctx, subtitle, bx + bw * 0.5, by + 21, PALETTE.iceCyan, 1, 'center');
      }
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fillRect(bx + 12, by + (subtitle ? 31 : 27), bw - 24, 1);
    }
  }

  private drawGlossyButton(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    selected: boolean,
    accentPrimary: string,
    accentLight: string,
    accentDark: string,
    onClick?: () => void,
    isPrimary = false
  ): void {
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    if (isPrimary || selected) {
      grad.addColorStop(0, selected ? accentLight : accentPrimary);
      grad.addColorStop(1, accentDark);
    } else {
      grad.addColorStop(0, '#1c2638');
      grad.addColorStop(1, '#111826');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);

    ctx.fillStyle = selected ? 'rgba(255, 255, 255, 0.22)' : 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(x + 1, y + 1, w - 2, 2);

    ctx.strokeStyle = selected ? PALETTE.gold : isPrimary ? accentLight : PALETTE.slateMid;
    ctx.lineWidth = selected ? 1.5 : 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    drawArcadeText(
      ctx,
      label,
      x + w * 0.5,
      y + h * 0.5 + 0.5,
      selected ? PALETTE.pureWhite : isPrimary ? PALETTE.pureWhite : PALETTE.offWhite,
      h >= 21 ? 8.5 : 7.5,
      'center',
      { weight: '800', shadowColor: PALETTE.inkBlack }
    );

    if (onClick) {
      this.clickZones.push({ x, y, w, h, action: onClick });
    }
  }

  private drawPerkIcon(ctx: CanvasRenderingContext2D, perk: PerkType, cx: number, cy: number): void {
    ctx.save();
    // Glowing emblem backdrop circle
    ctx.fillStyle = 'rgba(11, 14, 20, 0.72)';
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = PALETTE.gold;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    if (perk === 'turbo_boots') {
      // Winged sprint boot
      ctx.fillStyle = PALETTE.iceCyan;
      ctx.fillRect(cx - 8, cy - 4, 8, 2);
      ctx.fillRect(cx - 6, cy - 1, 6, 2);
      ctx.fillStyle = PALETTE.gold;
      ctx.fillRect(cx - 3, cy - 4, 6, 8);
      ctx.fillRect(cx - 3, cy + 2, 10, 3);
    } else if (perk === 'iron_leg') {
      // Explosive power strike leg + spark
      ctx.fillStyle = PALETTE.dangerRed;
      ctx.fillRect(cx - 5, cy - 7, 5, 11);
      ctx.fillRect(cx - 5, cy + 2, 9, 4);
      ctx.fillStyle = PALETTE.gold;
      ctx.beginPath();
      ctx.arc(cx + 6, cy + 2, 3.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (perk === 'quick_dash') {
      // Lightning bolt
      ctx.fillStyle = PALETTE.iceCyan;
      ctx.beginPath();
      ctx.moveTo(cx + 2, cy - 8);
      ctx.lineTo(cx - 6, cy + 1);
      ctx.lineTo(cx - 1, cy + 1);
      ctx.lineTo(cx - 3, cy + 8);
      ctx.lineTo(cx + 6, cy - 1);
      ctx.lineTo(cx + 1, cy - 1);
      ctx.closePath();
      ctx.fill();
    } else if (perk === 'banana_curve') {
      // Curved shot arc + ball
      ctx.strokeStyle = PALETTE.gold;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx - 1, cy + 2, 8, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
      ctx.fillStyle = PALETTE.pureWhite;
      ctx.beginPath();
      ctx.arc(cx + 5, cy - 3, 3.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (perk === 'steel_body') {
      // Shield badge
      ctx.fillStyle = '#4f6d8a';
      ctx.beginPath();
      ctx.moveTo(cx, cy - 8);
      ctx.lineTo(cx + 7, cy - 5);
      ctx.lineTo(cx + 6, cy + 3);
      ctx.lineTo(cx, cy + 8);
      ctx.lineTo(cx - 6, cy + 3);
      ctx.lineTo(cx - 7, cy - 5);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = PALETTE.pureWhite;
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      // Magnet touch: U-magnet + small pulled ball
      ctx.strokeStyle = PALETTE.dangerRed;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx - 1, cy, 5.5, Math.PI * 0.5, Math.PI * 1.5);
      ctx.stroke();
      ctx.fillStyle = PALETTE.pureWhite;
      ctx.fillRect(cx - 1, cy - 6.5, 3, 2.5);
      ctx.fillRect(cx - 1, cy + 4, 3, 2.5);
      ctx.beginPath();
      ctx.arc(cx + 6, cy, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  triggerMutatorBanner(label: string, subtitle: string): void {
    this.mutatorBannerLabel = label;
    this.mutatorBannerSub = subtitle;
    this.mutatorBannerTimer = 2.8;
  }

  triggerToastBanner(title: string, subtitle = '', color: string = PALETTE.iceCyan, duration = 2.6): void {
    this.toastBannerTitle = title;
    this.toastBannerSub = subtitle;
    this.toastBannerColor = color;
    this.toastBannerTimer = duration;
  }

  update(rawDt: number): void {
    this.clock += rawDt;
    if (this.mutatorBannerTimer > 0) {
      this.mutatorBannerTimer = Math.max(0, this.mutatorBannerTimer - rawDt);
    }
    if (this.toastBannerTimer > 0) {
      this.toastBannerTimer = Math.max(0, this.toastBannerTimer - rawDt);
    }
  }

  getClickZones(): ClickRect[] {
    return this.clickZones;
  }

  render(
    ctx: CanvasRenderingContext2D,
    match: MatchState,
    menuConfig: MatchConfig,
    muted: boolean,
    records: CareerRecordsData,
    callbacks: UICallbacks,
    connectedGamepads: ConnectedGamepadInfo[] = [],
    onlineStatus?: OnlineStatusBadge
  ): void {
    this.clickZones = [];
    this.renderActiveScreen(
      ctx,
      match,
      menuConfig,
      muted,
      records,
      callbacks,
      connectedGamepads,
      onlineStatus
    );
    if (this.adOverlayLabel) {
      this.clickZones = [];
      this.renderAdOverlay(ctx, this.adOverlayLabel);
    }
  }

  private renderAdOverlay(ctx: CanvasRenderingContext2D, label: string): void {
    ctx.fillStyle = 'rgba(11, 14, 20, 0.88)';
    ctx.fillRect(0, 0, NATIVE_WIDTH, NATIVE_HEIGHT);

    const bw = 220;
    const bh = 62;
    const bx = NATIVE_WIDTH * 0.5 - bw * 0.5;
    const by = NATIVE_HEIGHT * 0.5 - bh * 0.5;
    ctx.fillStyle = PALETTE.deepNavy;
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = PALETTE.gold;
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, bw, bh);

    drawPixelText(ctx, label, NATIVE_WIDTH * 0.5, by + 18, PALETTE.gold, 2, 'center', PALETTE.inkBlack);
    drawPixelText(ctx, 'GAME PAUSED', NATIVE_WIDTH * 0.5, by + 42, PALETTE.slateLight, 1, 'center');
  }

  private renderActiveScreen(
    ctx: CanvasRenderingContext2D,
    match: MatchState,
    menuConfig: MatchConfig,
    muted: boolean,
    records: CareerRecordsData,
    callbacks: UICallbacks,
    connectedGamepads: ConnectedGamepadInfo[] = [],
    onlineStatus?: OnlineStatusBadge
  ): void {
    if (match.phase === 'MENU') {
      if (this.menuOverlay === 'guide') {
        this.renderGuideOverlay(ctx, callbacks);
      } else if (this.menuOverlay === 'records') {
        this.renderRecordsOverlay(ctx, records, callbacks);
      } else if (this.menuOverlay === 'customize') {
        this.renderCustomizeOverlay(ctx, menuConfig, callbacks);
      } else {
        this.renderMainMenu(ctx, menuConfig, muted, callbacks, connectedGamepads);
      }
      if (this.toastBannerTimer > 0) {
        this.renderToastBanner(ctx, 18);
      }
      return;
    }

    if (match.phase === 'PERK_SELECT') {
      this.renderPerkSelectScreen(ctx, match, callbacks);
      if (this.toastBannerTimer > 0) this.renderToastBanner(ctx, 18);
      return;
    }

    if (match.phase === 'CUP_CHAMPION') {
      this.renderCupChampionScreen(ctx, match, callbacks);
      if (this.toastBannerTimer > 0) this.renderToastBanner(ctx, 18);
      return;
    }

    if (match.phase === 'REPLAY') {
      this.renderReplayOverlay(ctx, match, callbacks, onlineStatus);
      return;
    }

    // In-game Top HUD
    this.renderHud(ctx, match, muted, callbacks, onlineStatus);

    if (onlineStatus?.active && onlineStatus.disconnectNotice) {
      this.renderOnlineDisconnectOverlay(ctx, onlineStatus.disconnectNotice, callbacks);
      return;
    }

    // Phase overlays
    if (match.phase === 'KICKOFF') {
      const count = Math.max(1, Math.ceil(match.phaseTimer * 3));
      const sub = match.cup.active
        ? `R${match.cup.getCurrentRound().roundNumber}: ${match.cup.getCurrentRound().title}`
        : match.isPracticeSandbox()
          ? 'PRACTICE / CHAOS SANDBOX'
          : undefined;
      this.renderCenterBanner(ctx, count > 1 ? `${count}` : 'KICK-OFF!', PALETTE.gold, sub);
      this.renderOnboardingHints(ctx, match, onlineStatus);
    } else if (match.phase === 'PLAYING') {
      this.renderOnboardingHints(ctx, match, onlineStatus);
    } else if (match.phase === 'GOAL_CELEBRATION') {
      this.renderGoalCelebrationBanner(ctx, match);
    } else if (match.phase === 'GOLDEN_GOAL_INTRO') {
      this.renderCenterBanner(ctx, 'GOLDEN GOAL!', PALETTE.gold, 'NEXT SCORE WINS!');
    } else if (match.phase === 'PAUSED' || (onlineStatus?.localPaused && match.phase !== 'FULL_TIME')) {
      if (this.pauseGuideOpen) {
        this.renderGuideOverlay(ctx, callbacks);
      } else {
        this.renderPauseOverlay(ctx, match, callbacks, onlineStatus);
      }
    } else if (match.phase === 'FULL_TIME') {
      this.renderFullTimeOverlay(ctx, match, callbacks, onlineStatus);
    }

    // Mutator top slide-in banner
    if (this.mutatorBannerTimer > 0 && match.phase === 'PLAYING') {
      this.renderMutatorBanner(ctx);
    }

    if (this.toastBannerTimer > 0) {
      const y = this.mutatorBannerTimer > 0 && match.phase === 'PLAYING' ? 46 : 21;
      this.renderToastBanner(ctx, y);
    }
  }

  private renderOnlineDisconnectOverlay(
    ctx: CanvasRenderingContext2D,
    reason: string,
    callbacks: UICallbacks
  ): void {
    ctx.fillStyle = 'rgba(8, 12, 20, 0.86)';
    ctx.fillRect(0, 0, NATIVE_WIDTH, NATIVE_HEIGHT);

    const cx = NATIVE_WIDTH * 0.5;
    const bw = 286;
    const bh = 108;
    const bx = cx - bw * 0.5;
    const by = 80;

    this.drawModalShell(ctx, bx, by, bw, bh, PALETTE.dangerRed, 'CONNECTION LOST');
    drawPixelText(ctx, reason.toUpperCase().slice(0, 42), cx, by + 40, PALETTE.offWhite, 1, 'center');
    this.drawGlossyButton(
      ctx,
      cx - 92,
      by + 66,
      184,
      24,
      'MAIN MENU (ENTER)',
      true,
      PALETTE.teamAPrimary,
      PALETTE.teamALight,
      PALETTE.teamADark,
      callbacks.onQuitToMenu,
      true
    );
  }

  private renderHud(
    ctx: CanvasRenderingContext2D,
    match: MatchState,
    muted: boolean,
    callbacks: UICallbacks,
    onlineStatus?: OnlineStatusBadge
  ): void {
    const hudGrad = ctx.createLinearGradient(0, 0, 0, 17);
    hudGrad.addColorStop(0, 'rgba(9, 13, 22, 0.96)');
    hudGrad.addColorStop(1, 'rgba(16, 24, 38, 0.94)');
    ctx.fillStyle = hudGrad;
    ctx.fillRect(0, 0, NATIVE_WIDTH, 17);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(0, 16, NATIVE_WIDTH, 1);

    const cx = NATIVE_WIDTH * 0.5;
    const kitA = getTeamKit(match.config.teamAKit, 'A');
    const kitB = getTeamKit(match.config.teamBKit, 'B');

    // Modern Center Broadcast Scorebug
    ctx.fillStyle = '#0c121e';
    ctx.fillRect(cx - 90, 1, 180, 14);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 0.75;
    ctx.strokeRect(cx - 90, 1, 180, 14);

    const gradA = ctx.createLinearGradient(cx - 90, 1, cx - 54, 15);
    gradA.addColorStop(0, kitA.primary);
    gradA.addColorStop(1, kitA.dark);
    ctx.fillStyle = gradA;
    ctx.fillRect(cx - 90, 1, 34, 14);

    const gradB = ctx.createLinearGradient(cx + 56, 1, cx + 90, 15);
    gradB.addColorStop(0, kitB.dark);
    gradB.addColorStop(1, kitB.primary);
    ctx.fillStyle = gradB;
    ctx.fillRect(cx + 56, 1, 34, 14);

    drawArcadeText(ctx, kitA.tag, cx - 73, 8.5, PALETTE.pureWhite, 7.5, 'center', {
      weight: '900',
      shadowColor: PALETTE.inkBlack,
    });
    drawArcadeText(ctx, `${match.scoreA}`, cx - 44, 8.5, PALETTE.pureWhite, 11, 'center', {
      weight: '900',
      family: ARCADE_DISPLAY_FONT,
      shadowColor: PALETTE.inkBlack,
    });

    if (match.isPracticeSandbox()) {
      drawArcadeText(ctx, 'SANDBOX', cx, 8.5, PALETTE.iceCyan, 7.5, 'center', { weight: '800' });
    } else if (match.isGoldenGoal) {
      const pulse = Math.floor(this.clock * 6) % 2 === 0;
      drawArcadeText(ctx, 'GOLDEN!', cx, 8.5, pulse ? PALETTE.gold : PALETTE.dangerRed, 8, 'center', {
        weight: '900',
      });
    } else {
      const secs = Math.ceil(match.timeRemaining);
      const mins = Math.floor(secs / 60);
      const rem = secs % 60;
      const timerStr = `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
      const urgent = secs <= 15;
      const timerColor = urgent
        ? Math.floor(this.clock * 8) % 2 === 0
          ? PALETTE.dangerRed
          : PALETTE.gold
        : PALETTE.pureWhite;
      drawArcadeText(ctx, timerStr, cx, 8.5, timerColor, 8.5, 'center', {
        weight: '800',
        shadowColor: PALETTE.inkBlack,
      });
    }

    drawArcadeText(ctx, `${match.scoreB}`, cx + 44, 8.5, PALETTE.pureWhite, 11, 'center', {
      weight: '900',
      family: ARCADE_DISPLAY_FONT,
      shadowColor: PALETTE.inkBlack,
    });
    drawArcadeText(ctx, kitB.tag, cx + 73, 8.5, PALETTE.pureWhite, 7.5, 'center', {
      weight: '900',
      shadowColor: PALETTE.inkBlack,
    });

    // Compact Team Fever Gauges beside scoreboard
    const drawFeverHud = (team: 'A' | 'B', barX: number) => {
      const barW = 34;
      const active = match.isTeamFeverActive(team);
      const pct = match.getTeamFever(team);
      const ratio = active
        ? Math.max(0, (team === 'A' ? match.teamFeverTimerA : match.teamFeverTimerB) / 4.5)
        : Math.max(0, Math.min(1, pct / 100));
      const ready = !active && pct >= 100;
      const blink = Math.floor(this.clock * 10) % 2 === 0;
      const label = active ? 'BURN' : ready ? 'FEV!' : 'FEV';
      const labelColor = active
        ? blink
          ? PALETTE.gold
          : PALETTE.amber
        : ready
          ? blink
            ? PALETTE.gold
            : PALETTE.pureWhite
          : PALETTE.slateLight;
      drawPixelText(ctx, label, barX + barW * 0.5, 3, labelColor, 1, 'center');
      ctx.fillStyle = PALETTE.deepNavy;
      ctx.fillRect(barX, 10, barW, 4);
      ctx.fillStyle = active
        ? blink
          ? PALETTE.gold
          : PALETTE.amber
        : ready
          ? PALETTE.gold
          : team === 'A'
            ? PALETTE.iceCyan
            : PALETTE.amber;
      const fillW = Math.round(barW * ratio);
      if (fillW > 0) ctx.fillRect(barX, 10, fillW, 4);
    };
    drawFeverHud('A', cx - 128);
    drawFeverHud('B', cx + 94);

    // Left HUD: Active Mutator OR Derby Cup Round + Active Perks OR Rooftop Wind
    const activeMut = match.mutators.getActive();
    if (activeMut) {
      drawMutatorIcon(ctx, activeMut.type, 6, 2);
      const timeNote = match.isPracticeSandbox() ? 'FREE' : `${Math.ceil(activeMut.remainingSeconds)}S`;
      drawPixelText(ctx, `${activeMut.label.replace('!', '')} ${timeNote}`, 21, 5, PALETTE.gold, 1, 'left');
    } else if (match.isPracticeSandbox()) {
      drawPixelText(ctx, '1-6:MUTATE  F:PASS', 8, 5, PALETTE.iceCyan, 1, 'left');
    } else if (match.cup.active) {
      const r = match.cup.getCurrentRound();
      const perkNote = match.cup.earnedPerks.length > 0 ? ` +${match.cup.earnedPerks.length}PK` : '';
      drawPixelText(ctx, `CUP R${r.roundNumber}/3${perkNote}`, 8, 5, PALETTE.gold, 1, 'left');
    } else if (ARENA_PRESETS[match.config.arena].hasWind) {
      const wy = match.params.windY;
      const arrow = wy > 3 ? 'WIND V' : wy < -3 ? 'WIND ^' : 'WIND ~';
      drawPixelText(ctx, arrow, 8, 5, PALETTE.iceCyan, 1, 'left');
    } else if (onlineStatus?.active) {
      const pingText = onlineStatus.pingMs !== null ? `${onlineStatus.pingMs}MS` : '...';
      const roleTag = onlineStatus.role === 'host' ? 'HOST' : 'P2';
      drawPixelText(ctx, `${roleTag} ${pingText}`, 8, 5, PALETTE.iceCyan, 1, 'left');
    } else if (match.config.mutatorsEnabled) {
      drawPixelText(ctx, 'CHAOS READY', 8, 5, PALETTE.slateLight, 1, 'left');
    }

    // Right HUD: Mute & Pause clickable badges
    const muteLabel = muted ? '[M] MUTE' : '[M] SFX';
    drawPixelText(ctx, muteLabel, NATIVE_WIDTH - 62, 5, muted ? PALETTE.dangerRed : PALETTE.turfLine, 1, 'right');
    this.clickZones.push({
      x: NATIVE_WIDTH - 108,
      y: 0,
      w: 50,
      h: 17,
      action: callbacks.onToggleMute,
    });

    drawPixelText(ctx, '[ESC] II', NATIVE_WIDTH - 8, 5, PALETTE.offWhite, 1, 'right');
    this.clickZones.push({
      x: NATIVE_WIDTH - 54,
      y: 0,
      w: 54,
      h: 17,
      action: callbacks.onTogglePause,
    });

    // Bottom subtle gameplay strip (hidden while initial onboarding hint pill is visible)
    const hideForOnboarding =
      !match.isPracticeSandbox() &&
      !onlineStatus?.localPaused &&
      !onlineStatus?.disconnectNotice &&
      (match.phase === 'KICKOFF' || (match.phase === 'PLAYING' && match.elapsedSeconds < 4.5));
    if (hideForOnboarding) {
      return;
    }

    if (match.isPracticeSandbox()) {
      const defState = match.sandboxDefenderEnabled ? 'ON' : 'OFF';
      drawPixelText(
        ctx,
        `1-6:MUTATE  0:OFF  F:PASS  B:BALL  T:AI(${defState})  E:PASS  C:FEV`,
        cx,
        257,
        PALETTE.iceCyan,
        1,
        'center'
      );
    } else if (onlineStatus?.active) {
      const hasMulti = match.hasTwoOutfieldPerTeam();
      if (hasMulti) {
        const tac = onlineStatus.localTeam === 'B' ? match.teamTacticB : match.teamTacticA;
        const tacTag = tac === 'attack' ? 'TAC:ATK' : tac === 'defend' ? 'TAC:DEF' : 'TAC:BAL';
        const tacCol =
          tac === 'attack' ? PALETTE.amber : tac === 'defend' ? PALETTE.iceCyan : PALETTE.slateLight;
        drawPixelText(ctx, tacTag, 8, 257, tacCol, 1, 'left');
      }
      const pingTxt = onlineStatus.pingMs !== null ? `${onlineStatus.pingMs}MS` : '--MS';
      const roleTxt = onlineStatus.role === 'host' ? 'P1' : 'P2';
      drawPixelText(
        ctx,
        hasMulti ? 'SP:KICK SH:FEINT E:PASS C:FEV Q:SW' : 'WASD/ARR SP:KICK SH:FEINT C:FEV',
        cx - 6,
        257,
        PALETTE.slateLight,
        1,
        'center'
      );
      drawPixelText(ctx, `${roleTxt} ${pingTxt}`, NATIVE_WIDTH - 8, 257, PALETTE.iceCyan, 1, 'right');
    } else if (match.isTwoPlayerMode()) {
      if (match.hasTwoOutfieldPerTeam()) {
        const tac = match.teamTacticA;
        const tacTag = tac === 'attack' ? 'TAC:ATK' : tac === 'defend' ? 'TAC:DEF' : 'TAC:BAL';
        const tacCol =
          tac === 'attack' ? PALETTE.amber : tac === 'defend' ? PALETTE.iceCyan : PALETTE.slateLight;
        drawPixelText(ctx, tacTag, 8, 257, tacCol, 1, 'left');
      }
      drawPixelText(
        ctx,
        'P1:WASD+SP/SH/E/C  /  P2:ARR+ENT/RC/./\\',
        match.hasTwoOutfieldPerTeam() ? cx + 26 : cx,
        257,
        PALETTE.slateLight,
        1,
        'center'
      );
    } else {
      const hasMulti = match.hasTwoOutfieldPerTeam();
      if (hasMulti) {
        const tac = match.teamTacticA;
        const tacTag = tac === 'attack' ? 'TAC:ATK' : tac === 'defend' ? 'TAC:DEF' : 'TAC:BAL';
        const tacCol =
          tac === 'attack' ? PALETTE.amber : tac === 'defend' ? PALETTE.iceCyan : PALETTE.slateLight;
        drawPixelText(ctx, tacTag, 8, 257, tacCol, 1, 'left');
      }
      const hint = hasMulti
        ? 'SP:KICK  SH:FEINT/DSH  E:PASS  C:FEV  Q:SW  TAB/1-3:TAC'
        : 'MOVE:WASD/ARR   KICK:SPACE   DASH/FEINT:SHIFT   C:FEVER';
      drawPixelText(ctx, hint, hasMulti ? cx + 26 : cx, 257, PALETTE.slateLight, 1, 'center');
    }
  }

  private renderReplayOverlay(
    ctx: CanvasRenderingContext2D,
    match: MatchState,
    callbacks: UICallbacks,
    onlineStatus?: OnlineStatusBadge
  ): void {
    // Classic arcade broadcast letterbox strips
    ctx.fillStyle = PALETTE.inkBlack;
    ctx.fillRect(0, 0, NATIVE_WIDTH, 18);
    ctx.fillRect(0, NATIVE_HEIGHT - 16, NATIVE_WIDTH, 16);

    // Blinking REC/REPLAY pill top-left
    const blink = Math.floor(this.clock * 6) % 2 === 0;
    ctx.fillStyle = PALETTE.deepNavy;
    ctx.fillRect(6, 2, 74, 13);
    if (blink) {
      ctx.fillStyle = PALETTE.dangerRed;
      ctx.fillRect(10, 6, 5, 5);
    }
    drawPixelText(ctx, 'REPLAY', 20, 5, PALETTE.pureWhite, 1, 'left');

    // Center goal highlight tag
    const tagCol = match.replay.scoringTeam === 'A' ? PALETTE.teamALight : PALETTE.teamBLight;
    drawPixelText(ctx, match.replay.activeGoalTag, NATIVE_WIDTH * 0.5, 5, tagCol, 1, 'center');

    const isGuest = onlineStatus?.active && onlineStatus.role === 'guest';
    // Skip hint top-right
    drawPixelText(
      ctx,
      isGuest ? 'GOAL REPLAY' : '[SPACE] SKIP >>',
      NATIVE_WIDTH - 8,
      5,
      isGuest ? PALETTE.iceCyan : PALETTE.gold,
      1,
      'right'
    );

    // Bottom progress bar
    const prog = match.replay.getPlaybackProgress();
    ctx.fillStyle = PALETTE.slateDark;
    ctx.fillRect(24, NATIVE_HEIGHT - 10, NATIVE_WIDTH - 48, 4);
    ctx.fillStyle = PALETTE.gold;
    ctx.fillRect(24, NATIVE_HEIGHT - 10, Math.round((NATIVE_WIDTH - 48) * prog), 4);

    if (!isGuest) {
      // Clicking anywhere skips replay
      this.clickZones.push({
        x: 0,
        y: 0,
        w: NATIVE_WIDTH,
        h: NATIVE_HEIGHT,
        action: callbacks.onSkipReplay,
      });
    }
  }

  private renderToastBanner(ctx: CanvasRenderingContext2D, by: number): void {
    const cx = NATIVE_WIDTH * 0.5;
    const bw = 248;
    const bh = this.toastBannerSub ? 22 : 14;
    const bx = cx - bw * 0.5;

    ctx.fillStyle = PALETTE.inkBlack;
    ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    ctx.fillStyle = PALETTE.deepNavy;
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = this.toastBannerColor;
    ctx.fillRect(bx, by, bw, 2);
    ctx.fillRect(bx, by + bh - 2, bw, 2);

    drawPixelText(ctx, this.toastBannerTitle, cx, by + 4, this.toastBannerColor, 1, 'center');
    if (this.toastBannerSub) {
      drawPixelText(ctx, this.toastBannerSub, cx, by + 13, PALETTE.pureWhite, 1, 'center');
    }
  }

  private renderMutatorBanner(ctx: CanvasRenderingContext2D): void {
    const cx = NATIVE_WIDTH * 0.5;
    const bw = 228;
    const bh = 22;
    const bx = cx - bw * 0.5;
    const by = 21;

    ctx.fillStyle = PALETTE.inkBlack;
    ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    ctx.fillStyle = PALETTE.deepNavy;
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = PALETTE.amber;
    ctx.fillRect(bx, by, bw, 2);
    ctx.fillRect(bx, by + bh - 2, bw, 2);

    drawPixelText(ctx, `CHAOS: ${this.mutatorBannerLabel}`, cx, by + 4, PALETTE.gold, 1, 'center');
    drawPixelText(ctx, this.mutatorBannerSub, cx, by + 13, PALETTE.pureWhite, 1, 'center');
  }

  private renderCenterBanner(
    ctx: CanvasRenderingContext2D,
    title: string,
    color: string,
    subtitle?: string
  ): void {
    const cx = NATIVE_WIDTH * 0.5;
    const cy = NATIVE_HEIGHT * 0.5;
    const bw = 236;
    const bh = subtitle ? 48 : 34;
    const bx = cx - bw * 0.5;
    const by = cy - bh * 0.5;

    ctx.fillStyle = 'rgba(8, 12, 20, 0.84)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(bx + 2, by + 2, bw - 4, 8);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, bw, bh);

    drawArcadeText(ctx, title, cx, cy + (subtitle ? -7 : 1), color, 17, 'center', {
      weight: '900',
      italic: true,
      family: ARCADE_DISPLAY_FONT,
      strokeColor: PALETTE.inkBlack,
      strokeWidth: 2.8,
      shadowColor: 'rgba(0, 0, 0, 0.85)',
    });
    if (subtitle) {
      drawPixelText(ctx, subtitle, cx, cy + 8, PALETTE.pureWhite, 1, 'center');
    }
  }

  private renderGoalCelebrationBanner(ctx: CanvasRenderingContext2D, match: MatchState): void {
    const kitA = getTeamKit(match.config.teamAKit, 'A');
    const kitB = getTeamKit(match.config.teamBKit, 'B');
    const scoreKit = getTeamKit(
      match.lastScoringTeam === 'A' ? match.config.teamAKit : match.config.teamBKit,
      match.lastScoringTeam ?? 'A'
    );
    const shortName = scoreKit.name.split(' ')[0].toUpperCase();
    const cx = NATIVE_WIDTH * 0.5;
    const cy = NATIVE_HEIGHT * 0.5;

    // Pop-in spring easing tied to phaseTimer (goal celebration lasts ~1.3s)
    const pop = Math.min(1, 0.65 + 0.45 * Math.abs(Math.sin(this.clock * 8)));
    const ribbonGrad = ctx.createLinearGradient(0, cy - 34, 0, cy + 34);
    ribbonGrad.addColorStop(0, 'rgba(8, 12, 20, 0.90)');
    ribbonGrad.addColorStop(0.5, 'rgba(18, 28, 46, 0.94)');
    ribbonGrad.addColorStop(1, 'rgba(8, 12, 20, 0.90)');
    ctx.fillStyle = ribbonGrad;
    ctx.fillRect(0, cy - 33, NATIVE_WIDTH, 66);

    // Animated speed/glint bars bordering top & bottom of goal ribbon
    ctx.fillStyle = scoreKit.primary;
    ctx.fillRect(0, cy - 33, NATIVE_WIDTH, 3);
    ctx.fillRect(0, cy + 30, NATIVE_WIDTH, 3);
    const sweepX = ((this.clock * 380) % (NATIVE_WIDTH + 140)) - 70;
    ctx.fillStyle = PALETTE.gold;
    ctx.fillRect(sweepX, cy - 33, 64, 3);
    ctx.fillRect(NATIVE_WIDTH - sweepX - 64, cy + 30, 64, 3);

    if (this.lastGoalHighlightTag && !match.isGoldenGoal) {
      drawArcadeText(ctx, this.lastGoalHighlightTag, cx, cy - 23, PALETTE.gold, 8.5, 'center', {
        weight: '900',
        shadowColor: PALETTE.inkBlack,
      });
    } else if (match.isGoldenGoal) {
      drawArcadeText(ctx, 'MATCH WINNER!', cx, cy - 23, PALETTE.gold, 8.5, 'center', {
        weight: '900',
        shadowColor: PALETTE.inkBlack,
      });
    }

    const titleText = match.isGoldenGoal ? 'GOLDEN GOAL!' : `${shortName} GOAL!`;
    drawArcadeText(
      ctx,
      titleText,
      cx,
      cy - 1,
      scoreKit.light,
      Math.round(23 + pop * 2),
      'center',
      {
        weight: '900',
        italic: true,
        family: ARCADE_DISPLAY_FONT,
        strokeColor: PALETTE.inkBlack,
        strokeWidth: 4,
        shadowColor: 'rgba(0, 0, 0, 0.9)',
      }
    );

    // Live Score Ticker Pill inside bottom of ribbon
    const pillW = 148;
    const pillX = cx - pillW * 0.5;
    const pillY = cy + 14;
    ctx.fillStyle = '#0a0f18';
    ctx.fillRect(pillX, pillY, pillW, 13);
    ctx.fillStyle = kitA.primary;
    ctx.fillRect(pillX, pillY, 30, 13);
    ctx.fillStyle = kitB.primary;
    ctx.fillRect(pillX + pillW - 30, pillY, 30, 13);
    ctx.strokeStyle = PALETTE.gold;
    ctx.lineWidth = 1;
    ctx.strokeRect(pillX + 0.5, pillY + 0.5, pillW - 1, 12);

    drawArcadeText(ctx, kitA.tag, pillX + 15, pillY + 7, PALETTE.pureWhite, 7, 'center', { weight: '900' });
    drawArcadeText(
      ctx,
      `${match.scoreA}  -  ${match.scoreB}`,
      cx,
      pillY + 7,
      PALETTE.gold,
      9,
      'center',
      { weight: '900', family: ARCADE_DISPLAY_FONT }
    );
    drawArcadeText(ctx, kitB.tag, pillX + pillW - 15, pillY + 7, PALETTE.pureWhite, 7, 'center', {
      weight: '900',
    });
  }

  private detectHomeCard(mode: GameMode): number {
    if (mode.startsWith('derby_cup_')) return 1;
    if (mode.endsWith('_local') || mode.endsWith('_coop')) return 2;
    if (mode === 'practice_sandbox') return 3;
    return 0;
  }

  private drawCardMiniIcon(
    ctx: CanvasRenderingContext2D,
    cardId: number,
    cx: number,
    cy: number,
    accent: string
  ): void {
    ctx.save();
    if (cardId === 0) {
      // Mini pitch + stadium ball
      ctx.fillStyle = PALETTE.turfDark;
      ctx.fillRect(cx - 12, cy - 6, 24, 13);
      ctx.strokeStyle = PALETTE.turfLine;
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - 11.5, cy - 5.5, 23, 12);
      ctx.fillStyle = PALETTE.turfLine;
      ctx.fillRect(cx, cy - 5, 1, 11);
      ctx.fillStyle = PALETTE.pureWhite;
      ctx.beginPath();
      ctx.arc(cx, cy + 0.5, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.fillRect(cx - 8, cy - 2, 3, 5);
      ctx.fillStyle = PALETTE.iceCyan;
      ctx.fillRect(cx + 5, cy - 2, 3, 5);
    } else if (cardId === 1) {
      // Golden Cup Trophy
      ctx.fillStyle = accent;
      ctx.fillRect(cx - 5, cy - 6, 10, 6);
      ctx.fillRect(cx - 3, cy, 6, 2);
      ctx.fillRect(cx - 1.5, cy + 2, 3, 3);
      ctx.fillRect(cx - 5, cy + 5, 10, 2);
      ctx.fillStyle = PALETTE.inkBlack;
      ctx.fillRect(cx - 8, cy - 5, 3, 3);
      ctx.fillRect(cx + 5, cy - 5, 3, 3);
      ctx.fillStyle = accent;
      ctx.fillRect(cx - 7, cy - 4, 2, 2);
      ctx.fillRect(cx + 5, cy - 4, 2, 2);
      ctx.fillStyle = PALETTE.pureWhite;
      ctx.fillRect(cx - 3, cy - 5, 2, 3);
    } else if (cardId === 2) {
      // Twin P1 + P2 badges
      ctx.fillStyle = PALETTE.teamAPrimary;
      ctx.fillRect(cx - 11, cy - 5, 9, 10);
      ctx.fillStyle = PALETTE.pureWhite;
      ctx.fillRect(cx - 8, cy - 3, 3, 2);
      ctx.fillStyle = PALETTE.teamBPrimary;
      ctx.fillRect(cx + 2, cy - 5, 9, 10);
      ctx.fillStyle = PALETTE.pureWhite;
      ctx.fillRect(cx + 5, cy - 3, 3, 2);
      ctx.fillStyle = PALETTE.gold;
      ctx.fillRect(cx - 1, cy - 1, 2, 2);
    } else {
      // Chaos lightning / gear diamond
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.moveTo(cx + 1, cy - 7);
      ctx.lineTo(cx - 5, cy + 1);
      ctx.lineTo(cx, cy + 1);
      ctx.lineTo(cx - 2, cy + 7);
      ctx.lineTo(cx + 5, cy - 1);
      ctx.lineTo(cx, cy - 1);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  private renderMainMenu(
    ctx: CanvasRenderingContext2D,
    config: MatchConfig,
    muted: boolean,
    callbacks: UICallbacks,
    connectedGamepads: ConnectedGamepadInfo[] = []
  ): void {
    // Translucent scrim over live stadium backdrop, or solid night sky in headless tests
    if (this.hasBackdrop) {
      const bgGrad = ctx.createLinearGradient(0, 0, 0, NATIVE_HEIGHT);
      bgGrad.addColorStop(0, 'rgba(8, 12, 20, 0.80)');
      bgGrad.addColorStop(0.36, 'rgba(10, 15, 24, 0.56)');
      bgGrad.addColorStop(0.75, 'rgba(9, 13, 22, 0.72)');
      bgGrad.addColorStop(1, 'rgba(7, 10, 17, 0.90)');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, NATIVE_WIDTH, NATIVE_HEIGHT);
    } else {
      ctx.fillStyle = PALETTE.inkBlack;
      ctx.fillRect(0, 0, NATIVE_WIDTH, NATIVE_HEIGHT);
    }

    // Top Utility Strip (Display Mode, Sound, Fullscreen)
    const viewLabel = `[V] PAD:${getDisplayModeLabel(config.displayMode ?? 'auto')}`;
    const viewActive = config.displayMode === 'mobile';
    ctx.fillStyle = viewActive ? PALETTE.teamAPrimary : 'rgba(18, 25, 38, 0.92)';
    ctx.fillRect(8, 5, 86, 13);
    ctx.strokeStyle = viewActive ? PALETTE.gold : PALETTE.slateMid;
    ctx.lineWidth = 1;
    ctx.strokeRect(8.5, 5.5, 85, 12);
    drawPixelText(ctx, viewLabel, 51, 8, viewActive ? PALETTE.pureWhite : PALETTE.iceCyan, 1, 'center');
    this.clickZones.push({
      x: 8,
      y: 5,
      w: 86,
      h: 13,
      action: callbacks.onCycleDisplayMode,
    });

    if (connectedGamepads.length > 0) {
      drawPixelText(
        ctx,
        connectedGamepads.length >= 2 ? 'PAD P1+P2 OK' : `PAD:${connectedGamepads[0].shortName.slice(0, 10)}`,
        99,
        8,
        '#7dffba',
        1,
        'left'
      );
    }

    ctx.fillStyle = muted ? 'rgba(66, 20, 28, 0.92)' : 'rgba(18, 25, 38, 0.92)';
    ctx.fillRect(306, 5, 76, 13);
    ctx.strokeStyle = muted ? PALETTE.dangerRed : PALETTE.slateMid;
    ctx.strokeRect(306.5, 5.5, 75, 12);
    drawPixelText(
      ctx,
      muted ? '[M] MUTE' : '[M] SFX:ON',
      344,
      8,
      muted ? PALETTE.dangerRed : PALETTE.iceCyan,
      1,
      'center'
    );
    this.clickZones.push({
      x: 306,
      y: 5,
      w: 76,
      h: 13,
      action: callbacks.onToggleMute,
    });

    const fsActive = isFullscreenActive(typeof document !== 'undefined' ? document : null);
    ctx.fillStyle = fsActive ? 'rgba(22, 61, 45, 0.94)' : 'rgba(18, 25, 38, 0.92)';
    ctx.fillRect(386, 5, 86, 13);
    ctx.strokeStyle = fsActive ? '#39d98a' : PALETTE.slateMid;
    ctx.strokeRect(386.5, 5.5, 85, 12);
    drawPixelText(
      ctx,
      fsActive ? '[F] WINDOW' : '[F] FULLSCRN',
      429,
      8,
      fsActive ? '#7dffba' : PALETTE.pureWhite,
      1,
      'center'
    );
    this.clickZones.push({
      x: 386,
      y: 5,
      w: 86,
      h: 13,
      action: callbacks.onToggleFullscreen,
    });

    // Hero Crest & Title Banner
    const kitA = getTeamKit(config.teamAKit, 'A');
    const kitB = getTeamKit(config.teamBKit, 'B');
    const titleX = 76;
    const titleY = 23;
    const titleW = 328;
    const titleH = 42;
    const titleGrad = ctx.createLinearGradient(titleX, titleY, titleX + titleW, titleY + titleH);
    titleGrad.addColorStop(0, 'rgba(17, 24, 38, 0.94)');
    titleGrad.addColorStop(0.5, 'rgba(24, 34, 52, 0.96)');
    titleGrad.addColorStop(1, 'rgba(17, 24, 38, 0.94)');
    ctx.fillStyle = titleGrad;
    ctx.fillRect(titleX, titleY, titleW, titleH);
    ctx.strokeStyle = PALETTE.gold;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(titleX + 0.5, titleY + 0.5, titleW - 1, titleH - 1);

    // Side kit color accents on hero title plaque
    ctx.fillStyle = kitA.primary;
    ctx.fillRect(titleX + 2, titleY + 2, 4, titleH - 4);
    ctx.fillStyle = kitB.primary;
    ctx.fillRect(titleX + titleW - 6, titleY + 2, 4, titleH - 4);

    drawPixelText(
      ctx,
      'WALL-BOUNCE FUTSAL  |  NO OUTS  |  PURE CHAOS',
      NATIVE_WIDTH * 0.5,
      27,
      PALETTE.iceCyan,
      1,
      'center',
      PALETTE.inkBlack
    );
    drawArcadeText(ctx, 'NO-OUT DERBY', NATIVE_WIDTH * 0.5, 49, PALETTE.gold, 21, 'center', {
      weight: '900',
      italic: true,
      family: ARCADE_DISPLAY_FONT,
      strokeColor: PALETTE.inkBlack,
      strokeWidth: 3.4,
      shadowColor: 'rgba(0, 0, 0, 0.9)',
    });
    // Animated subtle gold sparkles beside logo
    const sparkAlpha = 0.45 + Math.abs(Math.sin(this.clock * 3.5)) * 0.55;
    ctx.save();
    ctx.globalAlpha = sparkAlpha;
    ctx.fillStyle = PALETTE.gold;
    ctx.fillRect(titleX + 36, 44, 3, 3);
    ctx.fillRect(titleX + titleW - 39, 44, 3, 3);
    ctx.restore();

    // 4 Selectable Mode Cards (homeRow === 0)
    const activeCardIdx = this.detectHomeCard(config.mode);
    const modeLabel = MODE_OPTIONS.find((m) => m.value === config.mode)?.label ?? '2V2 VS AI';
    const cardDefinitions: Array<{
      id: number;
      title: string;
      modes: GameMode[];
      defaultMode: GameMode;
      accent: string;
      idleSub: string;
    }> = [
      {
        id: 0,
        title: 'QUICK MATCH',
        modes: ['1v1_ai', '2v2_ai', '3v3_ai', '4v4_ai'],
        defaultMode: '2v2_ai',
        accent: kitA.primary,
        idleSub: '1V1 - 4V4 AI',
      },
      {
        id: 1,
        title: 'DERBY CUP',
        modes: ['derby_cup_1v1', 'derby_cup_2v2', 'derby_cup_3v3', 'derby_cup_4v4'],
        defaultMode: 'derby_cup_2v2',
        accent: PALETTE.gold,
        idleSub: '3-STAGE TOUR',
      },
      {
        id: 2,
        title: '2P LOCAL',
        modes: ['1v1_local', '2v2_local', '3v3_local', '4v4_local', '2v2_coop', '3v3_coop', '4v4_coop'],
        defaultMode: '1v1_local',
        accent: PALETTE.iceCyan,
        idleSub: 'VERSUS / CO-OP',
      },
      {
        id: 3,
        title: 'SANDBOX',
        modes: ['practice_sandbox'],
        defaultMode: 'practice_sandbox',
        accent: '#39d98a',
        idleSub: 'DRILLS + CHAOS',
      },
    ];

    const cardW = 104;
    const cardH = 52;
    const cardGap = 8;
    const cardStartX = 20;
    const cardY = 71;

    for (const card of cardDefinitions) {
      const cx = cardStartX + card.id * (cardW + cardGap);
      const isCurrentMode = activeCardIdx === card.id;
      const isFocused = this.homeRow === 0 && this.homeCard === card.id;

      ctx.fillStyle = isCurrentMode ? 'rgba(24, 37, 58, 0.96)' : 'rgba(13, 19, 30, 0.90)';
      ctx.fillRect(cx, cardY, cardW, cardH);

      // Top colored accent bar
      ctx.fillStyle = isCurrentMode || isFocused ? card.accent : PALETTE.slateMid;
      ctx.fillRect(cx, cardY, cardW, 3);

      ctx.strokeStyle = isFocused
        ? PALETTE.gold
        : isCurrentMode
          ? card.accent
          : PALETTE.slateDark;
      ctx.lineWidth = isFocused || isCurrentMode ? 1.5 : 1;
      ctx.strokeRect(cx + 0.5, cardY + 0.5, cardW - 1, cardH - 1);

      this.drawCardMiniIcon(ctx, card.id, cx + cardW * 0.5, cardY + 15, card.accent);
      drawPixelText(
        ctx,
        card.title,
        cx + cardW * 0.5,
        cardY + 27,
        isCurrentMode || isFocused ? PALETTE.pureWhite : PALETTE.offWhite,
        1,
        'center'
      );

      let subText = card.idleSub;
      if (isCurrentMode) {
        if (card.id === 0) subText = `< ${modeLabel.replace(' VS AI', '')} >`;
        else if (card.id === 1) subText = `< ${modeLabel.replace('DERBY CUP ', '')} CUP >`;
        else if (card.id === 2) subText = `< ${modeLabel.replace('2P ', '').replace(' VERSUS', ' VS')} >`;
        else subText = 'FREE CHAOS';
      }
      drawPixelText(
        ctx,
        subText,
        cx + cardW * 0.5,
        cardY + 39,
        isCurrentMode ? PALETTE.gold : PALETTE.slateLight,
        1,
        'center'
      );

      this.clickZones.push({
        x: cx,
        y: cardY,
        w: cardW,
        h: cardH,
        action: () => {
          this.homeRow = 0;
          this.homeCard = card.id;
          if (isCurrentMode && card.modes.length > 1) {
            const curIdx = card.modes.indexOf(config.mode);
            const nextMode = card.modes[(curIdx + 1) % card.modes.length];
            callbacks.onUpdateConfig({ mode: nextMode });
          } else if (!isCurrentMode) {
            callbacks.onUpdateConfig({ mode: card.defaultMode });
          }
        },
      });
    }

    // Active Loadout Summary Strip + [C] CUSTOMIZE Pill (y: 129..153)
    const stripX = 20;
    const stripY = 129;
    const stripW = 440;
    const stripH = 24;
    ctx.fillStyle = 'rgba(13, 19, 30, 0.92)';
    ctx.fillRect(stripX, stripY, stripW, stripH);
    ctx.strokeStyle = PALETTE.slateDark;
    ctx.lineWidth = 1;
    ctx.strokeRect(stripX + 0.5, stripY + 0.5, stripW - 1, stripH - 1);

    // Kit A vs Kit B swatches
    ctx.fillStyle = PALETTE.inkBlack;
    ctx.fillRect(stripX + 7, stripY + 5, 14, 14);
    ctx.fillStyle = kitA.primary;
    ctx.fillRect(stripX + 8, stripY + 6, 12, 12);
    ctx.fillStyle = kitA.trim;
    ctx.fillRect(stripX + 12, stripY + 6, 3, 12);

    drawPixelText(ctx, 'VS', stripX + 30, stripY + 9, PALETTE.slateLight, 1, 'center');

    ctx.fillStyle = PALETTE.inkBlack;
    ctx.fillRect(stripX + 38, stripY + 5, 14, 14);
    ctx.fillStyle = kitB.primary;
    ctx.fillRect(stripX + 39, stripY + 6, 12, 12);
    ctx.fillStyle = kitB.trim;
    ctx.fillRect(stripX + 43, stripY + 6, 3, 12);

    const isCup = config.mode.startsWith('derby_cup_');
    const isFourVsFour =
      config.mode === '4v4_ai' ||
      config.mode === 'derby_cup_4v4' ||
      config.mode === '4v4_local' ||
      config.mode === '4v4_coop';
    const isSandbox = config.mode === 'practice_sandbox';
    const arenaShort = isCup
      ? '3-ARENA CUP'
      : ARENA_PRESETS[config.arena ?? 'classic'].name.split(' ')[0];
    const pitchShort = isFourVsFour
      ? 'XL'
      : (PITCH_SIZE_PRESETS[config.pitchSize ?? 'standard'] ?? PITCH_SIZE_PRESETS.standard).label
          .split(' ')[0]
          .slice(0, 5);
    const ctrlShort = (config.controlStyle ?? 'classic') === 'dribble' ? 'DRIBBLE' : 'BOUNCE';
    const diffShort = isCup
      ? 'LADDER'
      : config.difficulty === 'tarkam'
        ? 'TARKAM'
        : config.difficulty.toUpperCase();
    const durShort = isSandbox ? 'FREE' : `${config.durationSeconds}S`;
    const setupLine = `${arenaShort} | ${pitchShort} | ${ctrlShort} | ${diffShort} | ${durShort}`.slice(0, 44);
    drawPixelText(ctx, setupLine, stripX + 60, stripY + 9, PALETTE.offWhite, 1, 'left');

    const customBtnX = stripX + stripW - 102;
    const customBtnY = stripY + 3;
    const customBtnW = 96;
    const customBtnH = 18;
    ctx.fillStyle = '#1b2b44';
    ctx.fillRect(customBtnX, customBtnY, customBtnW, customBtnH);
    ctx.strokeStyle = PALETTE.iceCyan;
    ctx.strokeRect(customBtnX + 0.5, customBtnY + 0.5, customBtnW - 1, customBtnH - 1);
    drawPixelText(
      ctx,
      '[C] CUSTOMIZE',
      customBtnX + customBtnW * 0.5,
      customBtnY + 6,
      PALETTE.iceCyan,
      1,
      'center'
    );
    const openCustomize = () => {
      if (callbacks.onOpenCustomize) callbacks.onOpenCustomize();
      else this.menuOverlay = 'customize';
    };
    this.clickZones.push({
      x: stripX,
      y: stripY,
      w: stripW,
      h: stripH,
      action: openCustomize,
    });

    // Primary CTA Row (homeRow === 1, fixed y: 162 for UI click-zone contract)
    const ctaY = 162;
    const ctaH = 34;
    const playFocused = this.homeRow === 1 && (this.menuFocusPlay || !this.onlineEnabled);
    const pulse = 0.5 + 0.5 * Math.sin(this.clock * 4.5);

    const playX = this.onlineEnabled ? 54 : 110;
    const playW = this.onlineEnabled ? 246 : 260;

    const ctaGrad = ctx.createLinearGradient(playX, ctaY, playX, ctaY + ctaH);
    ctaGrad.addColorStop(0, playFocused ? kitA.light : kitA.primary);
    ctaGrad.addColorStop(1, kitA.dark);
    ctx.fillStyle = ctaGrad;
    ctx.fillRect(playX, ctaY, playW, ctaH);

    // Top specular highlight strip
    ctx.fillStyle = `rgba(255, 255, 255, ${0.14 + pulse * 0.14})`;
    ctx.fillRect(playX + 2, ctaY + 2, playW - 4, 3);

    ctx.strokeStyle = playFocused ? PALETTE.gold : PALETTE.offWhite;
    ctx.lineWidth = playFocused ? 2 : 1;
    ctx.strokeRect(playX + 0.5, ctaY + 0.5, playW - 1, ctaH - 1);

    const ctaTitle = isCup ? 'START CUP!' : isSandbox ? 'PRACTICE!' : 'PLAY NOW!';
    drawArcadeText(ctx, ctaTitle, playX + playW * 0.5, ctaY + 13, PALETTE.pureWhite, 16, 'center', {
      weight: '900',
      italic: true,
      family: ARCADE_DISPLAY_FONT,
      strokeColor: PALETTE.inkBlack,
      strokeWidth: 2.6,
      shadowColor: 'rgba(0, 0, 0, 0.85)',
    });
    drawPixelText(
      ctx,
      this.isMobileLayout ? 'TAP TO KICK OFF' : 'ENTER / CLICK TO KICK OFF',
      playX + playW * 0.5,
      ctaY + 23,
      PALETTE.gold,
      1,
      'center',
      PALETTE.inkBlack
    );

    this.clickZones.push({
      x: playX,
      y: ctaY,
      w: playW,
      h: ctaH,
      action: () => {
        this.homeRow = 1;
        this.menuFocusPlay = true;
        callbacks.onStartMatch();
      },
    });

    if (this.onlineEnabled) {
      const onlineX = playX + playW + 8;
      const onlineW = 118;
      const onlineFocused = this.homeRow === 1 && !this.menuFocusPlay;
      const onlineGrad = ctx.createLinearGradient(onlineX, ctaY, onlineX, ctaY + ctaH);
      onlineGrad.addColorStop(0, onlineFocused ? '#1c7ca6' : '#145875');
      onlineGrad.addColorStop(1, '#0b3245');
      ctx.fillStyle = onlineGrad;
      ctx.fillRect(onlineX, ctaY, onlineW, ctaH);

      ctx.strokeStyle = onlineFocused ? PALETTE.gold : PALETTE.iceCyan;
      ctx.lineWidth = onlineFocused ? 2 : 1;
      ctx.strokeRect(onlineX + 0.5, ctaY + 0.5, onlineW - 1, ctaH - 1);

      drawPixelText(
        ctx,
        'ONLINE [O]',
        onlineX + onlineW * 0.5,
        ctaY + 8,
        PALETTE.pureWhite,
        1,
        'center',
        PALETTE.inkBlack
      );
      drawPixelText(
        ctx,
        'ROOM CODE',
        onlineX + onlineW * 0.5,
        ctaY + 20,
        PALETTE.iceCyan,
        1,
        'center'
      );

      this.clickZones.push({
        x: onlineX,
        y: ctaY,
        w: onlineW,
        h: ctaH,
        action: () => {
          this.homeRow = 1;
          this.menuFocusPlay = false;
          callbacks.onOpenOnlineLobby();
        },
      });
    }

    // Footer Quick Actions Row (homeRow === 2, y: 204..225)
    const footerActions: Array<{
      id: number;
      label: string;
      color: string;
      action: () => void;
    }> = [
      { id: 0, label: '[C] MATCH SETUP', color: PALETTE.offWhite, action: openCustomize },
      { id: 1, label: '[H] HOW TO PLAY', color: PALETTE.iceCyan, action: callbacks.onOpenGuide },
      { id: 2, label: '[R] RECORDS', color: PALETTE.gold, action: callbacks.onOpenRecords },
    ];
    const footW = 112;
    const footH = 21;
    const footGap = 10;
    const footStartX = 62;
    const footY = 204;

    for (const item of footerActions) {
      const fx = footStartX + item.id * (footW + footGap);
      const selected = this.homeRow === 2 && this.homeFooterIdx === item.id;
      ctx.fillStyle = selected ? PALETTE.slateMid : 'rgba(15, 22, 34, 0.90)';
      ctx.fillRect(fx, footY, footW, footH);
      ctx.strokeStyle = selected ? PALETTE.gold : PALETTE.slateDark;
      ctx.lineWidth = 1;
      ctx.strokeRect(fx + 0.5, footY + 0.5, footW - 1, footH - 1);
      drawPixelText(
        ctx,
        item.label,
        fx + footW * 0.5,
        footY + 7,
        selected ? PALETTE.gold : item.color,
        1,
        'center'
      );
      this.clickZones.push({
        x: fx,
        y: footY,
        w: footW,
        h: footH,
        action: () => {
          this.homeRow = 2;
          this.homeFooterIdx = item.id;
          item.action();
        },
      });
    }

    // Compact Controls Strip (y: 232..262)
    ctx.fillStyle = 'rgba(11, 14, 20, 0.90)';
    ctx.fillRect(20, 232, NATIVE_WIDTH - 40, 30);
    ctx.strokeStyle = connectedGamepads.length > 0 ? '#39d98a' : PALETTE.slateDark;
    ctx.lineWidth = 1;
    ctx.strokeRect(20.5, 232.5, NATIVE_WIDTH - 41, 29);

    const controlsLine =
      connectedGamepads.length >= 2
        ? 'PAD1+2 READY  |  L-STICK:MOVE  A/RT:KICK  B/RB:TACKLE  Y/LB:SW'
        : connectedGamepads.length === 1
          ? `EXT PAD OK (${connectedGamepads[0].shortName.slice(0, 12)})  |  A/RT:KICK  B/RB:TACKLE`
          : this.isMobileLayout
            ? 'TOUCH STICK: MOVE  |  HOLD KICK: POWER SHOT  |  DASH: TACKLE'
            : 'MOVE: WASD/ARROWS  |  KICK: SPACE  |  TACKLE/DASH: SHIFT  |  SW: Q';
    drawPixelText(
      ctx,
      controlsLine,
      NATIVE_WIDTH * 0.5,
      238,
      connectedGamepads.length > 0 ? '#7dffba' : PALETTE.offWhite,
      1,
      'center'
    );
    drawPixelText(
      ctx,
      this.onlineEnabled
        ? 'UP/DOWN: FOCUS | ENT: PLAY | O: ONLINE | C: SETUP'
        : 'UP/DOWN: FOCUS | LEFT/RIGHT: MODE | ENT: PLAY | C: SETUP',
      NATIVE_WIDTH * 0.5,
      250,
      PALETTE.slateLight,
      1,
      'center'
    );
  }

  private renderCustomizeOverlay(
    ctx: CanvasRenderingContext2D,
    config: MatchConfig,
    callbacks: UICallbacks
  ): void {
    ctx.fillStyle = 'rgba(8, 12, 20, 0.88)';
    ctx.fillRect(0, 0, NATIVE_WIDTH, NATIVE_HEIGHT);

    const modalX = 56;
    const modalY = 10;
    const modalW = NATIVE_WIDTH - 112;
    const modalH = NATIVE_HEIGHT - 20;
    this.drawModalShell(ctx, modalX, modalY, modalW, modalH, PALETTE.gold, 'MATCH SETUP');

    // Top-right Close [ESC] button
    const closeX = modalX + modalW - 58;
    const closeY = modalY + 6;
    ctx.fillStyle = PALETTE.deepNavy;
    ctx.fillRect(closeX, closeY, 50, 14);
    ctx.strokeStyle = PALETTE.iceCyan;
    ctx.lineWidth = 1;
    ctx.strokeRect(closeX + 0.5, closeY + 0.5, 49, 13);
    drawPixelText(ctx, 'ESC:BACK', closeX + 25, closeY + 3.5, PALETTE.iceCyan, 1, 'center');
    this.clickZones.push({
      x: closeX,
      y: closeY,
      w: 50,
      h: 14,
      action: callbacks.onCloseOverlay,
    });

    const panelX = 68;
    const panelW = NATIVE_WIDTH - 136;
    const panelY = 39;
    const rowH = 18;

    const isCup = config.mode.startsWith('derby_cup_');
    const isFourVsFour =
      config.mode === '4v4_ai' ||
      config.mode === 'derby_cup_4v4' ||
      config.mode === '4v4_local' ||
      config.mode === '4v4_coop';
    const isSandbox = config.mode === 'practice_sandbox';
    const modeLabel = MODE_OPTIONS.find((m) => m.value === config.mode)?.label ?? '1V1 VS AI';
    const controlStyle = config.controlStyle ?? 'classic';
    const controlLabel = controlStyle === 'dribble' ? 'DRIBBLE + TACKLE' : 'CLASSIC (BOUNCE)';
    const arenaLabel = ARENA_PRESETS[config.arena ?? 'classic'].name;
    const pitchSize: PitchSize = config.pitchSize ?? 'standard';
    const pitchSizeLabel = (PITCH_SIZE_PRESETS[pitchSize] ?? PITCH_SIZE_PRESETS.standard).label;
    const diffLabel = DIFFICULTY_OPTIONS.find((d) => d.value === config.difficulty)?.label ?? 'PRO';
    const aiUsed = config.mode !== '1v1_local' && !isCup;
    const kitA = getTeamKit(config.teamAKit, 'A');
    const kitB = getTeamKit(config.teamBKit, 'B');

    const rows: Array<{
      id: number;
      label: string;
      value: string;
      highlight?: boolean;
      disabled?: boolean;
      swatch?: { primary: string; trim: string };
      onClick: () => void;
    }> = [
      {
        id: 0,
        label: 'KICK OFF!',
        value: 'START MATCH ->',
        highlight: true,
        onClick: callbacks.onStartMatch,
      },
      {
        id: 1,
        label: 'MODE',
        value: `< ${modeLabel} >`,
        onClick: () => {
          const idx = MODE_OPTIONS.findIndex((m) => m.value === config.mode);
          const next = MODE_OPTIONS[(idx + 1) % MODE_OPTIONS.length].value;
          callbacks.onUpdateConfig({ mode: next });
        },
      },
      {
        id: 2,
        label: 'BALL CTRL',
        value: `< ${controlLabel} >`,
        onClick: () => {
          callbacks.onUpdateConfig({
            controlStyle: controlStyle === 'dribble' ? 'classic' : 'dribble',
          });
        },
      },
      {
        id: 3,
        label: 'ARENA',
        value: isCup ? '3-STAGE CUP TOUR' : `< ${arenaLabel} >`,
        disabled: isCup,
        onClick: () => {
          if (isCup) return;
          const idx = ARENA_LIST.indexOf(config.arena ?? 'classic');
          const next: ArenaId = ARENA_LIST[(idx + 1) % ARENA_LIST.length];
          callbacks.onUpdateConfig({ arena: next });
        },
      },
      {
        id: 4,
        label: 'PITCH SIZE',
        value: isFourVsFour ? 'STADIUM XL (4V4 ONLY)' : `< ${pitchSizeLabel} >`,
        disabled: isFourVsFour,
        onClick: () => {
          if (isFourVsFour) return;
          const idx = PITCH_SIZE_LIST.indexOf(pitchSize);
          const next: PitchSize = PITCH_SIZE_LIST[(idx + 1) % PITCH_SIZE_LIST.length];
          callbacks.onUpdateConfig({ pitchSize: next });
        },
      },
      {
        id: 5,
        label: 'TEAM A KIT',
        value: `< ${kitA.name} >`,
        swatch: { primary: kitA.primary, trim: kitA.trim },
        onClick: () => {
          callbacks.onUpdateConfig({ teamAKit: cycleTeamKit(kitA.id, kitB.id, 1) });
        },
      },
      {
        id: 6,
        label: 'TEAM B KIT',
        value: `< ${kitB.name} >`,
        swatch: { primary: kitB.primary, trim: kitB.trim },
        onClick: () => {
          callbacks.onUpdateConfig({ teamBKit: cycleTeamKit(kitB.id, kitA.id, 1) });
        },
      },
      {
        id: 7,
        label: 'AI LEVEL',
        value: isCup ? 'CUP LADDER (R->P->T)' : isSandbox ? `< ${diffLabel} (DEF) >` : aiUsed ? `< ${diffLabel} >` : 'HUMAN VS HUMAN',
        disabled: !aiUsed,
        onClick: () => {
          if (!aiUsed) return;
          const idx = DIFFICULTY_OPTIONS.findIndex((d) => d.value === config.difficulty);
          const next = DIFFICULTY_OPTIONS[(idx + 1) % DIFFICULTY_OPTIONS.length].value;
          callbacks.onUpdateConfig({ difficulty: next });
        },
      },
      {
        id: 8,
        label: 'MUTATORS',
        value: isSandbox ? 'MANUAL [1-6] KEYS' : config.mutatorsEnabled ? '< ON (CHAOS) >' : '< OFF (CLASSIC) >',
        disabled: isSandbox,
        onClick: () => {
          if (isSandbox) return;
          callbacks.onUpdateConfig({ mutatorsEnabled: !config.mutatorsEnabled });
        },
      },
      {
        id: 9,
        label: 'DURATION',
        value: isSandbox ? 'UNLIMITED (FREE)' : `< ${config.durationSeconds} SEC >`,
        disabled: isSandbox,
        onClick: () => {
          if (isSandbox) return;
          const idx = DURATION_OPTIONS.indexOf(config.durationSeconds);
          const next = DURATION_OPTIONS[(idx + 1) % DURATION_OPTIONS.length];
          callbacks.onUpdateConfig({ durationSeconds: next });
        },
      },
    ];

    for (const row of rows) {
      const ry = panelY + row.id * rowH;
      const selected = this.menuRow === row.id;

      if (row.highlight) {
        ctx.fillStyle = selected ? kitA.primary : kitA.dark;
        ctx.fillRect(panelX, ry, panelW, 15);
        if (selected) {
          ctx.strokeStyle = PALETTE.gold;
          ctx.lineWidth = 1;
          ctx.strokeRect(panelX + 0.5, ry + 0.5, panelW - 1, 14);
        }
        const ctaText = isCup
          ? 'START DERBY CUP (ENTER)'
          : isSandbox
            ? 'START PRACTICE (ENTER)'
            : '>>> KICK OFF! (ENTER)';
        drawPixelText(ctx, ctaText, panelX + panelW * 0.5, ry + 4, PALETTE.pureWhite, 1, 'center');
        this.clickZones.push({
          x: panelX,
          y: ry,
          w: panelW,
          h: 15,
          action: () => {
            this.menuRow = row.id;
            row.onClick();
          },
        });
        continue;
      }

      ctx.fillStyle = selected ? PALETTE.slateMid : PALETTE.deepNavy;
      ctx.fillRect(panelX, ry, panelW, 15);
      if (selected) {
        ctx.strokeStyle = PALETTE.gold;
        ctx.lineWidth = 1;
        ctx.strokeRect(panelX + 0.5, ry + 0.5, panelW - 1, 14);
      }

      drawPixelText(
        ctx,
        row.label,
        panelX + 10,
        ry + 4,
        row.disabled ? PALETTE.slateLight : PALETTE.offWhite,
        1,
        'left'
      );
      if (row.swatch) {
        const sx = panelX + panelW - 20;
        const sy = ry + 2;
        ctx.fillStyle = PALETTE.inkBlack;
        ctx.fillRect(sx - 1, sy - 1, 12, 12);
        ctx.fillStyle = row.swatch.primary;
        ctx.fillRect(sx, sy, 10, 10);
        ctx.fillStyle = row.swatch.trim;
        ctx.fillRect(sx + 4, sy, 2, 10);
      }
      drawPixelText(
        ctx,
        row.value,
        panelX + panelW - (row.swatch ? 26 : 10),
        ry + 4,
        row.disabled ? PALETTE.slateLight : selected ? PALETTE.gold : PALETTE.turfLine,
        1,
        'right'
      );

      this.clickZones.push({
        x: panelX,
        y: ry,
        w: panelW,
        h: 15,
        action: () => {
          this.menuRow = row.id;
          row.onClick();
        },
      });
    }

    // Done / Back button at bottom of Customize modal
    const doneY = modalY + modalH - 28;
    this.drawGlossyButton(
      ctx,
      NATIVE_WIDTH * 0.5 - 94,
      doneY,
      188,
      19,
      'DONE / BACK TO HOME (ESC)',
      true,
      PALETTE.slateMid,
      PALETTE.iceCyan,
      PALETTE.deepNavy,
      callbacks.onCloseOverlay
    );
  }

  private renderOnboardingHints(
    ctx: CanvasRenderingContext2D,
    match: MatchState,
    onlineStatus?: OnlineStatusBadge
  ): void {
    if (onlineStatus?.localPaused || onlineStatus?.disconnectNotice || match.isPracticeSandbox()) {
      return;
    }

    const showGoalArrow = match.phase === 'KICKOFF';
    const showControlsHint = match.phase === 'KICKOFF' || (match.phase === 'PLAYING' && match.elapsedSeconds < 4.5);
    if (!showGoalArrow && !showControlsHint) return;

    const fadeAlpha =
      match.phase === 'PLAYING' && match.elapsedSeconds > 3.2
        ? Math.max(0, 1 - (match.elapsedSeconds - 3.2) / 1.3)
        : 1;

    ctx.save();
    ctx.globalAlpha = fadeAlpha;

    const localSlot = onlineStatus?.active ? onlineStatus.localHumanSlot : 1;
    const localPlayer = match.players.find((p) => p.humanSlot === localSlot);
    const localTeam = localPlayer?.team ?? 'A';

    // 1. Pulsing Attack Direction Cue at opponent goal during KICKOFF
    if (showGoalArrow) {
      const attackRight = localTeam === 'A';
      const targetX = attackRight ? match.bounds.right - 36 : match.bounds.left + 36;
      const pulseOffset = (Math.sin(this.clock * 6) * 2.5) * (attackRight ? 1 : -1);
      drawPixelText(
        ctx,
        attackRight ? 'SCORE ->' : '<- SCORE',
        targetX + pulseOffset,
        match.bounds.centerY - 4,
        PALETTE.gold,
        1,
        'center',
        PALETTE.inkBlack
      );
    }

    // 3. First-5-second Controls Pill near bottom of screen
    if (showControlsHint) {
      const text = this.isMobileLayout
        ? 'L-STICK: MOVE | HOLD KICK: POWER | DASH: TACKLE'
        : match.isTwoPlayerMode()
          ? 'P1: WASD+SPACE | P2: ARROWS+ENTER | NO FOULS!'
          : 'WASD/ARROWS: MOVE | HOLD SPACE: POWER SHOT | SHIFT: DASH';
      const barW = 378;
      const barX = NATIVE_WIDTH * 0.5 - barW * 0.5;
      const barY = NATIVE_HEIGHT - 19;
      ctx.fillStyle = 'rgba(11, 14, 20, 0.90)';
      ctx.fillRect(barX, barY, barW, 14);
      ctx.strokeStyle = PALETTE.iceCyan;
      ctx.lineWidth = 1;
      ctx.strokeRect(barX + 0.5, barY + 0.5, barW - 1, 13);
      drawPixelText(ctx, text, NATIVE_WIDTH * 0.5, barY + 4, PALETTE.pureWhite, 1, 'center');
    }

    ctx.restore();
  }

  private renderPauseOverlay(
    ctx: CanvasRenderingContext2D,
    match: MatchState,
    callbacks: UICallbacks,
    onlineStatus?: OnlineStatusBadge
  ): void {
    ctx.fillStyle = 'rgba(8, 12, 20, 0.80)';
    ctx.fillRect(0, 0, NATIVE_WIDTH, NATIVE_HEIGHT);

    const kitA = getTeamKit(match.config.teamAKit, 'A');
    const kitB = getTeamKit(match.config.teamBKit, 'B');
    const isOnline = Boolean(onlineStatus?.active);
    const sub = isOnline
      ? `${onlineStatus?.transport === 'cloudflare-ws' ? 'LIVE WSS' : 'LIVE P2P'} | ROOM ${onlineStatus?.roomCode ?? '----'}`
      : `${kitA.tag} ${match.scoreA} - ${match.scoreB} ${kitB.tag}  |  ${ARENA_PRESETS[match.config.arena].name}`;

    const bx = 128;
    const by = 28;
    const bw = 224;
    const bh = 212;
    this.drawModalShell(ctx, bx, by, bw, bh, PALETTE.gold, isOnline ? 'ONLINE MENU' : 'GAME PAUSED', sub);

    const padLabel = getDisplayModeLabel(match.config.displayMode ?? 'auto');
    const fsActive = isFullscreenActive(typeof document !== 'undefined' ? document : null);
    const items = [
      { id: 0, label: 'RESUME MATCH', primary: true, action: callbacks.onResume },
      {
        id: 1,
        label: isOnline ? 'KEEP PLAYING' : 'RESTART ROUND',
        primary: false,
        action: isOnline ? callbacks.onResume : callbacks.onRestartRound,
      },
      {
        id: 2,
        label: fsActive ? 'FULLSCREEN: ON [F]' : 'FULLSCREEN: OFF [F]',
        primary: false,
        action: callbacks.onToggleFullscreen,
      },
      { id: 3, label: `MOBILE PAD: ${padLabel}`, primary: false, action: callbacks.onCycleDisplayMode },
      { id: 4, label: 'HOW TO PLAY [H]', primary: false, action: callbacks.onOpenGuide },
      { id: 5, label: isOnline ? 'LEAVE ONLINE ROOM' : 'QUIT TO MENU', primary: false, action: callbacks.onQuitToMenu },
    ];

    for (const item of items) {
      const ry = by + 40 + item.id * 25;
      const sel = this.pauseRow === item.id;
      this.drawGlossyButton(
        ctx,
        bx + 18,
        ry,
        bw - 36,
        20,
        item.label,
        sel,
        item.primary ? kitA.primary : PALETTE.slateMid,
        item.primary ? kitA.light : PALETTE.slateLight,
        item.primary ? kitA.dark : PALETTE.deepNavy,
        () => {
          this.pauseRow = item.id;
          item.action();
        },
        item.primary
      );
    }

    drawPixelText(ctx, 'UP/DN: MOVE | ENT: OK | ESC: BACK', NATIVE_WIDTH * 0.5, by + bh - 14, PALETTE.slateLight, 1, 'center');
  }

  private renderFullTimeOverlay(
    ctx: CanvasRenderingContext2D,
    match: MatchState,
    callbacks: UICallbacks,
    onlineStatus?: OnlineStatusBadge
  ): void {
    ctx.fillStyle = 'rgba(8, 12, 20, 0.84)';
    ctx.fillRect(0, 0, NATIVE_WIDTH, NATIVE_HEIGHT);

    const kitA = getTeamKit(match.config.teamAKit, 'A');
    const kitB = getTeamKit(match.config.teamBKit, 'B');
    const winKit = match.winner === 'A' ? kitA : kitB;

    const isCup = match.cup.active;
    const cupRound = match.cup.getCurrentRound();
    const headerLabel = isCup ? `DERBY CUP - ${cupRound.title}` : 'FULL TIME RESULT';
    const shortA = kitA.name.split(' ')[0];
    const shortB = kitB.name.split(' ')[0];
    const winTitle =
      match.winner === 'A'
        ? isCup && match.cup.isFinalRound()
          ? 'CUP CHAMPIONS!'
          : match.isGoldenGoal
            ? `${shortA} GOLDEN GOAL!`
            : `${shortA} WINS!`
        : isCup
          ? 'KNOCKED OUT!'
          : match.isGoldenGoal
            ? `${shortB} GOLDEN GOAL!`
            : `${shortB} WINS!`;

    const bx = 86;
    const by = 22;
    const bw = 308;
    const bh = 226;
    this.drawModalShell(ctx, bx, by, bw, bh, winKit.light, winTitle, headerLabel);

    const cx = NATIVE_WIDTH * 0.5;
    // Large broadcast matchup score plate
    ctx.fillStyle = '#0b111c';
    ctx.fillRect(bx + 22, by + 39, bw - 44, 34);
    ctx.fillStyle = kitA.primary;
    ctx.fillRect(bx + 22, by + 39, 54, 34);
    ctx.fillStyle = kitB.primary;
    ctx.fillRect(bx + bw - 76, by + 39, 54, 34);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 22.5, by + 39.5, bw - 45, 33);

    drawArcadeText(ctx, kitA.tag, bx + 49, by + 56, PALETTE.pureWhite, 11, 'center', {
      weight: '900',
      shadowColor: PALETTE.inkBlack,
    });
    drawArcadeText(ctx, `${match.scoreA}  -  ${match.scoreB}`, cx, by + 57, PALETTE.gold, 21, 'center', {
      weight: '900',
      family: ARCADE_DISPLAY_FONT,
      strokeColor: PALETTE.inkBlack,
      strokeWidth: 2.5,
      shadowColor: 'rgba(0,0,0,0.8)',
    });
    drawArcadeText(ctx, kitB.tag, bx + bw - 49, by + 56, PALETTE.pureWhite, 11, 'center', {
      weight: '900',
      shadowColor: PALETTE.inkBlack,
    });

    // 4 Clean Stat Tiles (2x2 grid)
    const stats = [
      { k: 'SHOTS', v: `${kitA.tag} ${match.stats.teamAShots} - ${match.stats.teamBShots} ${kitB.tag}`, col: PALETTE.pureWhite },
      { k: 'WALL BOUNCES', v: `${match.stats.wallBounces}`, col: PALETTE.iceCyan },
      { k: 'TACKLES', v: `${match.stats.tackles}`, col: PALETTE.turfLine },
      { k: 'TOP SPEED', v: `${match.stats.topBallSpeed} PX/S`, col: PALETTE.gold },
    ];
    const tileW = (bw - 52) * 0.5;
    const tileH = 26;
    for (let i = 0; i < stats.length; i++) {
      const colIdx = i % 2;
      const rowIdx = Math.floor(i / 2);
      const tx = bx + 22 + colIdx * (tileW + 8);
      const ty = by + 81 + rowIdx * (tileH + 6);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.fillRect(tx, ty, tileW, tileH);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
      ctx.strokeRect(tx + 0.5, ty + 0.5, tileW - 1, tileH - 1);
      drawPixelText(ctx, stats[i].k, tx + tileW * 0.5, ty + 3, PALETTE.slateLight, 1, 'center');
      drawPixelText(ctx, stats[i].v, tx + tileW * 0.5, ty + 14, stats[i].col, 1, 'center');
    }

    const isOnline = Boolean(onlineStatus?.active);
    const primaryAction = isOnline
      ? {
          label:
            onlineStatus?.role === 'host'
              ? onlineStatus.peerWantsRematch
                ? 'OPPONENT READY! REMATCH!'
                : 'REMATCH! (ENTER)'
              : onlineStatus?.localWantsRematch
                ? 'WAITING FOR HOST...'
                : 'REQUEST REMATCH (ENTER)',
          action: callbacks.onRematch,
        }
      : isCup && match.winner === 'A'
        ? {
            label: match.cup.isFinalRound() ? 'CLAIM TROPHY! (ENTER)' : 'PICK PERK & NEXT ->',
            action: callbacks.onAdvanceCup,
          }
        : {
            label: isCup ? 'RETRY CUP (ENTER)' : 'REMATCH! (ENTER)',
            action: callbacks.onRematch,
          };

    const btns = [
      { id: 0, label: primaryAction.label, primary: true, action: primaryAction.action },
      { id: 1, label: isOnline ? 'LEAVE ONLINE ROOM' : 'MAIN MENU', primary: false, action: callbacks.onQuitToMenu },
    ];

    for (const btn of btns) {
      const ry = by + 150 + btn.id * 28;
      const sel = this.resultRow === btn.id;
      this.drawGlossyButton(
        ctx,
        bx + 36,
        ry,
        bw - 72,
        22,
        btn.label,
        sel,
        btn.primary ? kitA.primary : PALETTE.slateMid,
        btn.primary ? kitA.light : PALETTE.slateLight,
        btn.primary ? kitA.dark : PALETTE.deepNavy,
        () => {
          this.resultRow = btn.id;
          btn.action();
        },
        btn.primary
      );
    }

    drawPixelText(ctx, 'UP/DOWN: SELECT  |  ENTER: CONFIRM', cx, by + bh - 12, PALETTE.slateLight, 1, 'center');
  }

  private renderPerkSelectScreen(ctx: CanvasRenderingContext2D, match: MatchState, callbacks: UICallbacks): void {
    const bgGrad = ctx.createLinearGradient(0, 0, 0, NATIVE_HEIGHT);
    bgGrad.addColorStop(0, '#090e18');
    bgGrad.addColorStop(0.5, '#101a2e');
    bgGrad.addColorStop(1, '#080c14');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, NATIVE_WIDTH, NATIVE_HEIGHT);

    const nextRoundIdx = match.cup.currentRoundIndex + 1;
    const nextRoundTitle = nextRoundIdx === 1 ? 'SEMI FINAL: CONCRETE ALLEY' : 'GRAND FINAL: ROOFTOP NIGHT';

    drawArcadeText(ctx, 'VICTORY! CHOOSE A CUP PERK', NATIVE_WIDTH * 0.5, 24, PALETTE.gold, 17, 'center', {
      weight: '900',
      italic: true,
      family: ARCADE_DISPLAY_FONT,
      strokeColor: PALETTE.inkBlack,
      strokeWidth: 3,
      shadowColor: 'rgba(0,0,0,0.8)',
    });
    drawPixelText(ctx, `NEXT STAGE -> ${nextRoundTitle}`, NATIVE_WIDTH * 0.5, 38, PALETTE.iceCyan, 1, 'center');

    const choices = match.cup.perkChoices;
    const cardW = 136;
    const cardH = 122;
    const gap = 14;
    const startX = (NATIVE_WIDTH - (cardW * 3 + gap * 2)) * 0.5;
    const cardY = 60;

    for (let i = 0; i < choices.length; i++) {
      const perkType = choices[i];
      const def = PERK_CATALOG[perkType];
      const cx = startX + i * (cardW + gap);
      const sel = this.perkIndex === i;

      this.drawModalShell(ctx, cx, cardY, cardW, cardH, sel ? PALETTE.gold : PALETTE.slateMid);

      // Top accent stripe & badge index
      ctx.fillStyle = sel ? PALETTE.gold : PALETTE.slateDark;
      ctx.fillRect(cx + 1, cardY + 1, cardW - 2, 3);
      ctx.fillRect(cx + 8, cardY + 9, 17, 14);
      drawPixelText(ctx, `${i + 1}`, cx + 16.5, cardY + 12, sel ? PALETTE.inkBlack : PALETTE.pureWhite, 1, 'center');

      this.drawPerkIcon(ctx, perkType, cx + cardW * 0.5, cardY + 38);

      drawArcadeText(ctx, def.name, cx + cardW * 0.5, cardY + 67, PALETTE.pureWhite, 8.5, 'center', {
        weight: '900',
        shadowColor: PALETTE.inkBlack,
      });
      drawPixelText(ctx, def.shortDesc, cx + cardW * 0.5, cardY + 76, PALETTE.turfLine, 1, 'center');

      this.drawGlossyButton(
        ctx,
        cx + 14,
        cardY + 94,
        cardW - 28,
        19,
        sel ? 'EQUIP [ENT]' : 'SELECT',
        sel,
        PALETTE.teamAPrimary,
        PALETTE.teamALight,
        PALETTE.teamADark,
        () => {
          this.perkIndex = i;
          callbacks.onSelectPerk(i);
        },
        sel
      );

      this.clickZones.push({
        x: cx,
        y: cardY,
        w: cardW,
        h: cardH,
        action: () => {
          this.perkIndex = i;
          callbacks.onSelectPerk(i);
        },
      });
    }

    const ownedText =
      match.cup.earnedPerks.length > 0
        ? `ACTIVE PERKS: ${match.cup.earnedPerks.map((p) => PERK_CATALOG[p].name).join(', ')}`
        : 'PICK 1 PERMANENT UPGRADE FOR THE REMAINING CUP MATCHES';
    drawPixelText(ctx, ownedText, NATIVE_WIDTH * 0.5, 202, PALETTE.offWhite, 1, 'center');
    drawPixelText(
      ctx,
      'LEFT/RIGHT OR 1-3: CHOOSE  |  ENTER / SPACE / CLICK: EQUIP',
      NATIVE_WIDTH * 0.5,
      222,
      PALETTE.slateLight,
      1,
      'center'
    );
  }

  private renderCupChampionScreen(ctx: CanvasRenderingContext2D, match: MatchState, callbacks: UICallbacks): void {
    const bgGrad = ctx.createLinearGradient(0, 0, 0, NATIVE_HEIGHT);
    bgGrad.addColorStop(0, '#0a0f1c');
    bgGrad.addColorStop(0.45, '#192238');
    bgGrad.addColorStop(1, '#070b12');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, NATIVE_WIDTH, NATIVE_HEIGHT);

    const tx = NATIVE_WIDTH * 0.5;
    // Celebratory radial glow behind trophy
    const glow = ctx.createRadialGradient(tx, 96, 6, tx, 96, 86);
    glow.addColorStop(0, 'rgba(255, 210, 63, 0.28)');
    glow.addColorStop(1, 'rgba(255, 210, 63, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(tx, 96, 86, 0, Math.PI * 2);
    ctx.fill();

    drawArcadeText(ctx, 'DERBY CUP CHAMPIONS!', tx, 22, PALETTE.gold, 21, 'center', {
      weight: '900',
      italic: true,
      family: ARCADE_DISPLAY_FONT,
      strokeColor: PALETTE.inkBlack,
      strokeWidth: 3.2,
      shadowColor: 'rgba(0,0,0,0.85)',
    });
    drawPixelText(ctx, '3 ROUNDS CONQUERED - STREET TO SKYLINE!', tx, 38, PALETTE.iceCyan, 1, 'center');

    // Shaded Golden Trophy
    const ty = 64;
    ctx.fillStyle = PALETTE.gold;
    ctx.fillRect(tx - 16, ty, 32, 18);
    ctx.fillRect(tx - 12, ty + 18, 24, 6);
    ctx.fillRect(tx - 4, ty + 24, 8, 12);
    ctx.fillRect(tx - 12, ty + 36, 24, 6);
    ctx.fillRect(tx - 22, ty + 3, 6, 10);
    ctx.fillRect(tx + 16, ty + 3, 6, 10);
    ctx.fillStyle = PALETTE.amber;
    ctx.fillRect(tx - 12, ty + 3, 4, 12);
    ctx.fillStyle = PALETTE.pureWhite;
    ctx.fillRect(tx + 6, ty + 3, 4, 10);

    // Twinkling stars beside trophy
    const blink = 0.5 + 0.5 * Math.sin(this.clock * 6);
    ctx.save();
    ctx.globalAlpha = blink;
    ctx.fillStyle = PALETTE.gold;
    ctx.fillRect(tx - 42, ty + 10, 4, 4);
    ctx.fillRect(tx + 38, ty + 10, 4, 4);
    ctx.fillRect(tx - 54, ty + 28, 3, 3);
    ctx.fillRect(tx + 51, ty + 28, 3, 3);
    ctx.restore();

    ctx.fillStyle = 'rgba(11, 16, 28, 0.85)';
    ctx.fillRect(tx - 145, 118, 290, 38);
    ctx.strokeStyle = 'rgba(255, 210, 63, 0.35)';
    ctx.strokeRect(tx - 144.5, 118.5, 289, 37);

    drawPixelText(
      ctx,
      `TOURNAMENT GOALS: ${match.cup.totalGoalsScored} FOR  -  ${match.cup.totalGoalsConceded} AGAINST`,
      tx,
      124,
      PALETTE.pureWhite,
      1,
      'center'
    );
    const perksStr =
      match.cup.earnedPerks.length > 0
        ? `PERKS: ${match.cup.earnedPerks.map((p) => PERK_CATALOG[p].name).join(' + ')}`
        : 'PURE SKILL RUN';
    drawPixelText(ctx, perksStr, tx, 140, PALETTE.turfLine, 1, 'center');

    const kitA = getTeamKit(match.config.teamAKit, 'A');
    const btns = [
      { id: 0, label: 'PLAY NEW DERBY CUP! (ENTER)', primary: true, action: callbacks.onRematch },
      { id: 1, label: 'MAIN MENU', primary: false, action: callbacks.onQuitToMenu },
    ];
    for (const btn of btns) {
      const ry = 174 + btn.id * 28;
      const sel = this.championRow === btn.id;
      this.drawGlossyButton(
        ctx,
        tx - 108,
        ry,
        216,
        22,
        btn.label,
        sel,
        btn.primary ? kitA.primary : PALETTE.slateMid,
        btn.primary ? kitA.light : PALETTE.slateLight,
        btn.primary ? kitA.dark : PALETTE.deepNavy,
        () => {
          this.championRow = btn.id;
          btn.action();
        },
        btn.primary
      );
    }
  }

  private renderRecordsOverlay(
    ctx: CanvasRenderingContext2D,
    records: CareerRecordsData,
    callbacks: UICallbacks
  ): void {
    ctx.fillStyle = 'rgba(8, 12, 20, 0.90)';
    ctx.fillRect(0, 0, NATIVE_WIDTH, NATIVE_HEIGHT);

    this.drawModalShell(ctx, 18, 12, NATIVE_WIDTH - 36, NATIVE_HEIGHT - 24, PALETTE.gold, 'CAREER RECORDS');

    const drawStatRow = (x: number, y: number, w: number, label: string, val: string, valColor: string, alt: boolean) => {
      if (alt) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
        ctx.fillRect(x + 4, y - 3, w - 8, 14);
      }
      drawPixelText(ctx, label, x + 10, y, PALETTE.offWhite, 1, 'left');
      drawPixelText(ctx, val, x + w - 10, y, valColor, 1, 'right');
    };

    const cardY = 46;
    const cardW = 204;
    const cardH = 148;
    const leftX = 30;
    const rightX = NATIVE_WIDTH - 30 - cardW;

    for (const cx of [leftX, rightX]) {
      ctx.fillStyle = 'rgba(13, 20, 34, 0.92)';
      ctx.fillRect(cx, cardY, cardW, cardH);
      ctx.strokeStyle = PALETTE.slateMid;
      ctx.lineWidth = 1;
      ctx.strokeRect(cx + 0.5, cardY + 0.5, cardW - 1, cardH - 1);
    }

    drawPixelText(ctx, 'TEAM A / P1 STATS', leftX + cardW * 0.5, cardY + 9, PALETTE.iceCyan, 1, 'center');
    drawStatRow(leftX, cardY + 28, cardW, 'MATCHES', `${records.matchesPlayed}`, PALETTE.pureWhite, true);
    drawStatRow(leftX, cardY + 46, cardW, 'WINS / LOSSES', `${records.wins}W - ${records.losses}L`, PALETTE.turfLine, false);
    drawStatRow(leftX, cardY + 64, cardW, 'WIN STREAK', `${records.currentWinStreak} (BEST ${records.bestWinStreak})`, PALETTE.gold, true);
    drawStatRow(leftX, cardY + 82, cardW, 'TOTAL GOALS', `${records.goalsScored}`, PALETTE.pureWhite, false);
    drawStatRow(leftX, cardY + 100, cardW, 'BEST 1 MATCH', `${records.mostGoalsInMatch} GOALS`, PALETTE.amber, true);
    drawStatRow(leftX, cardY + 118, cardW, 'CUP TROPHIES', `${records.cupTrophies}`, PALETTE.gold, false);

    drawPixelText(ctx, 'HIGHLIGHTS & SPEED', rightX + cardW * 0.5, cardY + 9, PALETTE.iceCyan, 1, 'center');
    drawStatRow(rightX, cardY + 28, cardW, 'BANK SHOTS', `${records.bankShots}`, PALETTE.gold, true);
    drawStatRow(rightX, cardY + 46, cardW, 'ONE-TIMER GOALS', `${records.oneTimerGoals}`, PALETTE.iceCyan, false);
    drawStatRow(rightX, cardY + 64, cardW, 'SAVES / BLOCKS', `${records.saves}`, PALETTE.turfLine, true);
    drawStatRow(rightX, cardY + 82, cardW, 'TACKLE STEALS', `${records.steals}`, PALETTE.amber, false);
    drawStatRow(rightX, cardY + 100, cardW, 'TOP BALL SPEED', `${records.topBallSpeed} PX/S`, PALETTE.gold, true);
    drawPixelText(
      ctx,
      'PRACTICE SANDBOX NOT COUNTED',
      rightX + cardW * 0.5,
      cardY + 126,
      PALETTE.slateLight,
      1,
      'center'
    );

    const btns = [
      { id: 0, x: 74, label: 'BACK (ESC)', danger: false, action: callbacks.onCloseOverlay },
      {
        id: 1,
        x: 246,
        label: this.resetArmed ? 'CONFIRM RESET!' : 'RESET RECORDS',
        danger: this.resetArmed,
        action: callbacks.onResetRecords,
      },
    ];
    for (const b of btns) {
      const sel = this.recordsRow === b.id;
      this.drawGlossyButton(
        ctx,
        b.x,
        208,
        160,
        22,
        b.label,
        sel,
        b.danger ? PALETTE.dangerRed : PALETTE.slateMid,
        b.danger ? '#ff7b8e' : PALETTE.slateLight,
        b.danger ? '#6e1622' : PALETTE.deepNavy,
        () => {
          this.recordsRow = b.id;
          b.action();
        },
        b.danger
      );
    }

    drawPixelText(
      ctx,
      'LEFT/RIGHT: SELECT  |  ENTER: CONFIRM  |  ESC: BACK TO MENU',
      NATIVE_WIDTH * 0.5,
      240,
      PALETTE.slateLight,
      1,
      'center'
    );
  }

  private renderGuideOverlay(ctx: CanvasRenderingContext2D, callbacks: UICallbacks): void {
    ctx.fillStyle = 'rgba(8, 12, 20, 0.90)';
    ctx.fillRect(0, 0, NATIVE_WIDTH, NATIVE_HEIGHT);

    this.drawModalShell(ctx, 14, 10, NATIVE_WIDTH - 28, NATIVE_HEIGHT - 20, PALETTE.iceCyan, 'HOW TO PLAY');

    const tabs = ['1. RULES & MODES', '2. CONTROLS & SKILLS', '3. ARENAS & SANDBOX'];
    const tabW = 140;
    const tabStartX = (NATIVE_WIDTH - (tabW * 3 + 12)) * 0.5;
    for (let i = 0; i < tabs.length; i++) {
      const tx = tabStartX + i * (tabW + 6);
      const active = this.guidePage === i;
      this.drawGlossyButton(
        ctx,
        tx,
        42,
        tabW,
        17,
        tabs[i],
        active,
        PALETTE.teamAPrimary,
        PALETTE.teamALight,
        PALETTE.teamADark,
        () => callbacks.onChangeGuidePage(i),
        active
      );
    }

    ctx.fillStyle = 'rgba(13, 20, 34, 0.92)';
    ctx.fillRect(24, 64, NATIVE_WIDTH - 48, 154);
    ctx.strokeStyle = PALETTE.slateMid;
    ctx.lineWidth = 1;
    ctx.strokeRect(24.5, 64.5, NATIVE_WIDTH - 49, 153);

    const pages: Array<Array<{ text: string; color: string }>> = [
      [
        { text: 'NO-OUT RULES: NO FOULS, NO THROW-INS, NO OUT OF BOUNDS!', color: PALETTE.gold },
        { text: '- ALL 45-DEG CORNERS & WALLS BOUNCE BALL BACK INTO PLAY.', color: PALETTE.offWhite },
        { text: '- TIED AT 00:00? TRIGGERS GOLDEN GOAL: NEXT GOAL WINS!', color: PALETTE.iceCyan },
        { text: '- 1V1: 1 OUTFIELD + 1 GK.  2V2: 2 OUTFIELD (NO GK).', color: PALETTE.offWhite },
        { text: '- 3V3: 2 OUTFIELD + 1 AI GK.  4V4 (XL): 3 OUTFIELD + 1 GK!', color: PALETTE.offWhite },
        { text: '- PLAYER FOCUS: STAYS ON 1 PLAYER (MANUAL [Q] TO SWITCH).', color: PALETTE.iceCyan },
        { text: '- DERBY CUP: BEAT 3 ROUNDS & PICK PERKS BETWEEN STAGES.', color: PALETTE.turfLine },
        { text: '- REPLAY: SPECTACULAR GOALS AUTO-REPLAY (SPACE TO SKIP).', color: PALETTE.slateLight },
      ],
      [
        { text: 'CONTROL STYLES & IN-PITCH ACTIONS:', color: PALETTE.gold },
        { text: '- DRIBBLE + TACKLE: CARRY BALL (AIM -> GOLD WHEN ON GOAL!).', color: PALETTE.iceCyan },
        { text: '- SMART PASS [E] / PAD X: LOCK ON OPEN TEAMMATE + GIVE&GO!', color: PALETTE.iceCyan },
        { text: '- SKILL FEINT: PRESS DASH WHILE CARRYING TO DODGE TACKLES!', color: PALETTE.gold },
        { text: '- FEVER BLITZ [C] / RB: 100% GAUGE -> SUPER SPEED & STRIKE!', color: PALETTE.amber },
        { text: '- TACTICS [TAB/1-3] / LB: BALANCED / ATTACK+ / DEFEND+ (2V2+).', color: PALETTE.turfLine },
        { text: '- POWER & CURVE: HOLD KICK (SPACE/J), STEER SIDEWAYS TO BEND!', color: PALETTE.offWhite },
        { text: '- EXT PAD: L-STICK 360, A/RT KICK, B/LT FEINT, X PASS, Y SW.', color: '#7dffba' },
        { text: '- MOBILE TOUCH: STICK + KICK/FEINT/PASS/FEVER + TAC PILL.', color: PALETTE.iceCyan },
      ],
      [
        { text: '3 ARENAS, 3 PITCH SIZES & 6 CHAOS MUTATORS:', color: PALETTE.gold },
        { text: '- CLASSIC: BALANCED. CONCRETE: FAST WALLS. ROOFTOP: WIND!', color: PALETTE.offWhite },
        { text: '- PITCH SIZE: STANDARD / LARGE (1.8X) / STADIUM XL (2.7X)!', color: PALETTE.turfLine },
        { text: '- FULLSCREEN [F]: FULLSCREEN + AUTO WIDE ON MOBILE BROWSERS!', color: PALETTE.iceCyan },
        { text: '- MUTATORS: GIANT BALL, ICE PITCH, PINBALL 114%, HOT POTATO,', color: PALETTE.iceCyan },
        { text: '  WIDE GOALS (1.6X), DOUBLE TROUBLE (2 BALLS AT ONCE).', color: PALETTE.iceCyan },
        { text: 'SANDBOX: [1-6] MUTATORS [0] CLEAR [F] FEED [B] BALL [T] AI', color: PALETTE.offWhite },
      ],
    ];

    const lines = pages[this.guidePage] ?? pages[0];
    const lineStep = lines.length >= 9 ? 16 : 18;
    for (let i = 0; i < lines.length; i++) {
      drawPixelText(ctx, lines[i].text, 34, 70 + i * lineStep, lines[i].color, 1, 'left');
    }

    this.drawGlossyButton(
      ctx,
      NATIVE_WIDTH * 0.5 - 78,
      224,
      156,
      20,
      'BACK / CLOSE (ESC)',
      true,
      PALETTE.slateMid,
      PALETTE.iceCyan,
      PALETTE.deepNavy,
      callbacks.onCloseOverlay
    );

    drawPixelText(
      ctx,
      'LEFT / RIGHT: SWITCH TAB  |  ESC OR ENTER: CLOSE',
      NATIVE_WIDTH * 0.5,
      248,
      PALETTE.slateLight,
      1,
      'center'
    );
  }
}
