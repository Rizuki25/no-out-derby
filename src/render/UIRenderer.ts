import {
  AIDifficulty,
  ArenaId,
  GameMode,
  MatchConfig,
  MatchDurationOption,
  NATIVE_HEIGHT,
  NATIVE_WIDTH,
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
import { MatchState } from '../game/MatchState.ts';
import { isFullscreenActive } from '../game/Fullscreen.ts';
import { getDisplayModeLabel } from '../game/MobileLayout.ts';
import { PALETTE } from './Palette.ts';
import { drawPixelText } from './PixelFont.ts';
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
  { value: 'derby_cup_1v1', label: 'DERBY CUP 1V1' },
  { value: 'derby_cup_2v2', label: 'DERBY CUP 2V2' },
  { value: 'derby_cup_3v3', label: 'DERBY CUP 3V3' },
  { value: '1v1_local', label: '2P 1V1 VERSUS' },
  { value: '2v2_local', label: '2P 2V2 VERSUS' },
  { value: '3v3_local', label: '2P 3V3 VERSUS' },
  { value: '2v2_coop', label: '2P 2V2 CO-OP' },
  { value: '3v3_coop', label: '2P 3V3 CO-OP' },
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
}

export class UIRenderer {
  public menuRow = 0; // 0..9
  public pauseRow = 0; // 0..5
  public resultRow = 0; // 0..1
  public perkIndex = 0; // 0..2
  public championRow = 0; // 0..1
  public menuOverlay: 'none' | 'guide' | 'records' = 'none';
  public guidePage = 0; // 0..2
  public recordsRow = 0; // 0..1
  public resetArmed = false;
  public pauseGuideOpen = false;

  private mutatorBannerTimer = 0;
  private mutatorBannerLabel = '';
  private mutatorBannerSub = '';
  private clock = 0;

  private clickZones: ClickRect[] = [];

  triggerMutatorBanner(label: string, subtitle: string): void {
    this.mutatorBannerLabel = label;
    this.mutatorBannerSub = subtitle;
    this.mutatorBannerTimer = 2.8;
  }

