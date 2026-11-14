import { handleSignalingRequest } from '../src/net/SignalingHandler.js';
import { createUpstashRoomStore } from '../src/net/UpstashRoomStore.js';

let cachedStore: ReturnType<typeof createUpstashRoomStore> | null = null;
let cachedCredKey = '';

function getStore() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
  const key = `${url}\0${token}`;
  if (!cachedStore || key !== cachedCredKey) {
    cachedCredKey = key;
    cachedStore = createUpstashRoomStore(url || undefined, token || undefined);
  }
  return cachedStore;
}

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      return await handleSignalingRequest(request, getStore());
    } catch (err) {
      console.error('[api/rooms] signaling handler error:', err);
      return new Response(
        JSON.stringify({
          error: 'SIGNALING_INTERNAL_ERROR',
          message: 'Kesalahan internal server signaling.',
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store, max-age=0',
          },
        }
      );
    }
  },
};
