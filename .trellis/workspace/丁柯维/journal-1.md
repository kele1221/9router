# Journal - 丁柯维 (Part 1)

> AI development session journal
> Started: 2026-07-29

---



## Session 1: Merge upstream v0.5.45 into product & fix update-center state

**Date**: 2026-07-31
**Task**: Merge upstream v0.5.45 into product & fix update-center state
**Package**: dashboard
**Branch**: `product`

### Summary

Merged upstream master v0.5.45 (34 commits) into release/k.10, bumped forkVersion to 0.5.45-k.10, pushed product branch to resolve update-center showing 34 stale upstream commits. Update center compares remote product...decolua:master; local merge without pushing product kept the banner active.

### Git Commits

| Hash | Message |
|------|---------|
| `0c43eaea` | (see git log) |
| `6cde9d61` | (see git log) |

### Status

[OK] **Completed**

---

**Date**: 2026-08-06
**Task**: Merge upstream v0.5.50 into product & close regression verdict
**Package**: dashboard
**Branch**: `product`

### Summary

Completed the v0.5.50 fork merge. Deployed `9router` global as `0.5.50-k.11`. Closed the open regression question: of 82 `verify-no-regression` failures, only 2 were real merging regressions (rest fixed/inherent).

### Regression forensics

Used `git worktree add /tmp/baseline 993b5f3f` (pre-merge fork) + symlinked `node_modules`/`tests/node_modules`, ran the same 17 failing files, diffed `(file, fullName)` failure sets:
- 66 failures identical on baseline → fork-inherent/env failures (cursor-agent-proto, security-audit, db-concurrent, live) — NOT regressions, no known-fails catalogue change.
- 2 failures post-merge-only in `tests/unit/request-details-tab.test.js` → real regressions.

### Root cause & fix

Upstream v0.5.50 renamed the observability gate setting `enableObservability2` → `enableObservability` (`src/lib/db/repos/requestDetailsRepo.js` `getObservabilityConfig()`, `settingsRepo.js` default, `profile/page.js`). Fork test setup still set the old name → logging silently disabled → `getRequestDetailById` returned null, `getDistinctProviders` missed `'anthropic'`. Fixed `tests/unit/request-details-tab.test.js:25` to use the new key. Both touched test files green.

### Git Commits

| Hash | Message |
|------|---------|
| `f4f3ce4a` | chore(fork): bump forkVersion k.11 + fix observability flag regression from v0.5.50 |
| `2cc5f526` | Merge upstream/master (v0.5.50) into product |
| `993b5f3f` | chore(fork): restart.sh npx-next-start + SSR-safe notice dismissal |

### Spec updates

- `dashboard/persistence.md`: documented observability gate contract + rename gotcha.
- `cross-layer-thinking-guide.md`: "judging merge regressions vs inherent env failures" workflow.

### Status

[OK] **Completed**

---

**Date**: 2026-08-14
**Task**: Merge upstream v0.5.55 into product & close regression verdict
**Package**: dashboard
**Branch**: `product`

### Summary

Merged upstream v0.5.55 into `product`, deployed `9router` global as `0.5.55-k.12`. SAML SSO, Alibaba Token Plan, Fish Audio TTS, Gemini 3.7 Flash, security fixes (GHSA x-9r-real-ip, SSRF guard) included.

### Conflicts resolved (3 files)

1. `CHANGELOG.md` — kept fork Chinese entries at top + upstream v0.5.55 entry (mojibake preserved as-is).
2. `cli/package.json` — upstream `version: 0.5.55` + fork fields (`forkVersion: 0.5.55-k.12`, `forkRepository`).
3. `src/lib/db/repos/settingsRepo.js` — upstream SAML settings added, fork's `enableObservability: true` default kept (fork fix from v0.5.50).

### Regression forensics

Baseline worktree `c3555bcb` (clean merge base), same 20 failing files, diffed `(file, fullName)` sets: 86 baseline failures vs 88 post-merge; only **2 merge-only candidates**:
- `golden-url-header.test.js` clinepass → inherent env issue (snapshot platform: upstream linux/node v24.15 vs local darwin; 4 sibling golden fails already baseline-inherent, not catalogued).
- `translator-helpers-edge.test.js` system hoist → **real regression**: upstream `7e5f5a88` intentionally folds mid-conversation system messages into neighbouring user turn (copy-on-write), but did not update the test. Adapted test to the new fold contract (7/7 green).

### Git Commits

