# 400 / 429 故障处理手册

## 预期行为

当上游返回 HTTP 400，并且 JSON 中 `error.code` 或 `error.type` 精确等于 `rate_limit_exceeded` 时：

1. 9Router 将有效状态归一化为 429。
2. 原始 JSON 响应体保持不变。
3. 账号回退和模型锁使用 429 指数退避，首次为 2 秒，而不是未知 400 的 30 秒。
4. 普通 400、非 JSON 响应和其他错误码保持原样。

## 排查顺序

1. 在“链路治理”检查声明链路是否与数据库一致。
2. 在 Console Log 确认错误是否显示为 429。
3. 确认 `modelLock_<model>` 首次约为 2 秒，而不是 30 秒。
4. 检查供应商原始 JSON 是否包含精确的 `rate_limit_exceeded` 标记。
5. 运行 Fork CI 中的 `upstream-error-*` 回归测试。

不要把通用 400 全部改为 429，也不要依赖 Model-Switch 在 9Router 之后再次改写状态；后者无法纠正已经发生的 9Router 锁定。
