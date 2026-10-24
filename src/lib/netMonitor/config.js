// Resolves netMonitor settings against defaults. settingsRepo's mergeWithDefaults
// is a shallow merge, so a stored `netMonitor: { enabled: true }` would arrive
// with no nested keys — read through this instead of settings.netMonitor directly.
export const NET_MONITOR_DEFAULTS = {
  enabled: false,
  intervalMs: 60000,
  targets: {
    icmp: ["1.1.1.1", "8.8.8.8"],
    tcp: [{ host: "1.1.1.1", port: 443 }],
    dns: ["github.com", "www.google.com"],
  },
  rawRetentionDays: 7,
  hourlyRetentionDays: 90,
  envRetentionDays: 180,
  // Off by default: upstream probes consume a real (billed) request per
  // provider, so enabling them is the user's explicit choice.
  probeUpstream: false,
};

export function resolveNetMonitorConfig(settings) {
  const raw = settings?.netMonitor || {};
  const targets = raw.targets || {};
  return {
    enabled: raw.enabled === true,
    intervalMs: positiveInt(raw.intervalMs, NET_MONITOR_DEFAULTS.intervalMs),
    targets: {
      icmp: nonEmptyArray(targets.icmp, NET_MONITOR_DEFAULTS.targets.icmp),
      tcp: nonEmptyArray(targets.tcp, NET_MONITOR_DEFAULTS.targets.tcp),
      dns: nonEmptyArray(targets.dns, NET_MONITOR_DEFAULTS.targets.dns),
    },
    rawRetentionDays: positiveInt(raw.rawRetentionDays, NET_MONITOR_DEFAULTS.rawRetentionDays),
    hourlyRetentionDays: positiveInt(raw.hourlyRetentionDays, NET_MONITOR_DEFAULTS.hourlyRetentionDays),
    envRetentionDays: positiveInt(raw.envRetentionDays, NET_MONITOR_DEFAULTS.envRetentionDays),
    probeUpstream: raw.probeUpstream === true,
  };
}

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function nonEmptyArray(value, fallback) {
  return Array.isArray(value) && value.length ? value : fallback;
}
