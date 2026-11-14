import { describe, expect, it } from 'vitest';
import {
  RelayRoomEngine,
  type RelayRoomHost,
  type RelaySocketHandle,
  type RoomSocketAttachment,
  routeRelayWorkerRequest,
} from '../../relay-worker/src/RelayRoomCore.ts';
import { createEmptyInput, MatchState } from '../game/MatchState.ts';
import { type NetInputPacket, type NetReliableMessage, type NetStateSnapshot } from '../net/NetSnapshot.ts';
import type { NetPeerTransport, PeerCallbacks, TransportKind } from '../net/NetTransport.ts';
import { OnlineSession } from '../net/OnlineSession.ts';
import type { OnlineRoomConfig } from '../net/SignalingTypes.ts';

class MockRelaySocket implements RelaySocketHandle {
  sent: Array<string | ArrayBuffer> = [];
  closedWith: { code?: number; reason?: string } | null = null;
  accepted = false;
  tags: string[] = [];
  attachment: RoomSocketAttachment | null = null;

  send(data: string | ArrayBuffer): void {
    this.sent.push(data);
  }
  close(code?: number, reason?: string): void {
    this.closedWith = { code, reason };
  }
  getAttachment(): RoomSocketAttachment | null {
    return this.attachment ? structuredClone(this.attachment) : null;
  }
  setAttachment(att: RoomSocketAttachment): void {
    this.attachment = structuredClone(att);
  }
}

class MockDurableHost implements RelayRoomHost {
  sockets: MockRelaySocket[] = [];
  rejected: MockRelaySocket[] = [];

  acceptSocket(socket: RelaySocketHandle, tags: string[]): void {
    const ms = socket as MockRelaySocket;
    ms.accepted = true;
    ms.tags = [...tags];
    if (!this.sockets.includes(ms)) this.sockets.push(ms);
  }

  getSockets(tag?: string): RelaySocketHandle[] {
    const open = this.sockets.filter((s) => s.closedWith === null);
    if (!tag) return open;
    return open.filter((s) => s.tags.includes(tag));
  }
}

const SAMPLE_CFG: OnlineRoomConfig = {
  mode: '2v2_local',
  arena: 'classic',
  pitchSize: 'standard',
  controlStyle: 'dribble',
  teamAKit: 'garuda',
  teamBKit: 'cyber',
  difficulty: 'pro',
  durationSeconds: 90,
  mutatorsEnabled: false,
};

