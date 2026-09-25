export default {
  version: 2,
  name: "model-eval-thinking",
  up(db) {
    // schema.js auto-sync also protects databases that skipped this migration.
    const runColumns = new Set(db.all("PRAGMA table_info(modelEvalRuns)").map((row) => row.name));
    const resultColumns = new Set(db.all("PRAGMA table_info(modelEvalResults)").map((row) => row.name));
    const scheduleColumns = new Set(db.all("PRAGMA table_info(modelEvalSchedules)").map((row) => row.name));
    if (!runColumns.has("thinkingEfforts")) db.exec("ALTER TABLE modelEvalRuns ADD COLUMN thinkingEfforts TEXT");
    if (!resultColumns.has("thinkingEffort")) db.exec("ALTER TABLE modelEvalResults ADD COLUMN thinkingEffort TEXT");
    if (!scheduleColumns.has("thinkingEfforts")) db.exec("ALTER TABLE modelEvalSchedules ADD COLUMN thinkingEfforts TEXT");
  },
};
