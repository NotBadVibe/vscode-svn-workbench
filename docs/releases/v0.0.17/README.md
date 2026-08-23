# SVN Workbench v0.0.17：发现性与核心任务效率

> 文档身份：`candidate-version-record`
>
> 状态：候选验收中。批次 A–F 已实现；源码提交 `5707a1e71e59df8d629997c7b8201c03bcd4e1f8`、VSIX 指纹与已接受 evidence 已绑定于 [`manifest.json`](./manifest.json)。本版本将随 `v0.0.18` 同包发布，不单独创建标签。当前开发事实以源码、测试和 [`../../current/`](../../current/) 为准。
>
> 规划基线：[`v0.0.16`](../v0.0.16/)。依赖 v0.0.13 机制 A（会话状态总线，用于筛选预设存取）。
>
> 优先级：P1。关闭易用性审查条目 C-01（推荐下一步）、C-09（空工作副本快捷动作）、U-06（冲突下一步 CTA）、C-02（空状态矩阵）、U-09（Repository 信息架构，含 Update 拆分）、C-13（文件类型筛选与筛选预设）。
>
> 不包含：推荐只是推荐，不替用户执行、不扩大右键范围、不自动开始写操作；不新建"大首页"或第二套业务 UI 架构。

## 1. 版本结论

状态与入口已经很多，缺的是"此刻最该做什么"的稳定答案和与频率匹配的导航层级。本版本做同一条信息架构主线的四个切面：全局推荐下一步带、Update 拆分为独立页面（与 Changes/Commit 平级组成"日常三件套"）、Repository 剩余任务分组、文件类型筛选与预设。

## 2. 范围与实现状态

1. **全局推荐下一步带（C-01/C-09）✅**：挂在 ScopeBar 下方，Host 按最新模块快照统一推导（`src/extension/workbench/nextStepRecommendation.ts` 纯函数：有冲突 → "处理 N 个冲突"；有本地修改 → "检查建议的 N 个文件"；干净且未配置 AI → "了解 AI 可选能力"；干净 → "检查远端更新"）；推荐经 `WorkbenchScopeView.recommendation` 随 `app/initialize` 与 `scope/changed` 下发，key 随状态摘要变化；Webview（`AppShell.svelte`）可忽略，忽略仅会话内生效、状态变化产生新 key 时重新展示（忽略不持久惩罚）。
2. **Update 拆分为独立模块 + U-06 合并落地 ✅**：新 moduleId `update`、任务 `update/preview`、动作 `update/preview`/`update/execute`、独立 `UpdateSnapshot`（`UpdatePreviewView`/`UpdateResultView` 自 `RepositorySnapshot` 拆出）；Host 逻辑迁入 `src/extension/workbench/updateWorkbenchActions.ts`（预览、意向单执行、执行前复验 token/范围/候选、活动记录均保持原契约）；页面 `src/webview/features/update/UpdateModule.svelte`（原 `UpdateTask.svelte` 移出 repository）；命令 `svnWorkbench.updateScope` 与项目总览 `update` 任务均指向新模块；更新结果页常驻"处理 N 个冲突"CTA（快照 `conflicts` 段由 Host 重采当前范围冲突，采集失败如实降级不阻塞）；Changes 冲突行与状态筛选区提供直达冲突模块 CTA。旧深链 `repository/update` 安全失效（协议守卫拒绝）。
3. **Repository 分组（U-09 收尾）✅**：Update 拆走后剩余任务按"分支与集成（branch/tag/merge）/ 维护与迁移（recovery/browse/properties/patch-shelf/release-notes）/ 危险操作（switch/relocate）"分组；默认展开"分支与集成"，其余折叠，展开状态经 `listPreferences` 按模块记忆；当前任务所在组始终可见；分组标题用组标签（role=group）不新增标题层级。
4. **C-13 文件类型筛选与筛选预设 ✅**：Changes/Commit 增加"文件类型"筛选维度（后缀清单从当前候选路径推导，`filterPresets.ts` 共享纯逻辑，不虚构取值）；命名预设（名称 + 通配符 patterns）经会话状态总线存取（`WorkbenchSession.filterPresets` + `list/save-filter-preset`/`list/delete-filter-preset`），Changes/Commit 共读，仅会话内不落盘。边界：筛选与预设只影响视图（filteredFiles），不改变选择集合与真实操作范围；与决策层 `commitSelection.pathRules` 无关。
5. **C-02 空状态矩阵收尾 ✅**：Update（尚未生成预览——正常状态+检查只读+生成按钮）、Changes（干净——正常状态+检查远端更新/查看历史快捷动作；筛选无匹配——原因+调整指引）、Commit（无候选——正常状态说明+回到本地修改/检查更新；未选择——选择推荐项指引）均回答"发生了什么 / 是否正常 / 现在能做什么"。

## 3. 任务拆分

