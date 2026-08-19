# SVN Workbench v0.0.12 规划：有证据的变更解读与任务内 AI 协作

> 文档身份：`planned-version-specification`
>
> 状态：候选（candidate）。批次 A（变更解读主闭环）、批次 B（提交说明接入有效确认 + 按改动意图拆分）、批次 C（冲突意图解释 + 旧 ai-review/impact/agent 入口收敛）已全部落地并通过本地完整门禁（`npm run verify` 全链路）；候选源码提交、发布 evidence 与 VSIX 指纹见 [`manifest.json`](./manifest.json)。真实读屏 / 200% 目视 / 真实 SVN 人工主路径与三平台 CI 保留为非阻断观察项。
>
> 规划基线：[`v0.0.11`](../v0.0.11/)。v0.0.11 已于 2026-08-18 正式发布；当前开发事实继续以源码、测试和 [`../../current/`](../../current/) 为准。
>
> 优先级：P2，在范围、列表、真实性与证据基础稳定后实施。
>
> 不包含：本版本不引入通用聊天首页、自由命令执行、多 Agent 编排或自动修改 / 提交代码。

## 1. 版本结论

用户不是为了“使用 AI”进入工作台，而是要理解改动、发现风险、决定验证方式、准备说明或拆分提交。v0.0.12 将分散的 Review、Impact 与固定 Agent 收敛为任务内的“解读当前变更”，并复用 v0.0.11 的回执、coverage、证据和时效模型。

## 1.1 实施状态（2026-08-19）

- 已完成（源码 + 测试，详见 `docs/current/实现与代码映射.md` §8.9-§8.11）：
  - 批次 A：统一 Snapshot 与本地/模型/用户合并、受限差异回执与证据、变更解读
    页面（understanding）、会话内确认（待复核、切换守卫）、入口；
  - 批次 B：提交说明接入仍有效确认事实、按改动意图拆分（无差异降级为目录/文件
    类型分组、同文件不跨实际 Changelist、preview→confirm→写入链路）；
  - 批次 C：冲突意图解释（§7 六段、受限回执、stale 只读），并移除旧
    ai-review/impact/agent 一级入口（understanding 为唯一主路径）；
  - 候选验收：`npm run verify` 全链路通过（静态检查、双平台契约、覆盖率门禁
    1160 项单元/组件测试、75 项 Webview/视觉/无障碍 E2E、性能预算、Extension
    Host 真实 SVN 验收，行覆盖率 91.48%），并同步 `docs/current/`。
- 非阻断观察项（沿用惯例）：真实读屏、200% 缩放与 High Contrast 目视复验；
  人工主路径验收记录；三平台 CI 在标签推送后运行。
  结果必须回答：

1. 改了什么；
2. 为什么值得关注；
3. 依据在哪里；
4. 哪些只是推断或未知；
5. 下一步验证、补充、拆分或提交什么。

## 2. 信息架构

### 2.1 收敛入口

- Changes / Commit 的主辅助入口：**解读所选变更（N）**；
- 配置入口：**设置 AI 辅助**；
- Changelist 继续是 SVN 任务，“按改动意图拆分”在结果中按需进入；
- 冲突解释只出现在当前冲突文件附近；
- 提交说明建议只出现在 Commit；
- 取消独立公开的固定 Agent 入口。

### 2.2 页面迁移

| 旧表面         | v0.0.12 目标              | 原因                           |
| -------------- | ------------------------- | ------------------------------ |
| AI Review      | 变更解读中的“需要关注”    | 风险必须与改动事实和证据相连   |
| Impact         | 变更解读中的“影响与验证”  | 用户不应手工拼接两个窗口       |
| Agent          | 移除一级入口              | 固定三步不响应目标，只增加审批 |
| Commit AI 说明 | 使用 v0.0.11 的证据化建议 | 保留原草稿和明确采用           |
| 智能拆分       | “按改动意图拆分”          | 区分语义拆分与目录分组         |
| 冲突 AI 分析   | “解释两侧改动”            | 输出意图、证据、未知与验证     |

## 3. 推荐主流程

