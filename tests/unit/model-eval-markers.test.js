import { describe, expect, it } from "vitest";
import { detectMarkers } from "../../src/lib/modelEval/markers.js";

describe("model eval markers", () => {
  it("flags SMIL animation inside svg", () => {
    const markers = detectMarkers("<svg><circle r='1'><animate attributeName='r' to='5' dur='1s'/></circle></svg>");
    expect(markers).toMatchObject({ hasSvg: true, hasAnimation: true, hasScript: false, truncated: false });
  });

  it("flags css keyframes without svg", () => {
    const markers = detectMarkers("<html><head><style>@keyframes spin { to { transform: rotate(360deg); } }</style></head><body></body></html>");
    expect(markers.hasSvg).toBe(false);
    expect(markers.hasAnimation).toBe(true);
  });

  it("flags requestAnimationFrame script", () => {
    const markers = detectMarkers("<script>requestAnimationFrame(loop)</script>");
    expect(markers.hasAnimation).toBe(true);
    expect(markers.hasScript).toBe(true);
  });

  it("leaves a static svg unanimated", () => {
    const markers = detectMarkers("<svg><rect width='4' height='4'/></svg>");
    expect(markers).toMatchObject({ hasSvg: true, hasAnimation: false });
  });

  it("marks truncated output from finish_reason=length", () => {
    expect(detectMarkers("<svg>", { finishReason: "length" }).truncated).toBe(true);
    expect(detectMarkers("<svg>", { finishReason: "stop" }).truncated).toBe(false);
  });

  it("handles empty input", () => {
    expect(detectMarkers("")).toMatchObject({ hasSvg: false, hasAnimation: false, length: 0 });
  });
});