| Hash | Message |
|------|---------|
| `881e48a5` | chore(fork): bump forkVersion k.12 + adapt passthrough system-fold regression from v0.5.55 |
| `c3723d3e` | Merge remote-tracking branch 'upstream/master' into product (v0.5.55) |
| `c3555bcb` | chore(fork): restart.sh background launch + usage overview in 千万 units |

### Spec updates

- `engine/translator-conventions.md`: documented passthrough system folding contract change (v0.5.55).

### Status

[OK] **Completed**

## 2026-10-11 — fix(commandcode): 缓存 token 采集与会话亲和性

Task: `.trellis/tasks/10-11-fix-commandcode-cache-tokens` (branch `fix/commandcode-cache-tokens`)

**症状**：用户反馈 CommandCode provider 的缓存恒为 0，但直连官方有缓存。本地遥测 62,838 条请求中 `commandcode` 的 3,489 条 `cached_tokens` 全为 0（累计 2.57 亿 prompt tokens 全按全价计费）。

**根因（两个独立缺陷）**：
1. `USAGE_EXTRACTORS.commandcode` 只读 `inputTokens/outputTokens/totalTokens`，从不读缓存字段 —— 而 claude/gemini/kiro/ollama 分支都读了。实测 72000 缓存 token 被丢弃，`cached_tokens` 恒为 0。因为 `calculateCostFromTokens()` 靠减去 `cached_tokens` 来套用缓存价，缓存命中部分被按全价计费（实测 14.5× 高估）。
2. `threadId`（body）与 `x-session-id`（header）每请求 `randomUUID()`，破坏上游会话亲和性 → 每轮可能落到冷节点 → 前缀缓存失效。而**稳定的会话 id 其实已经算好了**（`credentials._clientSessionId` / `providerSessionId`），只是被丢弃。

**为什么其他供应商同模型正常**：不是模型差异，是代码路径差异。OpenAI 兼容上游走通用响应路径，`extractUsage()` 天然读缓存字段；CommandCode 是私有 NDJSON 协议，必须走专属翻译器，缓存字段得手工映射 —— 漏了。所以这是 9Router 的集成 bug，不是供应商的 bug。

**关键推断**：用「库中存在 7 行 `prompt_tokens < 2001`」反证线上 usage 是 v5 扁平格式（若是 v6 嵌套，`n()` 得 0 → 触发估算兜底 +BUFFER_TOKENS 2000）。因此修复必须双命名兼容。

**交付**：
- `c2f0391b` 双命名兼容的 usage 提取器（v5 `cachedInputTokens` / v6 `inputTokenDetails.cacheReadTokens` / DeepSeek `prompt_cache_hit_tokens`）
- `87ebdc99` `toUuidSessionId()` + 翻译器/executor 接线，body 与 header 字节一致
- `e64aa903` spec + CHANGELOG

**验证**（都是可复现命令，不是"应该没问题"）：
- 6 个 commandcode 测试文件 62 tests 全绿
- **非空洞测试**：单独 revert Bug A → 5 个测试失败；revert Bug B → 7 个测试失败
- 全量套件：16 个失败**逐条与 pristine 树完全相同**，引入 0 个新失败
- e2e：多轮对话经真实 `resolveSessionId` 路径 → 1 个会话 1 个亲和键，header==body
- lint 干净；`buildHeaders` 签名与 `base.js` 调用点对齐；`validate/route.js` 3 参调用仍兼容

**踩到的坑（值得记）**：
- 仓库自带的 `tests/__baseline__/verify-no-regression.mjs` 用 `/app/` 切路径，在本机绝对路径下解析出 `undefined :: <testname>`，导致它把该仓库**既有的 16 个失败**全报成 regression（false positive）。判定必须自己比对失败集合，不能只看这个脚本的退出码。
- AI SDK v5 → v6 把 `cachedInputTokens` 改成了 `inputTokenDetails.cacheReadTokens`；上游 CLI 已升到 v6，而 registry 还 pin 在 `x-command-code-version: 0.25.7`。双命名兼容是防「升级后再次静默归零」的关键。
- **不要上报 `reasoningTokens`**：`calculateCostFromTokens()` 把它加在 `completion_tokens` 之上，而 AI SDK 的 `outputTokens.total` 已含 reasoning，上报会造成新的重复计费（实测 +8.9%）。

**未关闭**：AC10（真实凭据端到端）因无凭据未验证。Bug A 会把缓存值写成 0，因此在修复 A 之前无法区分"缓存其实命中只是没记录"与"缓存真的没命中"—— Bug B 是否真实存在，需修复后跑真实流量或用带凭据的 curl 探针观测 `finish.totalUsage` 才能定论。

