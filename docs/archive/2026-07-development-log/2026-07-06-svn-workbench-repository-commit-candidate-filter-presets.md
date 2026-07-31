# SVN Workbench 仓库级提交候选筛选预设

日期：2026-07-06

阶段：开发 -> 测试

## 背景

提交页已经支持内置筛选预设，但不同团队常有自己的固定提交范围，例如：

- 只看订单模块配置。
- 只看未版本控制的配置文件。
- 只看 docs 目录文档。
- 只看 AI 推荐后仍属于某个模板预设的文件。

本轮新增仓库级自定义筛选预设，团队可以通过 `.svn-workbench.json` 统一维护常用筛选入口。

## 配置位置

仓库根目录：

```json
{
  "commitCandidateFilterPresets": [
    {
      "id": "teamConfig",
      "label": "团队配置",
      "description": "只看团队配置变更",
      "filters": {
        "templateGroup": "config",
        "fileType": "json",
        "status": "unversioned",
        "hideGenerated": true,
        "aiDecision": "needsReview"
      }
    },
    {
      "id": "teamDocs",
      "label": "团队文档",
      "description": "只看 docs 目录文档变更",
      "filters": {
        "search": "docs/",
        "templateGroup": "document",
        "hideGenerated": true
      }
    }
  ]
}
```

## 支持字段

`filters` 支持：

- `search`
- `status`
- `fileType`
- `templateGroup`
- `hideGenerated`
- `aiDecision`

未配置的字段会回到安全默认值：

- `search = ""`
- `status = "all"`
- `fileType = "all"`
- `templateGroup = "all"`
- `hideGenerated = true`
- `aiDecision = "all"`

## 校验规则

仓库级预设会被校验后再进入页面：

- `id` 只能包含字母、数字、下划线和中划线，最多 64 位。
- `label` 不能为空。
- `filters` 必须是对象。
- 与内置预设 ID 冲突时跳过仓库预设。
- 同一仓库配置内重复 ID 时跳过后出现的项。
- 配置错误会在提交页提示 `筛选预设配置提醒`。

## 页面交互

提交页面打开时：

1. 读取 `.svn-workbench.json`。
2. 解析 `commitCandidateFilterPresets`。
3. 与内置预设合并。
4. 显示在 `筛选预设` 下拉框中。
5. 用户套用后，现有筛选框同步变化。

仓库预设仍可继续配合：

- `只选当前筛选`
- `加入当前筛选`
- `移除当前筛选`
- `预览提交计划`

## 安全边界

仓库级预设只影响筛选显示和批量勾选范围：

- 不自动提交。
- 不绕过生成物隐藏。
- 不绕过阻止项和默认排除项。
- 不修改工作区文件。
- 不自动写入 `.svn-workbench.json`。

## 跨平台一致性

`.svn-workbench.json` 位于仓库根目录，Windows 和 macOS 读取同一份配置。
预设解析运行在 TypeScript 层，不依赖平台命令。

## 验证

已通过：

- `npm.cmd run compile`
- `npm.cmd run test:extension`
- `npm.cmd audit`

新增测试：

- `parses repository commit candidate filter presets`
- `reads repository commit candidate filter presets`

