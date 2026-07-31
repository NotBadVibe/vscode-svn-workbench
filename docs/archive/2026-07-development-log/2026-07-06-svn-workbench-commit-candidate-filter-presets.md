# SVN Workbench 提交候选筛选预设

日期：2026-07-06

阶段：开发 -> 测试

## 背景

提交页面已经支持文件类型、模板预设、SVN 状态、AI 建议等组合筛选，并且上一轮补齐了“当前筛选批量选择”。
但用户仍需要手动组合多个筛选框。

本轮新增“筛选预设”，把常见提交范围变成一键套用的快捷入口。

## 页面入口

提交页面 -> 候选文件工具栏：

- 新增 `筛选预设` 下拉框。
- 默认值为 `自定义筛选`。
- 套用预设后会同步更新现有筛选框。
- 用户手动修改任一筛选项后，预设状态自动回到 `自定义筛选`。

## 当前预设

已内置：

- `全部可见候选`
- `前端代码`
- `后端代码`
- `配置文件`
- `文档说明`
- `资源文件`
- `AI 推荐`

## 使用流程

典型流程：

1. 选择 `前端代码`。
2. 点击 `只选当前筛选`。
3. 选择 `配置文件`。
4. 点击 `加入当前筛选`。
5. 点击 `预览提交计划`。

这样可以快速组合常见提交范围，减少逐个勾选。

## 交互细节

套用预设时会同步：

- 路径搜索
- SVN 状态
- 文件类型
- 模板预设
- AI 建议
- 隐藏生成物

预设不会绕过安全规则：

- 默认仍隐藏生成物。
- 不会自动勾选阻止项。
- 不会自动勾选默认排除项。
- 是否提交仍需经过提交计划预览和确认。

## 核心实现

新增核心能力：

- `getCommitCandidateFilterPresets`
- `resolveCommitCandidateFilterPreset`

Webview 新增：

- `filterPreset` 下拉框
- `applyCandidateFilterPreset`
- `markFilterPresetCustom`
- `syncFilterControls`

## 跨平台一致性

筛选预设运行在 TypeScript 核心逻辑和 VS Code Webview 中，不依赖平台命令。
Windows 和 macOS 的预设列表、筛选结果、安全边界保持一致。

## 验证

已通过：

- `npm.cmd run compile`
- `npm.cmd run test:extension`
- `npm.cmd audit`

新增测试：

- `resolves commit candidate filter presets`

