# SVN Workbench AI 模型配置与 SecretStorage 记录

日期：2026-07-04

阶段：开发

> 目标：把 AI 模型从手写 settings 推进到可视化配置页，并支持国产模型预设。API Key 不再建议写入 settings，而是保存到 VS Code SecretStorage。

## 本轮实现范围

新增命令：

```text
SVN: AI Configure Model
```

新增配置页能力：

1. 选择模型供应商预设。
2. 自动带出 Base URL 和模型名。
3. Base URL 和模型名仍可手动编辑。
4. API Key 输入后保存到 VS Code SecretStorage。
5. 支持清除已保存 API Key。
6. 支持测试连接。
7. 兼容旧版 `svnWorkbench.ai.apiKey` settings 字段，但页面会提示建议迁移。

## 供应商预设

当前预设是“可编辑模板”，不是强绑定：

| 预设 | Base URL | 默认模型 | 说明 |
| --- | --- | --- | --- |
| DeepSeek | `https://api.deepseek.com` | `deepseek-v4-flash` | OpenAI-compatible。 |
| 通义千问 DashScope | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` | 适合国内常见 DashScope Key；部分账号建议改为 workspace 专属域名。 |
| 智谱 GLM Coding Plan | `https://open.bigmodel.cn/api/coding/paas/v4` | `glm-5.2` | 编程套餐 Key 使用该入口。 |
| 智谱 GLM 通用 API | `https://open.bigmodel.cn/api/paas/v4` | `glm-4.7` | 通用开放平台 Key 使用该入口。 |
| Kimi / Moonshot | `https://api.moonshot.ai/v1` | `kimi-latest` | OpenAI-compatible。 |
| 自定义 OpenAI-compatible | 空 | 空 | 用户自行填写。 |

## 官方资料依据

本轮调研了这些官方页面：

- DeepSeek API 文档：`https://api-docs.deepseek.com/`
- DeepSeek Models & Pricing：`https://api-docs.deepseek.com/quick_start/pricing`
- Alibaba Cloud Model Studio OpenAI-compatible：`https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope`
- 智谱 GLM Coding Plan 接入工具：`https://docs.bigmodel.cn/cn/coding-plan/tool/others`
- Kimi API Platform：`https://platform.kimi.ai/docs/api/overview`

关键结论：

1. DeepSeek 已提供 OpenAI-compatible `base_url = https://api.deepseek.com`，并在 2026-07-04 当前文档中推荐 `deepseek-v4-flash / deepseek-v4-pro`。
2. DashScope 仍支持 `compatible-mode/v1`，但官方已推荐部分区域迁移到 workspace 专属域名，因此页面必须允许用户编辑 Base URL。
3. 智谱 Coding Plan 和通用开放平台不是同一个 Base URL，必须拆成两个预设。
4. Kimi 支持 OpenAI Chat Completions 兼容接口，Base URL 为 `https://api.moonshot.ai/v1`。

## 涉及文件

```text
package.json
src/extension.ts
src/ai/aiModelConfiguration.ts
src/ai/aiConfigurationPanel.ts
src/conflict/conflictCenterPanel.ts
src/test/suite/index.ts
```

## 配置读取优先级

AI Provider 构造时按以下顺序读取：

1. `svnWorkbench.ai.baseUrl`
2. `svnWorkbench.ai.model`
3. SecretStorage 中的 `svnWorkbench.ai.apiKey`
4. 如果 SecretStorage 没有，再兼容读取旧版 `svnWorkbench.ai.apiKey`

如果缺少任意必要项，会提示：

```text
AI provider is not configured. Run "SVN: AI Configure Model".
```

## SecretStorage 设计

SecretStorage Key：

```text
svnWorkbench.ai.apiKey
```

保存行为：

- 用户输入新 API Key 时，写入 SecretStorage。
- 用户留空 API Key 时，不覆盖已有密钥。
- 用户勾选“清除已保存 API Key”时，删除 SecretStorage 中的密钥。

保留旧 settings 字段的原因：

1. 兼容前期技术验证文档和测试环境。
2. 避免用户升级后立即丢失配置。
3. 后续正式版本可以做迁移提示，再逐步废弃。

## 页面交互

页面字段：

- 模型供应商
- Base URL
- 模型
- API Key
- 清除已保存 API Key
- 保存配置
- 测试连接

供应商切换规则：

- 切到非自定义预设时，自动填充 Base URL 和模型。
- 用户可以继续手动修改。
- 保存时写入 VS Code 全局配置，跨项目复用。

测试连接规则：

- 如果输入框有 API Key，优先用输入框内容测试。
- 如果输入框为空，则使用已保存 SecretStorage Key。
- 如果 SecretStorage 为空，则兼容读取旧 settings API Key。
- 测试不强制保存当前表单。

## 与现有 AI 功能的关系

以下功能已经改为使用统一配置解析：

- `SVN: AI Test Connection`
- `SVN: AI Select Current Scope`
- 冲突中心 `AI 建议`

这样后续接入国产模型时，不需要每个功能单独做模型配置。

## 跨平台影响

本轮实现不依赖 Windows/macOS 特定路径。

SecretStorage 由 VS Code 负责适配平台：

- Windows：系统凭据能力。
- macOS：Keychain。

插件侧只使用 VS Code API，因此两个平台交互标准一致。

## 后续可推进

下一步建议推进：

1. 在配置页增加“从模型服务拉取模型列表”。
2. 增加“按场景选择模型”：提交筛选、冲突建议、冲突候选合并、提交说明生成可用不同模型。
3. 增加连接状态缓存和最近错误展示。
4. 增加 API Key 迁移按钮：从旧 settings 迁移到 SecretStorage 后清空旧字段。
5. 增加企业代理配置：HTTP proxy、自签证书提示、内网 OpenAI-compatible endpoint。
