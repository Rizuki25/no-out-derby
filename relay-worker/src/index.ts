import { DurableObject } from 'cloudflare:workers';
import {
  RelayRoomEngine,
  type RelaySocketHandle,
  type RoomSocketAttachment,
  routeRelayWorkerRequest,
} from './RelayRoomCore.js';

export interface Env {
  RELAY_ROOMS: DurableObjectNamespace<RelayRoom>;
}

const socketHandles = new WeakMap<WebSocket, RelaySocketHandle>();

function wrapWebSocket(ws: WebSocket): RelaySocketHandle {
  const existing = socketHandles.get(ws);
  if (existing) return existing;

  const handle: RelaySocketHandle = {
    send(data) {
      ws.send(data);
    },
    close(code, reason) {
      if (typeof code === 'number') {
        ws.close(code, reason);
      } else {
        ws.close();
      }
    },
    getAttachment() {
      const att = ws.deserializeAttachment();
      return (att && typeof att === 'object' ? att : null) as RoomSocketAttachment | null;
    },
    setAttachment(attachment) {
      ws.serializeAttachment(attachment);
    },
  };
  socketHandles.set(ws, handle);
  return handle;
}

export class RelayRoom extends DurableObject<Env> {
  private readonly rawSockets = new WeakMap<RelaySocketHandle, WebSocket>();
  private readonly engine: RelayRoomEngine;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('hb', 'hb_ack'));

    this.engine = new RelayRoomEngine({
      acceptSocket: (socket, tags) => {
        const ws = this.rawSockets.get(socket);
        if (ws) {
          this.ctx.acceptWebSocket(ws, tags);
        }
      },
      getSockets: (tag) => {
        const list = tag ? this.ctx.getWebSockets(tag) : this.ctx.getWebSockets();
        return list.map((ws) => {
          const handle = wrapWebSocket(ws);
          this.rawSockets.set(handle, ws);
          return handle;
        });
      },
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/status') {
      const code = url.searchParams.get('code') || '';
      return this.engine.handleStatusHttp(code);
    }

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const serverHandle = wrapWebSocket(server);
    this.rawSockets.set(serverHandle, server);

    this.engine.handleWebSocketConnect(url, serverHandle, () => {
      server.accept();
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    this.engine.handleWebSocketMessage(wrapWebSocket(ws), message);
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean
  ): Promise<void> {
    this.engine.handleWebSocketClose(wrapWebSocket(ws), code, reason);
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    this.engine.handleWebSocketClose(wrapWebSocket(ws), 1011, 'WS_ERROR');
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return routeRelayWorkerRequest(request, {
      getRoomStatus: async (code) => {
        const id = env.RELAY_ROOMS.idFromName(code);
        const stub = env.RELAY_ROOMS.get(id);
        return stub.fetch(new Request(`https://relay.internal/status?code=${encodeURIComponent(code)}`));
      },
      connectWebSocket: async (code, req) => {
        const id = env.RELAY_ROOMS.idFromName(code);
        const stub = env.RELAY_ROOMS.get(id);
        return stub.fetch(req);
      },
    });
  },
};
