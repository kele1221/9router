// Fork migration (upstream has no versioned model-eval migrations).
// schema.js auto-sync also protects databases that skipped this migration — and on a
// legacy DB that predates the model-eval tables, the tables simply do not exist yet
// (auto-sync creates them after the versioned chain), so every ALTER is guarded.
const tableExists = (db, table) => {
  try {
    return db.all(`PRAGMA table_info(${table})`).length > 0;
  } catch {
    return false;
  }
};

const addColumn = (db, table, column, ddl) => {
  if (!tableExists(db, table)) return;
  const columns = new Set(db.all(`PRAGMA table_info(${table})`).map((row) => row.name));
  if (!columns.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
};

export default {
  version: 2,
  name: "model-eval-thinking",
  up(db) {
    addColumn(db, "modelEvalRuns", "thinkingEfforts", "thinkingEfforts TEXT");
    addColumn(db, "modelEvalResults", "thinkingEffort", "thinkingEffort TEXT");
    addColumn(db, "modelEvalSchedules", "thinkingEfforts", "thinkingEfforts TEXT");
  },
};
