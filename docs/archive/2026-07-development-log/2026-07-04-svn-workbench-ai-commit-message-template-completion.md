# SVN Workbench AI 提交说明模板补全记录

日期：2026-07-04

阶段：开发

> 目标：用户先选择或填写提交说明模板，AI 只补全空字段，不能覆盖用户已经写好的内容。

## 本轮实现范围

提交页面新增按钮：

```text
AI 补全模板
```

行为：

1. 优先读取当前提交说明输入框内容。
2. 如果输入框为空，则使用当前下拉选中的模板作为基础。
3. 采集当前勾选文件和轻量 diff 摘要。
4. 使用 `commitMessage` 场景模型补全模板。
5. 模型失败时回退到本地规则补全。
6. 模型返回后仍执行保护合并，保留用户已填写字段。

## 涉及文件

```text
src/ai/aiProvider.ts
src/ai/commitMessageAiGenerator.ts
src/ai/openAiCompatibleProvider.ts
src/commit/commitPanel.ts
src/test/suite/index.ts
```

## 新增请求模式

`AiCommitMessageRequest` 新增：

```ts
mode?: 'draft' | 'completeTemplate';
templateId?: string;
templateLabel?: string;
currentMessage?: string;
```

模式说明：

| mode | 用途 |
| --- | --- |
| `draft` | 生成完整提交说明草稿。 |
| `completeTemplate` | 补全当前模板空字段。 |

## 保护合并规则

核心函数：

```ts
mergeCommitMessagePreservingUserContent(currentMessage, generatedMessage)
```

规则：

1. 识别 `字段名: 内容` 或 `字段名：内容`。
2. 如果当前字段已有内容，保留用户内容。
3. 如果当前字段为空，使用 AI 或本地规则生成的同名字段内容。
4. 非字段行保持原样。

示例：

输入：

```text
需求: 已写好的内容

范围:
影响: 用户下单流程
```

AI 生成：

```text
需求: AI 不应覆盖这里
范围: src/pages/order，+3 / -1
影响: AI 不应覆盖影响
```

最终：

```text
需求: 已写好的内容

范围: src/pages/order，+3 / -1
影响: 用户下单流程
```

## 模型提示词约束

OpenAI-compatible provider 已增加提示：

```text
If mode is completeTemplate, preserve all non-empty user-written fields in currentMessage and only fill empty fields.
```

同时插件侧仍会二次保护合并，避免模型不遵守提示词时覆盖用户内容。

## 本地 fallback

无模型或模型失败时，本地规则会根据：

- 当前模板字段。
- 当前提交 scope。
- 已选文件数量。
- 文件模板分组。
- 轻量 diff 摘要。

补全常见字段：

- 需求
- 修复
- 配置
- 文档
- 重构
- 范围
- 原因
- 影响
- 风险

## 页面交互

提交说明区域现在有：

- 套用模板
- AI 生成说明
- AI 补全模板
- 确认提交

区别：

| 按钮 | 行为 |
| --- | --- |
| AI 生成说明 | 根据已选文件生成完整草稿，可能替换 textarea 内容。 |
| AI 补全模板 | 只补空字段，保留已写内容。 |

## 测试覆盖

新增测试：

| 用例 | 覆盖点 |
| --- | --- |
| builds commit message AI request in template completion mode | 验证模板补全模式会携带模板、当前内容和已选文件。 |
| preserves user commit message template fields | 验证已有字段不会被 AI 结果覆盖。 |

## 后续可推进

下一步建议：

1. 支持团队提交规范配置，例如工单号、模块名、固定前缀。
2. AI 补全时识别光标所在字段，只补一个字段。
3. 提交前增加 AI 说明质量检查。
4. 对模板字段增加必填项校验。
