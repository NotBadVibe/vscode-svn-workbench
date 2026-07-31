# SVN Workbench AI 提交文件筛选

日期：2026-07-05

阶段：开发 -> 测试

## 目标

提交页原先只有 `AI mock 筛选`，用于验证范围边界。本轮升级为真实 AI 文件筛选能力：

- 优先调用已配置模型。
- 模型不可用时回退本地规则。
- 推荐结果自动更新提交页勾选状态。
- 提交仍由用户最终确认。

## 交互变化

提交页按钮从：

```text
AI mock 筛选
```

调整为：

```text
AI 筛选
```

点击后：

1. 构建当前右键范围内的提交候选文件。
2. 给 AI 传入文件状态、文件类型、生成物策略、默认选择策略和原因。
3. AI 返回 `recommended / needsReview / excluded / blocked` 四组。
4. 系统对 AI 结果做范围和候选文件校验。
5. 只把 `recommended` 文件自动勾选。
6. `needsReview / excluded / blocked` 不自动勾选，用户可手动调整。

## 安全边界

AI 结果会经过两层校验：

### 1. 右键范围校验

AI 不能把当前右键文件夹以外的文件加入提交。

### 2. 候选文件校验

即使路径在当前工作副本内，只要不是本次 SVN 候选文件，也会被拦截。

这可以防止模型幻觉路径，例如：

```text
src/invented.ts
```

## AI 请求内容

请求包含：

- `scope`：当前操作范围。
- `files`：候选文件。
- `status`：SVN 状态。
- `fileType`：文件类型。
- `templateGroup`：前端、后端、文档、配置等分组。
- `generatedDecision`：生成物策略。
- `defaultSelection`：本地默认选择。
- `reason`：本地规则原因。
- `policy`：右键范围、生成物默认排除、用户最终确认。

## 本地回退

模型未配置或调用失败时，使用本地规则：

- `selected` -> `recommended`
- `needsReview` -> `needsReview`
- `excluded` -> `excluded`
- `blocked` -> `blocked`

这样没有模型也能保持可用。

## 已修改文件

- `src/ai/commitSelectionAi.ts`：新增提交文件筛选请求构建和本地回退。
- `src/ai/aiProvider.ts`：扩展提交文件筛选上下文。
- `src/ai/aiResultValidator.ts`：新增结果归一化、相对路径解析、候选文件白名单校验。
- `src/ai/openAiCompatibleProvider.ts`：增强提交文件筛选提示词并归一化模型结果。
- `src/commit/commitPanel.ts`：提交页接入真实 AI 筛选并自动更新勾选状态。
- `src/extension.ts`：提交页文件筛选使用 `commitSelection` 场景模型。
- `src/test/suite/index.ts`：新增 3 个提交文件筛选测试。

## 后续建议

下一步可以继续推进“AI 筛选解释面板”：

- 展示每个文件被推荐、排除、待确认的原因。
- 支持按 AI 决策分组过滤。
- 支持一键接受推荐或只接受部分推荐。
