import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildResultFileName, formatStamp, writeResultFile } from "../../src/lib/modelEval/outputDir.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-model-eval-out-"));
process.env.MODEL_EVAL_OUTPUT_DIR = tmpDir;

const date = new Date(2026, 8, 23, 14, 5, 9);

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("generated file naming", () => {
  it("builds 模型名-测试提示-时间戳", () => {
    expect(buildResultFileName({ model: "openrouter/z-ai/glm-5.3", promptName: "SVG 鹈鹕骑自行车动画", date }))
      .toBe("openrouter-z-ai-glm-5.3-SVG-鹈鹕骑自行车动画-20260923-140509.html");
  });

  it("strips path separators and illegal characters", () => {
    const name = buildResultFileName({ model: "a:b*c?d", promptName: "x/y\\z", date });
    expect(name).toBe("a-b-c-d-x-y-z-20260923-140509.html");
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
  });

  it("falls back when a part is empty", () => {
    expect(buildResultFileName({ model: "", promptName: "", date })).toBe("model-prompt-20260923-140509.html");
  });

  it("formats the timestamp as YYYYMMDD-HHmmss", () => {
    expect(formatStamp(new Date(2026, 0, 2, 3, 4, 5))).toBe("20260102-030405");
  });
});

describe("result file writing", () => {
  it("writes html files into the configured directory", () => {
    const file = writeResultFile({ model: "kiro/claude-x", promptName: "蒸汽火车", code: "<html><body>hi</body></html>", date });
    expect(file).toBe(path.join(tmpDir, "kiro-claude-x-蒸汽火车-20260923-140509.html"));
    expect(fs.readFileSync(file, "utf8")).toBe("<html><body>hi</body></html>");
  });

  it("uses the svg extension for bare svg output", () => {
    const file = writeResultFile({ model: "m/n", promptName: "p", code: "<svg><rect/></svg>", date });
    expect(file.endsWith(".svg")).toBe(true);
  });

  it("suffixes instead of overwriting on a name collision", () => {
    const first = writeResultFile({ model: "dup/model", promptName: "same", code: "<svg/>", date });
    const second = writeResultFile({ model: "dup/model", promptName: "same", code: "<svg/>", date });
    expect(path.basename(second)).toBe(path.basename(first).replace(/\.svg$/, "-2.svg"));
  });

  it("returns null instead of throwing when the target is unusable", () => {
    process.env.MODEL_EVAL_OUTPUT_DIR = path.join(tmpDir, "blocked", "file.txt", "nested");
    fs.mkdirSync(path.join(tmpDir, "blocked"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "blocked", "file.txt"), "not a directory");
    expect(writeResultFile({ model: "m", promptName: "p", code: "<html/>", date })).toBeNull();
    process.env.MODEL_EVAL_OUTPUT_DIR = tmpDir;
  });
});
