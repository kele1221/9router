import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export const IS_WIN = process.platform === "win32";
export const IS_MAC = process.platform === "darwin";

// macOS/Linux: -c count, -i interval (s), -W timeout (ms on macOS, s on Linux)
// Windows:     -n count, -w timeout (ms), no interval flag
export function icmpFlags({ count, intervalMs, timeoutMs }) {
  if (IS_WIN) {
    return ["-n", String(count), "-w", String(timeoutMs)];
  }
  return [
    "-c", String(count),
    "-i", String(intervalMs / 1000),
    "-W", IS_MAC ? String(timeoutMs) : String(Math.ceil(timeoutMs / 1000)),
  ];
}

// ping exits 1 on "no reply" and 2 on "cannot resolve"; both are probe results,
// not failures. execFile rejects on non-zero, so the caller must read err.stdout.
// `fping -q` writes its summary to stderr, hence the concatenation.
export function execProbe(bin, args, timeoutMs) {
  return execFileAsync(bin, args, {
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 64 * 1024,
  }).then(
    (out) => (out.stdout || "") + (out.stderr || ""),
    (err) => (err.stdout || "") + (err.stderr || ""),
  );
}
