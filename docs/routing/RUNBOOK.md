# 400 / 429 故障处理手册

## 预期行为

当上游返回 HTTP 400，并且 JSON 中 `error.code` 或 `error.type` 精确等于 `rate_limit_exceeded` 或 `rate_limit_error` 时：

1. 9Router 将有效状态归一化为 429。
2. 原始 JSON 响应体保持不变。
3. 账号回退和模型锁使用 429 指数退避，首次为 2 秒，而不是未知 400 的 30 秒。
4. 普通 400、非 JSON 响应和其他错误码保持原样。
5. 终端输出 `RATE_LIMIT_NORMALIZED`，并在“使用量和分析”首页显示累计次数、最近时间、供应商和模型。

事件记录只保存脱敏后的连接 ID 与路由元数据，不保存供应商错误正文、请求内容或密钥。累计次数会持久化，界面最多保留最近 20 条事件摘要，并每 15 秒刷新一次。

## 排查顺序

1. 在“链路治理”确认 Claude-CN → Model-Switch、Model-Switch → 9Router、9Router → 供应商节点均通过实时校验。
2. 在“使用量和分析”顶部确认出现“已自动修正供应商限流状态”提示卡。
3. 在 Console Log 搜索 `RATE_LIMIT_NORMALIZED`，并确认错误显示为 429。
4. 确认 `modelLock_<model>` 首次约为 2 秒，而不是 30 秒。
5. 检查供应商原始 JSON 是否包含精确的 `rate_limit_exceeded` 或 `rate_limit_error` 标记。
6. 运行 Fork CI 中的 `upstream-error-*` 回归测试。

若“Claude-CN 实时入口经过 Model-Switch”失败，新启动的 Claude-CN 会话可能绕过 Model-Switch；修复 `~/.claude-cn/settings.json` 后必须重新启动 Claude-CN 会话。已运行的进程不会自动刷新环境变量。

不要把通用 400 全部改为 429，也不要依赖 Model-Switch 在 9Router 之后再次改写状态；后者无法纠正已经发生的 9Router 锁定。

## 使用情况首页图表

Fork 在上游“使用量和分析”首页下方追加与参考项目一致的五类统计图表：

1. 按模型请求数。
2. 请求趋势，仅展示所选时段内请求量最高的 5 个模型。
3. Token 分布。
4. 平均延迟对比。
5. 按 API Key 统计请求数与错误数。

模型请求、错误与延迟来自 `requestDetails` 和 `usageHistory` 的本地记录；延迟卡片会明确显示实际覆盖的观测条数。Token 与 API Key 请求数来自 `usageHistory`。由于 `requestDetails` 不记录访问密钥，API Key 错误数只包含能够由 `usageHistory` 归属到密钥的错误，页面副标题会明确提示这一口径。

接口 `/api/fork/usage-dashboard` 只返回 API Key 的名称或脱敏标识，不向浏览器返回原始密钥。除请求趋势外，其他图表不会截断模型或 API Key 分组。