## 2026-10-11 (part 2) — 回归闸门修复、CommandCode CLI 升级、发布 k.2

### 1. 修复 `verify-no-regression.mjs` 的假阳性（用户要求）

**根因**：脚本用 `f.name.split("/app/")[1]` 构造比对键，假设套件跑在含 `/app/` 的容器路径下。在本机绝对路径下 split 得到 `undefined`，于是：
- **每个**失败都被报成 regression（干净 checkout 上 16 个假阳性）
- 已知失败**永远匹配不上**，闸门永远不可能通过 → 于是被所有人无视

这比"脚本报错"更危险：一个永远红的闸门等于没有闸门，真回归会被淹没。

**修复**：可移植路径派生（优先取最后一个 `/tests/` 段，兼容 Windows 分隔符与 `/app/` 容器路径）、提示已过期可清理的 known-fails 条目、报告文件缺失/损坏时以退出码 2 明确报错。

**附带发现**：`known-fails.txt` 已完全腐烂 —— 原 24 条**现在全部通过**，而当前 16 个真实失败**一条都没被收录**。已按真实运行重新生成。

**验证**：当前状态 PASS；注入一个新失败 → 正确 exit 1；`/app/` 风格路径 → PASS；无参数/坏 JSON/空报告 → exit 2 且有明确提示。

### 2. CommandCode CLI 版本任务（Trellis 任务 `10-11-upgrade-commandcode-cli-version`）

新建任务并完成：`x-command-code-version` 从硬编码 `0.25.7` 改为 `COMMANDCODE_CLI_VERSION = "1.79.2"`（npm dist-tags.latest 实测）。**决定性证据**：解包 1.79.2 tarball 后确认 CLI 用 `[$v.CLI_VERSION]: e.cliVersion` 发送自身 package.json 版本 —— 也就是我们那条 header 声称的版本落后了约 70 个 release。加测试锁定 header == 常量，防止再次静默漂移。

### 3. 对抗式复核发现的问题（全部修复）

我派了一个 subagent 做对抗式复核，它找出 2 个 HIGH、3 个 MEDIUM。**每一条我都先自己复现再修**：

- **HIGH-1**：v6 的 `inputTokens.cacheRead` 内联形态根本没读 → 又回到"静默归零"。原 v6 测试因为总是同时给 `inputTokenDetails` 而漏掉。已复现并修复。
- **HIGH-2（安全）**：`_clientSessionId` 来自**未鉴权的客户端输入**，却原样作为上游亲和键 → 任意客户端可把别的连接/租户的请求钉到自己选定的后端节点（缓存计时侧信道 + 跨租户争用）。这是**我这个提交新引入的攻击面**（改之前两处都是服务端 randomUUID）。新增 `toScopedSessionId()` 按 `connectionId` 加盐。
- `cached > input` 未夹取 → 下游 ~6600× 高估 + 给 Claude 客户端发负数 `input_tokens`；而**我原来的测试还把 999999 这个错误值写成了断言**，等于把 bug 固化。已改为断言夹取结果。
- `/api/translator/translate` 在 transformRequest 之前、不传 body 就建 header → header 与 body 不一致。已修复。
- MEDIUM（会话派生按连接而非按会话、缺 connectionId 静默失亲和、providerOverrides 会覆盖 body 派生 header）：**属 40+ 供应商共用的 `sessionManager` / 用户显式覆盖语义，改动影响面远超本 provider**，因此写进 spec 记录而非在本任务改。

**教训**：如果我不做对抗式复核就发布，会带着一个我自己引入的跨租户安全漏洞和一个"测试固化了 bug"的问题上线。

### 4. 发布 v0.5.99-k.2

按 `9router-release` 技能：forkVersion `k.1 → k.2`（`src/shared/constants/fork.js` + `cli/package.json`）、更新测试断言、CHANGELOG 定日期、`release/k.2` 分支 → PR #31（CI 全绿）→ 合并 product → tag `fork-v0.5.99-k.2` → GitHub Release（`build-release` workflow 已自动创建，补了详细 notes）。

### 踩到的坑（值得记）

- **`db-sqlite-vs-lowdb.test.js` 是 flaky**：priority 重排断言。我起初以为它 PASS，后来 3 次里失败 1 次；在**干净基线 2f13a089 上 4/4 全失败**，证明是既有间歇性失败而非我的回归。已连同原因记入 known-fails。
- **bash heredoc 里的中文 PR body 会被引号截断** → 改用 `--body-file`。同理 release notes 用 `--notes-file`。
- `gh release create` 会报 `tag_name already exists` —— 因为 `build-release` workflow 已经自动建了 Release。应该用 `gh release edit` 补 notes，而不是重复 create。
- 用户要求修闸门时，**不能只改路径**：`known-fails.txt` 已腐烂，只修脚本会立刻暴露出 16 个"新"失败。必须同时重建基线，否则把假阳性换成真噪音。

