export interface FullscreenElementLike {
  requestFullscreen?: (options?: { navigationUI?: 'auto' | 'hide' | 'show' }) => Promise<void>;
  webkitRequestFullscreen?: () => Promise<void> | void;
}

export interface FullscreenDocLike {
  fullscreenEnabled?: boolean;
  webkitFullscreenEnabled?: boolean;
  fullscreenElement?: Element | null;
  webkitFullscreenElement?: Element | null;
  documentElement?: FullscreenElementLike | null;
  exitFullscreen?: () => Promise<void>;
  webkitExitFullscreen?: () => Promise<void> | void;
}

export interface ScreenLike {
  orientation?: {
    lock?: (orientation: 'landscape' | 'portrait' | 'any') => Promise<void>;
    unlock?: () => void;
  };
}

let fallbackFullscreenActive = false;

export function isNativeFullscreen(doc: FullscreenDocLike | null | undefined): boolean {
  if (!doc) return false;
  return Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

export function isFullscreenActive(doc: FullscreenDocLike | null | undefined): boolean {
  return isNativeFullscreen(doc) || fallbackFullscreenActive;
}

export function canRequestNativeFullscreen(doc: FullscreenDocLike | null | undefined): boolean {
  if (!doc || !doc.documentElement) return false;
  const el = doc.documentElement;
  const hasApi =
    typeof el.requestFullscreen === 'function' ||
    typeof el.webkitRequestFullscreen === 'function';
  if (!hasApi) return false;
  if (doc.fullscreenEnabled === false && doc.webkitFullscreenEnabled !== true) {
    return false;
  }
  return true;
}

export function resetFallbackFullscreen(): void {
  fallbackFullscreenActive = false;
}

/**
 * Enters browser fullscreen if supported (with optional landscape orientation lock on mobile),
 * falling back cleanly to immersive viewport-fill mode on platforms like iOS Safari tabs.
 */
export async function toggleAppFullscreen(
  preferLandscape: boolean,
  doc: FullscreenDocLike | null = typeof document !== 'undefined' ? (document as unknown as FullscreenDocLike) : null,
  screenObj: ScreenLike | null = typeof screen !== 'undefined' ? (screen as unknown as ScreenLike) : null
): Promise<{ active: boolean; mode: 'native' | 'fallback' | 'exited' }> {
  if (isFullscreenActive(doc)) {
    fallbackFullscreenActive = false;
    try {
      if (isNativeFullscreen(doc)) {
        if (typeof doc?.exitFullscreen === 'function') {
          await doc.exitFullscreen();
        } else if (typeof doc?.webkitExitFullscreen === 'function') {
          await doc.webkitExitFullscreen();
        }
      }
      screenObj?.orientation?.unlock?.();
    } catch {
      // Ignore exit/unlock rejection
    }
    return { active: false, mode: 'exited' };
  }

  if (canRequestNativeFullscreen(doc)) {
    const el = doc!.documentElement!;
    try {
      if (typeof el.requestFullscreen === 'function') {
        await el.requestFullscreen({ navigationUI: 'hide' });
      } else if (typeof el.webkitRequestFullscreen === 'function') {
        await el.webkitRequestFullscreen();
      }
      fallbackFullscreenActive = false;
      if (preferLandscape) {
        try {
          await screenObj?.orientation?.lock?.('landscape');
        } catch {
          // Orientation lock is optional and unsupported on desktop/some mobile browsers
        }
      }
      return { active: true, mode: 'native' };
    } catch {
      // Fall through to immersive viewport fallback when native fullscreen is blocked
    }
  }

  fallbackFullscreenActive = true;
  if (typeof window !== 'undefined') {
    window.scrollTo?.(0, 1);
  }
  return { active: true, mode: 'fallback' };
}
