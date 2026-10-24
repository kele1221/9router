import dns from "dns";

// Public resolvers, matching src/lib/tunnel/shared/dnsResolver.js — it forces
// these to bypass mDNSResponder's negative cache. This probe adds the timing
// that shared helper discards.
const resolver = new dns.promises.Resolver();
resolver.setServers(["1.1.1.1", "1.0.0.1", "8.8.8.8"]);

export async function probeDns(hostname, timeoutMs = 3000) {
  const startedAt = Date.now();
  try {
    await Promise.race([
      resolver.resolve4(hostname),
      new Promise((_, rej) => setTimeout(() => rej(new Error("dns timeout")), timeoutMs)),
    ]);
    return { ok: true, backend: "dns", rttMs: Date.now() - startedAt };
  } catch (err) {
    return { ok: false, backend: "dns", error: err.message, rttMs: null };
  }
}