  update(rawDt: number): void {
    this.clock += rawDt;
    if (this.mutatorBannerTimer > 0) {
      this.mutatorBannerTimer = Math.max(0, this.mutatorBannerTimer - rawDt);
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
    callbacks: UICallbacks
  ): void {
    this.clickZones = [];

    if (match.phase === 'MENU') {
      if (this.menuOverlay === 'guide') {
        this.renderGuideOverlay(ctx, callbacks);
      } else if (this.menuOverlay === 'records') {
        this.renderRecordsOverlay(ctx, records, callbacks);
      } else {
        this.renderMainMenu(ctx, menuConfig, muted, callbacks);
      }
      return;
    }

    if (match.phase === 'PERK_SELECT') {
      this.renderPerkSelectScreen(ctx, match, callbacks);
      return;
    }

    if (match.phase === 'CUP_CHAMPION') {
      this.renderCupChampionScreen(ctx, match, callbacks);
      return;
    }

    if (match.phase === 'REPLAY') {
      this.renderReplayOverlay(ctx, match, callbacks);
      return;
    }

    // In-game Top HUD
    this.renderHud(ctx, match, muted, callbacks);

    // Phase overlays
    if (match.phase === 'KICKOFF') {
      const count = Math.max(1, Math.ceil(match.phaseTimer * 3));
      const sub = match.cup.active
        ? `R${match.cup.getCurrentRound().roundNumber}: ${match.cup.getCurrentRound().title}`
        : match.isPracticeSandbox()
          ? 'PRACTICE / CHAOS SANDBOX'
          : undefined;
      this.renderCenterBanner(ctx, count > 1 ? `${count}` : 'KICK-OFF!', PALETTE.gold, sub);
    } else if (match.phase === 'GOAL_CELEBRATION') {
      const scoreKit = getTeamKit(
        match.lastScoringTeam === 'A' ? match.config.teamAKit : match.config.teamBKit,
        match.lastScoringTeam ?? 'A'
      );
      const shortName = scoreKit.name.split(' ')[0];
      const teamName = `${shortName} GOAL!`;
      this.renderCenterBanner(ctx, match.isGoldenGoal ? 'GOLDEN GOAL!' : teamName, scoreKit.light);
    } else if (match.phase === 'GOLDEN_GOAL_INTRO') {
      this.renderCenterBanner(ctx, 'GOLDEN GOAL!', PALETTE.gold, 'NEXT SCORE WINS!');
    } else if (match.phase === 'PAUSED') {
      if (this.pauseGuideOpen) {
        this.renderGuideOverlay(ctx, callbacks);
      } else {
        this.renderPauseOverlay(ctx, match, callbacks);
      }
    } else if (match.phase === 'FULL_TIME') {
      this.renderFullTimeOverlay(ctx, match, callbacks);
    }

    // Mutator top slide-in banner
    if (this.mutatorBannerTimer > 0 && match.phase === 'PLAYING') {
      this.renderMutatorBanner(ctx);
    }
  }

  private renderHud(
    ctx: CanvasRenderingContext2D,
    match: MatchState,
    muted: boolean,
    callbacks: UICallbacks
  ): void {
    ctx.fillStyle = PALETTE.inkBlack;
    ctx.fillRect(0, 0, NATIVE_WIDTH, 17);
    ctx.fillStyle = PALETTE.slateDark;
    ctx.fillRect(0, 16, NATIVE_WIDTH, 1);

    const cx = NATIVE_WIDTH * 0.5;
    const kitA = getTeamKit(match.config.teamAKit, 'A');
    const kitB = getTeamKit(match.config.teamBKit, 'B');
    ctx.fillStyle = PALETTE.deepNavy;
    ctx.fillRect(cx - 88, 1, 176, 14);
    ctx.fillStyle = kitA.primary;
    ctx.fillRect(cx - 88, 1, 32, 14);
    ctx.fillStyle = kitB.primary;
    ctx.fillRect(cx + 56, 1, 32, 14);

    drawPixelText(ctx, kitA.tag, cx - 72, 5, PALETTE.pureWhite, 1, 'center');
    drawPixelText(ctx, `${match.scoreA}`, cx - 44, 5, PALETTE.pureWhite, 1, 'center');

    if (match.isPracticeSandbox()) {
      drawPixelText(ctx, 'SANDBOX', cx, 5, PALETTE.iceCyan, 1, 'center');
    } else if (match.isGoldenGoal) {
      const pulse = Math.floor(this.clock * 6) % 2 === 0;
      drawPixelText(ctx, 'GOLDEN!', cx, 5, pulse ? PALETTE.gold : PALETTE.dangerRed, 1, 'center');
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
        : PALETTE.offWhite;
      drawPixelText(ctx, timerStr, cx, 5, timerColor, 1, 'center');
    }

    drawPixelText(ctx, `${match.scoreB}`, cx + 44, 5, PALETTE.pureWhite, 1, 'center');
    drawPixelText(ctx, kitB.tag, cx + 72, 5, PALETTE.pureWhite, 1, 'center');

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

    // Bottom subtle gameplay strip
    if (match.isPracticeSandbox()) {
      const defState = match.sandboxDefenderEnabled ? 'ON' : 'OFF';
      drawPixelText(
        ctx,
        `1-6:MUTATE  0:OFF  F:VOLLEY PASS  B:RESET BALL  T:DEFENDER(${defState})`,
        cx,
        257,
        PALETTE.iceCyan,
        1,
        'center'
      );
    } else if (match.isTwoPlayerMode()) {
      drawPixelText(
        ctx,
        'P1:WASD + SPACE/SHIFT   /   P2:ARROWS + ENTER/RCTRL',
        cx,
        257,
        PALETTE.slateLight,
        1,
        'center'
      );
    } else {
      const switchHint = match.hasTwoOutfieldPerTeam() ? '   [Q] SWITCH' : '';
      drawPixelText(
        ctx,
        `MOVE:WASD/ARROWS   KICK/HOLD:SPACE   DASH:SHIFT${switchHint}`,
        cx,
        257,
        PALETTE.slateLight,
        1,
        'center'
      );
    }
  }

  private renderReplayOverlay(ctx: CanvasRenderingContext2D, match: MatchState, callbacks: UICallbacks): void {
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

    // Skip hint top-right
    drawPixelText(ctx, '[SPACE] SKIP >>', NATIVE_WIDTH - 8, 5, PALETTE.gold, 1, 'right');

    // Bottom progress bar
    const prog = match.replay.getPlaybackProgress();
    ctx.fillStyle = PALETTE.slateDark;
    ctx.fillRect(24, NATIVE_HEIGHT - 10, NATIVE_WIDTH - 48, 4);
    ctx.fillStyle = PALETTE.gold;
    ctx.fillRect(24, NATIVE_HEIGHT - 10, Math.round((NATIVE_WIDTH - 48) * prog), 4);

    // Clicking anywhere skips replay
    this.clickZones.push({
      x: 0,
      y: 0,
      w: NATIVE_WIDTH,
      h: NATIVE_HEIGHT,
      action: callbacks.onSkipReplay,
    });
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
    ctx.fillStyle = 'rgba(11, 14, 20, 0.72)';
    ctx.fillRect(cx - 115, cy - 22, 230, subtitle ? 44 : 30);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - 115, cy - 22, 230, subtitle ? 44 : 30);

    drawPixelText(ctx, title, cx, cy - 13, color, 2, 'center', PALETTE.inkBlack);
    if (subtitle) {
      drawPixelText(ctx, subtitle, cx, cy + 7, PALETTE.pureWhite, 1, 'center');
    }
  }

