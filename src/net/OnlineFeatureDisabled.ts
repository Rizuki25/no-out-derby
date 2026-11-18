import type { OnlineController, OnlineControllerDeps } from './OnlineFeatureTypes.ts';
import type { OnlineStatusBadge } from './OnlineSession.ts';

export type { OnlineController, OnlineControllerDeps } from './OnlineFeatureTypes.ts';

const OFFLINE_STATUS_BADGE: OnlineStatusBadge = {
  active: false,
  role: null,
  transport: null,
  localHumanSlot: null,
  localTeam: 'A',
  roomCode: null,
  pingMs: null,
  peerWantsRematch: false,
  localWantsRematch: false,
  disconnectNotice: null,
};

/**
 * CrazyGames build stub: eliminates OnlineLobbyUI, WebRTC, WebSockets, and signaling endpoints
 * completely from the production bundle when `VITE_CRAZYGAMES=true`.
 */
export function createOnlineController(_deps: OnlineControllerDeps): OnlineController {
  return {
    isLobbyOpen: () => false,
    openLobby: () => undefined,
    closeLobby: () => undefined,
    isActive: () => false,
    isConnected: () => false,
    getRole: () => null,
    getLocalHumanSlot: () => null,
    getLocalTeam: () => 'A',
    getDisconnectNotice: () => null,
    getStatusBadge: () => ({ ...OFFLINE_STATUS_BADGE }),
    disconnect: () => undefined,
    pushHostImmediateState: () => undefined,
    requestRematch: () => 'disabled',
    stepHostTick: () => undefined,
    sendGuestInput: () => undefined,
    syncGuestRenderState: () => false,
  };
}
