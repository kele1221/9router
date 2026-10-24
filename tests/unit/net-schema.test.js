import { describe, it, expect } from "vitest";
import { initDb } from "../../src/lib/db/index.js";
import { getAdapter } from "../../src/lib/db/driver.js";

describe("netMonitor schema", () => {
  it("auto-creates both tables via syncSchemaFromTables", async () => {
    await initDb();
    const db = await getAdapter();
    const names = db.all(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'netMonitor%'`).map((t) => t.name).sort();
    expect(names).toEqual(["netMonitorHourly", "netMonitorSamples"]);

    const cols = db.all(`PRAGMA table_info(netMonitorSamples)`).map((c) => c.name);
    for (const expected of ["ts", "target", "kind", "ok", "rttAvgMs", "jitterMs", "lossPct", "error"]) {
      expect(cols).toContain(expected);
    }
    const idx = db.all(`SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_nm%'`).map((i) => i.name).sort();
    expect(idx).toContain("idx_nms_target_ts");
    expect(idx).toContain("idx_nmh_bucket_target");
  });

  it("ships a SCHEMA_VERSION that triggers the pre-change backup", async () => {
    const { SCHEMA_VERSION } = await import("../../src/lib/db/schema.js");
    // Bumped 5 → 6 when the netMonitor tables landed; migrate.js takes a safety
    // backup only when the stored version is lower than this constant.
    expect(SCHEMA_VERSION).toBe(6);
  });
});
