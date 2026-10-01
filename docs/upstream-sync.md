# 上游同步凭证

`Upstream Sync Candidate` 每 6 小时检查上游，更新本仓库的 `master` 镜像，
并准备合入 `product` 的 `sync/upstream` 候选 PR。不会自动合并或部署。

同步可能涉及 `.github/workflows/` 文件，默认 `GITHUB_TOKEN` 无法完成此类推送。
因此准备任务必须使用仓库 Secret `UPSTREAM_SYNC_TOKEN`，同时供
`actions/checkout` 的 Git 凭证和创建 PR 的 `GH_TOKEN` 使用。
缺少 Secret 时会在任何 checkout 或推送前明确报错，不会回退到默认凭证。

## 一次性配置

1. 在 GitHub Settings → Developer settings → Personal access tokens 中创建
   fine-grained token，Resource owner 选择 `kele1221`，仅选择 `9router` 仓库。
2. Repository permissions 设置：
   - Contents: Read and write
   - Pull requests: Read and write
   - Workflows: Read and write
3. 在仓库 Settings → Secrets and variables → Actions 中新增 Repository secret，
   名称为 `UPSTREAM_SYNC_TOKEN`，值为刚创建的 token。
4. 将工作流修复提交到 `product` 后，在 Actions → Upstream Sync Candidate 中
   对 `product` 手动运行一次，检查 Prepare、验证和结果报告。

也可以在本机执行 `gh secret set UPSTREAM_SYNC_TOKEN --repo kele1221/9router`，
通过交互输入设置值。不要把 token 写入源码、命令参数或聊天消息。

凭证到期后需要更新 Secret。验证、结果报告和冲突提醒任务继续使用各自最小权限的
默认凭证；专用 token 不传入候选代码的测试或构建任务。