  private renderMainMenu(
    ctx: CanvasRenderingContext2D,
    config: MatchConfig,
    muted: boolean,
    callbacks: UICallbacks
  ): void {
    ctx.fillStyle = PALETTE.inkBlack;
    ctx.fillRect(0, 0, NATIVE_WIDTH, NATIVE_HEIGHT);

    // Header banner (compact so 9 options + controls strip breathe cleanly)
    ctx.fillStyle = PALETTE.turfDark;
    ctx.fillRect(0, 0, NATIVE_WIDTH, 42);
    ctx.fillStyle = PALETTE.turfLight;
    for (let x = 0; x < NATIVE_WIDTH; x += 32) {
      ctx.fillRect(x, 0, 16, 42);
    }
    ctx.fillStyle = 'rgba(11, 14, 20, 0.55)';
    ctx.fillRect(0, 0, NATIVE_WIDTH, 38);
    ctx.fillStyle = PALETTE.gold;
    ctx.fillRect(0, 36, NATIVE_WIDTH, 2);

    drawPixelText(ctx, 'NO-OUT DERBY', NATIVE_WIDTH * 0.5, 5, PALETTE.gold, 2, 'center', PALETTE.inkBlack);
    drawPixelText(
      ctx,
      'FUTSAL PANTUL - NO FOULS. NO OUTS. PURE CHAOS.',
      NATIVE_WIDTH * 0.5,
      23,
      PALETTE.pureWhite,
      1,
      'center',
      PALETTE.inkBlack
    );

    // Left Header Pills: [H] GUIDE & [R] RECORDS
    ctx.fillStyle = PALETTE.deepNavy;
    ctx.fillRect(6, 4, 62, 13);
    ctx.strokeStyle = PALETTE.iceCyan;
    ctx.lineWidth = 1;
    ctx.strokeRect(6.5, 4.5, 61, 12);
    drawPixelText(ctx, '[H] GUIDE', 37, 7, PALETTE.iceCyan, 1, 'center');
    this.clickZones.push({
      x: 6,
      y: 4,
      w: 62,
      h: 13,
      action: callbacks.onOpenGuide,
    });

    ctx.fillStyle = PALETTE.deepNavy;
    ctx.fillRect(72, 4, 74, 13);
    ctx.strokeStyle = PALETTE.gold;
    ctx.strokeRect(72.5, 4.5, 73, 12);
    drawPixelText(ctx, '[R] RECORDS', 109, 7, PALETTE.gold, 1, 'center');
    this.clickZones.push({
      x: 72,
      y: 4,
      w: 74,
      h: 13,
      action: callbacks.onOpenRecords,
    });

    drawPixelText(
      ctx,
      muted ? '[M] SOUND:OFF' : '[M] SOUND:ON',
      NATIVE_WIDTH - 10,
      7,
      muted ? PALETTE.dangerRed : PALETTE.iceCyan,
      1,
      'right'
    );
    this.clickZones.push({
      x: NATIVE_WIDTH - 96,
      y: 3,
      w: 92,
      h: 16,
      action: callbacks.onToggleMute,
    });

    // Mobile / Desktop View Pill under left pills (clickable & [V] hotkey)
    const viewLabel = `[V] PAD:${getDisplayModeLabel(config.displayMode ?? 'auto')}`;
    const viewActive = config.displayMode === 'mobile';
    ctx.fillStyle = viewActive ? PALETTE.teamAPrimary : PALETTE.deepNavy;
    ctx.fillRect(6, 20, 90, 13);
    ctx.strokeStyle = viewActive ? PALETTE.gold : PALETTE.turfLine;
    ctx.lineWidth = 1;
    ctx.strokeRect(6.5, 20.5, 89, 12);
    drawPixelText(
      ctx,
      viewLabel,
      51,
      23,
      viewActive ? PALETTE.pureWhite : PALETTE.turfLine,
      1,
      'center'
    );
    this.clickZones.push({
      x: 6,
      y: 20,
      w: 90,
      h: 13,
      action: callbacks.onCycleDisplayMode,
    });

    // Fullscreen toggle Pill under Mute (clickable & [F] hotkey)
    const fsActive = isFullscreenActive(typeof document !== 'undefined' ? document : null);
    const fsLabel = fsActive ? '[F] EXIT FULL' : '[F] FULLSCREEN';
    ctx.fillStyle = fsActive ? '#163d2d' : PALETTE.deepNavy;
    ctx.fillRect(NATIVE_WIDTH - 96, 20, 90, 13);
    ctx.strokeStyle = fsActive ? '#39d98a' : PALETTE.iceCyan;
    ctx.lineWidth = 1;
    ctx.strokeRect(NATIVE_WIDTH - 95.5, 20.5, 89, 12);
    drawPixelText(
      ctx,
      fsLabel,
      NATIVE_WIDTH - 51,
      23,
      fsActive ? '#7dffba' : PALETTE.iceCyan,
      1,
      'center'
    );
    this.clickZones.push({
      x: NATIVE_WIDTH - 96,
      y: 20,
      w: 90,
      h: 13,
      action: callbacks.onToggleFullscreen,
    });

    const panelX = 76;
    const panelW = 328;
    const panelY = 41;
    const rowH = 17;

    const isCup =
      config.mode === 'derby_cup_1v1' ||
      config.mode === 'derby_cup_2v2' ||
      config.mode === 'derby_cup_3v3';
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
        value: `< ${pitchSizeLabel} >`,
        onClick: () => {
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

      ctx.fillStyle = row.highlight
        ? selected
          ? kitA.primary
          : kitA.dark
        : selected
          ? PALETTE.slateMid
          : PALETTE.deepNavy;
      ctx.fillRect(panelX, ry, panelW, 15);

      if (selected) {
        ctx.strokeStyle = PALETTE.gold;
        ctx.lineWidth = 1;
        ctx.strokeRect(panelX + 0.5, ry + 0.5, panelW - 1, 14);
      }

      if (row.highlight) {
        const ctaText = isCup
          ? '>>> START DERBY CUP! (ENTER) <<<'
          : isSandbox
            ? '>>> START PRACTICE! (ENTER) <<<'
            : '>>> KICK OFF! (ENTER) <<<';
        drawPixelText(ctx, ctaText, NATIVE_WIDTH * 0.5, ry + 4, PALETTE.pureWhite, 1, 'center');
      } else {
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
      }

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

    // Bottom Controls Strip
    ctx.fillStyle = PALETTE.deepNavy;
    ctx.fillRect(24, 213, NATIVE_WIDTH - 48, 52);
    ctx.strokeStyle = PALETTE.slateMid;
    ctx.lineWidth = 1;
    ctx.strokeRect(24.5, 213.5, NATIVE_WIDTH - 49, 51);

    drawPixelText(ctx, 'CONTROLS (KEYBOARD / GAMEPAD READY)', NATIVE_WIDTH * 0.5, 217, PALETTE.gold, 1, 'center');
    drawPixelText(
      ctx,
      'P1: WASD  /  SPACE OR J: KICK  /  SHIFT OR K: TACKLE  /  Q: SWITCH',
      NATIVE_WIDTH * 0.5,
      228,
      PALETTE.offWhite,
      1,
      'center'
    );
    drawPixelText(
      ctx,
      'P2: ARROWS / ENTER OR NUM1: KICK / RCTRL OR NUM2: TACKLE / NUM0: SW',
      NATIVE_WIDTH * 0.5,
      239,
      PALETTE.iceCyan,
      1,
      'center'
    );
    drawPixelText(
      ctx,
      'UP/DOWN:MENU   LEFT/RIGHT:SET   H:HOW TO PLAY   R:CAREER RECORDS',
      NATIVE_WIDTH * 0.5,
      250,
      PALETTE.slateLight,
      1,
      'center'
    );
  }

  private renderPauseOverlay(
    ctx: CanvasRenderingContext2D,
    match: MatchState,
    callbacks: UICallbacks
  ): void {
    ctx.fillStyle = 'rgba(11, 14, 20, 0.76)';
    ctx.fillRect(0, 0, NATIVE_WIDTH, NATIVE_HEIGHT);

    const bx = 136;
    const by = 38;
    const bw = 208;
    const bh = 192;
    ctx.fillStyle = PALETTE.deepNavy;
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = PALETTE.gold;
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, bw, bh);

    drawPixelText(ctx, 'PAUSED', NATIVE_WIDTH * 0.5, by + 13, PALETTE.gold, 2, 'center');

    const padLabel = getDisplayModeLabel(match.config.displayMode ?? 'auto');
    const fsActive = isFullscreenActive(typeof document !== 'undefined' ? document : null);
    const items = [
      { id: 0, label: 'RESUME MATCH', action: callbacks.onResume },
      { id: 1, label: 'RESTART MATCH', action: callbacks.onRematch },
      {
        id: 2,
        label: fsActive ? 'FULLSCREEN: ON [F]' : 'FULLSCREEN: OFF [F]',
        action: callbacks.onToggleFullscreen,
      },
      { id: 3, label: `MOBILE PAD: ${padLabel}`, action: callbacks.onCycleDisplayMode },
      { id: 4, label: 'HOW TO PLAY [H]', action: callbacks.onOpenGuide },
      { id: 5, label: 'MAIN MENU', action: callbacks.onQuitToMenu },
    ];

    for (const item of items) {
      const ry = by + 38 + item.id * 23;
      const sel = this.pauseRow === item.id;
      ctx.fillStyle = sel ? PALETTE.teamAPrimary : PALETTE.slateDark;
      ctx.fillRect(bx + 18, ry, bw - 36, 18);
      if (sel) {
        ctx.strokeStyle = PALETTE.gold;
        ctx.lineWidth = 1;
        ctx.strokeRect(bx + 18.5, ry + 0.5, bw - 37, 17);
      }
      drawPixelText(ctx, item.label, NATIVE_WIDTH * 0.5, ry + 6, PALETTE.pureWhite, 1, 'center');
      this.clickZones.push({
        x: bx + 18,
        y: ry,
        w: bw - 36,
        h: 18,
        action: () => {
          this.pauseRow = item.id;
          item.action();
        },
      });
    }
  }

