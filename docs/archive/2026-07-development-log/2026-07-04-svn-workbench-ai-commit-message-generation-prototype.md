# SVN Workbench AI 提交说明生成原型记录

日期：2026-07-04

阶段：开发

> 目标：在提交页面支持根据当前勾选文件生成中文提交说明草稿，并接入 `commitMessage` 场景模型。AI 只生成草稿，用户仍需编辑确认后再提交。

## 本轮实现范围

新增提交页面按钮：

```text
AI 生成说明
```

生成逻辑：

1. 读取当前提交页面勾选的文件。
2. 将文件状态、类型、模板分组、选择原因压缩成 AI 请求。
3. 优先调用 `commitMessage` 场景模型。
4. 模型未配置或调用失败时，回退到本地规则草稿。
5. 生成成功后填入提交说明输入框。
6. 用户可以继续手动编辑。
7. 最终提交仍走原有提交说明校验和二次确认。

## 涉及文件

```text
src/ai/aiProvider.ts
src/ai/commitMessageAiGenerator.ts
src/ai/openAiCompatibleProvider.ts
src/commit/commitPanel.ts
src/extension.ts
src/test/suite/index.ts
```

## AI 请求结构

```ts
interface AiCommitMessageRequest {
  scope: string;
  selectedFileCount: number;
  omittedFileCount: number;
  files: AiCommitMessageFileContext[];
  locale: 'zh-CN';
}
```

每个文件包含：

```ts
interface AiCommitMessageFileContext {
  path: string;
  status: string;
  fileType: string;
  templateGroup: string;
  reason: string;
}
```

当前最多向模型传入 80 个文件。

如果勾选文件超过 80 个：

- `selectedFileCount` 记录真实数量。
- `omittedFileCount` 记录省略数量。
- 本地草稿和模型请求都能提示文件较多。

## AI 返回结构

```ts
interface AiCommitMessageResult {
  message: string;
  summary: string;
  warnings: string[];
}
```

模型返回会经过归一化：

- `message` 去除首尾空白。
- `summary` 压缩为单行。
- `warnings` 只保留字符串项。

## 页面交互

提交页面当前提交说明区按钮：

- 套用模板
- AI 生成说明
- 确认提交

点击 `AI 生成说明` 后：

1. 如果没有勾选文件，不覆盖现有提交说明。
2. 如果生成成功，将草稿填入 textarea。
3. 在 AI 结果区域展示来源：
   - `configured-model`
   - `local-rule`
   - `local-rule-fallback`
4. 如果模型失败，展示 fallback 原因。

## 场景模型接入

提交说明生成使用：

```text
resolveAiProviderConfig(context, 'commitMessage')
```

这意味着用户可以在 AI 配置页单独为提交说明配置模型。

示例：

```json
"svnWorkbench.ai.scenarioModels": {
  "commitMessage": "qwen-plus"
}
```

## 安全边界

本轮没有让 AI 自动提交。

本轮没有跳过提交说明校验。

本轮没有读取完整 diff 内容，只基于文件元数据生成说明。

原因：

1. 当前阶段先验证交互闭环。
2. 文件元数据足以生成可用的提交说明草稿。
3. 后续如果读取 diff，需要增加隐私提示、大小限制和生成内容校验。

## 测试覆盖

新增测试：

| 用例 | 覆盖点 |
| --- | --- |
| builds commit message AI request from selected files | 只基于当前勾选文件生成 AI 请求。 |
| creates safe fallback commit message | 无模型时也能生成可用草稿，并校验模型返回归一化。 |

## 后续可推进

下一步建议推进：

1. 提交说明生成支持读取轻量 diff 摘要。
2. 根据模板类型生成不同风格，例如需求、修复、配置、文档。
3. 增加“保留我已写内容，AI 补全剩余字段”。
4. 增加团队提交规范配置，例如前缀、工单号、模块名。
5. 增加提交前说明质量检查。
