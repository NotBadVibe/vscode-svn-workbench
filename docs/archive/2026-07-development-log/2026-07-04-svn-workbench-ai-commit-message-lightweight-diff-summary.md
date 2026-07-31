# SVN Workbench AI 提交说明轻量 Diff 摘要记录

日期：2026-07-04

阶段：开发

> 目标：让 AI 提交说明生成不只依赖文件状态，还能参考轻量 diff 摘要；同时不把完整代码内容交给模型。

## 本轮实现范围

新增轻量 diff 摘要能力：

1. 点击提交页面 `AI 生成说明` 时，先对已选路径执行 `svn diff --internal-diff`。
2. 解析统一 diff。
3. 每个文件只提取统计信息：
   - addedLines
   - deletedLines
   - hunks
   - binary
   - truncated
   - error
4. AI 请求带上这些统计摘要。
5. 本地 fallback 草稿也展示 `+行 / -行`。
6. 不把完整 diff 内容传给模型。

## 涉及文件

```text
src/ai/aiProvider.ts
src/ai/commitMessageAiGenerator.ts
src/ai/openAiCompatibleProvider.ts
src/commit/commitDiffSummary.ts
src/commit/commitPanel.ts
src/test/suite/index.ts
```

## 数据结构

AI 文件上下文新增：

```ts
interface AiCommitMessageDiffSummary {
  addedLines: number;
  deletedLines: number;
  hunks: number;
  binary: boolean;
  truncated: boolean;
  error?: string;
}
```

文件上下文：

```ts
interface AiCommitMessageFileContext {
  path: string;
  status: string;
  fileType: string;
  templateGroup: string;
  reason: string;
  diff?: AiCommitMessageDiffSummary;
}
```

## Diff 采集策略

命令：

```powershell
svn diff --internal-diff <selected-path>
```

限制：

- 最多处理 80 个路径。
- 每个路径最多解析 160000 字符。
- 超过时标记 `truncated: true`。
- 路径必须在当前 OperationScope 内。
- SVN diff 失败时不抛出整体错误，而是在该文件摘要里记录 `error`。

## 解析规则

统一 diff 解析：

| 行类型 | 处理 |
| --- | --- |
| `@@ ... @@` | hunk 数 +1 |
| `+...` | addedLines +1 |
| `-...` | deletedLines +1 |
| `+++ ...` | 忽略 |
| `--- ...` | 忽略 |
| 包含 `Cannot display` / `binary type` / `svn:mime-type` | 标记 binary |

## 安全边界

本轮仍不发送完整代码内容。

AI 只能看到：

- 文件路径。
- SVN 状态。
- 文件类型。
- 模板分组。
- 选择原因。
- diff 统计数字。

这样可以减少泄漏代码内容的风险，同时让提交说明比单纯文件状态更准确。

## 页面行为

用户点击：

```text
AI 生成说明
```

实际流程：

1. 收集当前勾选文件。
2. 采集轻量 diff 摘要。
3. 构建 AI 提交说明请求。
4. 优先调用 `commitMessage` 场景模型。
5. 失败则回退到本地规则草稿。
6. 草稿填入提交说明文本框。

## 测试覆盖

新增测试：

| 用例 | 覆盖点 |
| --- | --- |
| parses lightweight svn diff summary | 解析统一 diff 的增删行、hunk、二进制和截断标记。 |
| attaches diff summary to commit message AI request | AI 提交说明请求能附带文件级 diff 摘要。 |

## 后续可推进

下一步建议：

1. 在提交页面展示 diff 摘要预览。
2. AI 提交说明支持“补全现有模板字段”。
3. 对不同模板类型生成不同提示词。
4. 增加团队提交规范配置，例如工单号、模块名、前缀。
5. 在提交前增加 AI 说明质量检查。
