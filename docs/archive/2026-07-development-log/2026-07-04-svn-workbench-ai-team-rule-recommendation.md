# SVN Workbench AI 团队规则推荐

日期：2026-07-04

阶段：开发 -> 测试

## 目标

团队规则页面已经支持表单编辑 `.svn-workbench.json`。本轮继续把 AI 融入该页面：根据仓库结构推荐提交前缀、模块名和工单号规则，用户确认后再保存。

## 新增交互

在 `SVN: Configure Team Rules` 页面新增按钮：

```text
AI 推荐规则
```

点击后：

1. 扫描当前仓库目录和文件样本。
2. 生成 AI 请求上下文。
3. 优先调用已配置模型的 `teamRules` 场景。
4. 如果模型未配置或调用失败，自动回落到本地规则推荐。
5. 将推荐结果填入表单，但不会自动保存。
6. 用户确认后点击“保存团队规则”才写入 `.svn-workbench.json`。

## 推荐内容

AI 推荐结果包含：

- `commitConvention`：推荐的团队提交规范。
- `summary`：推荐摘要。
- `reasons`：推荐理由。
- `warnings`：需要人工确认的提醒。
- `confidence`：`low` / `medium` / `high`。

## 本地回退策略

本地推荐器会排除以下目录：

```text
.svn, .git, node_modules, dist, build, out, bin, obj, coverage, target
```

然后根据仓库结构推断模块，例如：

```text
src/pages/order -> order
src/pages/user  -> user
config          -> config
docs            -> docs
```

默认推荐前缀：

```text
feat, fix, config, docs, refactor, test, chore
```

如果仓库没有文档、配置或测试信号，会减少对应前缀。

## 模型接入

AI Provider 新增：

```ts
recommendTeamRules(request)
```

OpenAI-compatible provider 会要求模型返回严格 JSON：

```text
commitConvention, summary, reasons, warnings, confidence
```

并要求模型不要编造仓库中不存在的业务模块。

## 场景模型

AI 配置页新增场景：

```text
团队规则推荐 teamRules
```

用户可以为该场景单独指定国产模型，例如 DeepSeek、通义千问、智谱或 Kimi。

## 决策边界

该功能遵循“AI 辅助，人来决策”：

- AI 只填充表单。
- 不自动写入 `.svn-workbench.json`。
- 保存前仍执行本地校验。
- 模型返回非法配置时会被本地归一化和修正。

## 已修改文件

- `src/ai/aiProvider.ts`：新增团队规则推荐请求和结果类型。
- `src/ai/teamRulesAiRecommender.ts`：新增仓库扫描、本地推荐、AI 结果归一化。
- `src/ai/openAiCompatibleProvider.ts`：新增模型推荐团队规则能力。
- `src/ai/aiModelConfiguration.ts`：新增 `teamRules` 场景。
- `src/commit/teamConfigPanel.ts`：新增“AI 推荐规则”按钮和推荐结果应用。
- `src/extension.ts`：团队规则页接入 `teamRules` 场景模型。
- `package.json`：AI 场景模型配置 schema 增加 `teamRules`。
- `src/test/suite/index.ts`：新增 3 个 AI 团队规则推荐测试。

## 下一步建议

下一步可以继续推进“AI 推荐提交文件增强”：

- 将当前提交页的 mock 筛选升级为真实模型调用。
- 模型根据生成物策略、文件类型、目录范围和 diff 摘要推荐提交文件。
- 推荐结果仍只勾选表单，用户最终确认。
