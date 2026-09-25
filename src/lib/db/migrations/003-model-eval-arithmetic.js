export default {
  version: 3,
  name: "model-eval-arithmetic",
  up(db) {
    // schema.js auto-sync also protects databases that skipped this migration.
    const promptColumns = new Set(db.all("PRAGMA table_info(modelEvalPrompts)").map((row) => row.name));
    const runColumns = new Set(db.all("PRAGMA table_info(modelEvalRuns)").map((row) => row.name));
    const resultColumns = new Set(db.all("PRAGMA table_info(modelEvalResults)").map((row) => row.name));
    if (!promptColumns.has("evaluationType")) db.exec("ALTER TABLE modelEvalPrompts ADD COLUMN evaluationType TEXT");
    if (!promptColumns.has("expectedAnswer")) db.exec("ALTER TABLE modelEvalPrompts ADD COLUMN expectedAnswer TEXT");
    if (!runColumns.has("evaluationType")) db.exec("ALTER TABLE modelEvalRuns ADD COLUMN evaluationType TEXT");
    if (!runColumns.has("expectedAnswer")) db.exec("ALTER TABLE modelEvalRuns ADD COLUMN expectedAnswer TEXT");
    if (!resultColumns.has("autoEvaluation")) db.exec("ALTER TABLE modelEvalResults ADD COLUMN autoEvaluation TEXT");
  },
};