  private renderFullTimeOverlay(ctx: CanvasRenderingContext2D, match: MatchState, callbacks: UICallbacks): void {
    ctx.fillStyle = 'rgba(11, 14, 20, 0.80)';
    ctx.fillRect(0, 0, NATIVE_WIDTH, NATIVE_HEIGHT);

    const kitA = getTeamKit(match.config.teamAKit, 'A');
    const kitB = getTeamKit(match.config.teamBKit, 'B');
    const winKit = match.winner === 'A' ? kitA : kitB;

    const bx = 98;
    const by = 34;
    const bw = 284;
    const bh = 202;
    ctx.fillStyle = PALETTE.deepNavy;
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = winKit.primary;
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, bw, bh);

    const isCup = match.cup.active;
    const cupRound = match.cup.getCurrentRound();

    const headerLabel = isCup ? `DERBY CUP - ${cupRound.title}` : 'FULL TIME!';
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
    const winColor = winKit.light;

    drawPixelText(ctx, headerLabel, NATIVE_WIDTH * 0.5, by + 12, PALETTE.gold, 1, 'center');
    drawPixelText(ctx, winTitle, NATIVE_WIDTH * 0.5, by + 26, winColor, 2, 'center', PALETTE.inkBlack);

    drawPixelText(
      ctx,
      `${kitA.tag}  ${match.scoreA}  -  ${match.scoreB}  ${kitB.tag}`,
      NATIVE_WIDTH * 0.5,
      by + 52,
      PALETTE.pureWhite,
      2,
      'center',
      PALETTE.inkBlack
    );

