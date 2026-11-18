import type { GameEvent, MatchConfig, PlayerInput, Team, TeamTactic } from '../types.ts';
import type { MatchState } from '../game/MatchState.ts';
import type { OnlineStatusBadge } from './OnlineSession.ts';
import type { TransportKind } from './NetTransport.ts';

export interface OnlineControllerDeps {
  getMenuConfig: () => MatchConfig;
  onCancelPending: () => void;
  onCloseModal: () => void;
  onPlayBlip: (confirm: boolean) => void;
  onMatchConnected: (
    matchConfig: MatchConfig,
    role: 'host' | 'guest',
    transport: TransportKind
  ) => void;
  onRemoteEvents: (events: GameEvent[]) => void;
  onRemoteRematchRequested: () => void;
  onRemoteRematchStart: (matchConfig: MatchConfig) => void;
  onDisconnected: (reason: string) => void;
}

export interface OnlineController {
  isLobbyOpen(): boolean;
  openLobby(prefillCode?: string): void;
  closeLobby(notifyCancel?: boolean): void;
  isActive(): boolean;
  isConnected(): boolean;
  getRole(): 'host' | 'guest' | null;
  getLocalHumanSlot(): 1 | 2 | null;
  getLocalTeam(): Team;
  getDisconnectNotice(): string | null;
  getStatusBadge(): OnlineStatusBadge;
  disconnect(notifyPeer?: boolean): void;
  pushHostImmediateState(match: MatchState, events: GameEvent[]): void;
  requestRematch(onHostExecute: () => void): 'started' | 'requested' | 'disabled';
  stepHostTick(
    dt: number,
    localInput: PlayerInput,
    match: MatchState,
    onEvents: (evs: GameEvent[]) => void
  ): void;
  sendGuestInput(localInput: PlayerInput, directTactic?: TeamTactic | null, dt?: number): void;
  syncGuestRenderState(nowMs: number, match: MatchState): boolean;
}
