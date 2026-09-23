import { describe, expect, it } from "vitest";
import { crc32, createZip, safeEntryName } from "../../src/lib/modelEval/zip.js";

// Minimal reader: walks the central directory so the archive is verified the
// way an unzip tool would see it, not just by byte-offset guesswork.
function readZip(buffer) {
  const eocdSignature = 0x06054b50;
  let eocd = buffer.length - 22;
  while (eocd >= 0 && buffer.readUInt32LE(eocd) !== eocdSignature) eocd -= 1;
  expect(eocd).toBeGreaterThanOrEqual(0);

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    expect(buffer.readUInt32LE(offset)).toBe(0x02014b50);
    const method = buffer.readUInt16LE(offset + 10);
    const crc = buffer.readUInt32LE(offset + 16);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);

    expect(buffer.readUInt32LE(localOffset)).toBe(0x04034b50);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    entries.push({ name, method, crc, data: buffer.subarray(dataStart, dataStart + size) });
    offset += 46 + nameLength;
  }
  return entries;
}

describe("model eval zip writer", () => {
  it("matches the known crc32 of 'hello'", () => {
    expect(crc32(Buffer.from("hello"))).toBe(0x3610a686);
  });

  it("stores multiple entries with correct names, sizes and crc", () => {
    const entries = [
      { name: "openai_gpt-4o.html", data: "<html>a</html>" },
      { name: "anthropic_claude.svg", data: "<svg/>" },
    ];
    const zip = createZip(entries, { date: new Date(2026, 8, 23, 10, 0, 0) });
    const read = readZip(zip);

    expect(read).toHaveLength(2);
    expect(read.map((e) => e.name)).toEqual(["openai_gpt-4o.html", "anthropic_claude.svg"]);
    expect(read.every((e) => e.method === 0)).toBe(true);
    expect(read[0].data.toString("utf8")).toBe("<html>a</html>");
    expect(read[1].data.toString("utf8")).toBe("<svg/>");
    expect(read[0].crc).toBe(crc32(Buffer.from("<html>a</html>")));
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
  });

  it("keeps utf-8 names intact", () => {
    const zip = createZip([{ name: "模型-结果.html", data: "<html/>" }]);
    expect(readZip(zip)[0].name).toBe("模型-结果.html");
  });

  it("sanitizes model ids into unique file names", () => {
    const used = new Set();
    expect(safeEntryName("openrouter/z-ai/glm-5.3", 0, used)).toBe("openrouter_z-ai_glm-5.3.html");
    expect(safeEntryName("openrouter/z-ai/glm-5.3", 1, used)).toBe("openrouter_z-ai_glm-5.3-2.html");
  });
});
