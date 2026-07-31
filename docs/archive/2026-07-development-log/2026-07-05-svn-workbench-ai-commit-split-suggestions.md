# SVN Workbench AI 拆分提交建议

日期：2026-07-05

阶段：开发 -> 测试

## 目标

在提交页已有筛选、分组、分组级操作和 AI 提交说明的基础上，本轮新增 `AI 拆分提交`。

这个能力用于解决日常开发里很常见的问题：一次工作区变更多、模块混杂、说明不好写。AI 可以先建议拆成几次更清晰的提交，但不会自动提交，最终仍由用户决策。

## 页面变化

提交页工具栏新增：

- `AI 拆分提交`

点击后会基于当前已勾选文件生成拆分建议。

每条建议包含：

- 拆分标题。
- 摘要。
- 建议文件列表。
- 拆分原因。
- 风险提示。
- 提交说明草稿。
- `套用此建议` 按钮。

## 交互规则

### 1. 生成拆分建议

用户先选择需要分析的文件，再点击 `AI 拆分提交`。

AI 会根据当前已勾选文件建议拆分方式：

- 优先按业务模块拆分。
- 模块不明显时按模板预设拆分。
- 保持每组可独立提交。
- 不混入未提供的文件路径。

### 2. 套用拆分建议

点击某条建议的 `套用此建议` 后：

- 当前勾选切换为该建议的文件列表。
- 提交说明文本框填入该建议的提交说明草稿。
- 用户可以继续编辑说明。
- 用户仍需预览提交计划和确认提交。

### 3. 本地 fallback

如果未配置模型或模型调用失败，会使用本地规则生成拆分建议：

- 多模块时按模块拆分。
- 单模块多类型时按模板预设拆分。
- 范围较集中时提示不建议强行拆分。

## AI 场景模型

新增 AI 使用场景：

- `commitSplit`

用户可以在模型配置里为拆分提交单独配置更适合规划/代码理解的模型。

## 安全边界

AI 拆分提交建议不会绕过安全链路：

1. 模型只能从已提供文件中选择路径。
2. 后端会校验路径必须在当前右键范围内。
3. 后端会校验路径必须属于真实候选文件。
4. 重复路径会被去重。
5. 范围外路径会被丢弃。
6. 虚构路径会被丢弃。
7. `套用此建议` 只修改勾选和提交说明。
8. 提交仍需提交计划预览、远端更新检查和用户确认。

## 技术实现

新增 `src/ai/commitSplitAi.ts`：

- `buildCommitSplitAiRequest`
- `createLocalCommitSplitResult`
- `normalizeCommitSplitResult`
- `validateCommitSplitResult`

更新 `src/ai/aiProvider.ts`：

- 新增 `AiCommitSplitRequest`
- 新增 `AiCommitSplitSuggestion`
- 新增 `AiCommitSplitResult`
- 新增 `suggestCommitSplits`

更新 `src/ai/openAiCompatibleProvider.ts`：

- 接入 OpenAI-compatible 的拆分提交提示词。

更新 `src/commit/commitPanel.ts`：

- 新增 `AI 拆分提交` 按钮。
- 新增拆分建议结果展示。
- 新增 `套用此建议` 交互。

更新 `src/extension.ts`：

- 为提交页注入 `commitSplit` 场景模型。

## 本轮新增测试

- `builds commit split AI request from selected candidates`
- `creates local commit split suggestions`
- `validates commit split suggestion paths`

## 下一步建议

下一步可以继续做“拆分建议执行前预览”：

- 每条拆分建议显示提交计划预览。
- 每条拆分建议显示 `svn add / remove / commit` 计划。
- 对包含删除、新增、二进制文件的建议做更明显风险提示。
- 支持把多条拆分建议加入待提交队列，但仍逐条确认。
