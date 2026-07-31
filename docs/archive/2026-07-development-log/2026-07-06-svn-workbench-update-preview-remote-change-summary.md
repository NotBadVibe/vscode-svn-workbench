# SVN Workbench 更新预览远端变更摘要

日期：2026-07-06

阶段：开发 -> 测试

## 背景

上一轮更新预览已经展示本地未提交变更摘要。
但用户在执行更新前，还需要知道当前范围内是否存在远端过期项，例如远端已修改或删除的文件。

本轮新增“远端变更摘要”，让 `预览更新` 更接近“先看清楚，再决定是否更新”的工作方式。

## 页面入口

提交页面 -> `预览更新`

预览内容新增：

- 远端更新检查是否执行。
- 检查到的仓库版本。
- 远端变更总数。
- 按 `repositoryStatus` 聚合的远端状态。
- 前 8 条远端变更文件明细。
- 远端检查失败时的错误提示。

## 实现方式

点击 `预览更新` 时：

1. 先生成本地更新预览。
2. 执行 `svn status --show-updates --xml <当前范围>`。
3. 复用远端状态 XML 解析逻辑。
4. 将远端过期项汇总到更新预览中。
5. 如果远端检查失败，只展示失败原因，不阻断本地预览。

## 示例

```text
远端更新检查: 已执行
检查版本: 18
远端变更: 3
远端状态: deleted 1，modified 2
- src/order.ts: modified
- docs/readme.md: modified
- old/config.json: deleted
```

## 安全边界

该能力只做远端状态检查：

- 不执行 `svn update`。
- 不修改工作区文件。
- 不解决冲突。
- 不自动提交。
- 远端检查失败不影响本地更新预览。

真正更新仍需用户点击 `更新当前范围` 并确认。

## 核心实现

新增核心能力：

- `UpdateScopeRemoteChangeSummary`
- `checkUpdateScopeRemoteChanges`
- `summarizeUpdateScopeRemoteChanges`

扩展：

- `UpdateScopePreview.remoteChanges`
- `UpdateScopePreview.remoteCheckError`

Webview 新增：

- `formatUpdateRemoteChangeSummary`

## 跨平台一致性

远端检查使用标准 SVN CLI：

```powershell
svn status --show-updates --xml <当前范围>
```

Windows 和 macOS 的解析、展示和失败降级逻辑一致。

## 验证

已通过：

- `npm.cmd run compile`
- `npm.cmd run test:extension`
- `npm.cmd audit`

新增测试：

- `summarizes update scope remote changes`

