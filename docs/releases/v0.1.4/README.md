# SVN Workbench v0.1.4：Changes → Diff → Commit 连续工作流

> 文档身份：`planned-version-record`
>
> 状态：规划中（`draft/planned`）。依赖 [`v0.1.3`](../v0.1.3/)。
>
> 基线版本：[`v0.1.3`](../v0.1.3/)。
>
> 路线来源：[融合审查报告](../../archive/product-reviews/2026-08-23/以人为本易用性审查与优化报告.md)U-01、U-02、U-14、`5.1～5.2、`8.2。
>
> 优先级：P0。
>
> 用户可独立体验的主路径：从 Explorer 范围进入 Changes，选择文件并查看 Diff，返回后保持选择与列表位置，使用唯一主操作进入紧凑 Commit，核对文件摘要、填写说明并走到最终提交确认前；过程中不重复选择、不丢草稿、不扩大 scope。
>
> 不包含：真正执行生产仓库提交的人工验收、Git staging 语义、新首页、删除 Changelist/Understanding 等专家能力。

## 1. 版本目标

解决 U-01/U-02：功能已经齐全，但用户需要在 Changes、Diff、Commit 之间重新理解选择、范围和下一步。本版本不合并模块，而是让独立窗口共享连续任务上下文。

成功标准：

- Changes 每个状态只出现一个明确主操作，按钮数量与实际 payload 一致。
- 打开 Diff、返回 Changes、进入 Commit 时保留稳定的文件 identity、选择、筛选、排序、活动行、滚动位置和共享草稿。
- Commit 默认进入“文件摘要 + 提交说明 + 检查结果”的紧凑模式；完整选择策略按需展开。
- 冲突、blocked、external 和混合仓库不能因简化而静默进入提交。
- 用户从 Changes 到最终意向单前不超过 3 次主要决定。
- 主路径在 AI 未配置时完整；AI 不占据首屏主操作。

## 2. 进入与退出门禁

### 2.1 进入条件

- [ ] `v0.1.3` 冲突闭环完成，Changes 中冲突入口不会导向半成品。
- [ ] 当前 shared selection、filter preset、commit draft、project switch guard 和 module routing 测试为绿。
- [ ] 记录 v0.0.18 主路径的点击、页面、重复确认和停顿 before 数据。
- [ ] 只深入研究 GitHub Desktop、VS Code SCM 或 TortoiseSVN 中最多 3 个可核对模式，不引入 Git stage 概念。

### 2.2 退出条件

- [ ] V014-A～V014-F 完成。
- [ ] 日常路径 5/5 次自测无范围扩大、无选择/草稿/滚动位置丢失。
- [ ] Changes 和 Commit 各只有一个当前主操作；次级能力可达但不竞争。
- [ ] 所有安全选择与整批校验契约继续通过。
- [ ] `npm run verify` 与固定人工任务通过。
- [ ] 满足进入 [`v0.1.5`](../v0.1.5/) 的页面摘要和确认收口条件。

## 3. 连续上下文模型

建议在既有 Host session 上明确记录，不让 Webview 自行拼接：

- `originModule`、`originTask`、`originScopeHash`；
- `selectedKeys` 与权威 path 映射；
- `activeFileKey`；
- Changes 的 filter/sort/density/only-selected；
- `scrollAnchorKey`，不用易漂移的绝对像素作为唯一恢复依据；
- 当前 Commit draft 和 draft revision；
- Diff target identity 和返回动作；
- 上下文版本/过期原因。

规则：

- 路由只能保持或缩小 scope。
- 返回时按最新快照保留合法交集；消失、blocked、跨仓库项明确播报移除原因。
- 新出现文件绝不因为过去“全选”而自动加入。
- Webview state 只保存界面偏好；可写操作身份继续由 Host 权威 session 管理。

## 4. AI 任务拆分

| ID     | 顺序 | 任务                           | 主要产物           |
| ------ | ---- | ------------------------------ | ------------------ |
| V014-A | 1    | 记录并建模连续任务上下文       | 纯状态/路由模型    |
| V014-B | 2    | 收敛 Changes 主操作            | 唯一准确 CTA       |
| V014-C | 3    | 保持 Changes ↔ Diff 往返上下文 | 选择/焦点/滚动恢复 |
| V014-D | 4    | 实现 Commit 紧凑模式           | 摘要、说明、检查   |
| V014-E | 5    | 收敛 Changes → Commit 交接     | 不重复选择、不过期 |
| V014-F | 6    | 安全、交互、性能与人工验收     | 完整日常路径证据   |

### 4.1 V014-A · 任务上下文

- 审计 `WorkbenchSession`、`session.selectedPaths`、`listPreferences`、`workbenchRouting.ts` 和项目草稿 store，先复用后扩展。
- 将 active file 和 scroll anchor 绑定 `SelectionKey/PathIdentityKey`，Webview 不生成 identity。
- 定义路由离开、返回、目标消失、筛选变化、项目切换和窗口关闭的恢复规则。
- 同模块单例加载新目标前执行脏草稿守卫；不同模块窗口互不顶替。
- 延迟快照携带旧 `sessionId` 时忽略，不能覆盖新上下文。
- 若新增协议字段，明确兼容/失效策略并同步全链测试。

### 4.2 V014-B · Changes 唯一主操作

状态与主操作建议：