## 2026-10-12 · fix(routing): 模型级 4xx 误伤组合回退 + 注册表过期

用户报 `super-deepseek` 组合整轮失败 400。Trellis 任务 `10-12-routing-model-4xx-combo-fallback`（PRD + design + implement 齐全）。

### 根因：一个函数回答了两个不同问题

`checkFallbackError()` 表面是"要不要冷却账号"，但 `combo.js` 把它当"要不要试下一个模型"用。多数错误上两者答案一致 —— 这正是隐性耦合能存活的原因。**分歧点在模型级错误**：上游不认这个 model id 时，正确答案相反 —— 不罚凭证、但要换模型。

`20a43f5a`（本意正确的 4xx 修复）引入的 `shouldFallback:false` 兜底让 combo 读成了"停"。所以一个成员的上游改名直接让整轮失败，后面 3 个健康成员一次都没被调用。

### 修复

- 新增 `isModelLevelError()`（400/404/422 + marker 表，runtime-overridable，与 `rateLimitMarkers` 同构）+ `shouldTryNextModel()`。
- **`checkFallbackError` 自身返回值没动** —— 只新增 `modelScoped` 附加字段。直接翻转它会重新引入 `20a43f5a` 修掉的账号误锁。
- 判定顺序是关键，我第一版写错了：放在 `ERROR_RULES` 循环之后，结果 `{status:404}` 规则先命中，"model not found" 仍然锁账号 2 分钟。改成 **文本规则 → 模型级 → 状态规则** 三段式才正确。两个方向都会踩：放状态规则之后会误锁；放文本规则之前会盖掉 codex 的 `model is not supported when using codex with a chatgpt account`（**账号级**规则，30 分钟冷却）。
- `deepseek-v4.1-flash → deepseek-flash`（`upstreamModelId`，本地 id 不动 → 用户组合配置无需改库）。
- clinepass 注册表 4 个 404 id 换成 13 个实测 200 的 id。

### 证据强度

所有结论都用真实凭证实测过，不靠推断：
- DeepSeek `/models` 只返回 `deepseek-flash` + `deepseek-v4-pro`；逐 id 探测 400/200。
- ClinePass 逐 id 探测，且**复核了最终列表全部 13 项**（gate G3）。
- 关键发现：`cline-pass/*` 是独立命名空间，`/api/v1/models` 的 458 条里 `cline-pass/` 前缀 **0 条**，所以 `resolveClinepassModels()` 永远拉不到 → 注册表**必须**手工维护（写进代码注释，防止后来者以为能自动同步）。

### 测试

23 个新测试 / 4 文件。**验证过 12 个在修复前会失败** —— 不然只是把新代码固化进断言。其中 AC2（不写 `modelLock_*`）直接在真实 `markAccountUnavailable` 路径上断言 `updateProviderConnection` 未被调用，并保留 429/401 仍锁账号的守护用例。

### 坑

- **`git stash` 验证"测试是否有效"很好用**：stash 源码改动 → 跑新测试看是否失败 → pop。比事后争论强。
- **`verify-alias` / `verify-providers` 本来就是红的**（kimi transports、minimax provider 漂移，与本次无关）。判断方法：在干净 HEAD 上先跑一遍，再对比 diff 集合是否一致 —— 我对比后确认**我的注册表改动对 verifier 是 byte-neutral 的**。
- `if (!shouldFallback) return` 在 `buildModelLockUpdate` **之前**，所以"模型级错误不锁账号"是结构性保证，不只是测试巧合。
- commit message 里混进了一个乱码 token（`胶囊-caps`），`--amend -F` 修掉 —— 生成日文/中文混排文本时要复查。

### 未做（明确超出范围）

`deepseek-v4-pro-max` / `-none` 实测也是 400（上游移除了 `-max`/`-none` 变体）。本次只在注释里标注，未改动 —— 需要时另立任务。

## 2026-10-17 · 网络质量监控与诊断模块（net-monitor C1–C7）

父任务 `.trellis/tasks/10-16-net-monitor`，7 个子任务全部完成。136 个新单测，build 通过，全量回归无回归。

### 最重要的一条：ICMP 丢包 ≠ 网络故障

真机实测（用户本人的 Mac）：

| 协议 | 成功率 |
|---|---|
| ICMP ping 1.1.1.1 | **7/10**（30% 丢包） |
| TCP 443 到同一目标 | **10/10** |
| HTTPS | **10/10** |

