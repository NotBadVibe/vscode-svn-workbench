# SVN Workbench v0.1.5：任务摘要、结果出口与确认减负

> 文档身份：`planned-version-record`
>
> 状态：规划中（`draft/planned`）。依赖 [`v0.1.4`](../v0.1.4/)。
>
> 基线版本：[`v0.1.4`](../v0.1.4/)。
>
> 路线来源：[融合审查报告](../../archive/product-reviews/2026-08-23/以人为本易用性审查与优化报告.md)U-03～U-05、U-08～U-10、`4.3、`5.3、`8.3。
>
> 优先级：P0。完成高频任务的“一眼确认—唯一下一步—一次确认”。
>
> 用户可独立体验的主路径：进入 Update、History、Repository 或任一写操作页面，先看清任务/范围/状态/下一步；写操作只在执行前出现一次包含动作、数量、revision、范围、命令和恢复方式的高质量确认，完成后直接获得结果与下一步。
>
> 不包含：放宽 token/scope/revision 复验、删除专家能力、新首页、把所有页面强行改成相同布局。

## 1. 版本目标

本版本不重复实现 `v0.0.17/v0.0.18` 已交付的 ScopeBar、Update 独立模块、Repository 分组、History 加载边界和空状态，而是用真实任务复核并统一它们的表达。

标准页面骨架：

```text
ScopeBar：在哪里 / 什么范围 / 哪个 revision
TaskSummary：当前状态 / 为什么 / 下一步
TaskBody：当前任务需要的列表、Diff 或表单
PrimaryActionBar：唯一主动作 + 必要次级动作
ResultNextStep：发生了什么 / 下一步 / 恢复
```

成功标准：

- 页面首屏不重复相同任务标题和范围信息。
- 强状态才使用全宽 notice；普通推荐进入紧凑 TaskSummary。
- 同一写操作不再先勾“已核对”再打开意向单重复批准。
- OperationIntent 仍完整展示安全信息，并由 Host 执行前复验。
- Update、History、Repository、空状态等已实现能力经过真实小视口和自用路径复核，不以“存在组件”代替好用。
- 完成/失败结果均给出一个明确下一步和一个适用恢复出口。

## 2. 进入与退出门禁

### 2.1 进入条件

- [ ] `v0.1.4` 日常主路径已稳定，主操作语义不再变化。
- [ ] 列出所有写操作从入口到执行的页面、预览、复选框、Dialog 和确认次数。
- [ ] 列出 ScopeBar/页面 H1/Task notice/卡片中重复的信息。
- [ ] 记录 Update、History、Repository 和空态当前小视口截图与停顿点。

### 2.2 退出条件

- [ ] V015-A～V015-F 完成。
- [ ] 每个纳入版本的写操作只有 1 次意向单确认；极高风险额外输入必须有单独书面理由。
- [ ] 页面遵循骨架但保留领域差异，主操作和恢复入口在 720×480/200% 可达。
- [ ] 已实现项复核无回归，重复卡片/说明/确认有 before/after 记录。
- [ ] `npm run verify` 与人工核心任务通过。
- [ ] 满足进入 [`v0.1.6`](../v0.1.6/) 的共享组件稳定条件。

## 3. AI 任务拆分

| ID     | 顺序 | 任务                                    | 主要产物                  |
| ------ | ---- | --------------------------------------- | ------------------------- |
| V015-A | 1    | 审计页面信息与确认路径                  | 重复项/确认次数清单       |
| V015-B | 2    | 建立共享任务骨架组件                    | TaskSummary/Action/Result |
| V015-C | 3    | 收敛 OperationIntent 使用               | 一次高质量确认            |
| V015-D | 4    | 复核 Update/History/Repository/ScopeBar | 已交付能力打磨            |
| V015-E | 5    | 统一空、错、过期与恢复                  | 三句话状态模型            |
| V015-F | 6    | 全链测试与自用测量                      | 退出证据                  |

### 3.1 V015-A · 审计

AI 先只读生成两张表：

1. **信息重复表**：模块、ScopeBar 信息、页面标题、Task notice、卡片说明、主动作、结果区。
2. **确认路径表**：动作、预览生成、前置复选框、意向单、确认次数、Host 复验、可恢复性。

覆盖 Commit、Update、Resolve、Revert、Delete、Switch、Relocate、Merge、Cleanup、Property、Changelist apply、历史恢复。

判定规则：

- 只读预览和生成 preview 不算用户确认。
- 相同事实多处展示只有在“持续定位”和“执行前最终核对”各自必要时保留。
- 极高风险额外文本复述不能套用于所有操作。
- 不以减少点击为由删除准确预览或 Host 复验。

### 3.2 V015-B · 共享任务骨架

候选组件：

- `TaskSummary.svelte`：状态、原因、唯一建议下一步；
- `PrimaryActionBar.svelte`：一个 primary、有限 secondary、数量和 busy/stale；
- `ResultNextStep.svelte`：结果、下一步、恢复；
- `TaskEmptyState.svelte`：发生了什么/是否正常/现在能做什么；
- `TaskErrorState.svelte`：原因、恢复、诊断；
- 已有 `ScopeBar.svelte` 保持独立，不重复造范围组件。

要求：

- 先迁移 2 个代表页面验证 API，再推广，不一次重写所有模块。
- 组件只负责表达和事件，不持有 Host 安全状态。
- 中文术语集中维护；危险按钮必须含动作+数量。
- sticky/scroll 关系由页面显式声明，不在共享组件使用全局 overflow。
- 可访问名称、焦点返回、IME 和 High Contrast 一次做齐。

### 3.3 V015-C · 一次高质量确认

- 以 `OperationIntentDialog.svelte` 为唯一通用写操作确认表面。
- 移除仅重复“我已核对”的普通前置复选框。
- 意向单必须显示：动作、最终数量、项目/仓库、scope 摘要、revision、候选清单、命令、阻止项、可恢复性。
- 清单只读；改范围必须回上一步重新生成 preview。
- 过期意向单只读，确认禁用，提供“重新检查”。
- Dialog 打开/关闭焦点往返、Esc/取消一致、Tab 循环、IME 候选 Enter 不执行。
- Host 继续复验 token/repositoryUuid/scopeHash/candidateHash/revision/当前状态。
- 写操作失败保留结果、输出和恢复，不自动重试旧 token。

极高风险例外应列白名单，例如目标难以恢复的 Relocate；是否使用目标复述由领域风险决定，不得形成全局二次确认。

### 3.4 V015-D · 已交付能力复核

#### ScopeBar

- 一眼看到任务、项目/工作副本、范围/候选数、revision 和入口来源。
- 长路径可键盘展开、复制；不在协议暴露不必要绝对路径。
- 写操作显示最终候选数，普通浏览显示范围数，两者命名不混用。

#### Update

- 未检查/已检查/已完成三状态明确。
- 完成后有冲突则主操作“处理 N 个冲突”，无冲突给“查看本地修改/返回编辑”。
- 取消后说明重新采集状态，不复用半完成结果。

#### History

- “已加载最近 N 条/可能还有更早/已经全部”清楚。
- 本地过滤和仓库查询的范围分别说明。
- 加载更多不丢选中 revision 或滚动位置。

#### Repository

- 分组命名按目的，危险操作不被最近使用提升为全局主动作。
- 默认入口 Browse；当前 task 所在组可见。
- 小屏不横向铺开所有任务。

### 3.5 V015-E · 状态与恢复

所有触及模块覆盖：

- 初次加载；
- 已有数据后台刷新；
- 正常空；
- 筛选无匹配；
- 失败；
- 取消；
- 过期；
- 部分完成；
- 恢复成功/失败；
- AI 未配置（如适用）。

每个状态回答三件事，结果先行。错误必须包含可执行恢复或诊断出口；成功后给与当前来路相关的下一步，不显示通用“完成”。

### 3.6 V015-F · 测试

- 组件：共享骨架的 primary 唯一性、数量、busy/stale、焦点、IME。
- OperationIntent：各操作参数化成功/拒绝/过期/失败/恢复。
- Host：不得因 UI 减少确认而降低执行前复验。
- 页面：Update、History、Repository、ScopeBar、空/错/结果。
- E2E：至少 Commit、Update、Resolve、Revert、Switch 各走一次确认路径。
- 视口：720×480、1024×600、1440×900、200%，验证真实滚动归属和末项。
- 人工：统计确认次数、重复信息、主动作定位时间。

## 4. 主要代码落点

| 领域       | 位置                                                               |
| ---------- | ------------------------------------------------------------------ |
| 共享 UI    | 候选 `src/webview/components/task/`                                |
| Scope      | `ScopeBar.svelte`、`workbenchPresentation.ts`                      |
| 意向单     | `OperationIntentDialog.svelte`、`src/operation/operationIntent.ts` |
| Update     | `UpdateModule.svelte`、`updateWorkbenchActions.ts`                 |
| History    | `HistoryModule.svelte`、`src/history/svnHistory.ts`                |
| Repository | `RepositoryModule.svelte`                                          |
| 状态文案   | `src/webview/i18n/`                                                |
| 测试       | components/E2E/Host/visual accessibility                           |

## 5. 验收指标

- 每个普通写操作确认次数 = 1。
- 主动作定位中位数候选目标 ≤10 秒。
- 页面内部不重复 ScopeBar 已经清楚表达的同名 H1/长说明。
- 过期、失败和取消均有明确恢复，旧 token 执行均被拒绝。
- Update 冲突转入 1 次动作；History 结果完整性可由用户准确回答。
- 720×480/200% 下主操作、警告、范围和恢复入口均可达。
- 所有现有安全门禁通过。

## 6. AI 完成报告格式

- 信息重复与确认 before/after；
- 共享组件迁移范围；
- 每类写操作最终确认次数；
- Host 复验无退化证据；
- 已交付能力复核结果；
- 视口/IME/主题结果；
- 是否满足进入 [`v0.1.6`](../v0.1.6/)。

## 7. 延期

- AI 渐进展开与视觉系统进入 `v0.1.6`。
- 完整键盘帮助、读屏和全视口专项进入 `v0.1.7`。
- 不以本版本为理由删除专家命令或更改 SVN 领域语义。
