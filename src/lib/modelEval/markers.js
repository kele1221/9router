// Cheap deterministic signals stored next to every result. They never score a
// model — they only flag "did the reply even contain renderable animated art".
export function detectMarkers(code, { finishReason } = {}) {
  const text = String(code ?? "");
  const hasSvg = /<svg[\s/>]/i.test(text);
  const hasAnimation =
    /<(?:animate|animateTransform|animateMotion|animateColor|set)[\s>]/i.test(text)
    || /@keyframes/i.test(text)
    || /requestAnimationFrame\s*\(/.test(text)
    || /(?:^|[;{\s])animation(?:-name)?\s*:/i.test(text)
    || /\btransition\s*:/i.test(text);
  const hasScript = /<script[\s>]/i.test(text);
  return {
    hasSvg,
    hasAnimation,
    hasScript,
    truncated: finishReason === "length",
    length: text.length,
  };
}
