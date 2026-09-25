// Built-in capability-eval prompts. Code constants (not DB rows) so an upgrade
// can refresh their wording; ids are prefixed and immutable, users cannot edit
// or delete them, and custom prompts live in the modelEvalPrompts table.
export const BUILTIN_PROMPT_PREFIX = "builtin:";

export const BUILTIN_EVAL_PROMPTS = [
  {
    id: "builtin:pelican-svg-bike",
    name: "SVG 鹈鹕骑自行车动画",
    content: "使用 svg 画一个鹈鹕骑自行车的 html 动画，要求：完整的单文件 HTML，画面中有可辨认的鹈鹕和自行车，鹈鹕的翅膀或腿有运动，车轮转动。只输出 HTML 代码。",
    evaluationType: "visual",
    expectedAnswer: null,
  },
  {
    id: "builtin:cat-clock-svg",
    name: "SVG 猫咪时钟动画",
    content: "使用 svg 画一个猫咪造型的挂钟 html 动画，时针分针要真实转动，猫的眼睛会眨，钟摆摆动。完整的单文件 HTML，只输出 HTML 代码。",
    evaluationType: "visual",
    expectedAnswer: null,
  },
  {
    id: "builtin:solar-system-html",
    name: "HTML 太阳系行星动画",
    content: "用 HTML + CSS 动画做一个太阳系示意图，八大行星绕太阳公转，轨道清晰、行星大小有区分、有名称标注。完整的单文件 HTML，只输出 HTML 代码。",
    evaluationType: "visual",
    expectedAnswer: null,
  },
  {
    id: "builtin:aquarium-svg",
    name: "SVG 水族箱动画",
    content: "使用 svg 画一个水族箱 html 动画，里面有游动的鱼、气泡上浮、水草摆动，鱼要有可辨认的身体与鱼鳍。完整的单文件 HTML，只输出 HTML 代码。",
    evaluationType: "visual",
    expectedAnswer: null,
  },
  {
    id: "builtin:steam-train-svg",
    name: "SVG 蒸汽火车动画",
    content: "使用 svg 画一列蒸汽火车的 html 动画，车轮转动、烟囱冒烟、火车沿轨道前进。完整的单文件 HTML，只输出 HTML 代码。",
    evaluationType: "visual",
    expectedAnswer: null,
  },
  {
    id: "builtin:arithmetic-order-of-operations", name: "算术：四则运算", expectedAnswer: "10", evaluationType: "arithmetic",
    content: "计算 84 ÷ 7 + 3 × 2 − 8 的结果。只输出一个阿拉伯数字，不要解释、单位或 Markdown。",
  },
  {
    id: "builtin:arithmetic-candy", name: "算术：糖果平均分", expectedAnswer: "46", evaluationType: "arithmetic",
    content: "有一些糖果，取走 6 颗后，剩余糖果平均分给 4 人，每人 10 颗。原来有多少颗糖果？只输出一个阿拉伯数字，不要解释、单位或 Markdown。",
  },
  {
    id: "builtin:arithmetic-chickens-rabbits", name: "算术：鸡兔同笼", expectedAnswer: "3", evaluationType: "arithmetic",
    content: "鸡兔同笼，共有 8 个头、22 条腿。兔子有多少只？只输出一个阿拉伯数字，不要解释、单位或 Markdown。",
  },
  {
    id: "builtin:arithmetic-age", name: "算术：年龄", expectedAnswer: "6", evaluationType: "arithmetic",
    content: "父亲当前年龄是儿子的 4 倍，12 年后父亲年龄是儿子的 2 倍。儿子当前几岁？只输出一个阿拉伯数字，不要解释、单位或 Markdown。",
  },
  {
    id: "builtin:arithmetic-work", name: "算术：工程", expectedAnswer: "2", evaluationType: "arithmetic",
    content: "甲单独完成工程需要 6 天，乙单独完成需要 3 天，两人同做需要多少天？只输出一个阿拉伯数字，不要解释、单位或 Markdown。",
  },
  {
    id: "builtin:arithmetic-discount", name: "算术：折扣", expectedAnswer: "90", evaluationType: "arithmetic",
    content: "120 元商品先打八折，再减 6 元，实付金额是多少？只输出一个阿拉伯数字，不要解释、单位或 Markdown。",
  },
  {
    id: "builtin:arithmetic-average", name: "算术：平均数", expectedAnswer: "13", evaluationType: "arithmetic",
    content: "8、11、13、15、x 的平均数为 12，x 是多少？只输出一个阿拉伯数字，不要解释、单位或 Markdown。",
  },
  {
    id: "builtin:arithmetic-binary", name: "算术：二进制", expectedAnswer: "22", evaluationType: "arithmetic",
    content: "二进制 10110 的十进制值是多少？只输出一个阿拉伯数字，不要解释、单位或 Markdown。",
  },
];

export function findBuiltinPrompt(id) {
  return BUILTIN_EVAL_PROMPTS.find((p) => p.id === id) || null;
}

export function isBuiltinPromptId(id) {
  return typeof id === "string" && id.startsWith(BUILTIN_PROMPT_PREFIX);
}
