# SVN Workbench v0.0.17：发现性与核心任务效率

> 文档身份：`planned-version-record`
>
> 状态：规划中，不代表已实现。当前开发事实以源码、测试和 [`../../current/`](../../current/) 为准。
>
> 规划基线：[`v0.0.16`](../v0.0.16/)（规划中）。依赖 v0.0.13 机制 A（会话状态总线）。
>
> 优先级：P1。关闭易用性审查条目 C-01（推荐下一步）、C-09（空工作副本快捷动作）、U-06（冲突下一步 CTA）、C-02（空状态矩阵）、U-09（Repository 信息架构，含 Update 拆分）、C-13（文件类型筛选与筛选预设）。
>
> 不包含：推荐只是推荐，不替用户执行、不扩大右键范围、不自动开始写操作；不新建"大首页"或第二套业务 UI 架构。

## 1. 版本结论

状态与入口已经很多，缺的是"此刻最该做什么"的稳定答案和与频率匹配的导航层级。本版本做同一条信息架构主线的四个切面：全局推荐下一步带、Update 拆分为独立页面（与 Changes/Commit 平级组成"日常三件套"）、Repository 剩余任务分组、文件类型筛选与预设。

## 2. 范围

1. **全局推荐下一步带（C-01/C-09）**：挂在 ScopeBar 下方，Host 按快照状态统一生成（有冲突 → "处理 N 个冲突"；有建议提交 → "检查建议的 N 个文件"；干净 → "检查远端更新 / 查看历史"；AI 未配置 → "了解 AI 可选能力"）；必须说明理由、允许忽略。
2. **Update 拆分为独立模块 + U-06 合并落地**：`repository/update` task 拆为新 moduleId `update`；`UpdateTask.svelte` → `UpdateModule.svelte`；更新结果页常驻"处理 N 个冲突"CTA，携带当前冲突文件与范围；Changes 冲突行同样提供直达 CTA。
3. **Repository 分组（U-09 收尾）**：Update 拆走后剩余任务按"分支与集成 / 维护与迁移 / 危险操作"分组；高级区默认折叠并记忆展开状态；页面只保留一个主标题层级。
4. **C-13 文件类型筛选与筛选预设**：Changes/Commit 增加"文件类型"筛选维度（后缀清单从当前候选路径推导，不虚构）；`listPreferences` 扩展为可保存命名筛选预设（名称 + glob 集合）；预设复用 v0.0.13 会话状态总线存取。边界：筛选只影响视图，不改变真实操作范围；与决策层的 `commitSelection.pathRules` 文案不得混用。
5. **C-02 空状态矩阵收尾**：每个空态回答"发生了什么 / 是否正常 / 现在能做什么"。

## 3. 任务拆分

| 批次 | 任务                                                                                                                                                                             | 主要涉及位置                                                                                                                                 |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | Update 拆分：协议新增 moduleId `update`、`taskModules`/`defaultTasks`/类型守卫/Mock；`buildUpdateSnapshot` 拆出；`openProjectTask` taskMap、命令入口（`extension.ts`）、术语同步 | `src/protocol/workbenchProtocol.ts`、`src/extension/workbench/WorkbenchController.ts`、`src/extension.ts`、`src/webview/i18n/terminology.ts` |
| B    | UpdateModule 页面与常驻冲突 CTA；Changes 冲突行 CTA                                                                                                                              | `src/webview/features/update/UpdateModule.svelte`（新）、`src/webview/features/changes/ChangesModule.svelte`                                 |
| C    | 全局推荐下一步带：Host 状态推导 + ScopeBar 下方展示                                                                                                                              | `src/extension/workbench/`、`src/webview/components/svn/ScopeBar.svelte`                                                                     |
| D    | Repository 剩余任务分组与渐进展开                                                                                                                                                | `src/webview/features/repository/RepositoryModule.svelte`                                                                                    |
| E    | 文件类型筛选维度 + 命名筛选预设（`listPreferences` 扩展）                                                                                                                        | `src/webview/app/listPreferences.ts`、Changes/Commit                                                                                         |
| F    | 空状态矩阵收尾；协议守卫、Mock、`workbenchProtocol.test.ts`、`RepositoryModule.test.ts`、E2E 同步                                                                                | `tests/`                                                                                                                                     |

## 4. 验收口径

- 审稿六条端到端用户任务全部可执行（无 CLI 首次启动、首次查看修改、选择带入提交、Update 后冲突直达、冲突编辑不丢稿、非 SVN 文件夹恢复）。
- 推荐动作可从任一模块看到，且数量与目标页一致；推荐可忽略，忽略不持久惩罚。
- Update 独立后，原 Repository 入口、命令、项目总览入口行为一致或明确迁移。
- 筛选预设在刷新与快照更新后不静默扩大选择；3–5 名"用过 SVN 但不熟本项目"用户走查记录首次成功率与停顿点。

## 5. 开放问题

- Update 快照形态：独立 UpdateSnapshot（本规划倾向），还是保留组合快照只取 update 段？
- Repository 分组默认展开"分支与集成"还是按用户最近使用？
- C-13 筛选预设归属：只存当前项目，还是用户级全局可用？
