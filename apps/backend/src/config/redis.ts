import Redis from "ioredis";
import { Redis as UpstashRedis } from "@upstash/redis";

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

class MockRedis {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) || null;
  }

  async set(key: string, value: string): Promise<string> {
    this.store.set(key, value);
    return "OK";
  }

  async setex(key: string, seconds: number, value: string): Promise<string> {
    this.store.set(key, value);
    setTimeout(() => this.store.delete(key), seconds * 1000);
    return "OK";
  }

  async ping(): Promise<string> {
    return "PONG (In-Memory Mock Mode)";
  }

  on(event: string, callback: (...args: any[]) => void): this {
    if (event === "connect") {
      setTimeout(() => callback(), 50);
    }
    return this;
  }

  disconnect() {}
}

let activeClient: any;

try {
  // Try Upstash REST API first if credentials are available
  if (upstashUrl && upstashToken) {
    try {
      activeClient = new UpstashRedis({
        url: upstashUrl,
        token: upstashToken,
      });
      console.log("[Redis] Connected to Upstash REST API successfully.");
    } catch (upstashError) {
      console.warn("[Redis] Upstash connection failed. Trying standard Redis...");
      throw upstashError;
    }
  } else {
    // Fall back to standard Redis connection
    activeClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 1500,
    });

    activeClient.on("error", (err: any) => {
      if (!(activeClient instanceof MockRedis)) {
        console.warn("[Redis] Connection failed. Falling back to local in-memory Mock Redis cache.");
        const oldClient = activeClient;
        activeClient = new MockRedis();
        try {
          oldClient.disconnect();
        } catch (e) {
          // ignore error during disconnect
        }
      }
    });
  }
} catch (error) {
  console.warn("[Redis] Initialization failed. Falling back to local in-memory Mock Redis cache.");
  activeClient = new MockRedis();
}

// Proxy wrapper to expose the active client dynamically to all modules importing it
const proxy = new Proxy({} as any, {
  get(target, prop) {
    const value = activeClient[prop];
    if (typeof value === "function") {
      return function (...args: any[]) {
        return value.apply(activeClient, args);
      };
    }
    return value;
  }
});

export default proxy;
export { Redis };