| 批次 | 任务                                                                                                                                                   | 主要涉及位置                                                                                                                                                                                      | 状态 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| A    | Update 拆分：协议 moduleId `update`、taskModules/defaultTasks/类型守卫/Mock；`buildUpdateSnapshot` 拆出；`openProjectTask` taskMap、命令入口、术语同步 | `src/protocol/workbenchProtocol.ts`、`src/extension/workbench/updateWorkbenchActions.ts`、`src/extension/workbench/WorkbenchController.ts`、`src/extension.ts`、`src/webview/i18n/terminology.ts` | ✅   |
| B    | UpdateModule 页面与常驻冲突 CTA；Changes 冲突行 CTA                                                                                                    | `src/webview/features/update/UpdateModule.svelte`、`src/webview/features/changes/ChangesModule.svelte`                                                                                            | ✅   |
| C    | 全局推荐下一步带：Host 状态推导 + ScopeBar 下方展示                                                                                                    | `src/extension/workbench/nextStepRecommendation.ts`、`src/webview/components/ui/AppShell.svelte`                                                                                                  | ✅   |
| D    | Repository 剩余任务分组与渐进展开                                                                                                                      | `src/webview/features/repository/RepositoryModule.svelte`、`src/webview/app/listPreferences.ts`                                                                                                   | ✅   |
| E    | 文件类型筛选维度 + 命名筛选预设                                                                                                                        | `src/webview/components/list/filterPresets.ts`、Changes/Commit                                                                                                                                    | ✅   |
| F    | 空状态矩阵收尾；协议守卫、Mock、测试同步                                                                                                               | `tests/`（见 §5）                                                                                                                                                                                 | ✅   |

## 4. 开放问题决策（实现时确认）

- **Update 快照形态**：采用独立 `UpdateSnapshot`（规划倾向），`RepositorySnapshot` 不再保留 update/lastResult 段；会话状态相应拆出 `updateState`（preview/candidateHash/result）。
- **Repository 分组默认展开**："分支与集成"默认展开，"维护与迁移"/"危险操作"默认折叠；当前任务所在组强制可见；不按最近使用动态排序（保持稳定层级）。
- **C-13 筛选预设归属**：当前项目会话级（`WorkbenchSession` 内存，不落盘、不跨重启），Changes/Commit 共读；不做用户级全局预设。

## 5. 候选验收证据

- `npm run verify` 已通过：1339 个覆盖率门禁测试、82 个 Webview E2E、性能预算与 Extension Host 验收均通过；VSIX 在独立 VS Code 配置中完成安装、卸载与重装。可追溯字段、工件和树指纹以 [`manifest.json`](./manifest.json) 为准。
- 性能预算同步：UpdateTask 随 update 独立模块拆出为 UpdateModule chunk（计入 lazyChunks 总量，实测 19 ≥ 17），`minimumRepositoryTaskChunks` 随架构由 7 调整为 6（`scripts/measure-webview-performance.js` 正则与预算同步更新）；其余预算（首屏体积、交互 P95、5000 项窗口化）实测均在限内。
- 新增测试：`tests/unit/nextStepRecommendation.test.ts`（推导优先级与快照提取）、`tests/components/UpdateModule.test.ts`（令牌契约、冲突 CTA、空态三要素、恢复入口）、`tests/components/ChangesConflictsFilter.test.ts`（冲突 CTA、类型筛选不改选择、预设保存/应用/删除）。
- 迁移测试：`workbenchProtocol.test.ts`（update 模块守卫）、`workbenchArchitecture.test.ts`（标题映射）、`RepositoryModule.test.ts`（分组导航）、`activityExecutionRecords.test.ts`（taskId 迁移）、`chinese-scroll.spec.ts` SCR-07、`workbench.spec.ts` 更新用例、`page-screenshots.spec.ts` Repository/Update 步骤。

## 6. 验收口径

- 审稿六条端到端用户任务全部可执行（无 CLI 首次启动、首次查看修改、选择带入提交、Update 后冲突直达、冲突编辑不丢稿、非 SVN 文件夹恢复）。
- 推荐动作可从任一模块看到，且数量与目标页一致；推荐可忽略，忽略不持久惩罚。
- Update 独立后，原 Repository 入口、命令、项目总览入口行为一致或明确迁移（旧深链 `repository/update` 安全失效）。
- 筛选预设在刷新与快照更新后不静默扩大选择（筛选只是视图维度，选择集合经 refreshSelectionSet 只保留合法交集）；3–5 名"用过 SVN 但不熟本项目"用户走查记录首次成功率与停顿点（候选阶段执行，非阻断）。

## 7. 延期项

- 筛选预设的跨会话持久化（当前有意只做会话级；持久化需项目隔离与清理策略设计）。
- "无扩展名"文件集合暂不支持保存为预设（文件名通配符无法精确表达），UI 已如实说明。
- Repository 分组按"最近使用"动态调整顺序（当前保持稳定层级）。