describe('Cloudflare Durable Object RelayRoomEngine', () => {
  it('routes CORS preflight, health check, and room code validation cleanly', async () => {
    const cors = await routeRelayWorkerRequest(new Request('https://relay.test/ws', { method: 'OPTIONS' }), {
      getRoomStatus: async () => new Response('ok'),
      connectWebSocket: async () => new Response('ok'),
    });
    expect(cors.status).toBe(204);
    expect(cors.headers.get('Access-Control-Allow-Origin')).toBe('*');

    const health = await routeRelayWorkerRequest(new Request('https://relay.test/health'), {
      getRoomStatus: async () => new Response('ok'),
      connectWebSocket: async () => new Response('ok'),
    });
    expect(health.status).toBe(200);
    const body = (await health.json()) as { ok: boolean; transport: string };
    expect(body.ok).toBe(true);
    expect(body.transport).toBe('cloudflare-do-ws');

    const badRoom = await routeRelayWorkerRequest(new Request('https://relay.test/room/BAD!'), {
      getRoomStatus: async () => new Response('ok'),
      connectWebSocket: async () => new Response('ok'),
    });
    expect(badRoom.status).toBe(400);
  });

  it('handles room creation, collision, preview, guest join, hibernation reload, relay, and leave', async () => {
    const durableHost = new MockDurableHost();
    let engine = new RelayRoomEngine(durableHost);

    // Room status before Host connects -> 404
    const before = engine.handleStatusHttp('K7M9');
    expect(before.status).toBe(404);

    // Host connects
    const hostWs = new MockRelaySocket();
    const cfgJson = encodeURIComponent(JSON.stringify(SAMPLE_CFG));
    const hostReject = engine.handleWebSocketConnect(
      new URL(`https://relay.test/ws?code=K7M9&role=host&cfg=${cfgJson}`),
      hostWs,
      (s) => durableHost.rejected.push(s as MockRelaySocket)
    );
    expect(hostReject).toBeNull();
    expect(hostWs.accepted).toBe(true);
    expect(JSON.parse(String(hostWs.sent[0]))).toMatchObject({ t: 'sys_ready', code: 'K7M9' });

    // Room collision -> second Host rejected cleanly with ROOM_TAKEN
    const rivalHost = new MockRelaySocket();
    const taken = engine.handleWebSocketConnect(
      new URL(`https://relay.test/ws?code=K7M9&role=host&cfg=${cfgJson}`),
      rivalHost,
      (s) => durableHost.rejected.push(s as MockRelaySocket)
    );
    expect(taken?.code).toBe('ROOM_TAKEN');
    expect(rivalHost.closedWith?.code).toBe(4009);

    // Room status preview shows not full + valid config
    const openStatus = engine.handleStatusHttp('K7M9');
    expect(openStatus.status).toBe(200);
    const openData = (await openStatus.json()) as { full: boolean; config: OnlineRoomConfig };
    expect(openData.full).toBe(false);
    expect(openData.config.mode).toBe('2v2_local');

    // Guest connects
    const guestWs = new MockRelaySocket();
    const guestReject = engine.handleWebSocketConnect(
      new URL('https://relay.test/ws?code=K7M9&role=guest'),
      guestWs,
      (s) => durableHost.rejected.push(s as MockRelaySocket)
    );
    expect(guestReject).toBeNull();
    expect(JSON.parse(String(guestWs.sent[0]))).toMatchObject({ t: 'sys_joined', code: 'K7M9' });
    expect(JSON.parse(String(hostWs.sent[1]))).toMatchObject({ t: 'sys_joined', code: 'K7M9' });

    // Third player trying to join full room is rejected with ROOM_FULL
    const extraGuest = new MockRelaySocket();
    const fullReject = engine.handleWebSocketConnect(
      new URL('https://relay.test/ws?code=K7M9&role=guest'),
      extraGuest,
      (s) => durableHost.rejected.push(s as MockRelaySocket)
    );
    expect(fullReject?.code).toBe('ROOM_FULL');

    // Simulate Durable Object wake-up after hibernation (fresh engine instance, only attachments survive)
    engine = new RelayRoomEngine(durableHost);

    // Heartbeat 'hb' replies locally with 'hb_ack' and is never forwarded to peer
    engine.handleWebSocketMessage(hostWs, 'hb');
    expect(hostWs.sent[hostWs.sent.length - 1]).toBe('hb_ack');
    expect(guestWs.sent).toHaveLength(1);

    // Guest -> Host input relay, Host -> Guest state relay
    engine.handleWebSocketMessage(guestWs, '{"t":"in","seq":1}');
    expect(hostWs.sent[hostWs.sent.length - 1]).toBe('{"t":"in","seq":1}');
    engine.handleWebSocketMessage(hostWs, '{"t":"st","seq":2}');
    expect(guestWs.sent[guestWs.sent.length - 1]).toBe('{"t":"st","seq":2}');

    // Host disconnects -> Guest gets sys_peer_left and is closed
    engine.handleWebSocketClose(hostWs, 1000, 'USER_LEAVE');
    expect(JSON.parse(String(guestWs.sent[guestWs.sent.length - 1]))).toMatchObject({
      t: 'sys_peer_left',
      role: 'host',
    });
    expect(guestWs.closedWith).not.toBeNull();
  });
});