    ctx.fillStyle = PALETTE.inkBlack;
    ctx.fillRect(bx + 22, by + 78, bw - 44, 58);
    drawPixelText(
      ctx,
      `SHOTS:   ${kitA.tag} ${match.stats.teamAShots}  -  ${match.stats.teamBShots} ${kitB.tag}`,
      NATIVE_WIDTH * 0.5,
      by + 87,
      PALETTE.offWhite,
      1,
      'center'
    );
    drawPixelText(
      ctx,
      `WALL BOUNCES: ${match.stats.wallBounces}   |   TACKLES: ${match.stats.tackles}`,
      NATIVE_WIDTH * 0.5,
      by + 102,
      PALETTE.turfLine,
      1,
      'center'
    );
    drawPixelText(
      ctx,
      `TOP BALL SPEED: ${match.stats.topBallSpeed} PX/S`,
      NATIVE_WIDTH * 0.5,
      by + 117,
      PALETTE.gold,
      1,
      'center'
    );

    const primaryAction =
      isCup && match.winner === 'A'
        ? {
            label: match.cup.isFinalRound() ? 'CLAIM TROPHY! (ENTER)' : 'PICK PERK & NEXT ->',
            action: callbacks.onAdvanceCup,
          }
        : {
            label: isCup ? 'RETRY CUP (ENTER)' : 'REMATCH! (ENTER)',
            action: callbacks.onRematch,
          };

    const btns = [
      { id: 0, label: primaryAction.label, action: primaryAction.action },
      { id: 1, label: 'MAIN MENU', action: callbacks.onQuitToMenu },
    ];

