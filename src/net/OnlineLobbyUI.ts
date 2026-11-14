import type { MatchConfig } from '../types.ts';
import {
  isValidRoomCode,
  ONLINE_MODE_OPTIONS,
  type OnlineGameMode,
  type OnlineRoomConfig,
  sanitizeRoomCode,
  toOnlineGameMode,
} from './SignalingTypes.ts';
import {
  fetchConnectionConfig,
  lookupOnlineRoom,
  type OnlineRoomPreview,
  type PeerConnectionPhase,
  SignalingError,
} from './NetTransport.ts';

export interface OnlineLobbyCallbacks {
  getMenuConfig: () => MatchConfig;
  onStartHost: (config: OnlineRoomConfig) => void;
  onStartJoin: (code: string) => void;
  onCancelPending: () => void;
  onCloseModal: () => void;
  onPlayBlip: (confirm: boolean) => void;
}

export class OnlineLobbyUI {
  private modalEl: HTMLElement | null;
  private closeBtn: HTMLButtonElement | null;
  private tabHostBtn: HTMLButtonElement | null;
  private tabJoinBtn: HTMLButtonElement | null;
  private hostPanelEl: HTMLElement | null;
  private joinPanelEl: HTMLElement | null;
  private formatGridEl: HTMLElement | null;
  private hostSummaryEl: HTMLElement | null;
  private hostIdleActionsEl: HTMLElement | null;
  private hostActiveBoxEl: HTMLElement | null;
  private createBtn: HTMLButtonElement | null;
  private roomCodeEl: HTMLElement | null;
  private copyLinkBtn: HTMLButtonElement | null;
  private copyCodeBtn: HTMLButtonElement | null;
  private cancelHostBtn: HTMLButtonElement | null;
  private joinFormEl: HTMLFormElement | null;
  private codeInputEl: HTMLInputElement | null;
  private joinBtn: HTMLButtonElement | null;
  private joinPreviewEl: HTMLElement | null;
  private cancelJoinBtn: HTMLButtonElement | null;
  private natBadgeEl: HTMLElement | null;
  private statusEl: HTMLElement | null;
  private iceStatusAbort: AbortController | null = null;

  private opened = false;
  private tab: 'host' | 'join' = 'host';
  private busy = false;
  private selectedFormat: OnlineGameMode = '1v1_local';
  private activeRoomCode = '';
  private previewAbort: AbortController | null = null;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private formatButtons = new Map<OnlineGameMode, HTMLButtonElement>();

  constructor(private readonly callbacks: OnlineLobbyCallbacks) {
    this.modalEl = document.getElementById('online-modal');
    this.closeBtn = document.getElementById('online-close-btn') as HTMLButtonElement | null;
    this.tabHostBtn = document.getElementById('online-tab-host') as HTMLButtonElement | null;
    this.tabJoinBtn = document.getElementById('online-tab-join') as HTMLButtonElement | null;
    this.hostPanelEl = document.getElementById('online-host-panel');
    this.joinPanelEl = document.getElementById('online-join-panel');
    this.formatGridEl = document.getElementById('online-format-grid');
    this.hostSummaryEl = document.getElementById('online-host-summary');
    this.hostIdleActionsEl = document.getElementById('online-host-idle-actions');
    this.hostActiveBoxEl = document.getElementById('online-host-active-box');
    this.createBtn = document.getElementById('online-create-btn') as HTMLButtonElement | null;
    this.roomCodeEl = document.getElementById('online-room-code');
    this.copyLinkBtn = document.getElementById('online-copy-link-btn') as HTMLButtonElement | null;
    this.copyCodeBtn = document.getElementById('online-copy-code-btn') as HTMLButtonElement | null;
    this.cancelHostBtn = document.getElementById('online-cancel-host-btn') as HTMLButtonElement | null;
    this.joinFormEl = document.getElementById('online-join-form') as HTMLFormElement | null;
    this.codeInputEl = document.getElementById('online-code-input') as HTMLInputElement | null;
    this.joinBtn = document.getElementById('online-join-btn') as HTMLButtonElement | null;
    this.joinPreviewEl = document.getElementById('online-join-preview');
    this.cancelJoinBtn = document.getElementById('online-cancel-join-btn') as HTMLButtonElement | null;
    this.natBadgeEl = document.getElementById('online-nat-badge');
    this.statusEl = document.getElementById('online-status');

    this.buildFormatButtons();
    this.bindEvents();
  }