describe('OnlineSession bandwidth throttling & event payload trimming', () => {
  async function createMockTransportSession(role: 'host' | 'guest') {
    const unreliableSent: Array<NetInputPacket | NetStateSnapshot | { t: string; ts: number }> = [];
    const reliableSent: NetReliableMessage[] = [];
    let callbacksRef: PeerCallbacks = {};

    const transport: NetPeerTransport = {
      transportKind: 'cloudflare-ws' satisfies TransportKind,
      async hostRoom(cfg) {
        callbacksRef.onRoomCodeReady?.('TEST');
        callbacksRef.onConnected?.(cfg, 'cloudflare-ws');
      },
      async joinRoom() {
        callbacksRef.onConnected?.(SAMPLE_CFG, 'cloudflare-ws');
      },
      isDataOpen: () => true,
      sendUnreliable(msg) {
        unreliableSent.push(msg);
      },
      sendReliable(msg) {
        reliableSent.push(msg);
      },
      close() {},
    };

    const session = new OnlineSession({
      onMatchConnected: () => {},
      onRemoteEvents: () => {},
      onRemoteRematchRequested: () => {},
      onRemoteRematchStart: () => {},
      onDisconnected: () => {},
      createTransport: (cbs) => {
        callbacksRef = cbs;
        return transport;
      },
    });

    if (role === 'host') session.startHosting(SAMPLE_CFG);
    else session.startJoining('TEST');

    await new Promise((r) => setTimeout(r, 0));
    return { session, unreliableSent, reliableSent };
  }

  it('sends Guest input immediately on button/move transitions while throttling idle repeats', async () => {
    const { session, unreliableSent } = await createMockTransportSession('guest');
    expect(session.isConnected()).toBe(true);

    // First idle tick transmits immediately
    session.sendGuestInput(createEmptyInput(), null, 1 / 60);
    expect(unreliableSent).toHaveLength(1);

    // Next 8 unchanged idle frames (133ms < 200ms heartbeat) are skipped
    for (let i = 0; i < 8; i++) {
      session.sendGuestInput(createEmptyInput(), null, 1 / 60);
    }
    expect(unreliableSent).toHaveLength(1);

    // Starting movement sends immediately
    session.sendGuestInput({ ...createEmptyInput(), moveX: 1 }, null, 1 / 60);
    expect(unreliableSent).toHaveLength(2);

    // Holding exact movement skips duplicate frames until heartbeat (200ms)
    for (let i = 0; i < 10; i++) {
      session.sendGuestInput({ ...createEmptyInput(), moveX: 1 }, null, 1 / 60);
    }
    expect(unreliableSent).toHaveLength(2);

    // Pressing an edge button (dash/kick/pass) always sends on the exact frame
    session.sendGuestInput({ ...createEmptyInput(), moveX: 1, kickJustReleased: true }, null, 1 / 60);
    expect(unreliableSent).toHaveLength(3);
    expect((unreliableSent[2] as NetInputPacket).ks).toBe(1);

    // Stopping movement sends immediately
    session.sendGuestInput(createEmptyInput(), null, 1 / 60);
    expect(unreliableSent).toHaveLength(4);

    // Holding idle past 200ms fires 1 heartbeat packet
    for (let i = 0; i < 13; i++) {
      session.sendGuestInput(createEmptyInput(), null, 1 / 60);
    }
    expect(unreliableSent).toHaveLength(5);
  });

  it('avoids attaching full snapshots on minor field events while attaching on phase/goal transitions', async () => {
    const { session, reliableSent, unreliableSent } = await createMockTransportSession('host');
    expect(session.isConnected()).toBe(true);

    const match = new MatchState();
    match.startMatch({
      mode: '1v1_local',
      arena: 'classic',
      pitchSize: 'standard',
      controlStyle: 'dribble',
      difficulty: 'pro',
      durationSeconds: 90,
      mutatorsEnabled: false,
    });
    match.phase = 'PLAYING';

    // First tick sees MENU -> PLAYING phaseChanged -> includes full snapshot reliably
    session.stepHostTick(1 / 60, createEmptyInput(), match, () => {});
    expect(reliableSent).toHaveLength(1);
    const firstEv = reliableSent[0] as Extract<NetReliableMessage, { t: 'events' }>;
    expect(firstEv.snapshot).toBeDefined();

    // Place ball at P1's feet and trigger a kick -> emits minor event WITHOUT heavy snapshot
    const p1 = match.players[0];
    const ball = match.balls[0];
    ball.carrierId = p1.id;
    ball.x = p1.x + 6;
    ball.y = p1.y;
    session.stepHostTick(1 / 60, { ...createEmptyInput(), kickJustReleased: true }, match, () => {});
    const kickMsg = reliableSent.find(
      (m): m is Extract<NetReliableMessage, { t: 'events' }> =>
        m.t === 'events' && m.events.some((ev) => ev.type === 'kick')
    );
    expect(kickMsg).toBeDefined();
    expect(kickMsg?.snapshot).toBeUndefined();

    // Regular ticks without phase changes emit ~22Hz snapshots on unreliable stream, never spamming reliable
    const reliableCountBefore = reliableSent.length;
    for (let i = 0; i < 60; i++) {
      session.stepHostTick(1 / 60, createEmptyInput(), match, () => {});
    }
    expect(reliableSent.length).toBe(reliableCountBefore);
    expect(unreliableSent.length).toBeGreaterThanOrEqual(20);
    expect(unreliableSent.length).toBeLessThanOrEqual(25);
  });
});
