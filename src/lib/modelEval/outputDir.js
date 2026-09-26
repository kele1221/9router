// Generated sources are also written to disk so the user can open them directly.
// Directory is fixed per install (project-relative by default), git-ignored, and
// excluded from the standalone build trace — never shipped with the code.
import fs from "node:fs";
import path from "node:path";

export const OUTPUT_DIR_NAME = "model-eval-output";

export function getOutputDir() {
  return process.env.MODEL_EVAL_OUTPUT_DIR || path.resolve(process.cwd(), OUTPUT_DIR_NAME);
}

function sanitizePart(value, maxLength = 60) {
  const cleaned = String(value ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned.slice(0, maxLength).replace(/[-.]+$/g, "");
}

export function formatStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function extensionFor(code) {
  const text = String(code ?? "").trim();
  if (/^<svg[\s/>]/i.test(text) && !/<!doctype\s+html|<html[\s>]/i.test(text)) return "svg";
  return "html";
}

// <模型名>-<思考深度>-<测试提示>-<时间戳>.<ext>
export function buildResultFileName({ model, promptName, thinkingEffort = "none", date = new Date(), ext = "html" }) {
  const parts = [sanitizePart(model, 80) || "model", sanitizePart(thinkingEffort) || "none", sanitizePart(promptName) || "prompt", formatStamp(date)];
  return `${parts.join("-")}.${ext}`;
}

// Returns the absolute path, or null when the write fails — a full disk or a
// read-only checkout must never fail an evaluation run.
export function writeResultFile({ model, promptName, thinkingEffort = "none", code, date = new Date() }) {
  try {
    const dir = getOutputDir();
    fs.mkdirSync(dir, { recursive: true });

    const ext = extensionFor(code);
    const fileName = buildResultFileName({ model, promptName, thinkingEffort, date, ext });
    const base = fileName.slice(0, -(ext.length + 1));
    let target = path.join(dir, fileName);
    let suffix = 2;
    while (fs.existsSync(target)) {
      target = path.join(dir, `${base}-${suffix++}.${ext}`);
    }

    fs.writeFileSync(target, String(code ?? ""), "utf8");
    return target;
  } catch (err) {
    console.warn("[ModelEval] failed to write result file:", err?.message);
    return null;
  }
}
