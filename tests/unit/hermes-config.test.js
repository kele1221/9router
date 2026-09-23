import { describe, expect, it } from "vitest";
import {
  HERMES_MIN_CONTEXT_LENGTH,
  normalizeHermesContextLength,
  parseHermesModelBlock,
  removeHermesModelBlock,
  resolveHermesContextLength,
  upsertHermesModelBlock,
} from "../../src/lib/hermesConfig.js";

const BASE_CONFIG = `model:
  default: "cc/claude-sonnet-5"
  provider: "custom"
  base_url: "http://127.0.0.1:20128/v1"
  api_key: \${OPENAI_API_KEY}
  api_mode: "chat_completions"
  streaming: true

mcp_servers:
  example:
    enabled: true
`;

describe("hermesConfig", () => {
  describe("normalizeHermesContextLength", () => {
    it("normalizes raw tokens and K/M suffixes", () => {
      expect(normalizeHermesContextLength(HERMES_MIN_CONTEXT_LENGTH)).toBe(64000);
      expect(normalizeHermesContextLength("128K")).toBe(128000);
      expect(normalizeHermesContextLength("1M")).toBe(1000000);
      expect(normalizeHermesContextLength("1.5M")).toBe(1500000);
    });

    it("uses null for Auto and undefined for an omitted field", () => {
      expect(normalizeHermesContextLength(null)).toBeNull();
      expect(normalizeHermesContextLength("")).toBeNull();
      expect(normalizeHermesContextLength("auto")).toBeNull();
      expect(normalizeHermesContextLength(undefined)).toBeUndefined();
    });

    it("rejects values Hermes cannot reliably use", () => {
      expect(() => normalizeHermesContextLength(63999)).toThrow(/64,000/);
      expect(() => normalizeHermesContextLength(0)).toThrow();
      expect(() => normalizeHermesContextLength(-1)).toThrow();
      expect(() => normalizeHermesContextLength("not-a-size")).toThrow();
      expect(() => normalizeHermesContextLength(Number.MAX_SAFE_INTEGER + 1)).toThrow();
    });

    it("preserves an override only for the same model and endpoint", () => {
      const existingModel = {
        default: "cc/claude-sonnet-5",
        provider: "custom",
        base_url: "http://127.0.0.1:20128/v1",
        context_length: 128000,
      };

      expect(resolveHermesContextLength({
        hasValue: false,
        existingModel,
        model: existingModel.default,
        baseUrl: existingModel.base_url,
      })).toBeUndefined();
      expect(resolveHermesContextLength({
        hasValue: false,
        existingModel,
        model: "cx/gpt-5.6-sol",
        baseUrl: existingModel.base_url,
      })).toBeNull();
      expect(resolveHermesContextLength({
        hasValue: true,
        value: "256K",
        existingModel,
        model: "cx/gpt-5.6-sol",
        baseUrl: existingModel.base_url,
      })).toBe(256000);
    });
  });

  it("parses the configured context length", () => {
    expect(parseHermesModelBlock(BASE_CONFIG)).toMatchObject({
      default: "cc/claude-sonnet-5",
      provider: "custom",
      base_url: "http://127.0.0.1:20128/v1",
      context_length: null,
    });

    const configured = upsertHermesModelBlock(BASE_CONFIG, { context_length: 128000 });
    expect(parseHermesModelBlock(configured).context_length).toBe(128000);
  });

  it("sets, updates, and clears context_length without losing unrelated config", () => {
    const configured = upsertHermesModelBlock(BASE_CONFIG, {
      default: "cx/gpt-5.6-sol",
      provider: "custom",
      base_url: "http://127.0.0.1:20128/v1",
      api_key: "${OPENAI_API_KEY}",
      context_length: 128000,
    });

    expect(configured).toContain('default: "cx/gpt-5.6-sol"');
    expect(configured).toContain("context_length: 128000");
    expect(configured).toContain('api_mode: "chat_completions"');
    expect(configured).toContain("mcp_servers:");
    expect(configured.match(/^\s+context_length:/gm)).toHaveLength(1);

    const updated = upsertHermesModelBlock(configured, { context_length: 256000 });
    expect(updated).toContain("context_length: 256000");
    expect(updated).not.toContain("context_length: 128000");
    expect(updated.match(/^\s+context_length:/gm)).toHaveLength(1);

    const auto = upsertHermesModelBlock(updated, { context_length: null });
    expect(auto).not.toContain("context_length:");
    expect(auto).toContain('api_mode: "chat_completions"');
    expect(auto).toContain("mcp_servers:");
  });

  it("creates a model block when none exists and is idempotent", () => {
    const fields = {
      default: "cc/claude-sonnet-5",
      provider: "custom",
      base_url: "http://127.0.0.1:20128/v1",
      api_key: "${OPENAI_API_KEY}",
      context_length: 128000,
    };

    const once = upsertHermesModelBlock("tools:\n  enabled: true\n", fields);
    const twice = upsertHermesModelBlock(once, fields);

    expect(twice.match(/^model:$/gm)).toHaveLength(1);
    expect(twice.match(/^\s+context_length:/gm)).toHaveLength(1);
    expect(twice).toContain("tools:\n  enabled: true");
  });

  it("removes only the managed model block on reset", () => {
    const reset = removeHermesModelBlock(BASE_CONFIG);
    expect(reset).not.toContain("model:");
    expect(reset).toContain("mcp_servers:");
  });
});
