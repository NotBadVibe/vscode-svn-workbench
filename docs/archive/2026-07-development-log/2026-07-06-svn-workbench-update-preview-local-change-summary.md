# SVN Workbench 更新预览本地变更摘要

日期：2026-07-06

阶段：开发 -> 测试

## 背景

提交页已经支持 `预览更新`，但此前只展示更新命令和更新路径数量。
用户在执行更新前，无法快速判断当前范围内是否存在本地未提交文件、生成物排除项、待确认文件或阻止项。

本轮新增“更新预览本地变更摘要”，用于在更新前识别本地风险。

## 页面入口

提交页面 -> `预览更新`

预览内容新增：

- 本地未提交数量
- 可提交候选数量
- 待确认数量
- 已排除数量
- 已阻止数量
- 生成物排除数量
- 模板分类统计
- 文件类型统计
- 阻止项或生成物风险提示

## 示例

```text
本地未提交: 4
可提交候选: 2
待确认: 1
已排除: 1
已阻止: 1
生成物排除: 1
模板分类: 前端 1，配置 1，其他 2
文件类型: conflicted 1，dll 1，json 1，ts 1
提示: 当前范围存在阻止项，更新后建议先打开冲突中心或重新刷新状态。
```

## 设计边界

该摘要统计的是“当前更新范围内的本地未提交候选”，不是远端即将更新下来的文件列表。

原因：

- 当前实现不额外执行 `svn status -u`。
- 不做远端变更预测。
- 不增加更新前网络开销。
- 不改变已有更新执行流程。

后续可以继续扩展远端更新预览，把 `svn status -u` 的远端变更也纳入分类。

## 安全价值

执行更新前，用户可以先看到：

- 是否存在冲突或阻止项。
- 是否有生成物排除项无需提交。
- 当前范围主要影响前端、后端、配置、文档还是资源。
- 当前文件类型分布是否符合预期。

这能帮助用户决定先提交、先处理冲突，还是继续执行更新。

## 核心实现

新增核心能力：

- `UpdateScopeLocalChangeSummary`
- `summarizeUpdateScopeLocalChanges`

扩展：

- `buildUpdateScopePreview(scope, candidates?)`
- `UpdateScopePreview.localChanges`

Webview 新增：

- `formatUpdateLocalChangeSummary`
- 更新预览中展示本地变更摘要

## 跨平台一致性

本轮能力基于 VS Code 中已有候选文件列表和 TypeScript 路径归一化实现。
Windows 和 macOS 使用同一套统计规则。

## 验证

已通过：

- `npm.cmd run compile`
- `npm.cmd run test:extension`
- `npm.cmd audit`

新增测试：

- `summarizes update scope local changes`