| 状态                  | 唯一主操作            | 次级动作           |
| --------------------- | --------------------- | ------------------ |
| 无选择且有推荐项      | “选择建议的 N 个文件” | 手动选择、查看筛选 |
| 已选择 N 个可提交文件 | “检查并提交 N 个文件” | 整理到变更集       |
| 当前只有冲突          | “处理 N 个冲突”       | 查看全部状态       |
| 工作副本干净          | “检查远端更新”        | 查看历史           |
| 有阻止项且无可提交项  | “查看阻止原因”        | 恢复/诊断          |

要求：

- 移除“所选”和“当前范围”两个同权提交按钮。
- “提交当前范围”如保留，只能放入更多菜单并先形成准确可提交选择，不直接执行。
- 主按钮数量来自当前权威合法选择，不能来自过滤后可见行数或缓存摘要。
- 冲突、blocked、external、重复 identity、跨仓库项 fail-closed。
- 选择/筛选变化立即使旧 commit preview/AI 建议失效。

### 4.3 V014-C · Changes ↔ Diff

- Enter/双击/明确按钮打开选中文件 Diff；来源文件保持活动行。
- Diff 顶部提供“返回本地修改”或关闭后恢复源窗口；不新建全局导航 Rail。
- 返回时恢复 filter/sort/density、only-selected、活动行和以 identity 为锚的滚动位置。
- 文件状态变化时恢复到最近合法邻项，并播报“原文件状态已变化”。
- Diff 中的页内编辑保存后，Changes 权威刷新保留合法选择，不把新状态文件自动加入。
- 多个 Diff 目标按现有单例/identity 契约复用，不破坏阅读位置。

### 4.4 V014-D · Commit 紧凑模式

首屏只保留：

1. “待提交 N 个文件”摘要、项目/仓库分组和阻止项；
2. 提交说明；
3. 自动运行的本地规则/提交前检查摘要；
4. 唯一主操作“预览提交 N 个文件”。

按需展开：

- 完整文件选择和策略；
- AI 建议与外发回执；
- 团队规则详情；
- 完整命令/证据；
- 调整文件入口。

要求：

- 从 Changes 带入后不重复展示同等重量的选择控制台。
- 本地确定性规则自动运行，结果写“本地检查”，不设置额外首屏按钮。
- AI 只在提交说明旁提供一个次级入口，未配置不影响手写和预览。
- 草稿、建议草稿、替换备份和确认事实保持原契约。
- 多仓库按执行单元拆分，不合并成一次 revision。

### 4.5 V014-E · 交接与过期

- 点击 Changes 主操作先由 Host 重新校验整批选择，再打开 Commit。
- Commit 收到明确 `source=changes` 和选择版本；显示“来自本地修改，范围未扩大”。
- 若候选变化，保留仍合法的手动选择并列出移除原因；不静默补入新文件。
- 返回 Changes 调整文件后，Commit preview/token 失效，草稿保留。
- 如果跨项目/仓库，先展示拆分执行单元，不替用户选择合并。
- 中途发生冲突，主路径切换为“处理冲突”，禁止继续旧提交预览。

### 4.6 V014-F · 测试与任务测量

最低覆盖：

- 纯状态：路由上下文、scroll anchor、合法交集、过期。
- Changes 组件：所有主操作状态、准确数量、无竞争 CTA。
- Commit：紧凑/展开、草稿、自动本地检查、AI 折叠。
- Host：整批伪造路径、blocked/external/跨仓库、旧 session/token。
- E2E：Changes→Diff→Changes→Commit→意向单前，含保存后刷新。
- 5000 文件：返回列表仍窗口化，活动行和选择恢复，不全量挂载 DOM。
- 键盘/IME/小视口/三主题。
- 人工记录：页面数、主要决定、返回次数、主动作定位时间。

## 5. 主要代码落点

| 领域      | 位置                                                                        |
| --------- | --------------------------------------------------------------------------- |
| Changes   | `src/webview/features/changes/ChangesModule.svelte`                         |
| Commit    | `src/webview/features/commit/CommitModule.svelte`                           |
| Diff      | `DiffModule.svelte`、`workbenchRouting.ts`                                  |
| 会话      | `WorkbenchSession`、`fileSelection.ts`、`listPreferences.ts`                |
| Host 校验 | `commitSelectionValidation.ts`、`WorkbenchController.applyWebviewSelection` |
| 共享草稿  | 现有 Commit session/project draft store                                     |
| 测试      | `ListSelection.test.ts`、Changes/Commit/Diff 组件、`workbench.spec.ts`      |

## 6. 验收指标

- 主动作定位中位数候选目标 ≤10 秒。
- Changes 到提交意向单前主要决定 ≤3 次。
- 文件选择、草稿和 scope 任何静默扩大为阻断失败。
- 查看 Diff 往返后活动文件、选择和滚动锚点保持；目标消失时有明确恢复。
- 主按钮显示数量与提交 preview 的 `selectedPaths.length` 完全一致。
- AI 关闭时主路径无降级提示墙。
- 720×480、200% 下主操作、范围、列表末项和错误恢复可达。

## 7. AI 完成报告格式

1. before/after 任务路径和决定数；
2. Changes 主操作状态表实际落地情况；
3. 上下文保持与过期规则；
4. Commit 紧凑模式；
5. 安全整批校验证据；
6. 5000 文件与小视口结果；
7. 是否满足进入 [`v0.1.5`](../v0.1.5/)。

## 8. 延期

- 全局页面摘要、结果出口和确认减负进入 `v0.1.5`。
- AI 面板与视觉密度统一进入 `v0.1.6`。
- 不新增 staging、历史重写或“自动提交”。
