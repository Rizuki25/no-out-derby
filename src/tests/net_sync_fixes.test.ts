import { describe, expect, it } from 'vitest';
import { createEmptyInput, MatchState, resolvePitchSizeForMode } from '../game/MatchState.ts';
import { OnlineSession, onlineConfigToMatchConfig } from '../net/OnlineSession.ts';
import type { PeerCallbacks } from '../net/NetTransport.ts';
import { buildNetSnapshot, HostRemoteInputDecoder, type NetInputPacket } from '../net/NetSnapshot.ts';
import type { OnlineRoomConfig } from '../net/SignalingTypes.ts';
import { sanitizeRelayConfig } from '../../relay-worker/src/RelayRoomCore.ts';
import { handleSignalingRequest, type RoomStore } from '../net/SignalingHandler.ts';
import type { RoomRecord } from '../net/SignalingTypes.ts';
import { ARENA_CONSTANTS, FIXED_DT } from '../types.ts';

const flush = () => new Promise((r) => setTimeout(r, 0));

const roomCfg: OnlineRoomConfig = {
  mode: '1v1_local',
  arena: 'classic',
  pitchSize: 'standard',
  controlStyle: 'dribble',
  teamAKit: 'garuda',
  teamBKit: 'cyber',
  difficulty: 'pro',
  durationSeconds: 60,
  mutatorsEnabled: false,
};

/** Minimal in-memory transport pair so both OnlineSession sides can talk to each other. */
function makeSessionPair() {
  const wire: { host: PeerCallbacks | null; guest: PeerCallbacks | null } = { host: null, guest: null };
  const hostCfg: { cfg: OnlineRoomConfig | null } = { cfg: null };

  const peer = (side: 'host' | 'guest', cb: PeerCallbacks) => {
    if (side === 'host') wire.host = cb;
    else wire.guest = cb;
    const other = () => (side === 'host' ? wire.guest : wire.host);
    return {
      transportKind: 'cloudflare-ws' as const,
      hostRoom: async (cfg: OnlineRoomConfig) => {
        hostCfg.cfg = cfg;
        cb.onConnected?.(cfg, 'cloudflare-ws');
      },
      joinRoom: async () => {
        cb.onConnected?.(hostCfg.cfg!, 'cloudflare-ws');
      },
      isDataOpen: () => true,
      sendUnreliable: (m: unknown) => other()?.onUnreliableMessage?.(m as never),
      sendReliable: (m: unknown) => other()?.onReliableMessage?.(m as never),
      close: () => {},
    };
  };

  return { wire, hostCfg, peer };
}

