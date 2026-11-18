export interface CrazyGamesSettings {
  muteAudio?: boolean;
  disableChat?: boolean;
}

export interface CrazyGamesAdCallbacks {
  adStarted?: () => void;
  adFinished?: () => void;
  adError?: (error: unknown, errorData?: unknown) => void;
}

export interface CrazyGamesSdkV3 {
  environment?: string;
  init?: () => Promise<void>;
  game?: {
    loadingStart?: () => void;
    loadingStop?: () => void;
    gameplayStart?: () => void;
    gameplayStop?: () => void;
    happytime?: () => void;
    settings?: CrazyGamesSettings;
    addSettingsChangeListener?: (cb: (settings: CrazyGamesSettings) => void) => void;
  };
  ad?: {
    requestAd?: (type: 'midgame' | 'rewarded', callbacks: CrazyGamesAdCallbacks) => void;
  };
}

export type AdOverlayState = 'idle' | 'loading' | 'playing';

export interface MidgameAdHooks {
  onStateChange?: (blocking: boolean, state: AdOverlayState) => void;
  onAudioMuteChange?: (muted: boolean) => void;
  onComplete: () => void;
}

export interface CrazyGamesEnvSource {
  buildFlag?: boolean;
  hostname?: string;
  search?: string;
  sdkEnvironment?: string;
}

const AD_AUCTION_TIMEOUT_MS = 4500;
/**
 * Hard ceiling for a midgame ad once the SDK has reported `adStarted`. Ad SDKs occasionally never
 * fire `adFinished`/`adError` (crashed iframe, blocked network, SDK regression). Without this the
 * game stays paused behind the "AD BREAK..." overlay forever and only a page reload recovers.
 */
const AD_PLAYBACK_TIMEOUT_MS = 20_000;
const SDK_SCRIPT_WAIT_MS = 1500;

export function isCrazyGamesHost(hostname: string, search = ''): boolean {
  const host = hostname.trim().toLowerCase();
  if (
    /(?:^|\.)crazygames\.[a-z.]+$/.test(host) ||
    /(?:^|\.)1001juegos\.com$/.test(host) ||
    host === 'builds.crazygames.com'
  ) {
    return true;
  }
  if (search) {
    try {
      const params = new URLSearchParams(search);
      if (params.get('crazygames') === '1' || params.get('useLocalSdk') === 'true') {
        return true;
      }
    } catch {
      // Ignore malformed query string
    }
  }
  return false;
}

export function resolveCrazyGamesMode(source: CrazyGamesEnvSource): boolean {
  if (source.buildFlag) return true;
  if (source.sdkEnvironment === 'crazygames') return true;
  return isCrazyGamesHost(source.hostname ?? '', source.search ?? '');
}

export function readCrazyGamesBuildFlag(): boolean {
  const metaEnv = (import.meta as unknown as { env?: Record<string, unknown> }).env;
  return metaEnv?.VITE_CRAZYGAMES === 'true' || metaEnv?.VITE_CRAZYGAMES === true;
}

export function isOnlineFeatureEnabled(
  hostname = typeof window !== 'undefined' ? window.location?.hostname ?? '' : '',
  search = typeof window !== 'undefined' ? window.location?.search ?? '' : ''
): boolean {
  const winSdkEnv =
    typeof window !== 'undefined'
      ? (window as unknown as { CrazyGames?: { SDK?: CrazyGamesSdkV3 } }).CrazyGames?.SDK?.environment
      : undefined;
  return !resolveCrazyGamesMode({
    buildFlag: readCrazyGamesBuildFlag(),
    hostname,
    search,
    sdkEnvironment: winSdkEnv,
  });
}

export interface CrazyGamesRuntimeDeps {
  getSdk?: () => CrazyGamesSdkV3 | null | undefined;
  findSdkScript?: () => { addEventListener?: (type: string, fn: () => void, opts?: { once?: boolean }) => void } | null;
  buildFlag?: boolean;
  hostname?: string;
  search?: string;
  adStartTimeoutMs?: number;
  adPlaybackTimeoutMs?: number;
}

export class CrazyGamesBridge {
  private readonly getSdk: () => CrazyGamesSdkV3 | null | undefined;
  private readonly findSdkScript: () => {
    addEventListener?: (type: string, fn: () => void, opts?: { once?: boolean }) => void;
  } | null;
  private readonly buildFlag: boolean;
  private readonly hostname: string;
  private readonly search: string;
  private readonly adStartTimeoutMs: number;
  private readonly adPlaybackTimeoutMs: number;

  private sdk: CrazyGamesSdkV3 | null = null;
  private initialized = false;
  private initializing = false;
  private loadingLifecycleSent = false;
  private desiredGameplayActive = false;
  private reportedGameplayActive = false;
  private adState: AdOverlayState = 'idle';
  private crazyGamesMode: boolean;

  constructor(deps: CrazyGamesRuntimeDeps = {}) {
    this.getSdk =
      deps.getSdk ??
      (() =>
        typeof window !== 'undefined'
          ? (window as unknown as { CrazyGames?: { SDK?: CrazyGamesSdkV3 } }).CrazyGames?.SDK
          : undefined);
    this.findSdkScript =
      deps.findSdkScript ??
      (() =>
        typeof document !== 'undefined'
          ? document.querySelector?.('script[src*="crazygames-sdk-v3"]') ?? null
          : null);
    this.buildFlag = deps.buildFlag ?? readCrazyGamesBuildFlag();
    this.hostname =
      deps.hostname ?? (typeof window !== 'undefined' ? window.location?.hostname ?? '' : '');
    this.search =
      deps.search ?? (typeof window !== 'undefined' ? window.location?.search ?? '' : '');
    this.adStartTimeoutMs = deps.adStartTimeoutMs ?? AD_AUCTION_TIMEOUT_MS;
    this.adPlaybackTimeoutMs = deps.adPlaybackTimeoutMs ?? AD_PLAYBACK_TIMEOUT_MS;
    this.crazyGamesMode = resolveCrazyGamesMode({
      buildFlag: this.buildFlag,
      hostname: this.hostname,
      search: this.search,
      sdkEnvironment: this.getSdk()?.environment,
    });
  }

