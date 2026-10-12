// Regression for the reported failure: the `super-deepseek` combo contains a
// member whose upstream model id was renamed (`ds/deepseek-v4.1-flash` ->
// upstream answers HTTP 400 "The supported API model names are deepseek-flash,
// deepseek-v4-pro, but you passed deepseek-v4.1-flash"). Because combo.js read
// checkFallbackError().shouldFallback as the "advance?" decision, that 400
// returned the failure immediately and the three healthy members after it were
// never tried — the whole turn failed.
import { describe, it, expect, vi, beforeEach } from "vitest";

import { handleComboChat, resetComboRotation } from "../../open-sse/services/combo.js";

const log = { info: () => {}, warn: () => {}, debug: () => {} };

// Minimal Response stub with the .ok/.status/.statusText/.clone().json() surface
// handleComboChat uses when classifying a failure.
function okResponse(content) {
  const json = { choices: [{ message: { role: "assistant", content } }] };
  const make = () => ({ ok: true, status: 200, statusText: "OK", clone: make, json: async () => json });
  return make();
}

function errResponse(status, body) {
  const make = () => ({ ok: false, status, statusText: "Error", clone: make, json: async () => body });
  return make();
}

const MODEL_ID_400 = {
  error: {
    message:
      "The supported API model names are deepseek-flash, deepseek-v4-pro, " +
      "but you passed deepseek-v4.1-flash.",
    type: "invalid_request_error",
    code: "invalid_request_error",
  },
};

const CONTEXT_400 = {
  error: {
    message: "This model's maximum context length is 1048576 tokens. However, you requested 1186139 tokens",
    type: "invalid_request_error",
  },
};

describe("combo advances past a model-level error", () => {
  beforeEach(() => resetComboRotation());

  it("falls through to the next member when a member's model id is rejected", async () => {
    const handleSingleModel = vi.fn(async (body, model) => {
      if (model === "ds/deepseek-v4.1-flash") return errResponse(400, MODEL_ID_400);
      return okResponse(`answered-by-${model}`);
    });

    const result = await handleComboChat({
      body: { model: "super-deepseek", messages: [{ role: "user", content: "hi" }] },
      models: ["ds/deepseek-v4.1-flash", "clinepass/cline-pass/deepseek-v4.1-flash"],
      handleSingleModel,
      log,
      comboName: "super-deepseek",
      comboStrategy: "fallback",
    });

    // The healthy second member answered instead of the turn failing.
    expect(result.ok).toBe(true);
    expect(handleSingleModel).toHaveBeenCalledTimes(2);
    expect(handleSingleModel.mock.calls[1][1]).toBe("clinepass/cline-pass/deepseek-v4.1-flash");
  });

  it("still fails fast for a request-scoped 400 (context overflow)", async () => {
    // A bigger-window sibling does not fix an over-long request, so advancing
    // would only burn upstream calls and hide the real cause.
    const handleSingleModel = vi.fn(async () => errResponse(400, CONTEXT_400));

    const result = await handleComboChat({
      body: { model: "ctx-combo", messages: [{ role: "user", content: "hi" }] },
      models: ["ds/deepseek-v4-pro", "clinepass/cline-pass/deepseek-v4-pro"],
      handleSingleModel,
      log,
      comboName: "ctx-combo",
      comboStrategy: "fallback",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(handleSingleModel).toHaveBeenCalledTimes(1);
  });
});