真实流量（百度/GitHub/Anthropic 各 3 次）**9/9 全通**，20128 生产实例响应 7ms。丢的全是 ICMP —— 运营商对 ICMP 降优先级是常态。

**第一版把 ICMP 丢包当成"网络质量差"显示成 `丢包 100%`，是纯误报。** 修法：ICMP 指标与传输层指标分开统计，ICMP 全失败或 ≥30% 丢包、但 TCP/DNS 全通 → 判定"ICMP 被限速或过滤，不影响实际使用"，不报警。`attribution.js` 与 `constants.js` 用同一套规则，避免卡片与结论打架。

**教训：监控指标要和它代表的东西对得上。** ping 通不通和"网能不能用"是两件事，混在一起会让模块天天喊狼来了，用户三周后就不看了。

### 其他抓到的真 bug

1. **`fping -q` 把摘要写到 stderr**，而 `execProbe` 只读 stdout → 自检永远失败、静默降级到 `ping`，fping 永远用不上。这个 bug 不会报错，只会让"首选后端"永不生效。
2. **`fping` 不接受 `ping` 的 `-W`**（`-p`/`-t` 才是它的），用 ping 的 flags 探测 fping 会得到 `invalid option`。
3. **归因优先级错**：原本"所有探测失败 → 本机网挂了"排第一，但 VPN 掉线时所有探测也会失败 → 指向本机网，把人引到错误方向。改成**已观测到的 VPN 掉线优先于全断**（更具体的原因优先）。
4. **`running` 用 timer 句柄推导**：`tick()` 开头把 `g.timer = null`，导致采集进行中查询看到 `running: false`，UI 每 10s 轮询撞上就闪"未启动"。拆成 `running`（调度器活着）与 `collecting`（本轮进行中）。加了回归测试，并**回退修复验证过该测试会失败**。
5. **`settingsRepo` 是浅合并**：用户存 `netMonitor: { enabled: true }` 会让嵌套的 `targets` 变 undefined。加了 `resolveNetMonitorConfig` 逐字段兜底。
6. **`getTailscaleStatus()` 依赖 9Router 自己的开关**：没在 dashboard 启用 Tailscale 时它返回 false，即使系统 Tailscale 在跑。改用直接调 CLI + `--socket`（免 sudo）。
7. **`networksetup -listallnetworkservices` 的 `*` 表示禁用**，而 `scutil --nc list` 的 `*` 表示启用 —— 语义相反，容易写反。
8. **`disableTailscale()` 会顺手把 `tailscaleEnabled` 设置改成 false**：照原样写"重连"会让用户点一次就永久关掉自己的配置。确认 `enableTailscale()` 会写回 true 才让往返成立。

### 浏览器实测才发现的（lint/build 都不报）

- **出口 IP 被截断成 `172.2…`** —— 截断的 IP 毫无用处。修法：那两张卡片 `col-span-2`。
- **Y 轴标签重叠** —— `width={44}` 配 `margin left: -12` 把刻度挤在一起。改成 `width={52}` + `left: 0`。
- 还踩到：**Tailwind 只扫描静态字符串**，`col-span-2` 在模板字面量的三元里也能生成（这次生成了），但 `Card` 的默认 `padding="md"` 会先给 `p-6`，自己的 `p-4` 覆盖它。
- **测试实例的静态 chunk 一直 500** —— 排查很久才发现每次重启都 `EADDRINUSE` 静默失败，一直是**第一个 build 的 server** 在服务。`pkill -f "PORT=20199"` 匹配不到（端口是环境变量前缀，不在进程 args 里），要用 `lsof -nP -iTCP:20199 -sTCP:LISTEN -t`。

### 流程

- **全程没碰 20128**。浏览器实测用隔离的 20199 + 临时 DATA_DIR。生产实例 PID 15917 会话期间连续运行 7h20m，未被重启。
- 探测后端三级降级 `fping` → `ping` → `TCP connect`，零新依赖。
- 安全审计：列出模块内**每一条子进程调用**逐个核对，全部是 `route -n get` / `scutil --dns|--nc list` / `ip route show` / `resolvectl status` / PowerShell `Get-*` / `ping` / `tailscale status` —— **无一条 set/down/stop/kill**。并加了自动化守护测试，操作 ID 与源码都禁止出现断网命令模式。
- 对现有文件只做附加：7 个文件 +83 行 / -1 行（唯一改导出的是给 `dnsConfig.js` 加 `flushDNS`，它原本是私有函数）。