    for (const btn of btns) {
      const ry = by + 148 + btn.id * 24;
      const sel = this.resultRow === btn.id;
      ctx.fillStyle = btn.id === 0 ? (sel ? PALETTE.teamAPrimary : PALETTE.teamADark) : sel ? PALETTE.slateMid : PALETTE.slateDark;
      ctx.fillRect(bx + 42, ry, bw - 84, 19);
      if (sel) {
        ctx.strokeStyle = PALETTE.gold;
        ctx.lineWidth = 1;
        ctx.strokeRect(bx + 42.5, ry + 0.5, bw - 85, 18);
      }
      drawPixelText(ctx, btn.label, NATIVE_WIDTH * 0.5, ry + 6, PALETTE.pureWhite, 1, 'center');
      this.clickZones.push({
        x: bx + 42,
        y: ry,
        w: bw - 84,
        h: 19,
        action: () => {
          this.resultRow = btn.id;
          btn.action();
        },
      });
    }
  }

  private renderPerkSelectScreen(ctx: CanvasRenderingContext2D, match: MatchState, callbacks: UICallbacks): void {
    ctx.fillStyle = PALETTE.inkBlack;
    ctx.fillRect(0, 0, NATIVE_WIDTH, NATIVE_HEIGHT);

    const nextRoundIdx = match.cup.currentRoundIndex + 1;
    const nextRoundTitle = nextRoundIdx === 1 ? 'SEMI FINAL: CONCRETE ALLEY' : 'GRAND FINAL: ROOFTOP NIGHT';

    drawPixelText(ctx, 'VICTORY! CHOOSE A CUP PERK', NATIVE_WIDTH * 0.5, 20, PALETTE.gold, 2, 'center');
    drawPixelText(ctx, `NEXT UP -> ${nextRoundTitle}`, NATIVE_WIDTH * 0.5, 42, PALETTE.iceCyan, 1, 'center');

    const choices = match.cup.perkChoices;
    const cardW = 132;
    const cardH = 112;
    const gap = 14;
    const startX = (NATIVE_WIDTH - (cardW * 3 + gap * 2)) * 0.5;
    const cardY = 68;

    for (let i = 0; i < choices.length; i++) {
      const perkType = choices[i];
      const def = PERK_CATALOG[perkType];
      const cx = startX + i * (cardW + gap);
      const sel = this.perkIndex === i;

      ctx.fillStyle = sel ? PALETTE.slateMid : PALETTE.deepNavy;
      ctx.fillRect(cx, cardY, cardW, cardH);
      ctx.strokeStyle = sel ? PALETTE.gold : PALETTE.slateLight;
      ctx.lineWidth = sel ? 2 : 1;
      ctx.strokeRect(cx, cardY, cardW, cardH);

      // Badge number
      ctx.fillStyle = sel ? PALETTE.gold : PALETTE.slateDark;
      ctx.fillRect(cx + 8, cardY + 8, 16, 14);
      drawPixelText(ctx, `${i + 1}`, cx + 16, cardY + 12, sel ? PALETTE.inkBlack : PALETTE.pureWhite, 1, 'center');

      // Pixel perk emblem box
      ctx.fillStyle = PALETTE.teamAPrimary;
      ctx.fillRect(cx + cardW * 0.5 - 12, cardY + 26, 24, 24);
      ctx.fillStyle = PALETTE.gold;
      ctx.fillRect(cx + cardW * 0.5 - 6, cardY + 32, 12, 12);

      drawPixelText(ctx, def.name, cx + cardW * 0.5, cardY + 62, PALETTE.pureWhite, 1, 'center');
      drawPixelText(ctx, def.shortDesc, cx + cardW * 0.5, cardY + 78, PALETTE.turfLine, 1, 'center');

      if (sel) {
        drawPixelText(ctx, '[SELECT]', cx + cardW * 0.5, cardY + 96, PALETTE.gold, 1, 'center');
      }

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

    // Active perks summary at bottom
    const ownedText =
      match.cup.earnedPerks.length > 0
        ? `ACTIVE PERKS: ${match.cup.earnedPerks.map((p) => PERK_CATALOG[p].name).join(', ')}`
        : 'SELECT 1 PERMANENT PERK FOR THE REST OF DERBY CUP';
    drawPixelText(ctx, ownedText, NATIVE_WIDTH * 0.5, 206, PALETTE.offWhite, 1, 'center');
    drawPixelText(
      ctx,
      'LEFT/RIGHT TO CHOOSE  |  ENTER / SPACE / CLICK TO EQUIP',
      NATIVE_WIDTH * 0.5,
      226,
      PALETTE.slateLight,
      1,
      'center'
    );
  }

  private renderCupChampionScreen(ctx: CanvasRenderingContext2D, match: MatchState, callbacks: UICallbacks): void {
    ctx.fillStyle = PALETTE.inkBlack;
    ctx.fillRect(0, 0, NATIVE_WIDTH, NATIVE_HEIGHT);

    // Subtle celebration stripes
    ctx.fillStyle = PALETTE.deepNavy;
    ctx.fillRect(0, 0, NATIVE_WIDTH, 68);

    drawPixelText(ctx, 'DERBY CUP CHAMPIONS!', NATIVE_WIDTH * 0.5, 16, PALETTE.gold, 2, 'center', PALETTE.inkBlack);
    drawPixelText(ctx, '3 ROUNDS CONQUERED - STREET TO SKYLINE!', NATIVE_WIDTH * 0.5, 40, PALETTE.iceCyan, 1, 'center');

    // Pixel Golden Trophy in center
    const tx = NATIVE_WIDTH * 0.5;
    const ty = 78;
    ctx.fillStyle = PALETTE.gold;
    ctx.fillRect(tx - 16, ty, 32, 18); // cup bowl
    ctx.fillRect(tx - 12, ty + 18, 24, 6);
    ctx.fillRect(tx - 4, ty + 24, 8, 12); // stem
    ctx.fillRect(tx - 12, ty + 36, 24, 6); // base
    // Handles
    ctx.fillRect(tx - 22, ty + 3, 6, 10);
    ctx.fillRect(tx + 16, ty + 3, 6, 10);
    ctx.fillStyle = PALETTE.amber;
    ctx.fillRect(tx - 12, ty + 3, 4, 12);
    ctx.fillStyle = PALETTE.pureWhite;
    ctx.fillRect(tx + 6, ty + 3, 4, 10);

    drawPixelText(
      ctx,
      `TOURNAMENT GOALS: ${match.cup.totalGoalsScored} FOR  -  ${match.cup.totalGoalsConceded} AGAINST`,
      tx,
      134,
      PALETTE.pureWhite,
      1,
      'center'
    );

    const perksStr =
      match.cup.earnedPerks.length > 0
        ? `PERKS: ${match.cup.earnedPerks.map((p) => PERK_CATALOG[p].name).join(' + ')}`
        : 'PURE SKILL RUN';
    drawPixelText(ctx, perksStr, tx, 150, PALETTE.turfLine, 1, 'center');

    const btns = [
      { id: 0, label: 'PLAY NEW DERBY CUP! (ENTER)', action: callbacks.onRematch },
      { id: 1, label: 'MAIN MENU', action: callbacks.onQuitToMenu },
    ];
    for (const btn of btns) {
      const ry = 178 + btn.id * 26;
      const sel = this.championRow === btn.id;
      ctx.fillStyle = btn.id === 0 ? (sel ? PALETTE.teamAPrimary : PALETTE.teamADark) : sel ? PALETTE.slateMid : PALETTE.slateDark;
      ctx.fillRect(tx - 105, ry, 210, 20);
      if (sel) {
        ctx.strokeStyle = PALETTE.gold;
        ctx.lineWidth = 1;
        ctx.strokeRect(tx - 104.5, ry + 0.5, 209, 19);
      }
      drawPixelText(ctx, btn.label, tx, ry + 7, PALETTE.pureWhite, 1, 'center');
      this.clickZones.push({
        x: tx - 105,
        y: ry,
        w: 210,
        h: 20,
        action: () => {
          this.championRow = btn.id;
          btn.action();
        },
      });
    }
  }

  private renderRecordsOverlay(
    ctx: CanvasRenderingContext2D,
    records: CareerRecordsData,
    callbacks: UICallbacks
  ): void {
    ctx.fillStyle = PALETTE.inkBlack;
    ctx.fillRect(0, 0, NATIVE_WIDTH, NATIVE_HEIGHT);

    ctx.fillStyle = PALETTE.deepNavy;
    ctx.fillRect(0, 0, NATIVE_WIDTH, 34);
    ctx.fillStyle = PALETTE.gold;
    ctx.fillRect(0, 33, NATIVE_WIDTH, 2);

    drawPixelText(ctx, 'CAREER RECORDS', NATIVE_WIDTH * 0.5, 8, PALETTE.gold, 2, 'center', PALETTE.inkBlack);

    // Two side-by-side stat cards
    const drawStatRow = (x: number, y: number, w: number, label: string, val: string, valColor: string) => {
      drawPixelText(ctx, label, x + 10, y, PALETTE.offWhite, 1, 'left');
      drawPixelText(ctx, val, x + w - 10, y, valColor, 1, 'right');
    };

    const cardY = 44;
    const cardW = 208;
    const cardH = 152;
    const leftX = 24;
    const rightX = NATIVE_WIDTH - 24 - cardW;

    for (const cx of [leftX, rightX]) {
      ctx.fillStyle = PALETTE.deepNavy;
      ctx.fillRect(cx, cardY, cardW, cardH);
      ctx.strokeStyle = PALETTE.slateMid;
      ctx.lineWidth = 1;
      ctx.strokeRect(cx + 0.5, cardY + 0.5, cardW - 1, cardH - 1);
    }

    drawPixelText(ctx, 'TEAM A / P1 STATS', leftX + cardW * 0.5, cardY + 10, PALETTE.iceCyan, 1, 'center');
    drawStatRow(leftX, cardY + 30, cardW, 'MATCHES', `${records.matchesPlayed}`, PALETTE.pureWhite);
    drawStatRow(leftX, cardY + 48, cardW, 'WINS / LOSSES', `${records.wins}W - ${records.losses}L`, PALETTE.turfLine);
    drawStatRow(leftX, cardY + 66, cardW, 'WIN STREAK', `${records.currentWinStreak} (BEST ${records.bestWinStreak})`, PALETTE.gold);
    drawStatRow(leftX, cardY + 84, cardW, 'TOTAL GOALS', `${records.goalsScored}`, PALETTE.pureWhite);
    drawStatRow(leftX, cardY + 102, cardW, 'BEST 1 MATCH', `${records.mostGoalsInMatch} GOALS`, PALETTE.amber);
    drawStatRow(leftX, cardY + 120, cardW, 'CUP TROPHIES', `${records.cupTrophies}`, PALETTE.gold);

    drawPixelText(ctx, 'HIGHLIGHTS & SPEED', rightX + cardW * 0.5, cardY + 10, PALETTE.iceCyan, 1, 'center');
    drawStatRow(rightX, cardY + 30, cardW, 'BANK SHOTS', `${records.bankShots}`, PALETTE.gold);
    drawStatRow(rightX, cardY + 48, cardW, 'ONE-TIMER GOALS', `${records.oneTimerGoals}`, PALETTE.iceCyan);
    drawStatRow(rightX, cardY + 66, cardW, 'SAVES / BLOCKS', `${records.saves}`, PALETTE.turfLine);
    drawStatRow(rightX, cardY + 84, cardW, 'TACKLE STEALS', `${records.steals}`, PALETTE.amber);
    drawStatRow(rightX, cardY + 102, cardW, 'TOP BALL SPEED', `${records.topBallSpeed} PX/S`, PALETTE.gold);
    drawPixelText(
      ctx,
      'PRACTICE SANDBOX NOT COUNTED',
      rightX + cardW * 0.5,
      cardY + 130,
      PALETTE.slateLight,
      1,
      'center'
    );

    // Action buttons
    const btns = [
      { id: 0, x: 74, label: 'BACK (ESC)', action: callbacks.onCloseOverlay },
      {
        id: 1,
        x: 246,
        label: this.resetArmed ? 'CONFIRM RESET!' : 'RESET RECORDS',
        action: callbacks.onResetRecords,
      },
    ];
    for (const b of btns) {
      const sel = this.recordsRow === b.id;
      const fill =
        b.id === 1 && this.resetArmed
          ? PALETTE.dangerRed
          : sel
            ? PALETTE.slateMid
            : PALETTE.slateDark;
      ctx.fillStyle = fill;
      ctx.fillRect(b.x, 212, 160, 20);
      if (sel) {
        ctx.strokeStyle = b.id === 1 && this.resetArmed ? PALETTE.pureWhite : PALETTE.gold;
        ctx.lineWidth = 1;
        ctx.strokeRect(b.x + 0.5, 212.5, 159, 19);
      }
      drawPixelText(ctx, b.label, b.x + 80, 219, PALETTE.pureWhite, 1, 'center');
      this.clickZones.push({
        x: b.x,
        y: 212,
        w: 160,
        h: 20,
        action: () => {
          this.recordsRow = b.id;
          b.action();
        },
      });
    }

    drawPixelText(
      ctx,
      'LEFT/RIGHT: SELECT   ENTER: CONFIRM   ESC: BACK TO MENU',
      NATIVE_WIDTH * 0.5,
      246,
      PALETTE.slateLight,
      1,
      'center'
    );
  }

  private renderGuideOverlay(ctx: CanvasRenderingContext2D, callbacks: UICallbacks): void {
    ctx.fillStyle = PALETTE.inkBlack;
    ctx.fillRect(0, 0, NATIVE_WIDTH, NATIVE_HEIGHT);

    ctx.fillStyle = PALETTE.deepNavy;
    ctx.fillRect(0, 0, NATIVE_WIDTH, 28);
    ctx.fillStyle = PALETTE.iceCyan;
    ctx.fillRect(0, 27, NATIVE_WIDTH, 2);

    drawPixelText(ctx, 'HOW TO PLAY - NO-OUT DERBY', NATIVE_WIDTH * 0.5, 8, PALETTE.gold, 1, 'center');

    const tabs = ['1. RULES & MODES', '2. CONTROLS & SKILLS', '3. ARENAS & SANDBOX'];
    const tabW = 142;
    const tabStartX = (NATIVE_WIDTH - (tabW * 3 + 12)) * 0.5;
    for (let i = 0; i < tabs.length; i++) {
      const tx = tabStartX + i * (tabW + 6);
      const active = this.guidePage === i;
      ctx.fillStyle = active ? PALETTE.teamAPrimary : PALETTE.deepNavy;
      ctx.fillRect(tx, 34, tabW, 16);
      ctx.strokeStyle = active ? PALETTE.gold : PALETTE.slateMid;
      ctx.lineWidth = 1;
      ctx.strokeRect(tx + 0.5, 34.5, tabW - 1, 15);
      drawPixelText(ctx, tabs[i], tx + tabW * 0.5, 39, active ? PALETTE.pureWhite : PALETTE.slateLight, 1, 'center');
      this.clickZones.push({
        x: tx,
        y: 34,
        w: tabW,
        h: 16,
        action: () => callbacks.onChangeGuidePage(i),
      });
    }

    ctx.fillStyle = PALETTE.deepNavy;
    ctx.fillRect(20, 56, NATIVE_WIDTH - 40, 166);
    ctx.strokeStyle = PALETTE.slateMid;
    ctx.strokeRect(20.5, 56.5, NATIVE_WIDTH - 41, 165);

    const pages: Array<Array<{ text: string; color: string }>> = [
      [
        { text: 'NO-OUT RULES: NO FOULS, NO THROW-INS, NO OUT OF BOUNDS!', color: PALETTE.gold },
        { text: '- ALL 45-DEG CORNERS & WALLS BOUNCE BALL BACK INTO PLAY.', color: PALETTE.offWhite },
        { text: '- TIED AT 00:00? TRIGGERS GOLDEN GOAL: NEXT GOAL WINS!', color: PALETTE.iceCyan },
        { text: '- 1V1: 1 OUTFIELD + 1 GK.  2V2: 2 OUTFIELD (NO GK).', color: PALETTE.offWhite },
        { text: '- 3V3: 2 OUTFIELD + 1 AI GK! BOT ASSISTS DEF & ATTACK.', color: PALETTE.offWhite },
        { text: '- PLAYER FOCUS: STAYS ON 1 PLAYER (MANUAL [Q] TO SWITCH).', color: PALETTE.iceCyan },
        { text: '- DERBY CUP: BEAT 3 ROUNDS & PICK PERKS BETWEEN STAGES.', color: PALETTE.turfLine },
        { text: '- REPLAY: SPECTACULAR GOALS AUTO-REPLAY (SPACE TO SKIP).', color: PALETTE.slateLight },
      ],
      [
        { text: 'CONTROL STYLES (SET IN MENU -> BALL CTRL):', color: PALETTE.gold },
        { text: '- DRIBBLE + TACKLE: TOUCH BALL TO CARRY AT YOUR FEET.', color: PALETTE.iceCyan },
        { text: '  PRESS DASH INTO CARRIER TO STUN & STEAL THE BALL!', color: PALETTE.offWhite },
        { text: '- CLASSIC (BOUNCE): PURE ARCADE PINBALL TOUCH ON CONTACT.', color: PALETTE.offWhite },
        { text: '- POWER & CURVE: HOLD KICK (SPACE/J), STEER SIDEWAYS TO BEND!', color: PALETTE.turfLine },
        { text: '- ONE-TIMER VOLLEY: TAP KICK AS A FAST PASS ARRIVES!', color: PALETTE.gold },
        { text: '- P2 KEYS: ARROWS MOVE, ENTER/NUM1 KICK, RCTRL/NUM2 TACKLE.', color: PALETTE.slateLight },
        { text: '- MOBILE TOUCH: JOYSTICK + KICK/TACKLE + [V] PAD + [F] FULL.', color: PALETTE.iceCyan },
      ],
      [
        { text: '3 ARENAS, 3 PITCH SIZES & 6 CHAOS MUTATORS:', color: PALETTE.gold },
        { text: '- CLASSIC: BALANCED. CONCRETE: FAST WALLS. ROOFTOP: WIND!', color: PALETTE.offWhite },
        { text: '- PITCH SIZE: STANDARD / LARGE (1.8X) / STADIUM XL (2.7X)!', color: PALETTE.turfLine },
        { text: '- FULLSCREEN [F]: LAYAR PENUH + AUTO WIDE DI BROWSER MOBILE!', color: PALETTE.iceCyan },
        { text: '- MUTATORS: GIANT BALL, ICE PITCH, PINBALL 114%, HOT POTATO,', color: PALETTE.iceCyan },
        { text: '  WIDE GOALS (1.6X), DOUBLE TROUBLE (2 BALLS AT ONCE).', color: PALETTE.iceCyan },
        { text: 'SANDBOX: [1-6] MUTATORS [0] CLEAR [F] FEED [B] BALL [T] AI', color: PALETTE.offWhite },
      ],
    ];

    const lines = pages[this.guidePage] ?? pages[0];
    for (let i = 0; i < lines.length; i++) {
      drawPixelText(ctx, lines[i].text, 32, 64 + i * 19, lines[i].color, 1, 'left');
    }

    // Footer bar + Back button
    ctx.fillStyle = PALETTE.slateDark;
    ctx.fillRect(NATIVE_WIDTH * 0.5 - 75, 229, 150, 19);
    ctx.strokeStyle = PALETTE.gold;
    ctx.strokeRect(NATIVE_WIDTH * 0.5 - 74.5, 229.5, 149, 18);
    drawPixelText(ctx, 'BACK / CLOSE (ESC)', NATIVE_WIDTH * 0.5, 236, PALETTE.pureWhite, 1, 'center');
    this.clickZones.push({
      x: NATIVE_WIDTH * 0.5 - 75,
      y: 229,
      w: 150,
      h: 19,
      action: callbacks.onCloseOverlay,
    });

    drawPixelText(
      ctx,
      'LEFT / RIGHT: SWITCH TAB   /   ESC OR ENTER: CLOSE',
      NATIVE_WIDTH * 0.5,
      255,
      PALETTE.slateLight,
      1,
      'center'
    );
  }
}