```text
在 Changes / Commit 选择明确项目范围
  → 解读所选变更
  → 查看本地检查与外发回执
  → 开始模型分析，或只运行本地检查
  → 阅读“改了什么 / 需要确认 / 影响与验证”
  → 打开证据核对并补充用户意图
  → 生成提交说明或按意图拆分
  → 回到既有 Commit / Changelist 预览与确认
```

只读采集、脱敏和同一次分析不重复逐步批准；新的隐私范围与任何写操作继续独立确认。

## 4. 变更解读页面

### 4.1 首屏

无需滚动即可看见：

- 用途：“理解当前修改、找出需要确认的风险，并准备验证与提交说明”；
- 工作区、项目、scope 和候选数量；
- 尚未分析、运行、完成、部分或过期状态；
- 本地检查 / 外部模型来源；
- “查看并开始分析 N 个文件”或“只运行本地检查”；
- AI 不会修改文件或执行提交。

模型、数据类型、预算、历史与排除详情复用 v0.0.11 的动作级回执。

### 4.2 结果顺序

1. **这次改了什么**
   - 2～5 条按用户或系统行为组织；
   - 使用“对象 + 变化 + 结果”；
   - 能证明时写“原来 / 现在”，不能证明时标为推断。
2. **需要你确认**
   - 本地阻止项、模型发现、证据不足和业务未知分开；
   - 每条包含失败后果、证据、限制和核对动作。
3. **影响与验证**
   - 关联受影响模块、调用方、配置、文档与用户流程；
   - 每条命令说明验证哪项风险；
   - 通用门禁与本次特定验证分开。
4. **准备提交**
   - 使用已确认事实生成提交说明；
   - 必要时建议拆分目的、依赖和风险；
   - 所有写动作进入既有预览与确认。

### 4.3 每条结论

至少包含：

- `statement`：具体变化或风险；
- `source`：本地、模型、用户或混合；
- `evidence`：Host 校验的 candidate / hunk；
- `impact`：对用户、调用方、配置、数据或测试的影响；
- `confidenceReason`：理由，不只是百分比；
- `limitations`：缺失、截断、二进制或推断；
- `nextAction`：核对、补充、测试、排除或提交。

没有证据的内容只能是“待确认假设”，用户可以补充、忽略或确认。用户确认与模型原始输出分开保存。

### 4.4 证据交互

- 点击证据在独立 Diff 窗口打开对应文件和差异位置；
- 返回保留结果、展开、焦点和滚动位置；
- 多证据显示主证据与“另有 N 个”；
- 复制摘要保留项目内路径，不包含本地绝对路径、完整 Prompt 或敏感正文；
- 复用 v0.0.10 的路径、搜索、排序和可访问性组件。

## 5. 统一结果模型

建议建立：

```ts
interface ChangeUnderstandingSnapshot {
  kind: "change-understanding";
  state: "idle" | "running" | "ready" | "partial" | "failed" | "stale";
  binding: AnalysisBinding;
  receipt: AnalysisReceipt;
  coverage: AnalysisCoverage;
  changes: EvidenceBackedChange[];
  findings: EvidenceBackedFinding[];
  verification: VerificationSuggestion[];
  userConfirmations: UserConfirmedFact[];
  limitations: string[];
  draftProposal?: CommitDraftProposal;
}
```

来源属于每条结果；证据不让模型控制可写路径；Commit、Changelist 和 Conflict 只消费通过 Host 范围、证据和时效校验的数据。Controller 只编排，差异分析、结果合并和验证建议进入独立领域服务。

## 6. 按改动意图拆分

- 优先消费用户核对过的变化、证据与确认事实；
- 仅有路径元数据时明确降级为“按目录和文件类型分组”；
- 每个候选说明目的、文件、依赖、风险和为何可以独立提交；
- 同一文件不能出现在两个实际 Changelist；
- 用户可手动移动文件；
- 套用后生成 Host 预览，确认后才写入 SVN Changelist；
- 模型不能把 scope 外文件加入拆分。

## 7. 冲突意图解释

输出结构：

1. 我的修改意图；
2. 对方修改意图；
3. 共同点和冲突点；
4. 推荐处理方式及对应证据；
5. 无法判断的业务选择；
6. 保存后应运行的验证。

