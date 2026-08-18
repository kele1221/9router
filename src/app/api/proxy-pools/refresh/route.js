import { NextResponse } from "next/server";
import {
  createProxyPool,
  deleteProxyPool,
  getProviderConnections,
  getProxyPools,
  updateProxyPool,
} from "@/models";
import { ProxyAgent, fetch as undiciFetch } from "undici";

const POOL_SOURCE =
  "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all";
const PROBE_URL = "https://opencode.ai/zen/v1/models";
const NAME_PREFIX = "ps-free-";
const DEFAULT_LIMIT = 60;
const PROBE_TIMEOUT_MS = 8000;
const CONCURRENCY = 12;

function normalizeAddr(line) {
  const addr = String(line || "").trim();
  return /^\d{1,3}(\.\d{1,3}){3}:\d{2,5}$/.test(addr) ? addr : null;
}

async function probe(addr) {
  let dispatcher;
  try {
    dispatcher = new ProxyAgent({ uri: `http://${addr}` });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await undiciFetch(PROBE_URL, {
        method: "GET",
        dispatcher,
        signal: controller.signal,
        headers: { Accept: "application/json" },
        redirect: "follow",
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  } finally {
    try {
      await dispatcher?.close?.();
    } catch {}
  }
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await fn(items[index]);
      }
    })
  );
  return results;
}

export async function POST() {
  try {
    const listRes = await fetch(POOL_SOURCE, { signal: AbortSignal.timeout(20000) });
    if (!listRes.ok) {
      return NextResponse.json({ error: `proxyscrape returned ${listRes.status}` }, { status: 502 });
    }
    const text = await listRes.text();
    const candidates = [
      ...new Set(
        text
          .split(/\r?\n/)
          .map(normalizeAddr)
          .filter(Boolean)
      ),
    ].slice(0, DEFAULT_LIMIT);

    if (candidates.length === 0) {
      return NextResponse.json({ error: "No proxy candidates from proxyscrape" }, { status: 502 });
    }

    const results = await mapLimit(candidates, CONCURRENCY, async (addr) => ({
      addr,
      ok: await probe(addr),
    }));
    const alive = results.filter((r) => r.ok).map((r) => r.addr);

    const pools = await getProxyPools();
    const byUrl = new Map(pools.map((p) => [String(p.proxyUrl || "").replace(/^https?:\/\//, ""), p]));
    const connections = await getProviderConnections();
    const boundIds = new Set(
      connections
        .map((c) => c?.providerSpecificData?.proxyPoolId)
        .filter(Boolean)
    );

    let created = 0;
    let kept = 0;
    let removed = 0;

    for (const addr of alive) {
      const existing = byUrl.get(addr);
      if (existing) {
        if (!existing.isActive || existing.testStatus !== "active") {
          await updateProxyPool(existing.id, {
            isActive: true,
            testStatus: "active",
            lastTestedAt: new Date().toISOString(),
            lastError: null,
          });
        }
        kept++;
      } else {
        await createProxyPool({
          name: `${NAME_PREFIX}${addr.replace(":", "-")}`,
          proxyUrl: `http://${addr}`,
          type: "http",
          isActive: true,
          testStatus: "active",
          lastTestedAt: new Date().toISOString(),
        });
        created++;
      }
    }

    for (const pool of pools) {
      if (!String(pool.name || "").startsWith(NAME_PREFIX)) continue;
      const addr = String(pool.proxyUrl || "").replace(/^https?:\/\//, "");
      if (alive.includes(addr)) continue;
      if (boundIds.has(pool.id)) {
        if (pool.isActive) await updateProxyPool(pool.id, { isActive: false });
        continue;
      }
      await deleteProxyPool(pool.id);
      removed++;
    }

    return NextResponse.json({
      ok: true,
      candidates: candidates.length,
      alive: alive.length,
      created,
      kept,
      removed,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
