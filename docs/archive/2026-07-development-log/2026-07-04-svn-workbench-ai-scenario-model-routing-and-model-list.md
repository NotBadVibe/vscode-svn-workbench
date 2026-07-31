# SVN Workbench AI 场景模型路由与模型列表记录

日期：2026-07-04

阶段：开发

> 目标：让不同 AI 功能可以使用不同模型，并支持从 OpenAI-compatible 服务拉取模型列表，降低用户手填模型名的成本。

## 本轮实现范围

新增能力：

1. AI 配置页支持“场景模型”。
2. 支持按场景覆盖默认模型。
3. 支持 `GET /models` 拉取模型列表。
4. 模型列表结果可点击填入默认模型输入框。
5. 提交文件筛选使用 `commitSelection` 场景模型。
6. 冲突中心 AI 建议使用 `conflictAdvice` 场景模型。

## 场景模型

当前定义了 4 个场景：

| 场景 ID | 中文含义 | 当前用途 |
| --- | --- | --- |
| `commitSelection` | 提交文件筛选 | 已接入 `SVN: AI Select Current Scope`。 |
| `conflictAdvice` | 冲突处理建议 | 已接入冲突中心 `AI 建议`。 |
| `commitMessage` | 提交说明生成 | 预留，后续用于生成提交说明。 |
| `conflictMerge` | 冲突候选合并 | 预留，后续用于生成候选 Working 内容。 |

保存规则：

- 默认模型仍存储在 `svnWorkbench.ai.model`。
- 场景覆盖模型存储在 `svnWorkbench.ai.scenarioModels`。
- 场景模型留空时，继承默认模型。
- 保存时会清理空字符串，避免 settings 被无效值污染。

## 配置 Schema

新增配置项：

```json
"svnWorkbench.ai.scenarioModels": {
  "commitSelection": "qwen-plus",
  "conflictAdvice": "deepseek-v4-pro",
  "commitMessage": "qwen-plus",
  "conflictMerge": "deepseek-v4-pro"
}
```

实际使用时可以只填需要覆盖的场景：

```json
"svnWorkbench.ai.scenarioModels": {
  "conflictAdvice": "deepseek-v4-pro"
}
```

## Provider 变化

`AiProvider` 新增：

```ts
listModels(): Promise<AiModelInfo[]>
```

`OpenAiCompatibleProvider` 实现：

```text
GET {baseUrl}/models
Authorization: Bearer {apiKey}
```

返回结构按 OpenAI-compatible 常见格式解析：

```json
{
  "object": "list",
  "data": [
    { "id": "model-name", "owner": "provider" }
  ]
}
```

如果服务不支持 `/models`，页面会展示失败原因，不影响手动填写模型名。

## 页面交互

`SVN: AI Configure Model` 页面新增：

- 场景模型输入区。
- 拉取模型列表按钮。
- 拉取成功后显示模型按钮。
- 点击模型按钮会填入默认模型输入框。

当前没有自动覆盖场景模型，原因是不同场景的模型选择需要用户自己判断。

## 场景路由

当前调用关系：

```text
SVN: AI Select Current Scope
  -> resolveAiProviderConfig(context, 'commitSelection')

Conflict Center / AI 建议
  -> resolveAiProviderConfig(context, 'conflictAdvice')
```

后续新增功能时直接传入对应场景：

```text
提交说明生成 -> commitMessage
冲突候选合并 -> conflictMerge
```

## 官方资料依据

本轮再次核对了 OpenAI-compatible 供应商资料：

- DeepSeek `GET /models`：`https://api-docs.deepseek.com/api/list-models`
- DeepSeek API OpenAI 格式：`https://api-docs.deepseek.com/`
- 阿里云 DashScope OpenAI-compatible：`https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope`
- Kimi 模型列表：`https://platform.kimi.ai/docs/models`

结论：

1. DeepSeek 明确支持 `GET /models`。
2. DashScope 的兼容入口主要强调 OpenAI-compatible Chat，模型列表能力不应强依赖，必须允许手填。
3. Kimi 官方有模型列表页面，插件侧仍按通用 `/models` 尝试，失败时允许手动输入。
4. 智谱存在 Coding Plan 与通用 API 两套入口，继续保留两个预设。

## 涉及文件

```text
package.json
src/extension.ts
src/ai/aiProvider.ts
src/ai/openAiCompatibleProvider.ts
src/ai/aiModelConfiguration.ts
src/ai/aiConfigurationPanel.ts
src/test/suite/index.ts
```

## 风险与边界

模型列表不是所有 OpenAI-compatible 服务都保证支持。

因此当前策略是：

1. 支持拉取。
2. 拉取失败只展示错误。
3. 不阻断保存配置。
4. 用户始终可以手动填写模型名。

## 后续可推进

下一步建议推进：

1. 提交说明 AI 生成，接入 `commitMessage` 场景。
2. 冲突候选合并，只生成候选内容，不自动写入。
3. 模型列表支持“应用到某个场景”。
4. 增加“场景推荐模型”说明，例如冲突合并建议用强推理/代码模型。
5. 记录每个场景最近一次调用耗时与错误。