复用动作级回执，明确冲突正文和预算。结果只能辅助用户编辑工作副本；保存与 Resolve 分别遵守现有 token、预览和确认契约。

## 8. 状态与恢复

| 状态     | 必须说明                       | 保留内容               | 恢复动作            |
| -------- | ------------------------------ | ---------------------- | ------------------- |
| 初始     | 用途、范围、数据和来源         | 选择与草稿             | 模型分析 / 本地检查 |
| 运行     | 采集、脱敏、模型或校验阶段     | 已有本地结果可看       | 取消并保留输入      |
| 空       | 无候选、无文本、全排除或无发现 | 不宣称没有问题         | 返回选择 / 看排除   |
| 部分     | 已分析与失败集合               | 已有结论带限制         | 只重试失败项        |
| 离线     | 模型不可用原因                 | 本地结果与输入         | 配置 / 重试 / 人工  |
| 结构错误 | 返回不可安全采用               | 不展示半真结果         | 本地结果 / 重生成   |
| 取消     | 取消阶段和是否已外发           | 输入与本地结果         | 重新开始            |
| 过期     | 文件、scope 或 revision 变化   | 旧结果只读、确认待复核 | 重新分析            |

## 9. 设置与来源

设置首屏显示变更解读、提交说明、拆分、冲突解释和团队规则的任务可用性、模型、输入模式、默认预算、历史开关和最近失败。Provider 字段保留在高级设置。

页面中的本地检查、模型分析、用户确认和混合结果逐条标记；置信度不能把本地硬阻止项降级成建议。

## 10. 实施顺序

1. 建立统一 Snapshot 与本地 / 模型 / 用户结果合并服务；
2. 合并 Review 与 Impact 为变更解读；
3. 实现证据卡片、用户确认、未知项和验证关联；
4. 接入 v0.0.11 提交说明建议；
5. 实现语义拆分并保留结构分组降级；
6. 重构冲突输出为两侧意图与证据；
7. 移除旧 Review、Impact、Agent 重复入口和伪场景；
8. 运行领域、安全、组件、E2E、真实 SVN 和候选验证，并同步 `docs/current/`。

## 11. 候选验收

### 11.1 用途、证据与来源

- `AI12-FLOW-01`：首屏说明用途、项目范围、来源和下一步；
- `AI12-SUMMARY-01`：至少一条结果描述“改动前 → 改动后”且有 Host 证据；
- `AI12-SUMMARY-02`：事实、推断、未知和用户确认可区分；
- `AI12-SUMMARY-03`：虚构、范围外和过期证据被拒绝并计入 coverage；
- `AI12-SOURCE-01`：每条结论单独标记本地、模型、用户或混合来源。

### 11.2 连续任务

- `AI12-VERIFY-01`：每条测试建议说明验证的具体风险；
- `AI12-SPLIT-01`：语义拆分说明目的、依赖和风险，路径模式诚实降级；
- `AI12-CONFLICT-01`：冲突解释两侧意图和未知项，但不能跳过保存或 Resolve 确认；
- `AI12-DRAFT-01`：已确认事实可进入提交建议，原草稿和撤销能力保持；
- `AI12-AGENT-01`：固定 Agent 一级入口被移除，纯只读同一次分析不重复审批。

### 11.3 恢复与可访问性

- `AI12-RECOVER-01`：初始、空、部分、离线、错误、取消与过期均有明确恢复；
- `AI12-RECOVER-02`：重新分析保留仍有效的用户确认并提示复核；
- `AI12-A11Y-01`：键盘、读屏、IME、200% 与 High Contrast 完成分析、证据核对、确认、验证、拆分和提交衔接；
- `AI12-SAFE-01`：AI 不能扩大 scope、修改文件、Resolve 或提交，所有写操作继续 Host 预览与确认。

人工主路径覆盖本地检查、模型分析、证据往返、未知项确认、验证命令、提交建议、语义拆分、路径降级、冲突解释、部分失败、过期、离线、跨项目切换和纯键盘操作。

## 12. 明确不做

