# 备份、迁移与回滚

## 切换前

1. 通过本地受信 CLI 令牌导出 9Router JSON 配置。
2. 停止服务，确保 SQLite WAL 完成落盘。
3. 完整备份 `~/.9router`、LaunchAgent、`~/.claude-cn/settings.json` 和 `~/.model-switch/model-switch.db`。
4. 对数据库执行 `PRAGMA integrity_check`，记录关键表行数和 SHA-256。
5. 使用数据副本和备用端口启动新版本，不能直接在生产数据库上试迁移。

备份包含 API Key 和供应商令牌，只能保存在本机权限为 700/600 的目录，禁止提交 Git 或上传公开 Release。

## 切换验证

对比 Provider Connections、Provider Nodes、API Keys、Combos、KV、Usage 和 Request Details 数量，并在“链路治理”确认 Claude-CN → Model-Switch → 9Router → 供应商链路的所有实时检查通过。

## 回滚

停止 Fork，恢复旧 LaunchAgent 和完整数据快照，再启动旧官方版本。Fork 稳定确认前不得删除基线备份和最终切换备份。