describe('Online guest/host physics parity', () => {
  it('guest mirrors host radius, ball mass, spin and kick power', async () => {
    const hostMatch = new MatchState(() => 0.5);
    const guestMatch = new MatchState(() => 0.5);
    const { peer } = makeSessionPair();

    const host = new OnlineSession({
      onMatchConnected: (cfg) => hostMatch.startMatch(onlineConfigToMatchConfig(cfg)),
      onRemoteEvents: () => {},
      onRemoteRematchRequested: () => {},
      onRemoteRematchStart: () => {},
      onDisconnected: () => {},
      createTransport: (cb) => peer('host', cb) as never,
    });
    const guest = new OnlineSession({
      onMatchConnected: (cfg) => guestMatch.startMatch(onlineConfigToMatchConfig(cfg)),
      onRemoteEvents: () => {},
      onRemoteRematchRequested: () => {},
      onRemoteRematchStart: () => {},
      onDisconnected: () => {},
      createTransport: (cb) => peer('guest', cb) as never,
    });

    host.startHosting(roomCfg);
    await flush();
    guest.startJoining('ABCD');
    await flush();
    expect(host.isConnected()).toBe(true);
    expect(guest.isConnected()).toBe(true);

    // Giant Ball so mass/radius clearly diverge from the defaults.
    hostMatch.mutators.activateMutator('giant_ball', hostMatch.balls, hostMatch.params, []);
    hostMatch.balls[0].spin = 1.4;
    hostMatch.balls[0].lastKickPower = 0.91;

    let now = 1000;
    for (let i = 0; i < 40; i++) {
      host.stepHostTick(FIXED_DT, createEmptyInput(), hostMatch, () => {});
      now += 16;
      guest.syncGuestRenderState(now, guestMatch);
    }

    const hostOut = hostMatch.players.find((p) => p.role === 'outfield')!;
    const guestOut = guestMatch.players.find((p) => p.role === 'outfield')!;
    const hostKeeper = hostMatch.players.find((p) => p.role === 'keeper')!;
    const guestKeeper = guestMatch.players.find((p) => p.role === 'keeper')!;

    expect(guestOut.radius).toBe(hostOut.radius);
    expect(guestKeeper.radius).toBe(hostKeeper.radius);
    expect(guestOut.radius).toBe(ARENA_CONSTANTS.PLAYER_RADIUS);
    expect(guestKeeper.radius).toBe(ARENA_CONSTANTS.KEEPER_RADIUS);
    expect(guestMatch.balls[0].mass).toBe(hostMatch.balls[0].mass);
    expect(guestMatch.balls[0].radius).toBe(hostMatch.balls[0].radius);
    expect(guestMatch.balls[0].lastKickPower).toBeGreaterThan(0.8);
  });

  it('round-trips spin through the wire snapshot', () => {
    const host = new MatchState(() => 0.5);
    host.startMatch({
      mode: '1v1_local',
      arena: 'classic',
      difficulty: 'pro',
      durationSeconds: 60,
      mutatorsEnabled: false,
      replayEnabled: false,
      controlStyle: 'dribble',
    });
    host.balls[0].spin = -1.75;
    const snap = buildNetSnapshot(host, 1, 1000, true);
    expect(snap.balls[0].sp).toBeCloseTo(-1.75, 1);

    const guest = new MatchState(() => 0.5);
    guest.startMatch({
      mode: '1v1_local',
      arena: 'classic',
      difficulty: 'pro',
      durationSeconds: 60,
      mutatorsEnabled: false,
      replayEnabled: false,
      controlStyle: 'dribble',
    });
    guest.applyRemoteSnapshot(snap);
    expect(guest.balls[0].spin).toBeCloseTo(-1.75, 1);
  });
});

describe('Online rematch keeps guest in sync', () => {
  it('guest tracks host clock across a host-initiated rematch', async () => {
    const hostMatch = new MatchState(() => 0.5);
    const guestMatch = new MatchState(() => 0.5);
    const { peer } = makeSessionPair();

    const host = new OnlineSession({
      onMatchConnected: (cfg) => hostMatch.startMatch(onlineConfigToMatchConfig(cfg)),
      onRemoteEvents: () => {},
      onRemoteRematchRequested: () => {},
      onRemoteRematchStart: () => {},
      onDisconnected: () => {},
      createTransport: (cb) => peer('host', cb) as never,
    });
    const guest = new OnlineSession({
      onMatchConnected: (cfg) => guestMatch.startMatch(onlineConfigToMatchConfig(cfg)),
      onRemoteEvents: () => {},
      onRemoteRematchRequested: () => {},
      onRemoteRematchStart: (cfg) => guestMatch.startMatch(onlineConfigToMatchConfig(cfg)),
      onDisconnected: () => {},
      createTransport: (cb) => peer('guest', cb) as never,
    });

    host.startHosting(roomCfg);
    await flush();
    guest.startJoining('ABCD');
    await flush();

    let now = 1000;
    const tick = (n: number) => {
      for (let i = 0; i < n; i++) {
        host.stepHostTick(FIXED_DT, createEmptyInput(), hostMatch, () => {});
        now += 16;
        guest.syncGuestRenderState(now, guestMatch);
      }
    };

    tick(200);
    const beforeRematch = guestMatch.timeRemaining;
    expect(beforeRematch).toBeLessThan(60);

    host.requestRematch(() => {
      hostMatch.rematch();
      host.pushHostImmediateState(hostMatch, []);
    });

    tick(300);
    // Guest must keep advancing with the host instead of freezing on the pre-rematch snapshot.
    expect(guestMatch.timeRemaining).toBeLessThan(beforeRematch - 1);
    expect(Math.abs(guestMatch.timeRemaining - hostMatch.timeRemaining)).toBeLessThan(0.2);
    expect(guestMatch.phase).toBe(hostMatch.phase);
  });
});