- 不新增与 SVN 任务分离的聊天首页；
- 不让模型自动选全文件、修改工作副本、解决冲突或提交；
- 不默认发送整个仓库、完整历史或范围外内容；
- 不用置信度替代证据和范围校验；
- 不恢复固定三步 Agent 或扩展到自由命令执行；
- 不为了漂亮结果隐藏空、失败、部分、过期和降级；
- 不修改 `package.json` 版本，不生成发布 evidence。

## 13. 是否继续扩展的门槛

只有候选验收证明用户能更快理解真实改动、发现至少一项有用未知或风险，并在不损害原输入的情况下继续提交，才考虑后续更强的任务代理能力。否则停止扩展 Agent，优先修正输入、证据和结果质量。

## 14. 开源作品研究结论（批次 A 前）

采用低风险结论：逐条 Host 证据（主证据 + 额外数量）、来源与限制明确展示、
confirmed/inferred/toConfirm + confidenceReason、coverage/部分失败/重试与
运行阶段诚实呈现。不采纳：全仓库上下文、自动应用/提交、模型置信驱动写操作、
聊天/diagram/Code Peek。

## 15. 批次 A 实施记录（2026-08-18，开发中）

范围固定：统一 Snapshot、本地/模型合并、受限差异回执与证据、understanding
页面、会话内确认、入口与测试；不接入 Commit 写回、不做语义拆分/冲突解释、
不移除旧入口。

已落地（源码 + 测试，详见 `docs/current/实现与代码映射.md` §8.9）：

- 新 moduleId `understanding`（任务 `understanding/analyze`）与统一
  `ChangeUnderstandingSnapshot`（state/binding/receipt/coverage/changes/
  findings/verification/userConfirmations/limitations/draftProposal）；
- 本地/模型/用户合并 `mergeUnderstandingResults`：来源逐条标记，本地硬阻止项
  不被模型降级；`AiUsageScenario` 增加 `changeUnderstanding`（设置页可见场景）；
- 受限差异回执与证据复用 v0.0.11：`AnalysisReceipt.task` 扩为
  `commit-draft|understand-changes`，pending receipt/token 显式绑定任务、
  跨任务一律拒绝；独立 `understanding/receipt` 消息（不改动已发布 commit/receipt）；
- `understanding` 页面：首屏用途/范围/来源/状态、回执三动作、四段结果、证据
  打开差异、会话内确认（IME 保护）、过期只读；`understanding/open-evidence`
  复验 token/时效/候选/范围后路由 Diff；`understanding/retry-failed` 只重采失败项；
- 会话内确认：绑定候选 hash，scope/候选/revision 变化标待复核且绝不静默沿用；
  `projectSwitchGuard` 计入切换提示；
- 入口：`svnWorkbench.understandScope`（“SVN：解读所选变更”）+ Explorer
  `svnWorkbench.ai` 子菜单；
- 测试：单元（changeUnderstanding）、Controller（workbenchUnderstanding：
  run-local 不调用模型、回执/跨任务拒绝/确认待复核/open-evidence/retry-failed）、
  组件（UnderstandingModule）、Webview E2E（主闭环/证据打开）；协议三处清单同步。

未实施（后续批次）：语义拆分（§6）、冲突意图解释（§7）、旧 Review/Impact/Agent
入口移除（§10 step 7）、提交说明写回 Commit 建议区、设置页变更解读高级字段。

## 16. 批次 B 实施记录（2026-08-18，开发中）

范围固定：将有效用户确认事实接入提交说明，并完成按改动意图拆分；不重做
commit/understanding receipt；实际 Changelist 套用保留既有预览→确认→写入链路。

已落地（源码 + 测试，详见 `docs/current/实现与代码映射.md` §8.10）：

- 跨模块会话内共享确认：`understandingConfirmations.ts`（项目键隔离、候选 hash
  一致的仍有效事实，仅会话内），commit 生成提交说明与 changelists 语义拆分复用；
- 提交说明接入确认：`commit/generate-message` 只使用仍有效确认，建议如实标注
  “已使用 N 条变更解读确认事实”；v0.0.11 不覆盖/采用/撤销/时效/证据契约不变；
- 按改动意图拆分：`changelist/preview-receipt`（任务 changelist-split 独立回执、
  脱敏与预算沿用 6000/40000）→ `changelist/run-semantic`（校验任务/token/范围/
  候选后携带差异 + 确认事实语义拆分）；无差异时 `changelist/suggest` 明确降级为
  目录/文件类型分组；模型永不加入 scope 外文件、同文件不跨拆分重复；
