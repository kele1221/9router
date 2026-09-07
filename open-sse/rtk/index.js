// RTK port: compress tool_result content in LLM request bodies
// Injected at the top of translateRequest (before any format translation)
import { RAW_CAP, MIN_COMPRESS_SIZE } from "./constants.js";
import { autoDetectFilter } from "./autodetect.js";
import { safeApply } from "./applyFilter.js";
import {
  DEFAULT_RTK_BUDGET_TOKENS,
  RTK_MODES,
  estimateRtkTokens,
  fitTextToRtkBudget,
  normalizeRtkBudgetTokens,
  normalizeRtkMode,
} from "./budget.js";

// Compress tool_result content in-place. Returns stats or null if disabled/failed.
export function compressMessages(body, enabled, options = {}) {
  if (!enabled) return null;
  if (!body) return null;

  const mode = normalizeRtkMode(options.mode);
  const budgetTokens = normalizeRtkBudgetTokens(
    options.budgetTokens ?? DEFAULT_RTK_BUDGET_TOKENS,
  );

  // Kiro format: conversationState.history + conversationState.currentMessage
  if (body.conversationState) {
    return compressKiroFormat(body, { mode, budgetTokens });
  }

  // Support both OpenAI/Claude "messages" and OpenAI Responses "input"
  const items = Array.isArray(body.messages) ? body.messages
    : Array.isArray(body.input) ? body.input
    : null;
  if (!items) return null;

  const startedAt = Date.now();
  const stats = {
    bytesBefore: 0,
    bytesAfter: 0,
    tokensBeforeEst: 0,
    tokensAfterEst: 0,
    hits: [],
    mode,
    budgetTokens: mode === RTK_MODES.BUDGET ? budgetTokens : null,
    budgetTruncated: 0,
    budgetBypassReasons: {},
    durationMs: 0,
  };

  const recordBudgetBypass = (reason) => {
    if (!reason) return;
    stats.budgetBypassReasons[reason] = (stats.budgetBypassReasons[reason] || 0) + 1;
  };

  const compress = (text, shape) => compressText(text, stats, shape, {
    mode,
    budgetTokens,
    recordBudgetBypass,
  });

  try {
    for (let i = 0; i < items.length; i++) {
      const msg = items[i];
      if (!msg) continue;

      // Shape 4: OpenAI Responses — top-level { type:"function_call_output", output: string | [{type:"input_text", text}] }
      if (msg.type === "function_call_output") {
        if (msg.is_error === true || msg.status === "error") continue;
        if (typeof msg.output === "string") {
          msg.output = compress(msg.output, "openai-responses-string");
        } else if (Array.isArray(msg.output)) {
          for (let k = 0; k < msg.output.length; k++) {
            const part = msg.output[k];
            if (part && part.type === "input_text" && typeof part.text === "string") {
              part.text = compress(part.text, "openai-responses-array");
            }
          }
        }
        continue;
      }

      // Shape 1: OpenAI tool message — { role:"tool", content: "string" }
      if (msg.role === "tool" && typeof msg.content === "string") {
        if (msg.is_error === true || msg.status === "error") continue;
        msg.content = compress(msg.content, "openai-tool");
        continue;
      }

      if (!Array.isArray(msg.content)) continue;

      // Shape 1b: OpenAI tool message — { role:"tool", content:[{type:"text", text:"..."}] }
      if (msg.role === "tool") {
        if (msg.is_error === true || msg.status === "error") continue;
        for (let k = 0; k < msg.content.length; k++) {
          const part = msg.content[k];
          if (part && part.type === "text" && typeof part.text === "string") {
            part.text = compress(part.text, "openai-tool-array");
          }
        }
        continue;
      }

      // Shape 2/3: blocks array with tool_result entries
      for (let j = 0; j < msg.content.length; j++) {
        const block = msg.content[j];
        if (!block || block.type !== "tool_result") continue;
        if (block.is_error === true) continue; // preserve error traces

        if (typeof block.content === "string") {
          // Shape 2: claude string form
          block.content = compress(block.content, "claude-string");
        } else if (Array.isArray(block.content)) {
          // Shape 3: claude array form — compress each text part
          for (let k = 0; k < block.content.length; k++) {
            const part = block.content[k];
            if (part && part.type === "text" && typeof part.text === "string") {
              part.text = compress(part.text, "claude-array");
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn("[RTK] compressMessages error:", e.message);
    return null;
  }
  stats.durationMs = Date.now() - startedAt;
  return stats;
}

// Compress Kiro format: conversationState.history[].userInputMessage.userInputMessageContext.toolResults[].content[].text
function compressKiroFormat(body, { mode, budgetTokens }) {
  const startedAt = Date.now();
  const stats = {
    bytesBefore: 0,
    bytesAfter: 0,
    tokensBeforeEst: 0,
    tokensAfterEst: 0,
    hits: [],
    mode,
    budgetTokens: mode === RTK_MODES.BUDGET ? budgetTokens : null,
    budgetTruncated: 0,
    budgetBypassReasons: {},
    durationMs: 0,
  };
  const recordBudgetBypass = (reason) => {
    if (!reason) return;
    stats.budgetBypassReasons[reason] = (stats.budgetBypassReasons[reason] || 0) + 1;
  };
  try {
    const state = body.conversationState;
    const allMessages = [...(Array.isArray(state?.history) ? state.history : [])];
    if (state?.currentMessage) allMessages.push(state.currentMessage);

    for (const msg of allMessages) {
      const toolResults = msg?.userInputMessage?.userInputMessageContext?.toolResults;
      if (!Array.isArray(toolResults)) continue;

      for (const tr of toolResults) {
        if (tr.status === "error") continue; // preserve error traces
        if (!Array.isArray(tr.content)) continue;

        for (const part of tr.content) {
          if (part && typeof part.text === "string") {
            part.text = compressText(part.text, stats, "kiro-tool-result", {
              mode,
              budgetTokens,
              recordBudgetBypass,
            });
          }
        }
      }
    }
  } catch (e) {
    console.warn("[RTK] compressKiroFormat error:", e.message);
    return null;
  }
  stats.durationMs = Date.now() - startedAt;
  return stats;
}

function compressText(text, stats, shape, { mode, budgetTokens, recordBudgetBypass }) {
  const bytesIn = text.length;
  stats.bytesBefore += bytesIn;
  stats.tokensBeforeEst += estimateRtkTokens(text);

  if (bytesIn < MIN_COMPRESS_SIZE || bytesIn > RAW_CAP) {
    stats.bytesAfter += bytesIn;
    stats.tokensAfterEst += estimateRtkTokens(text);
    return text;
  }

  const fn = autoDetectFilter(text);
  if (!fn) {
    stats.bytesAfter += bytesIn;
    stats.tokensAfterEst += estimateRtkTokens(text);
    if (mode === RTK_MODES.BUDGET) recordBudgetBypass("unrecognized");
    return text;
  }

  let out = safeApply(fn, text);

  // Safety: never return empty, never grow the input
  if (!out || out.length === 0 || out.length >= bytesIn) {
    out = text;
  }

  let budgeted = false;
  if (mode === RTK_MODES.BUDGET) {
    const fitted = fitTextToRtkBudget(out, budgetTokens);
    if (fitted.truncated) {
      out = fitted.text;
      budgeted = true;
      stats.budgetTruncated++;
    } else if (fitted.reason) {
      recordBudgetBypass(fitted.reason);
    }
  }

  if (!out || out.length === 0 || out.length >= bytesIn) {
    stats.bytesAfter += bytesIn;
    stats.tokensAfterEst += estimateRtkTokens(text);
    return text;
  }

  stats.bytesAfter += out.length;
  stats.tokensAfterEst += estimateRtkTokens(out);
  stats.hits.push({
    shape,
    filter: fn.filterName || fn.name,
    saved: bytesIn - out.length,
    budgeted,
  });
  return out;
}

// Convenience: format a log line from stats
export function formatRtkLog(stats) {
  if (!stats || !stats.hits || stats.hits.length === 0) return null;
  const saved = stats.bytesBefore - stats.bytesAfter;
  const pct = stats.bytesBefore > 0 ? ((saved / stats.bytesBefore) * 100).toFixed(1) : "0";
  const filters = Array.from(new Set(stats.hits.map(h => h.filter))).join(",");
  const budget = stats.mode === RTK_MODES.BUDGET
    ? ` budget=${stats.budgetTokens}tok truncated=${stats.budgetTruncated}`
    : "";
  return `[RTK] saved ${saved}B / ${stats.bytesBefore}B (${pct}%) via [${filters}] hits=${stats.hits.length}${budget}`;
}
