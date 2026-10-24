// Curated set of "common" provider icons that users can pick when configuring
// a custom provider node (OpenAI/Anthropic compatible, custom embedding).
// Each entry's `id` resolves to /providers/{id}.png (see providerIcon.js).
// Only include ids that ship a real icon file in /public/providers.

export const PRESET_PROVIDER_ICONS = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "claude", label: "Claude" },
  { id: "gemini", label: "Gemini" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "xai", label: "xAI" },
  { id: "grok-cli", label: "Grok" },
  { id: "mistral", label: "Mistral" },
  { id: "qwen", label: "Qwen" },
  { id: "glm", label: "GLM" },
  { id: "kimi", label: "Kimi" },
  { id: "minimax", label: "MiniMax" },
  { id: "cohere", label: "Cohere" },
  { id: "voyage-ai", label: "Voyage AI" },
  { id: "jina-ai", label: "Jina AI" },
  { id: "together", label: "Together" },
  { id: "fireworks", label: "Fireworks" },
  { id: "groq", label: "Groq" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "perplexity", label: "Perplexity" },
  { id: "nvidia", label: "NVIDIA" },
  { id: "ollama", label: "Ollama" },
  { id: "vercel", label: "Vercel" },
  { id: "bedrock", label: "Bedrock" },
  { id: "siliconflow", label: "SiliconFlow" },
  { id: "huggingface", label: "HF" },
  { id: "cerebras", label: "Cerebras" },
  { id: "github", label: "GitHub" },
  { id: "copilot", label: "Copilot" },
  { id: "cursor", label: "Cursor" },
  { id: "zed", label: "Zed" },
  { id: "windsurf", label: "Windsurf" },
];

// Default accent colors per category, used as the chip background + fallback
// text color when the user hasn't picked one.
export const DEFAULT_NODE_COLORS = {
  "openai-compatible": "#10A37F",
  "anthropic-compatible": "#D97757",
  "custom-embedding": "#A855F7",
};

// Default 2-letter fallback badges per category.
export const DEFAULT_NODE_TEXT_ICONS = {
  "openai-compatible": "OC",
  "anthropic-compatible": "AC",
  "custom-embedding": "CE",
};