  isOpen(): boolean {
    return this.opened;
  }

  private buildFormatButtons(): void {
    if (!this.formatGridEl) return;
    this.formatGridEl.innerHTML = '';
    this.formatButtons.clear();

    for (const opt of ONLINE_MODE_OPTIONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'online-btn online-format-pill';
      btn.textContent = opt.shortLabel;
      btn.addEventListener('click', () => {
        if (this.busy) return;
        this.callbacks.onPlayBlip(false);
        this.selectedFormat = opt.value;
        this.renderHostState();
      });
      this.formatGridEl.appendChild(btn);
      this.formatButtons.set(opt.value, btn);
    }
  }

  private bindEvents(): void {
    this.closeBtn?.addEventListener('click', () => {
      this.callbacks.onPlayBlip(false);
      this.close(true);
    });

    this.modalEl?.addEventListener('click', (ev) => {
      if (ev.target === this.modalEl && !this.busy) {
        this.callbacks.onPlayBlip(false);
        this.close(true);
      }
    });

    window.addEventListener('keydown', (ev) => {
      if (this.opened && ev.key === 'Escape') {
        ev.preventDefault();
        this.callbacks.onPlayBlip(false);
        this.close(true);
      }
    });

    this.tabHostBtn?.addEventListener('click', () => {
      if (this.busy) return;
      this.callbacks.onPlayBlip(false);
      this.switchTab('host');
    });

    this.tabJoinBtn?.addEventListener('click', () => {
      if (this.busy) return;
      this.callbacks.onPlayBlip(false);
      this.switchTab('join');
    });

    this.createBtn?.addEventListener('click', () => {
      if (this.busy) return;
      this.callbacks.onPlayBlip(true);
      const cfg = this.buildHostRoomConfig();
      this.busy = true;
      this.renderHostState();
      this.callbacks.onStartHost(cfg);
    });

    this.cancelHostBtn?.addEventListener('click', () => {
      this.callbacks.onPlayBlip(false);
      this.callbacks.onCancelPending();
      this.resetBusyState('Pembuatan room dibatalkan.');
    });

    this.cancelJoinBtn?.addEventListener('click', () => {
      this.callbacks.onPlayBlip(false);
      this.callbacks.onCancelPending();
      this.resetBusyState('Proses join dibatalkan.');
    });

    this.copyLinkBtn?.addEventListener('click', () => {
      if (!this.activeRoomCode) return;
      const shareUrl = `${window.location.origin}${window.location.pathname}?room=${this.activeRoomCode}`;
      void this.copyText(shareUrl, this.copyLinkBtn, 'SALIN LINK INVITE', 'LINK DISALIN!');
    });

    this.copyCodeBtn?.addEventListener('click', () => {
      if (!this.activeRoomCode) return;
      void this.copyText(this.activeRoomCode, this.copyCodeBtn, 'SALIN KODE', 'KODE DISALIN!');
    });

    this.codeInputEl?.addEventListener('input', () => {
      if (!this.codeInputEl) return;
      const clean = sanitizeRoomCode(this.codeInputEl.value);
      this.codeInputEl.value = clean;
      this.scheduleJoinPreview(clean);
    });

    this.joinFormEl?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (this.busy || !this.codeInputEl) return;
      const clean = sanitizeRoomCode(this.codeInputEl.value);
      this.codeInputEl.value = clean;
      if (!isValidRoomCode(clean)) {
        this.setStatus('Masukkan 4 karakter kode room yang valid.', 'error');
        return;
      }
      this.callbacks.onPlayBlip(true);
      this.busy = true;
      this.renderJoinState();
      this.callbacks.onStartJoin(clean);
    });
  }

  private async copyText(
    text: string,
    btn: HTMLButtonElement | null,
    defaultLabel: string,
    copiedLabel: string
  ): Promise<void> {
    this.callbacks.onPlayBlip(true);
    try {
      await navigator.clipboard.writeText(text);
      if (btn) {
        btn.textContent = copiedLabel;
        setTimeout(() => {
          btn.textContent = defaultLabel;
        }, 1400);
      }
      this.setStatus(`Tersalin: ${text}`, 'ok');
    } catch {
      this.setStatus(`Salin manual link/kode: ${text}`, 'info');
    }
  }

  private buildHostRoomConfig(): OnlineRoomConfig {
    const base = this.callbacks.getMenuConfig();
    const isFour = this.selectedFormat === '4v4_local' || this.selectedFormat === '4v4_coop';
    return {
      mode: this.selectedFormat,
      arena: base.arena ?? 'classic',
      pitchSize: isFour ? 'xl' : base.pitchSize ?? 'standard',
      controlStyle: base.controlStyle ?? 'dribble',
      teamAKit: base.teamAKit ?? 'garuda',
      teamBKit: base.teamBKit ?? 'cyber',
      difficulty: base.difficulty ?? 'pro',
      durationSeconds: base.durationSeconds ?? 90,
      mutatorsEnabled: Boolean(base.mutatorsEnabled),
    };
  }

  open(initialJoinCode?: string): void {
    this.opened = true;
    this.busy = false;
    this.activeRoomCode = '';
    this.selectedFormat = toOnlineGameMode(this.callbacks.getMenuConfig().mode);

    this.modalEl?.classList.add('open');
    this.refreshNatStatus();

    if (initialJoinCode) {
      const clean = sanitizeRoomCode(initialJoinCode);
      this.switchTab('join');
      if (this.codeInputEl) {
        this.codeInputEl.value = clean;
      }
      if (isValidRoomCode(clean)) {
        this.scheduleJoinPreview(clean, 0);
      }
      this.setStatus('Kode undangan terdeteksi! Klik GABUNG SEKARANG untuk bermain.', 'info');
    } else {
      this.switchTab('host');
      this.setStatus('Pilih Buat Room untuk mengundang teman, atau masukkan kode teman.', 'info');
    }
  }

  close(cancelPending: boolean): void {
    if (!this.opened) return;
    this.opened = false;
    this.modalEl?.classList.remove('open');
    this.previewAbort?.abort();
    this.iceStatusAbort?.abort();
    if (this.previewTimer) {
      clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
    if (cancelPending && this.busy) {
      this.callbacks.onCancelPending();
    }
    this.busy = false;
    this.activeRoomCode = '';
    this.callbacks.onCloseModal();
  }

  private switchTab(tab: 'host' | 'join'): void {
    this.tab = tab;
    this.tabHostBtn?.classList.toggle('active', tab === 'host');
    this.tabJoinBtn?.classList.toggle('active', tab === 'join');
    if (this.hostPanelEl) this.hostPanelEl.style.display = tab === 'host' ? 'block' : 'none';
    if (this.joinPanelEl) this.joinPanelEl.style.display = tab === 'join' ? 'block' : 'none';
    this.renderHostState();
    this.renderJoinState();
    if (tab === 'join') {
      setTimeout(() => this.codeInputEl?.focus(), 40);
    }
  }

  private renderHostState(): void {
    const base = this.callbacks.getMenuConfig();
    const isFour = this.selectedFormat === '4v4_local' || this.selectedFormat === '4v4_coop';
    const pitch = isFour ? 'STADIUM XL' : (base.pitchSize ?? 'standard').toUpperCase();
    const ctrl = (base.controlStyle ?? 'dribble').toUpperCase();
    const mut = base.mutatorsEnabled ? 'CHAOS ON' : 'CLASSIC';

    if (this.hostSummaryEl) {
      this.hostSummaryEl.textContent =
        `SETINGAN MENU: ${(base.arena ?? 'classic').toUpperCase()} • ${pitch} • CTRL:${ctrl} • ${base.durationSeconds}S • ${mut}`;
    }

    for (const [mode, btn] of this.formatButtons.entries()) {
      btn.classList.toggle('active', mode === this.selectedFormat);
      btn.disabled = this.busy;
    }

    const showingActiveRoom = this.busy && this.tab === 'host';
    if (this.hostIdleActionsEl) {
      this.hostIdleActionsEl.style.display = showingActiveRoom ? 'none' : 'block';
    }
    if (this.hostActiveBoxEl) {
      this.hostActiveBoxEl.style.display = showingActiveRoom ? 'block' : 'none';
    }
    if (this.roomCodeEl) {
      this.roomCodeEl.textContent = this.activeRoomCode || '....';
    }
    if (this.createBtn) this.createBtn.disabled = this.busy;
    if (this.tabJoinBtn) this.tabJoinBtn.disabled = this.busy;
  }

  private renderJoinState(): void {
    if (this.joinBtn) this.joinBtn.disabled = this.busy;
    if (this.codeInputEl) this.codeInputEl.disabled = this.busy;
    if (this.cancelJoinBtn) {
      this.cancelJoinBtn.style.display = this.busy && this.tab === 'join' ? 'block' : 'none';
    }
    if (this.tabHostBtn) this.tabHostBtn.disabled = this.busy;
  }

  private scheduleJoinPreview(code: string, delayMs = 250): void {
    if (this.previewTimer) {
      clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
    this.previewAbort?.abort();
    if (!isValidRoomCode(code)) {
      if (this.joinPreviewEl) this.joinPreviewEl.style.display = 'none';
      return;
    }

    this.previewTimer = setTimeout(() => {
      const ac = new AbortController();
      this.previewAbort = ac;
      void lookupOnlineRoom(code, ac.signal)
        .then((room: OnlineRoomPreview) => {
          if (ac.signal.aborted || !this.joinPreviewEl) return;
          const opt = ONLINE_MODE_OPTIONS.find((m) => m.value === room.config.mode);
          this.joinPreviewEl.style.display = 'block';
          this.joinPreviewEl.textContent = room.full
            ? `ROOM ${room.code}: SUDAH PENUH`
            : `ROOM ${room.code}: ${opt?.shortLabel ?? room.config.mode} • ${room.config.arena.toUpperCase()} • ${room.config.durationSeconds}S • SIAP GABUNG`;
        })
        .catch((err) => {
          if (ac.signal.aborted || !this.joinPreviewEl) return;
          if (err instanceof SignalingError && err.code === 'ROOM_NOT_FOUND') {
            this.joinPreviewEl.style.display = 'block';
            this.joinPreviewEl.textContent = `ROOM ${code}: TIDAK DITEMUKAN / EXPIRED`;
          } else {
            this.joinPreviewEl.style.display = 'none';
          }
        });
    }, delayMs);
  }

  onRoomCodeReady(code: string): void {
    this.activeRoomCode = code;
    this.renderHostState();
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('room', code);
      window.history.replaceState({}, '', url.toString());
    } catch {
      // Ignore history restrictions
    }
  }

  onPhaseChange(phase: PeerConnectionPhase, detail?: string): void {
    if (!this.opened) return;
    if (phase === 'connected') {
      this.setStatus('Terhubung! Memulai pertandingan...', 'ok');
      this.close(false);
      return;
    }
    if (detail) {
      this.setStatus(detail, phase === 'error' || phase === 'disconnected' ? 'error' : 'info');
    }
  }

  onError(message: string): void {
    this.resetBusyState(message, 'error');
  }

  private resetBusyState(message: string, tone: 'info' | 'error' | 'ok' = 'info'): void {
    this.busy = false;
    this.activeRoomCode = '';
    this.renderHostState();
    this.renderJoinState();
    this.setStatus(message, tone);
  }

  private refreshNatStatus(): void {
    if (!this.natBadgeEl) return;
    this.iceStatusAbort?.abort();
    const ac = new AbortController();
    this.iceStatusAbort = ac;

    this.natBadgeEl.className = '';
    this.natBadgeEl.textContent = 'JALUR KONEKSI: MENGECEK...';
    void fetchConnectionConfig(ac.signal).then((cfg) => {
      if (ac.signal.aborted || !this.natBadgeEl) return;
      if (cfg.relayWsUrl) {
        this.natBadgeEl.className = 'turn-ready';
        this.natBadgeEl.textContent =
          'JALUR: CLOUDFLARE EDGE WSS • ANTI-NAT / ANTI-BLOKIR (LOW PING)';
      } else if (cfg.hasTurn) {
        this.natBadgeEl.className = 'turn-ready';
        this.natBadgeEl.textContent =
          `NAT RELAY: TURN AKTIF (${cfg.provider.toUpperCase()}) • SIAP BEDA JARINGAN / 4G`;
      } else {
        this.natBadgeEl.className = 'stun-only';
        this.natBadgeEl.textContent =
          'NAT RELAY: STUN ONLY • PASANG RELAY_WS_URL (CLOUDFLARE) DI VERCEL AGAR LANCAR';
      }
    });
  }

  private setStatus(message: string, tone: 'info' | 'error' | 'ok'): void {
    if (!this.statusEl) return;
    this.statusEl.textContent = message;
    this.statusEl.className = tone === 'error' ? 'error' : tone === 'ok' ? 'ok' : '';
  }
}
