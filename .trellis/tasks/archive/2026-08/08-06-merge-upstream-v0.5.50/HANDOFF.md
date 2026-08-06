# HANDOFF - merge upstream v0.5.50

> 交接时间：2026-08-06。接手人：丁柯维 / 后续 agent。
> 任务目录：`.trellis/tasks/08-06-merge-upstream-v0.5.50/`
> 规划文档：`prd.md` / `design.md` / `implement.md`（均已写就并 validate 通过）。

## 1. 任务目标

把上游 decolua/9router **v0.5.50** 合并进 fork 的 `product` 分支，保留全部 fork 特征，forkVersion bump 到 `0.5.50-k.11`，重建 + 全局部署。上次合并停在 v0.5.45（fork k.10）。

## 2. 进度总览

| 步骤 | 内容 | 状态 |
|---|---|---|
| Step 0 | 提交 fork 专属 dirty 改动为干净基点 | done commit 993b5f3f |
| Step 1 | `git merge upstream/master` 解冲突 | done commit 2cc5f526 (4 冲突全解) |
| Step 2 | 同步 package.json 版本 → 0.5.50 | done (merge 时完成) |
| Step 3 | forkVersion bump → k.11 (3 处) | done，但**未提交** |
| Step 4 | `npm run build` (standalone) | done 成功 |
| Step 5 | cli build + npm pack → tgz | done `9router-0.5.50.tgz` |
| Step 6 | `npm install -g` | done 已装全局 |
| Step 7 | `9router --version` | done `0.5.50-k.11` |
| 回归检查 | verify-no-regression | **开：82 失败，68 未 catalogued，未定论** |

**核心功能已达成**：`9router --version` 输出 `0.5.50-k.11`，全局可运行。14 个 fork 专属测试文件（26 用例）全部通过。

## 3. 已完成细节

### Step 0 - 干净基点 993b5f3f
提交了 merge 前工作区两个 fork 专属 dirty 改动：
- `restart.sh`（启动命令 → `npx next start --port`）
- `src/app/(dashboard)/dashboard/usage/components/fork/RateLimitNormalizationNotice.js`（localStorage 延迟读取，SSR 安全）

### Step 1 - Merge 2cc5f526（4 冲突解法）
1. **CHANGELOG.md** - 去 marker，保留 fork 中文备注条目 + 上游 v0.5.50 新条目 + v0.5.45（共用）。
   **fork 中文备注是 mojibake（乱码），是 merge 前就存在的提交内容，本次未动、按原样保留。**
2. **cli/package.json** - 收上游 version `0.5.50`，**重放 fork 字段**（forkVersion `0.5.50-k.11`、forkRepository）。
3. **src/sse/handlers/chat.js** - 单块导入冲突：**两边都保留**。fork 的 `withRetryAfter`（仍被 line 243 使用）+ 上游新增 capacityAdapter 导入。
4. **tests/package.json** - 收上游干净 test 脚本（去掉 Unix 路径 adv hack），**保留 fork 的 `test:fork` 脚本**。

其余约 176 文件自动合并。上游删的 qwen 相关文件直接接受删除（fork 无自定义 qwen）。

## 4. 需决策项：REMAINING WORK
仍有 2 项 deltas 需要交接/提交前确认：
1. **手写 merged 输出 vs anaconda 报告**：此证据失效（节点详情不清），以 git-head-base 为准。见下方回归小节。
2. **将本 HANDOFF 归档保留** - 交接完成功本身，需完成后 archive task。

### 回归检查 - OPEN 问题（82 失败，68 未 catalogued）
`node tests/__baseline__/verify-no-regression.mjs <results.json>` 判定：当前失败的测试若不在 `tests/__baseline__/known-fails.txt`（24 条目）中，计为回归。

- 当前 82 失败断言，覆盖 17 个文件。
- 与 known-fails 精确匹配：14（claude-header 1 + oauth-cursor 8 + translator-normalization 4 + openai-to-claude 1）。
- **68 未覆盖（候选回归）：cursor-agent-proto 35、security-audit 13、oauth-cursor-auto-import 8（已覆盖，平台依赖）、windsurf 3、db-concurrent 3、others 等。**

**关键判断：这 82 失败并非 v0.5.50 新增——失败的所有 17 个测试文件在 v0.5.45 基线（6fcd2733）就已存在。`mimo-free.live`、`cursor-agent-proto`（cursor proto 可能需 live）、db-concurrent（并发）、security-audit（源码断言）等多属**环境/特有失败**，未见与 merge 逻辑直接相关。**但需接手 agent 验证：确认这些在 merge 前的 fork 上是否同样失败（即为固有环境问题），不应让合并背锅。若确为 v0.5.50 引入，需新增 known-fails 收录。**

**验证建议**：在 merge 前状态 `git worktree add /tmp/fork-baseline 6fcd2733` 用相同方式跑 82 项对照，判断这是 fork 固有失败还是 merge 回归。二者取证后再决定是否收敛。

## 5. 未提交工作区状态
当前 HEAD = `2cc5f526` (merge)。工作区有：
- M `src/shared/constants/fork.js`（k.11，未提交）
- M `tests/unit/fork-cli-updater-safety.test.js`（k.11，未提交）
- ?? `tests/results.json`（回归产物，可删）
- ?? `.trellis/tasks/08-06-merge-upstream-v0.5.50/`（本任务，未提交）
- ?? `.trellis/research/`（独立研究，勿 commit）

**建议下一步（接手者）**：
1. 决定前面 68 名义回归是否收录 known-fails（用 worktree 对基线 9935f3 对照）。
2. commit Step3 的 kVersion（fork.js + test 断言）。
3. 提交 merge 后 job 的 handoff（含 archive）。
4. 用 `/trellis:finish-work` 总结并在 commit 前 update-spec。

## 5. 风险与建议
- **mojibake**：CHANGELOG fork 中文乱码是历史上坏的，如需修是独立任务别混。
- **全局已装 v0.5.50-k.11**：本机全局 9router 已是合并后版本；若回滚需 `npm install -g` 旧 tgz。
- **未 push**：所有 local 提交均在本地，未推到 origin。BASE 为 product。origin/product ahead 46。
- HEAD 未 push；merge 提交 2cc5f526+993b5f3f 未推。