describe('Config validation parity between relay and signaling', () => {
  it('defaults missing or non-boolean mutatorsEnabled to ON in both paths', async () => {
    const store: RoomStore & { created: RoomRecord[] } = {
      created: [],
      isConfigured: () => true,
      getRoom: async () => null,
      createRoomIfAbsent: async (_code, record) => {
        store.created.push(record);
        return true;
      },
      setGuestAnswerIfAbsent: async () => true,
      appendCandidate: async () => {},
      deleteRoom: async () => {},
    };

    const signalingResult = async (mutatorsEnabled: unknown) => {
      store.created.length = 0;
      const res = await handleSignalingRequest(
        new Request('https://x/api/rooms', {
          method: 'POST',
          body: JSON.stringify({
            action: 'create',
            config: {
              mode: '1v1_local',
              arena: 'classic',
              pitchSize: 'standard',
              controlStyle: 'dribble',
              teamAKit: 'garuda',
              teamBKit: 'cyber',
              difficulty: 'pro',
              durationSeconds: 90,
              mutatorsEnabled,
            },
            hostOffer: { type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\n' },
          }),
        }),
        store
      );
      expect(res.status).toBe(201);
      return store.created[0].config.mutatorsEnabled;
    };

    const workerResult = (mutatorsEnabled: unknown) =>
      sanitizeRelayConfig({
        mode: '1v1_local',
        arena: 'classic',
        pitchSize: 'standard',
        controlStyle: 'dribble',
        teamAKit: 'garuda',
        teamBKit: 'cyber',
        difficulty: 'pro',
        durationSeconds: 90,
        mutatorsEnabled,
      })?.mutatorsEnabled;

    for (const raw of [true, false, undefined, null, 0, 'yes']) {
      expect(workerResult(raw), `worker for ${String(raw)}`).toBe(await signalingResult(raw));
    }
  });
});

describe('Pitch size resolution', () => {
  it('uses one rule for local, lobby and match state', () => {
    for (const mode of ['1v1_local', '2v2_local', '3v3_local', '2v2_coop', '3v3_coop'] as const) {
      expect(resolvePitchSizeForMode(mode, 'standard')).toBe('standard');
      expect(resolvePitchSizeForMode(mode, 'large')).toBe('large');
      expect(resolvePitchSizeForMode(mode, 'xl')).toBe('xl');
    }
    for (const mode of ['4v4_local', '4v4_coop', '4v4_ai', 'derby_cup_4v4'] as const) {
      expect(resolvePitchSizeForMode(mode, 'standard')).toBe('xl');
      expect(resolvePitchSizeForMode(mode, 'large')).toBe('xl');
    }
    // Unknown values fall back to standard rather than leaking through.
    expect(resolvePitchSizeForMode('1v1_local', 'massive')).toBe('standard');
    expect(resolvePitchSizeForMode('1v1_local', undefined)).toBe('standard');
  });

  it('MatchState and the online lobby agree on the resolved pitch', () => {
    const match = new MatchState(() => 0.5);
    match.startMatch({
      mode: '4v4_local',
      arena: 'classic',
      pitchSize: 'standard',
      difficulty: 'pro',
      durationSeconds: 90,
      mutatorsEnabled: false,
      replayEnabled: false,
    });
    expect(match.config.pitchSize).toBe('xl');

    const worker = sanitizeRelayConfig({
      mode: '4v4_local',
      arena: 'classic',
      pitchSize: 'standard',
      controlStyle: 'dribble',
      teamAKit: 'garuda',
      teamBKit: 'cyber',
      difficulty: 'pro',
      durationSeconds: 90,
      mutatorsEnabled: false,
    });
    expect(worker?.pitchSize).toBe(match.config.pitchSize);
  });
});

describe('Remote input decoder edge handling', () => {
  it('fires each monotonic edge counter exactly once', () => {
    const decoder = new HostRemoteInputDecoder();
    const packet = (seq: number, ks: number): NetInputPacket => ({
      t: 'in',
      seq,
      mx: 0,
      my: 0,
      kh: false,
      ks,
      ds: 0,
      ss: 0,
      ps: 0,
      fs: 0,
      ts: 0,
    });

    decoder.ingest(packet(1, 1));
    expect(decoder.consumeTick().input.kickJustReleased).toBe(true);
    expect(decoder.consumeTick().input.kickJustReleased).toBe(false);

    // Duplicate / out-of-order packet must not re-fire the edge.
    decoder.ingest(packet(1, 1));
    expect(decoder.consumeTick().input.kickJustReleased).toBe(false);

    decoder.ingest(packet(2, 2));
    expect(decoder.consumeTick().input.kickJustReleased).toBe(true);
  });
});
