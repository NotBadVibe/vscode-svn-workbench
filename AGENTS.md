# SVN Workbench AI 开发约束

## 沟通语言

- 与用户沟通、说明实现结果和报告问题时统一使用中文。
- 路径、命令、配置键、协议字段、代码标识符和必要的 SVN/AI/API 等技术术语保持原文。

## 开始任务前必须阅读

任何代码、配置、测试或文档修改开始前，必须先阅读：

1. `README.md`
2. `docs/README.md`
3. `docs/current/README.md`

再按任务类型阅读对应的当前基线：

- 新增或修改产品功能、业务行为：
  - `docs/current/产品与功能基线.md`
  - `docs/current/实现与代码映射.md`
- 修改页面、交互、中文文案、滚动或可访问性：
  - `docs/current/设计与交互基线.md`
- 修改测试、构建、覆盖率、验收或交付流程：
  - `docs/current/测试与验收基线.md`
- 涉及 API Key、SVN 凭据、证书、AI 外发数据或危险 SVN 操作：
  - `SECURITY.md`
  - `docs/current/实现与代码映射.md`
- 准备贡献、提交或发布：
  - `CONTRIBUTING.md`

开始实现前，应在工作说明中简要列出本次已读取的基线文档。不得仅依赖搜索命中的片段代替阅读适用文档。

## 文档权威层级

- 发生冲突时依次采用：实际代码与测试契约、`docs/current/` 当前基线、`docs/releases/` 已发布版本记录、`docs/archive/` 历史归档。
- `docs/archive/` 只能用于历史追溯，不得作为当前需求、实现状态或验收依据。
- `docs/releases/` 只描述对应版本事实，不得覆盖当前开发线基线。
- 行为、源码路径、测试映射或证据路径变化时，必须同步更新相关 `docs/current/` 文档，并执行 `npm run docs:verify`。

## 架构边界

- 正式业务界面统一使用 Svelte 5，并沿用现有 `src/webview/features/`、共享组件和样式体系；不得另建平行业务 UI 架构。
- Extension Host 负责 SVN、文件系统、凭据、安全校验和最终写操作；Webview 负责展示状态并通过协议发起动作。
- 页面与命令必须保持 `moduleId + taskId + operationScope` 边界。
- 右键确定的操作范围只能被筛选、模板、Changelist 或 AI 缩小，不能被扩大。
- 修改 `src/protocol/workbenchProtocol.ts` 时，必须同步检查 Host、Webview、Mock、类型守卫和相关测试。
- 新逻辑优先进入对应领域目录；避免继续扩大 `WorkbenchController.ts` 中可独立测试的纯业务逻辑。

## SVN 与写操作安全

- Commit、Update、Resolve、Revert、Delete、Switch、Relocate、Merge、历史恢复等写操作必须先展示准确预览，再由用户明确确认。
- 执行写操作前必须重新校验操作范围、候选状态、工作副本或 revision 状态以及确认令牌。
- 工作副本状态、范围或 revision 改变后，旧预览和旧 AI 结果必须失效。
- 混合仓库选择不能合并成一次 revision，必须按仓库拆分。
- AI 只能生成建议、草稿或候选结果，不得直接执行 commit、update、resolve、revert、delete、switch 或 merge。
- 不得在没有用户明确要求的情况下执行 SVN 提交、还原、删除、切换、合并或发布操作。

## AI、隐私与本地降级

- AI 是可选增强；未配置、超时、失败或返回无效结构时，核心 SVN 功能、本地规则和人工流程必须继续可用。
- AI 返回的文件路径必须重新经过仓库、操作范围和候选集合校验；范围外、虚构或已过期结果必须拒绝。
- AI 外发前必须说明模型、数据类型、文件范围、字符或文件预算以及是否包含历史。
- API Key 和 SVN 密码只能进入 VS Code SecretStorage 或既有安全输入通道。
- API Key、SVN 密码和证书私密材料不得进入 Webview 消息、日志、输出面板、快照、测试夹具或提交历史。
- UI 必须如实显示结果来源；不得把本地规则结果表述成外部模型分析结果。

## 中文界面与交互

- 用户界面中文优先；统一术语优先复用 `src/webview/i18n/`，不要在单个页面创造同义文案。
- 状态不能只依赖颜色表达，必须同时提供文字、图标或其他可访问信息。
- 危险按钮必须写明具体动作和影响数量，不能只使用“确定”或“继续”。
- 错误信息应说明发生了什么、可能原因以及用户可以采取的恢复动作。
- 页面和局部列表必须有明确滚动归属；不得使用全局 `overflow: auto !important` 掩盖布局问题。
- 修改输入交互时必须保留中文 IME composition 保护，候选阶段的 Enter 不得触发提交、确认或 AI 执行。
- 交互验收必须覆盖键盘访问、小高度、200% 缩放以及 Light、Dark、High Contrast 模式。

## 代码质量与验证

- TypeScript 保持 strict；遵循现有 ESLint、Prettier、Svelte 和 TypeScript 配置。
- 不得为无关文件执行批量格式化或顺带重构。
- 新增或修改领域行为时同步增加对应单元、组件、Webview E2E 或 Extension Host 测试。
- 安全边界和写操作必须覆盖成功、拒绝、过期、失败及恢复分支。
- 不得为了让测试通过而降低校验、删除断言或无理由批量更新视觉基线。
- 普通代码修改至少执行 `npm run check` 和与改动直接相关的测试。
- 完整交付前执行 `npm run verify`；未实际运行的检查必须如实说明。
- 只有显式发布任务才能运行 `npm run evidence:release`，不得覆盖已发布版本证据。

## 工具链

- Node.js 和 npm 版本以 `package.json` 的 `engines` 与 `packageManager` 为准：Node.js 26、npm 12。
- `.nvmrc` 已声明 Node.js 26，与 `package.json` 和 `README.md` 一致；执行 `nvm use` 会得到受支持版本。
- 不提交 API Key、密码、私有仓库地址、证书私钥、VSIX、测试结果或构建生成物。
