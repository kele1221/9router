// Fork migration (upstream has no versioned model-eval migrations).
// Same legacy-DB guard as 002: the model-eval tables may not exist yet, because
// schema.js auto-sync runs after the versioned migration chain.
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
  version: 3,
  name: "model-eval-arithmetic",
  up(db) {
    addColumn(db, "modelEvalPrompts", "evaluationType", "evaluationType TEXT");
    addColumn(db, "modelEvalPrompts", "expectedAnswer", "expectedAnswer TEXT");
    addColumn(db, "modelEvalRuns", "evaluationType", "evaluationType TEXT");
    addColumn(db, "modelEvalRuns", "expectedAnswer", "expectedAnswer TEXT");
    addColumn(db, "modelEvalResults", "autoEvaluation", "autoEvaluation TEXT");
  },
};
