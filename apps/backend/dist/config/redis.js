"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Redis = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
exports.Redis = ioredis_1.default;
const redis_1 = require("@upstash/redis");
const sanitizeUrl = (url) => {
    if (!url)
        return "";
    let trimmed = url.trim();
    if (trimmed.startsWith("hhttps://")) {
        trimmed = trimmed.replace(/^h+https:\/\//, "https://");
    }
    return trimmed;
};
const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const rawUpstashUrl = process.env.UPSTASH_REDIS_REST_URL;
const upstashUrl = sanitizeUrl(rawUpstashUrl);
const upstashToken = (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
class MockRedis {
    store = new Map();
    async get(key) {
        return this.store.get(key) || null;
    }
    async set(key, value) {
        this.store.set(key, value);
        return "OK";
    }
    async setex(key, seconds, value) {
        this.store.set(key, value);
        setTimeout(() => this.store.delete(key), seconds * 1000);
        return "OK";
    }
    async ping() {
        return "PONG (In-Memory Mock Mode)";
    }
    on(event, callback) {
        if (event === "connect") {
            setTimeout(() => callback(), 50);
        }
        return this;
    }
    disconnect() { }
}
let activeClient;
try {
    // Try Upstash REST API first if credentials are available
    if (upstashUrl && upstashToken) {
        try {
            activeClient = new redis_1.Redis({
                url: upstashUrl,
                token: upstashToken,
            });
            console.log(`[Redis] REAL UPSTASH REDIS connected successfully (${upstashUrl}).`);
        }
        catch (upstashError) {
            console.warn("[Redis] Upstash connection failed:", upstashError?.message || upstashError);
            throw upstashError;
        }
    }
    else {
        // Fall back to standard Redis connection
        console.log(`[Redis] Connecting to standard Redis at ${redisUrl}...`);
        activeClient = new ioredis_1.default(redisUrl, {
            maxRetriesPerRequest: 1,
            connectTimeout: 1500,
        });
        activeClient.on("error", (err) => {
            if (!(activeClient instanceof MockRedis)) {
                console.warn("[Redis] Standard Redis connection failed. Falling back to IN-MEMORY MOCK REDIS.");
                const oldClient = activeClient;
                activeClient = new MockRedis();
                try {
                    oldClient.disconnect();
                }
                catch (e) {
                    // ignore error during disconnect
                }
            }
        });
    }
}
catch (error) {
    console.warn("[Redis] Initialization failed. Falling back to IN-MEMORY MOCK REDIS cache.");
    activeClient = new MockRedis();
}
// Proxy wrapper to expose the active client dynamically to all modules importing it
const proxy = new Proxy({}, {
    get(target, prop) {
        const value = activeClient[prop];
        if (typeof value === "function") {
            return function (...args) {
                return value.apply(activeClient, args);
            };
        }
        return value;
    }
});
exports.default = proxy;
