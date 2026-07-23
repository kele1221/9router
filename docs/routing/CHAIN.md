# Claude-CN 调用链路

仓库内的 `src/shared/config/routing-chains.json` 是脱敏模板。真实生产声明保存在 `DATA_DIR/fork/routing-chains.local.json`（macOS 默认是 `~/.9router/fork/routing-chains.local.json`），不会提交到公开 Fork。界面中的链路拓扑来自本地声明与运行数据库的合并结果。

```text
Claude Code (claude-cn)
  → Model-Switch http://127.0.0.1:15721
  → 9Router Fork http://127.0.0.1:20128
  → provider node <local-provider-node-id>
  → https://provider.example/v1
```

职责边界：Model-Switch 负责客户端入口切换；9Router 负责路由、账号回退、冷却和模型锁；供应商节点负责访问真实 OpenAI-compatible 网关。供应商错误必须在 9Router 执行冷却和模型锁之前完成归一化。

任何端口、节点 ID 或供应商 Base URL 的调整，都必须修改本地覆盖文件并通过“链路治理”页面校验。Fork 变更应运行 `npm run test:fork --prefix tests`。
