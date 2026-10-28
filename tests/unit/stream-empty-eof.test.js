import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import {
  buildClinePassUpstreamObservation,
  extraUpstreamsFromError,
  observeClinePassRouting,
} from "../../open-sse/shared/clinePassRouting.js";

// An empty SSE body is what an upstream that hung up after its 200 looks like.
async function runStream(input, sourceFormat, targetFormat) {
  const encoder = new TextEncoder();
  const source = new ReadableStream({
    start(controller) {
      if (input) controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });

  let completion = null;
  const output = source.pipeThrough(
    createSSETransformStreamWithLogger(targetFormat, sourceFormat, "clinepass", null, null, "m", null, null,
      (...args) => { completion = args; }),
  );

  const reader = output.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }
  return completion;
}

describe("empty stream is reported as a failure, not a success", () => {
  it("zero chunks and no usage → errorCode stream_empty_eof", async () => {
    const [content, usage, , errorCode] = await runStream("", FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES);
    expect(content.content).toBe("");
    expect(usage).toBeNull();
    expect(errorCode).toBe("stream_empty_eof");
  });

  it("a normal chunk with usage → no errorCode", async () => {
    const body = [
      'data: {"id":"1","choices":[{"delta":{"content":"hi"}}]}',
      'data: {"id":"1","choices":[],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
      'data: [DONE]',
      "",
    ].join("\n\n");
    const [content, , , errorCode] = await runStream(body, FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES);
    expect(content.content).toBe("hi");
    expect(errorCode).toBeNull();
  });
});

describe("clinepass upstream observation", () => {
  it("keeps the first routing fact instead of letting a later frame overwrite it", () => {
    const observation = buildClinePassUpstreamObservation("deepseek", null);
    observeClinePassRouting(observation, { provider: "deepseek" });
    observeClinePassRouting(observation, { provider: "openrouter" });
    expect(observation).toEqual({ expected: "deepseek", actual: "deepseek", observed: true, match: "adopted" });
  });

  it("reads routing out of a streamed delta", () => {
    const observation = buildClinePassUpstreamObservation("deepseek", null);
    observeClinePassRouting(observation, {
      choices: [{ delta: { provider_metadata: { gateway: { routing: { finalProvider: "baseten" } } } } }],
    });
    expect(observation).toMatchObject({ actual: "baseten", match: "not-adopted" });
  });
});

describe("pin probe error parsing", () => {
  it("reads the planner's available-providers sentence", () => {
    expect(extraUpstreamsFromError('No provider available. Available providers are: deepseek, baseten, together.'))
      .toEqual(["deepseek", "baseten", "together"]);
  });

  it("reads OpenRouter's error metadata", () => {
    const message = JSON.stringify({ error: { message: "no allowed providers", metadata: { available_providers: ["deepseek", "z-ai"] } } });
    expect(extraUpstreamsFromError(`upstream error: ${message}`)).toEqual(["deepseek", "z-ai"]);
  });

  it("returns nothing when the error carries no channel list", () => {
    expect(extraUpstreamsFromError("429 rate limited")).toEqual([]);
    expect(extraUpstreamsFromError("")).toEqual([]);
    expect(extraUpstreamsFromError(null)).toEqual([]);
  });
});
