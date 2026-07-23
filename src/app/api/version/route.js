import { collectForkUpdateStatus } from "@/lib/fork/updateStatus.js";

// Backward-compatible endpoint for older clients. In fork mode, "hasUpdate"
// means an installable Fork Release exists; upstream source changes are
// reported separately and never point to the official npm package.
export async function GET() {
  const status = await collectForkUpdateStatus();
  return Response.json({
    ...status,
    latestVersion: status.fork.latestVersion,
    hasUpdate: status.fork.hasInstallUpdate,
  });
}
