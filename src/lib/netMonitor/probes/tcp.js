import net from "net";

// TCP connect RTT. Cannot measure loss (TCP retransmits hide it), so this is the
// last-resort backend when no ICMP binary is usable.
export function probeTcp(host, port = 443, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish({ ok: true, backend: "tcp", rttMs: Date.now() - startedAt }));
    socket.once("timeout", () => finish({ ok: false, backend: "tcp", error: "timeout", rttMs: null }));
    socket.once("error", (err) => finish({ ok: false, backend: "tcp", error: err.code || err.message, rttMs: null }));
    try {
      socket.connect(port, host);
    } catch (err) {
      finish({ ok: false, backend: "tcp", error: err.code || err.message, rttMs: null });
    }
  });
}
