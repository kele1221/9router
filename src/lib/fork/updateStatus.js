import { FORK_CONFIG } from "@/shared/constants/fork.js";

function normalizeReleaseVersion(tagName) {
  return String(tagName || "")
    .replace(/^fork-v/, "")
    .replace(/^v/, "");
}

function versionParts(version) {
  const match = String(version || "").match(/^(\d+)\.(\d+)\.(\d+)(?:-k\.(\d+))?$/);
  if (!match) return null;
  return match.slice(1).map((value) => Number(value || 0));
}

export function compareForkVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  if (!left || !right) return 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }
  return 0;
}

async function fetchJson(fetchImpl, url) {
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "9router-fork-update-check",
      },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function collectForkUpdateStatus({
  fetchImpl = fetch,
  currentVersion = FORK_CONFIG.version,
  now = () => new Date(),
} = {}) {
  const apiBase = `https://api.github.com/repos/${FORK_CONFIG.owner}/${FORK_CONFIG.repo}`;
  const compareUrl = `${apiBase}/compare/${FORK_CONFIG.productBranch}...${FORK_CONFIG.upstreamOwner}:${FORK_CONFIG.upstreamBranch}`;
  const pullsUrl = `${apiBase}/pulls?state=open&head=${FORK_CONFIG.owner}:${FORK_CONFIG.syncBranch}&base=${FORK_CONFIG.productBranch}`;
  const releaseUrl = `${apiBase}/releases/latest`;

  const [comparison, pulls, release] = await Promise.all([
    fetchJson(fetchImpl, compareUrl),
    fetchJson(fetchImpl, pullsUrl),
    fetchJson(fetchImpl, releaseUrl),
  ]);

  const aheadBy = Number(comparison?.ahead_by || 0);
  const hasUpstreamUpdate = aheadBy > 0;
  const comparisonAvailable = Boolean(comparison);
  const pullsAvailable = Array.isArray(pulls);
  const releaseAvailable = Boolean(release);
  const syncPr = Array.isArray(pulls) ? pulls[0] : null;
  const latestVersion = normalizeReleaseVersion(release?.tag_name);
  const hasInstallUpdate = Boolean(latestVersion) && compareForkVersions(latestVersion, currentVersion) > 0;
  const syncStatus = syncPr
    ? "pr_open"
    : (!comparisonAvailable || !pullsAvailable)
      ? "unknown"
      : hasUpstreamUpdate
        ? "update_available"
        : "current";

  return {
    currentVersion,
    checkedAt: now().toISOString(),
    availability: {
      comparison: comparisonAvailable,
      pulls: pullsAvailable,
      release: releaseAvailable,
    },
    upstream: {
      repository: `${FORK_CONFIG.upstreamOwner}/${FORK_CONFIG.upstreamRepo}`,
      branch: FORK_CONFIG.upstreamBranch,
      hasUpdate: hasUpstreamUpdate,
      aheadBy,
      comparisonStatus: comparison?.status || "unknown",
      compareUrl: `${FORK_CONFIG.repositoryUrl}/compare/${FORK_CONFIG.productBranch}...${FORK_CONFIG.upstreamOwner}:${FORK_CONFIG.upstreamBranch}`,
    },
    sync: {
      status: syncStatus,
      prNumber: syncPr?.number || null,
      prUrl: syncPr?.html_url || null,
    },
    fork: {
      repository: `${FORK_CONFIG.owner}/${FORK_CONFIG.repo}`,
      productBranch: FORK_CONFIG.productBranch,
      latestVersion: latestVersion || null,
      hasInstallUpdate,
      releaseUrl: release?.html_url || `${FORK_CONFIG.repositoryUrl}/releases`,
    },
    healthy: comparisonAvailable && pullsAvailable && releaseAvailable,
  };
}
