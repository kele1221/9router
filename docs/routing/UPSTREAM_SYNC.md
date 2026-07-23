# 上游同步手册

## 分支职责

- `master`：只读镜像，始终与 `decolua/9router:master` 保持一致。
- `product`：当前定制生产分支，不允许自动覆盖。
- `sync/upstream`：自动同步使用的临时分支。

## 自动流程

GitHub Actions 每 6 小时以及手动触发时检查上游。发现新提交后：

1. 快进 fork 的 `master` 镜像。
2. 尝试将上游合入 `sync/upstream`。
3. 创建或更新面向 `product` 的同步 PR。
4. 使用只读权限运行 Fork 阻断性回归测试和生产构建。
5. 冲突时创建并指派 Issue，不自动选择 `ours` 或 `theirs`。

同步 PR 必须人工检查并合并。合并后再创建 Fork Release，本机更新中心只识别 Fork Release，不安装官方 npm 包。
