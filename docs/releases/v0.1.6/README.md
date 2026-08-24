# SVN Workbench v0.1.6：AI 渐进辅助与视觉层级统一

> 文档身份：`planned-version-record`
>
> 状态：规划中（`draft/planned`）。依赖 [`v0.1.5`](../v0.1.5/)。
>
> 基线版本：[`v0.1.5`](../v0.1.5/)。
>
> 路线来源：[融合审查报告](../../archive/product-reviews/2026-08-23/以人为本易用性审查与优化报告.md)U-07、U-12、U-13、`5.5、`5.8～5.9、`8.3。
>
> 优先级：P1。
>
> 用户可独立体验的主路径：在 Commit、Conflicts、Changelists 和 Understanding 中，不配置或不展开 AI 也能先完成确定性 SVN 任务；需要帮助时，每页从一个一致入口展开来源、预算、回执、证据和建议，采用后回到主流程。页面主次、间距、边框和按钮层级一致。
>
> 不包含：新增模型能力、改变 AI 外发内容、自动采用建议、全仓无关重构、品牌视觉重做。

## 1. 版本目标

解决“AI 与主任务争夺注意力”和“每页各自创造视觉语法”。本版本主要重排和抽取，不改变 AI 安全/隐私领域契约。

成功标准：

- 同一页面最多一个模型入口，统一放入 `AssistancePanel` 或与输入直接相关的次级动作。
- 本地规则自动运行并如实标记“本地检查”，不写“AI/智能”。
- 用户主动选择模型能力后才展示模型、数据类型、范围、预算、历史和回执。
- AI 未配置/超时/失败时，当前选择、草稿和人工流程完全保留。
- 每页只有一个强调色 primary；边框只用于风险、独立滚动区和可折叠详情。
- 巨型页面按实际任务切片拆分，`WorkbenchController` 不继续吸收可独立测试的纯逻辑。
- 已有来源、证据、过期和采用复验契约不退化。

## 2. 进入与退出门禁

### 2.1 进入条件

- [ ] `v0.1.5` 的 TaskSummary/PrimaryAction/Result 组件稳定。
- [ ] 列出 Commit、Conflicts、Changelists、Understanding 当前所有 AI/本地入口、说明、回执和结果区。
- [ ] 明确每个入口是否真的调用模型，禁止以视觉改名掩盖来源。
- [ ] 记录页面首屏控件数、primary 数、卡片/notice/边框层级 before 数据。

### 2.2 退出条件

- [ ] V016-A～V016-F 完成。
- [ ] AI 关闭时四个模块的核心人工路径全部完成。
- [ ] 每页最多一个模型入口，来源和外发回执仍完整准确。
- [ ] 视觉层级与共享组件通过三主题、小视口和 200%。
- [ ] 巨型组件拆分有测试收益，不产生第二套状态机。
- [ ] `npm run verify` 通过；满足进入 [`v0.1.7`](../v0.1.7/) 的全局可访问性前提。

## 3. AI 任务拆分

| ID     | 顺序 | 任务                           | 主要产物           |
| ------ | ---- | ------------------------------ | ------------------ |
| V016-A | 1    | 审计 AI 入口与视觉密度         | 来源/控件/层级清单 |
| V016-B | 2    | 建立 `AssistancePanel`         | 一致按需帮助容器   |
| V016-C | 3    | 迁移 Conflicts/Commit          | 高频页面主次收敛   |
| V016-D | 4    | 迁移 Changelists/Understanding | 辅助流程一致       |
| V016-E | 5    | 抽取领域组件与视觉 token       | 可维护的小组件     |
| V016-F | 6    | 隐私、降级、视觉与回归验收     | 全链证据           |

### 3.1 V016-A · 入口与密度审计

每个模块记录：

- 确定性主任务；
- 本地规则动作；
- 模型动作；
- 外发回执触发点；
- 建议区；
- 采用动作；
- 过期/失败/降级；
- 首屏 primary/secondary 数量；
- 标题、说明、卡片、notice、边框层数；
- 默认折叠状态和焦点顺序。

发现同一页面多个模型入口时，指定唯一入口和保留的子任务菜单。不得合并不同回执 token 或跨任务复用隐私确认。

### 3.2 V016-B · `AssistancePanel`

候选 API：

- `title`、`summary`、`sourceState`、`configured`、`expanded`；
- `localActions`、`modelActions`；
- `receipt`、`progress`、`result`、`stale`、`error`；
- slots 或明确子组件承载领域内容；
- `onExpand/onCollapse/onRetry/onDiscard`。

要求：

- 默认折叠时显示一句用途和一个“需要帮助”入口，不永久占用大块空间。
- 点击模型动作后再展示外发说明；本地动作不弹外发回执。
- receipt 仍是任务独立、一次性、可放弃状态。
- 关闭/折叠不丢建议或草稿；范围变化标 stale，不允许采用。
- 键盘展开、焦点返回、`aria-expanded`、`role=region`、IME 一次做齐。
- 组件不执行模型调用，不解析业务结果，只表达状态与事件。

### 3.3 V016-C · Commit 与 Conflicts

#### Commit

- 提交说明旁只保留一个“生成建议草稿”入口。
- 模式选择（仅文件信息/含差异）在展开后出现。
- 本地规则结果进入检查摘要，不作为“AI”按钮。
- 建议、行级差异、插入/替换/撤销保持原草稿保护。
- 回执与证据在用户主动生成时出现，完成/放弃后不长期挤压提交主表单。

#### Conflicts

- 冲突比较、编辑、保存、Resolve 始终优先。
- “本地建议/解释冲突意图”收进一个“需要帮助”入口；配置模型与否决定内部选项和真实文案。
- AI 建议只产生候选编辑；采用后仍进入 Editor undo 栈，不直接保存/Resolve。
- 结果过期时只读，人工编辑继续可用。

### 3.4 V016-D · Changelists 与 Understanding

#### Changelists

- 默认以“未分组修改/任务组/移动到…”组织。
- 本地目录/类型建议为轻量“自动整理”。
- “按改动意图拆分（含差异需确认）”进入按需帮助。
- AI 结果仍须人工调整、预览、意向单确认后才写 Changelist。

#### Understanding

- 本地检查是默认可用主路径。
- 模型分析作为按需增强，回执/覆盖率/证据不省略。
- 结果按“改了什么/需确认/影响与验证/准备提交”组织，不让模型配置成为页面主题。
- 已确认事实的 stale/待复核逻辑保持。

### 3.5 V016-E · 视觉与工程拆分

建议伴随迁移抽取：

- `AssistancePanel.svelte`；
- `SuggestionSourceBadge.svelte`；
- `ReceiptSummary.svelte`（只共享表达，不共享任务 token）；
- `ConflictStepBar.svelte`（如前版尚在页面内）；
- `CommitMessageEditor.svelte`；
- `TaskEmptyState/TaskErrorState` 复用；
- 视觉 spacing/button/notice/card token。

规则：

- 8/12/16/24px 层级统一，但服从 VS Code 密度。
- 一个页面只有一个 primary。
- 不给每段文字套卡片；说明改为摘要+详情。
- status badge 不承担按钮职责。
- 拆分时 state 仍由父领域模块/Host 权威管理；子组件用显式 props/events。
- 不顺带格式化或重构无关模块。

### 3.6 V016-F · 验证

- 单元：来源文案、configured/unconfigured、stale、receipt 隔离。
- 组件：AssistancePanel 展开/折叠/焦点/IME/错误/重试。
- 各模块：AI 关闭、模型成功/失败/取消/过期、草稿保留。
- 协议/Host：外发 token、task/scope/candidate/hash 边界完全保留。
- E2E：人工路径不展开 AI；主动展开后完整回执；采用后返回主流程。
- 视觉：首屏 primary 数、三主题、720×480、200%、High Contrast。
- 快照：只更新有意的视觉基线，不批量接受未知变化。

## 4. 主要代码落点

| 领域          | 位置                                                            |
| ------------- | --------------------------------------------------------------- |
| 共享帮助      | 候选 `src/webview/components/assistance/`                       |
| Commit        | `src/webview/features/commit/CommitModule.svelte`               |
| Conflicts     | `src/webview/features/conflicts/ConflictsModule.svelte`         |
| Changelists   | `src/webview/features/changelists/ChangelistsModule.svelte`     |
| Understanding | `src/webview/features/understanding/UnderstandingModule.svelte` |
| 来源/i18n     | `src/webview/i18n/`、AI source mapping                          |
| Host          | 现有各 AI action；原则上不改安全语义                            |
| 测试          | component/E2E/protocol/visual                                   |

## 5. 验收指标

- AI 未配置时核心路径成功率 5/5。
- 每页模型入口 ≤1。
- 每页强调色 primary =1（Dialog 内当前执行动作除外）。
- 外发前模型、数据类型、范围、预算、历史继续完整展示。
- 模型失败不改变当前选择/草稿/冲突结果。
- 720×480/200% 下不展开 AI 时主任务至少保留一个完整可操作区。
- 来源不真实、AI 自动写操作、过期建议可采用均为阻断失败。

## 6. AI 完成报告格式

- 各模块入口 before/after；
- 本地/模型来源映射；
- `AssistancePanel` API 与迁移范围；
- 隐私和过期契约；
- 视觉密度数据；
- AI 关闭主路径结果；
- 是否满足进入 [`v0.1.7`](../v0.1.7/)。

## 7. 延期

- 全面快捷帮助、读屏、小视口专项在 `v0.1.7`。
- 新模型能力、自动验证或长期 AI 记忆不在本版本。
- 大文件建议渲染性能与多窗格在 `v0.1.8`。
