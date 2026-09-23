import { describe, expect, it } from "vitest";
import { extractCode } from "../../src/lib/modelEval/extractHtml.js";

describe("model eval code extraction", () => {
  it("takes the html fenced block out of a chatty reply", () => {
    const raw = [
      "Here is the animation you asked for:",
      "```html",
      "<!DOCTYPE html><html><body><svg><circle r='5'/></svg></body></html>",
      "```",
      "Let me know if you want changes.",
    ].join("\n");
    const code = extractCode(raw);
    expect(code.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(code.endsWith("</html>")).toBe(true);
    expect(code).not.toContain("```");
  });

  it("accepts a bare svg document", () => {
    const code = extractCode("<svg width='10' height='10'><rect width='10' height='10'/></svg>");
    expect(code).toBe("<svg width='10' height='10'><rect width='10' height='10'/></svg>");
  });

  it("accepts a bare html document with prose around it", () => {
    const code = extractCode("Sure!\n<!DOCTYPE html>\n<html><body>hi</body></html>\nEnjoy.");
    expect(code).toBe("<!DOCTYPE html>\n<html><body>hi</body></html>");
  });

  it("keeps the tail of an unterminated fence (truncated output)", () => {
    const raw = "```html\n<!DOCTYPE html><html><body><svg><circle r='5'";
    const code = extractCode(raw);
    expect(code).toBe("<!DOCTYPE html><html><body><svg><circle r='5'");
  });

  it("prefers an svg/html fence over a longer unrelated one", () => {
    const raw = [
      "```js",
      "console.log('a very long non markup block that is much longer than the markup one')",
      "```",
      "```svg",
      "<svg><circle r='1'/></svg>",
      "```",
    ].join("\n");
    expect(extractCode(raw)).toBe("<svg><circle r='1'/></svg>");
  });

  it("returns null when there is nothing renderable", () => {
    expect(extractCode("")).toBeNull();
    expect(extractCode("I cannot help with that.")).toBeNull();
    expect(extractCode(null)).toBeNull();
  });
});
