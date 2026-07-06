import redis from "../config/redis";

// ── Coalesced Redis write buffer ──────────────────────────────────────────────
//
// Phase 6: the tick hot path used to issue 2-3 individual Upstash REST calls per
// tick (~800 HTTP requests/sec at peak market load). Each call is a separate
// HTTPS request; under load undici opened ~14k parallel sockets, starving the
// OS of ephemeral ports (which then broke MongoDB Atlas connectivity) and piling
// up pending promises until the heap OOM'd (see PHASE5_VALIDATION_REPORT.md §9).
//
// This buffer keeps only the LATEST value per key in memory and flushes all
// dirty keys in ONE pipelined request every FLUSH_INTERVAL_MS. Last-write-wins
// per key — identical semantics for the ltp:/oi: cache keys, whose readers
// (ATM seeding, OI warmup, indicator evaluation, monitoring) only ever want the
// most recent value. Memory is bounded by the number of distinct keys
// (~2 per subscribed instrument).

const FLUSH_INTERVAL_MS = 500;

interface PendingWrite {
  value: string;
  ttlSeconds?: number; // present → SETEX, absent → SET
}

const dirty = new Map<string, PendingWrite>();
// Mirror of the latest buffered value per key, kept after flush so hot readers
// can consult memory instead of issuing a REST GET.
const mirror = new Map<string, string>();

let flushing = false;
let flushTimer: NodeJS.Timeout | null = null;

// Telemetry for the Phase 6 before/after report and the periodic stats line.
let commandsBuffered = 0;
let commandsSent = 0;
let flushCount = 0;
let lastErrorLogTs = 0;

export const bufferSet = (key: string, value: string) => {
  commandsBuffered++;
  dirty.set(key, { value });
  mirror.set(key, value);
};

export const bufferSetex = (key: string, ttlSeconds: number, value: string) => {
  commandsBuffered++;
  dirty.set(key, { value, ttlSeconds });
  mirror.set(key, value);
};

/** Latest buffered value for a key (undefined if never written this session). */
export const getBufferedValue = (key: string): string | undefined => mirror.get(key);

export const getWriteBufferStats = () => ({
  commandsBuffered,
  commandsSent,
  flushCount,
  dirtyKeys: dirty.size,
  mirrorKeys: mirror.size,
});

const flush = async () => {
  if (flushing || dirty.size === 0) return;
  flushing = true;

  // Snapshot + clear so ticks arriving during the flush are captured next cycle.
  const batch = new Map(dirty);
  dirty.clear();

  try {
    const pipelineFn = (redis as any).pipeline;
    if (typeof pipelineFn === "function") {
      // Upstash SDK and ioredis both support pipeline(): one HTTP request /
      // one socket round-trip for the whole batch.
      const p = (redis as any).pipeline();
      for (const [key, w] of batch) {
        if (w.ttlSeconds !== undefined) p.setex(key, w.ttlSeconds, w.value);
        else p.set(key, w.value);
      }
      await p.exec();
    } else {
      // MockRedis fallback — sequential, but volume is already coalesced.
      for (const [key, w] of batch) {
        if (w.ttlSeconds !== undefined) await redis.setex(key, w.ttlSeconds, w.value);
        else await redis.set(key, w.value);
      }
    }
    commandsSent += batch.size;
    flushCount++;
  } catch (err: any) {
    // Re-mark failed keys dirty (unless a newer value already superseded them)
    // so the next cycle retries. Bounded: key space is small and fixed.
    for (const [key, w] of batch) {
      if (!dirty.has(key)) dirty.set(key, w);
    }
    const now = Date.now();
    if (now - lastErrorLogTs > 30_000) {
      lastErrorLogTs = now;
      console.warn(`[RedisBuffer] Flush failed (${batch.size} keys, will retry): ${err?.message || err}`);
    }
  } finally {
    flushing = false;
  }
};

export const startRedisWriteBuffer = () => {
  if (flushTimer) return;
  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
  console.log(`[RedisBuffer] Coalesced write buffer active — flushing dirty keys every ${FLUSH_INTERVAL_MS}ms in one pipelined request.`);
};

export const stopRedisWriteBuffer = () => {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
};

// Start immediately on module load — the buffer is a pure infrastructure layer
// and must be running before the first tick arrives.
startRedisWriteBuffer();
