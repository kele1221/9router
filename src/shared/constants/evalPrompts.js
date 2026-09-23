// Built-in capability-eval prompts. Code constants (not DB rows) so an upgrade
// can refresh their wording; ids are prefixed and immutable, users cannot edit
// or delete them, and custom prompts live in the modelEvalPrompts table.
export const BUILTIN_PROMPT_PREFIX = "builtin:";

export const BUILTIN_EVAL_PROMPTS = [
  {
    id: "builtin:pelican-svg-bike",
    name: "SVG 鹈鹕骑自行车动画",
    content: "使用 svg 画一个鹈鹕骑自行车的 html 动画，要求：完整的单文件 HTML，画面中有可辨认的鹈鹕和自行车，鹈鹕的翅膀或腿有运动，车轮转动。只输出 HTML 代码。",
  },
  {
    id: "builtin:cat-clock-svg",
    name: "SVG 猫咪时钟动画",
    content: "使用 svg 画一个猫咪造型的挂钟 html 动画，时针分针要真实转动，猫的眼睛会眨，钟摆摆动。完整的单文件 HTML，只输出 HTML 代码。",
  },
  {
    id: "builtin:solar-system-html",
    name: "HTML 太阳系行星动画",
    content: "用 HTML + CSS 动画做一个太阳系示意图，八大行星绕太阳公转，轨道清晰、行星大小有区分、有名称标注。完整的单文件 HTML，只输出 HTML 代码。",
  },
  {
    id: "builtin:aquarium-svg",
    name: "SVG 水族箱动画",
    content: "使用 svg 画一个水族箱 html 动画，里面有游动的鱼、气泡上浮、水草摆动，鱼要有可辨认的身体与鱼鳍。完整的单文件 HTML，只输出 HTML 代码。",
  },
  {
    id: "builtin:steam-train-svg",
    name: "SVG 蒸汽火车动画",
    content: "使用 svg 画一列蒸汽火车的 html 动画，车轮转动、烟囱冒烟、火车沿轨道前进。完整的单文件 HTML，只输出 HTML 代码。",
  },
];

export function findBuiltinPrompt(id) {
  return BUILTIN_EVAL_PROMPTS.find((p) => p.id === id) || null;
}

export function isBuiltinPromptId(id) {
  return typeof id === "string" && id.startsWith(BUILTIN_PROMPT_PREFIX);
}