- 同文件不得进入两个实际 Changelist：`changelist/preview-apply` 与 `execute-apply`
  均复验（fail-closed）；实际套用保留 preview→确认→写入链路；
- Webview：变更集页语义拆分入口 + 回执三动作 + purpose/依赖展示；提交页确认事实
  提示；变更解读“准备提交”区“按改动意图拆分”入口；
- 测试：单元（commitSplitSemantic）、Controller（workbenchChangelistSemantic：
  回执/跨任务拒绝/重复文件阻止/确认事实有效与过期排除）、组件（ChangelistsSemantic）、
  Webview E2E（语义拆分主闭环/确认事实提示）。

未实施（后续批次）：冲突意图解释（§7）、旧 Review/Impact/Agent 入口移除
（§10 step 7）、变更解读/提交页间确认的跨窗口自动同步刷新。

## 17. 批次 C 实施记录（2026-08-18，开发中）

范围固定：冲突意图解释主功能（§7 六段）；不启用 conflictMerge 场景；不自动
编辑/保存/Resolve/扩大 scope；保存与 Resolve 保留既有 token/预览/确认/失败恢复。

已落地（源码 + 测试，详见 `docs/current/实现与代码映射.md` §8.11）：

- 领域 `src/ai/conflictInterpretation.ts`：六段 `AiConflictInterpretation`、
  复用受限文本预算、本地回退如实声明无法判断、严格结构校验；
- 模型 `AiProvider.interpretConflict`（复用 conflictAdvice 场景配置，不启用
  conflictMerge）；Prompt 只读、验证命令仅建议、业务未知如实列出；
- 协议：任务 `conflict-interpret`、`conflict/preview-receipt`/`receipt-dismiss`/
  `interpret`、`conflict/receipt` 消息、`ConflictSnapshot.interpretation`；
- Host：preview-receipt 只读正文算预算；interpret 校验任务/token/scope/冲突集
  hash 后调用模型并绑定；冲突集/revision 变化标 stale 只读；dismiss 放弃；
- Webview：解释入口 + 回执三动作 + 六段展示（验证命令仅展示）；保存与 Resolve
  契约不变；
- 测试：单元（conflictInterpretation）、Controller（workbenchConflictInterpret：
  回执/跨任务拒绝/冲突集变化 stale/dismiss）、组件（ConflictsModule 六段/回执）、
  Webview E2E（冲突意图解释主闭环）。

未实施（后续批次）：旧 Review/Impact/Agent 入口移除（§10 step 7，等待 ds1 清单）；
冲突解释与冲突文件的跨窗口证据跳转细化。

## 18. 批次 C 入口收敛记录（2026-08-18）

按 ds1 调研建议直接删除（不保留别名）旧 `ai-review`、`impact`、`agent`
一级模块/任务/命令/菜单/动作/Mock/组件/测试；`understanding`（变更解读）为
唯一变更解读主路径。

- 保留：`src/ai/changeIntelligence.ts` 与 `AiReviewSnapshot`/`ImpactSnapshot`
  领域契约（供 understanding 本地适配）；changelists、understanding、冲突
  意图解释与所有 receipt；保存/Resolve 契约。
- 删除：协议 module/task/action/moduleIds 三处清单中 ai-review/impact/agent；
  `AgentSnapshot`；controller 对应 case 与 helper；extension.ts 命令与入口；
  package.json 命令/菜单/activationEvent；FeatureRouter 分支与三个 feature
  目录；Mock 快照/动作；AgentModule/IntelligenceModules 组件测试与相关 e2e；
  i18n 术语与旧模块专属 CSS（保留共享类）。
- 迁移：`AiReviewSnapshot`/`ImpactSnapshot` 从协议移入 `changeIntelligence.ts`
  （领域契约）；旧深链经运行时 moduleIds 清单移除安全失效/回退。
- 文档：README 命令与能力说明、CHANGELOG（Unreleased）、docs/current 基线、
  acceptanceChecklist、chinese-scroll 与 navigation 同步。
