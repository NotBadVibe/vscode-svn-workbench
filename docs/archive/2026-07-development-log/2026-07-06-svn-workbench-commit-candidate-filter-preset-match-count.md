# SVN Workbench 提交候选筛选预设命中数量提示

日期：2026-07-06

阶段：开发 -> 测试

## 背景

提交页已经支持内置预设和仓库级自定义预设，但下拉框此前只显示预设名称。
用户需要先套用预设，才能知道它会命中多少文件、其中多少文件可以被批量勾选。

本轮新增预设命中数量提示，让用户在选择前就能判断预设范围是否符合预期。

## 页面表现

提交页面 -> `筛选预设` 下拉框：

```text
前端代码（3/3 可选）
配置文件（1/1 可选）
资源文件（2/0 可选）
AI 推荐（5/4 可选）
```

含义：

- 第一个数字：预设命中的候选文件总数。
- 第二个数字：其中可被批量勾选的文件数。

## 可选数规则

可选数会排除：

- 默认排除项。
- 阻止项。
- 生成物排除项。
- 冲突、阻塞、异常状态文件。

因此 `资源文件（2/0 可选）` 代表该预设命中了 2 个候选，但它们当前都不能被安全批量勾选。

## 动态更新

预设计数会随以下变化更新：

- 打开提交页时基于当前候选列表计算。
- 刷新 SVN 候选列表后重新计算。
- 运行 AI 筛选后，`AI 推荐` 等 AI 相关预设会重新计算。

## 核心实现

新增核心能力：

- `summarizeCommitCandidateFilterPresetMatches`

Webview 新增：

- `refreshFilterPresetOptions`
- `formatFilterPresetOptionLabel`
- `matchesPresetFilters`

## 安全边界

该能力只展示统计信息：

- 不自动勾选。
- 不自动提交。
- 不修改筛选预设。
- 不改变已有提交安全规则。

## 验证

已通过：

- `npm.cmd run compile`
- `npm.cmd run test:extension`
- `npm.cmd audit`

新增测试：

- `summarizes commit candidate filter preset matches`