  shouldDisableOnline(): boolean {
    return this.crazyGamesMode;
  }

  isAdBlocking(): boolean {
    return this.adState !== 'idle';
  }

  getAdState(): AdOverlayState {
    return this.adState;
  }

  canServeAds(): boolean {
    if (!this.initialized || !this.sdk?.ad?.requestAd) return false;
    return this.sdk.environment !== 'disabled';
  }

  async initialize(
    onEnvironmentResolved?: () => void,
    onMuteSettingChange?: (muted: boolean) => void
  ): Promise<void> {
    if (this.initialized || this.initializing) return;
    this.initializing = true;

    try {
      let candidate = this.getSdk();
      if (!candidate) {
        const scriptEl = this.findSdkScript();
        if (scriptEl?.addEventListener) {
          await new Promise<void>((resolve) => {
            let settled = false;
            const done = () => {
              if (settled) return;
              settled = true;
              resolve();
            };
            scriptEl.addEventListener?.('load', done, { once: true });
            scriptEl.addEventListener?.('error', done, { once: true });
            setTimeout(done, SDK_SCRIPT_WAIT_MS);
          });
          candidate = this.getSdk();
        }
      }

      if (!candidate) return;
      this.sdk = candidate;

      if (typeof candidate.init === 'function') {
        await candidate.init();
      }

      this.initialized = true;
      this.crazyGamesMode = resolveCrazyGamesMode({
        buildFlag: this.buildFlag,
        hostname: this.hostname,
        search: this.search,
        sdkEnvironment: candidate.environment,
      });
      onEnvironmentResolved?.();

      if (candidate.environment !== 'disabled' && !this.loadingLifecycleSent) {
        this.loadingLifecycleSent = true;
        candidate.game?.loadingStart?.();
        candidate.game?.loadingStop?.();
      }

      const initialMute = candidate.game?.settings?.muteAudio;
      if (typeof initialMute === 'boolean') {
        onMuteSettingChange?.(initialMute);
      }

      candidate.game?.addSettingsChangeListener?.((next) => {
        if (typeof next?.muteAudio === 'boolean') {
          onMuteSettingChange?.(next.muteAudio);
        }
      });

      this.flushGameplayState();
    } catch {
      // Never block or crash game boot if an AdBlocker/offline runtime rejects SDK init.
    } finally {
      this.initializing = false;
    }
  }

  setGameplayActive(active: boolean): void {
    this.desiredGameplayActive = active;
    this.flushGameplayState();
  }

  happytime(): void {
    if (!this.initialized || !this.sdk || this.sdk.environment === 'disabled') return;
    try {
      this.sdk.game?.happytime?.();
    } catch {
      // Ignore non-fatal SDK celebration failures
    }
  }

  requestMidgameAd(hooks: MidgameAdHooks): void {
    if (this.adState !== 'idle') return;

    if (!this.crazyGamesMode || !this.canServeAds() || !this.sdk?.ad?.requestAd) {
      hooks.onComplete();
      return;
    }

    let settled = false;
    let preStartTimer: ReturnType<typeof setTimeout> | null = null;
    let playbackTimer: ReturnType<typeof setTimeout> | null = null;

    const clearTimers = () => {
      if (preStartTimer !== null) {
        clearTimeout(preStartTimer);
        preStartTimer = null;
      }
      if (playbackTimer !== null) {
        clearTimeout(playbackTimer);
        playbackTimer = null;
      }
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimers();
      this.adState = 'idle';
      hooks.onAudioMuteChange?.(false);
      hooks.onStateChange?.(false, 'idle');
      hooks.onComplete();
    };

    this.adState = 'loading';
    this.setGameplayActive(false);
    hooks.onStateChange?.(true, 'loading');

    preStartTimer = setTimeout(() => {
      // Ensure auction stalls / silent blockers never softlock transitions.
      if (this.adState === 'loading') {
        finish();
      }
    }, this.adStartTimeoutMs);

    try {
      this.sdk.ad.requestAd('midgame', {
        adStarted: () => {
          if (settled) return;
          if (preStartTimer !== null) {
            clearTimeout(preStartTimer);
            preStartTimer = null;
          }
          this.adState = 'playing';
          hooks.onAudioMuteChange?.(true);
          hooks.onStateChange?.(true, 'playing');
          // Playback watchdog: if the ad never reports completion the game must still resume.
          if (playbackTimer === null) {
            playbackTimer = setTimeout(finish, this.adPlaybackTimeoutMs);
          }
        },
        adFinished: () => {
          finish();
        },
        adError: () => {
          finish();
        },
      });
    } catch {
      finish();
    }
  }

  private flushGameplayState(): void {
    if (!this.initialized || !this.sdk || this.sdk.environment === 'disabled') return;
    if (this.desiredGameplayActive === this.reportedGameplayActive) return;

    this.reportedGameplayActive = this.desiredGameplayActive;
    try {
      if (this.reportedGameplayActive) {
        this.sdk.game?.gameplayStart?.();
      } else {
        this.sdk.game?.gameplayStop?.();
      }
    } catch {
      // Ignore SDK telemetry failures
    }
  }
}
