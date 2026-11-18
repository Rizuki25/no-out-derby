import type { GameEvent, PlayerInput, TeamTactic } from '../types.ts';
import type { MatchState } from '../game/MatchState.ts';
import type { OnlineController, OnlineControllerDeps } from './OnlineFeatureTypes.ts';
import { OnlineLobbyUI } from './OnlineLobbyUI.ts';
import { onlineConfigToMatchConfig, OnlineSession } from './OnlineSession.ts';

export type { OnlineController, OnlineControllerDeps } from './OnlineFeatureTypes.ts';

/** Standard online multiplayer controller used in web/Vercel builds. */
export function createOnlineController(deps: OnlineControllerDeps): OnlineController {
  let session!: OnlineSession;

  const lobbyUI = new OnlineLobbyUI({
    getMenuConfig: deps.getMenuConfig,
    onStartHost: (cfg) => session.startHosting(cfg),
    onStartJoin: (code) => session.startJoining(code),
    onCancelPending: deps.onCancelPending,
    onCloseModal: deps.onCloseModal,
    onPlayBlip: deps.onPlayBlip,
  });

  session = new OnlineSession({
    onLobbyStateChange: (phase, detail) => lobbyUI.onPhaseChange(phase, detail),
    onRoomCodeReady: (code) => lobbyUI.onRoomCodeReady(code),
    onLobbyError: (_code, message) => lobbyUI.onError(message),
    onMatchConnected: (cfg, role, transport) => {
      lobbyUI.close(false);
      deps.onMatchConnected(
        onlineConfigToMatchConfig(cfg, deps.getMenuConfig().displayMode ?? 'auto'),
        role,
        transport
      );
    },
    onRemoteEvents: deps.onRemoteEvents,
    onRemoteRematchRequested: deps.onRemoteRematchRequested,
    onRemoteRematchStart: (cfg) => {
      deps.onRemoteRematchStart(
        onlineConfigToMatchConfig(cfg, deps.getMenuConfig().displayMode ?? 'auto')
      );
    },
    onDisconnected: deps.onDisconnected,
  });

  return {
    isLobbyOpen: () => lobbyUI.isOpen(),
    openLobby: (prefillCode?: string) => lobbyUI.open(prefillCode),
    closeLobby: (notifyCancel = true) => lobbyUI.close(notifyCancel),
    isActive: () => session.isActive(),
    isConnected: () => session.isConnected(),
    getRole: () => session.getRole(),
    getLocalHumanSlot: () => session.getLocalHumanSlot(),
    getLocalTeam: () => session.getLocalTeam(),
    getDisconnectNotice: () => session.getDisconnectNotice(),
    getStatusBadge: () => session.getStatusBadge(),
    disconnect: (notifyPeer = true) => session.disconnect(notifyPeer),
    pushHostImmediateState: (match: MatchState, events: GameEvent[]) =>
      session.pushHostImmediateState(match, events),
    requestRematch: (onHostExecute: () => void) => session.requestRematch(onHostExecute),
    stepHostTick: (
      dt: number,
      localInput: PlayerInput,
      match: MatchState,
      onEvents: (evs: GameEvent[]) => void
    ) => session.stepHostTick(dt, localInput, match, onEvents),
    sendGuestInput: (localInput: PlayerInput, directTactic?: TeamTactic | null, dt?: number) =>
      session.sendGuestInput(localInput, directTactic, dt),
    syncGuestRenderState: (nowMs: number, match: MatchState) =>
      session.syncGuestRenderState(nowMs, match),
  };
}
