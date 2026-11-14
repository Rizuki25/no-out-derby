import { handleSignalingRequest } from '../src/net/SignalingHandler';
import { createUpstashRoomStore } from '../src/net/UpstashRoomStore';

let cachedStore: ReturnType<typeof createUpstashRoomStore> | null = null;

function getStore() {
  if (!cachedStore) {
    const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
    cachedStore = createUpstashRoomStore(url, token);
  }
  return cachedStore;
}

export default {
  async fetch(request: Request): Promise<Response> {
    return handleSignalingRequest(request, getStore());
  },
};
