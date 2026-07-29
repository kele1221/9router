# Add Cache Hit Rate Card to Usage Overview

## Requirement
在 `OverviewCards` 顶部卡片组中增加一张"Cache Hit Rate"卡片，展示输入 token 的缓存命中率。

## Acceptance Criteria
- 新卡片显示 `cachedTokens / totalPromptTokens` 百分比
- 当 `totalPromptTokens === 0` 时显示 `—`
- 否则显示百分比，保留 1 位小数
- 布局适配：从 `lg:grid-cols-5` 改为 `lg:grid-cols-6`（6 列）
- 视觉上和现有卡片风格统一

## Formula
```
cacheHitRate = totalPromptTokens === 0 ? "—" : (totalCachedTokens / totalPromptTokens * 100).toFixed(1) + "%"
```

## Files Affected
- `src/app/(dashboard)/dashboard/usage/components/OverviewCards.js`: 加卡片

## Constraints
- 不碰后端/API/stats 数据结构（totalCachedTokens 已存在于 stats 中）
- 不新增依赖
- 不改其他卡片布局/样式
