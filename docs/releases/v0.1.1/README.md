# SVN Workbench v0.1.1：统一冲突差异视图与角色映射

> 文档身份：`planned-version-record`
>
> 状态：规划中（`draft/planned`）。只有 [`v0.1.0`](../v0.1.0/) 退出门禁通过后才可进入开发。
>
> 基线版本：[`v0.1.0`](../v0.1.0/)。
>
> 路线来源：[融合审查报告](../../archive/product-reviews/2026-08-23/以人为本易用性审查与优化报告.md)第 6.2～6.5、8.2 节。
>
> 优先级：P0。将普通 Diff 已验证的 Pierre 适配能力带入冲突页。
>
> 用户可独立体验的主路径：打开一个文本冲突，在同一差异视图中看清“我的修改（本地）”“对方修改（仓库 revision）”“共同基线（BASE）”，跳转到当前冲突块并就地选择采用我的、采用对方或保留双方；结果先进入安全草稿，不直接 Resolve。
>
> 不包含：自由文本编辑、反向保留双方、最终写盘/Resolve 重构、四窗格、依赖升级。

## 1. 版本目标

当前 `ConflictsModule.svelte` 已有冲突列表、Mine/Theirs/BASE Tab、块级采用、草稿和 Resolve 契约，但冲突正文仍以 marker 文本和正文外按钮为主。本版本新增薄组件 `ConflictDiffView.svelte`，优先使用已验证的 `UnresolvedFile`，让动作与冲突块处于同一视觉上下文。

成功标准：

- Mine/Theirs/BASE/合并结果角色始终可见，current/incoming 只存在于适配层内部。
- 每个冲突块旁提供中文、键盘可达的就地动作。
- 动作只修改当前 Host 内存草稿或受控 Webview 草稿，不写工作副本、不执行 `svn resolve`。
- 冲突文件、scope、revision、内容 hash 或 marker 集变化后，旧动作立即失效。
- Pierre 失败或输入不受支持时，保留现有冲突编辑器作为明确的“简化编辑”降级。
- 左侧文件进度和正文内冲突进度分别表达，不把“文件 1/2”和“块 1/7”混为一个数字。

## 2. 进入与退出门禁

### 2.1 进入条件

- [x] `v0.1.0` 对 `UnresolvedFile`、自定义动作、CSP、主题和 cleanup 的结论为 go（2026-08-24 门禁 spike 实测补齐：七维度全 go、严格 CSP 零违规、5000 行冲突 fixture 挂载约 1260ms / 动作点击约 68ms、损坏 marker fail-closed；证据 `.validation/evidence/v0.1.1-spike/2026-08-24T15-00-00-000Z-final`，lead 独立复跑结论一致）。
- [x] 已有冲突草稿三选一、解释回执、保存和 Resolve 测试保持通过（2026-08-25 lead 独立复测：ConflictsModule/ConflictsModuleDraft 等 11 个冲突相关测试文件 72/72 通过，全量 128 文件 1389/1389 绿，`npm run check` 与 `docs:verify` 通过；V011-D 中途残留的 `activePane` 引用与 lint/类型错误已修复）。
- [x] 已建立 Git/SVN marker、CRLF、无 BASE marker、损坏 marker、超长行和多块 fixture（2026-08-24 V011-A 落地：`src/conflict/fixtures.ts` 确定性 fixture 集，含 BOM、无末尾换行、嵌套损坏与 5000 行级性能 fixture；`tests/unit/conflictDiffModel.test.ts` 与扩展 `conflictMerge.test.ts` 共 18 项通过）。
- [x] 明确 SVN 生成的 marker 顺序，不能凭 `current/incoming` 字面名映射 Mine/Theirs（2026-08-24 V011-A 固化：真实顺序 `<<<<<<< .mine` → `||||||| .rBASE`（可选）→ `=======` → `>>>>>>> .rN`，按位置映射 Mine/Theirs，交换内容 fixture 证明不凭字面名；见 `docs/current/实现与代码映射.md` 冲突领域条目与 `src/conflict/conflictDiffModel.ts` 头部注释）。

### 2.2 退出条件

- [x] V011-A～V011-F 全部完成。
  - 进度：V011-A/B/C/D/E 已落地；V011-E（2026-08-25 lead 独立核验：fail-closed 降级覆盖 UnresolvedFile 渲染异常/损坏 marker/二进制/截断/缺失/过期/草稿保留/AI 本地降级，`?conflictScenario=damaged|binary|truncated|missing` 可演示；`ConflictsModuleFallback.test.ts` 3/3、冲突相关组件 33/33、全量 129 文件 1392/1392 绿，`npm run check` 0 错误 1 历史警告、`docs:verify` 通过；V011-D 夹具误判与 `state_referenced_locally` 新警告已修复）。
  - V011-F 自动化已落地（2026-08-25 lead 独立核验：`tests/webview-e2e/conflict-v011-f.spec.ts` 6/6 覆盖 §3.6 三种结果不触发 Host 写操作/切换文件三选一/四场景故障降级草稿保留/720×480 小高度滚动归属/严格 CSP 零违规/块导航键盘焦点；Playwright `--project=webview` 全量 89/89 绿，全量 vitest 129 文件 1392/1392、`npm run check` 0 错误 1 历史警告、`docs:verify` 通过；同步修复 V011-D details 折叠引发的 3 处历史 spec 回归与 4 处 src 真实 bug：ConflictsModule `untrack`、ConflictDiffView 0 块不误报 fallback、global.css 小高度滚动归属、cspCompatObserver 垫片扩 insertBefore/append 路径）。剩余：人工验收（5 秒角色识别、连续 10 块）。主路径 AI 关闭验证已完成（见退出条件第 2 条勾选）。
- [x] 主路径在 AI 未配置时完整可用（2026-08-25 lead 独立核验：`tests/webview-e2e/conflict-ai-disabled.spec.ts` 5/5，通过 `?ai=disabled` mock 未配置外部模型，覆盖进入冲突页基础信息无 AI 报错、三种结果仅 `conflict/draft-update` 无 AI 请求与 Host 写操作、帮助区展示本地建议且如实标注「本地检查」不标为模型、草稿三选一/保存/导出可用、全程无 console 错误级 AI 噪音；Playwright webview 全量 94/94、单测 129 文件 1392/1392、`npm run check` 0 错误、`docs:verify` 通过）。
- [x] 受控草稿、角色映射、过期拒绝、fallback 和键盘操作均有自动化证据。
- [x] `npm run verify` 通过，并完成人工冲突角色识别走查（2026-08-26 真机验收：VS Code 1.134 + svn-workbench 0.1.1 VSIX，svn-conflict-demo 隔离副本 demo.js 冲突页四角色条/三动作/AI 分析按钮渲染正常；受 Workspace Trust 受限模式影响曾误判为驱动问题，解除后确认非扩展缺陷。10 块连续操作由 mock fixture `?conflictBlocks=10` + `conflict-10blocks.spec.ts` 覆盖，每块独立、进度 1/10→10/10 正确、无 Host 写）。操作清单：
  1. 安装打包的 VSIX 后打开含冲突的 SVN 工作副本，进入「冲突」页（或 mock `?module=conflicts` 正常场景）。
  2. 角色识别：5 秒内仅凭界面固定文案/图标（不只靠颜色）说出四角色——我的修改（本地）=工作副本改动、对方修改（仓库 rN）=仓库 incoming、共同基线（BASE）=冲突前共同版本、合并结果=当前草稿。
  3. 连续处理 10 个块：用顶部「上一个块/下一个块」或键盘导航，逐块执行「采用我的/采用对方/保留双方」，每次确认草稿区只改对应当前块、其它块不变、块进度 X/Y 正确推进；连续 10 块无选错对象即通过。
  4. 顺带观察（不阻断）：顶部路径/revision/剩余数始终可见；720×480 下滚动只发生在主体区；Light/Dark/High Contrast 三主题下角色与状态可辨。
  5. 任一角色 5 秒内说不清、或某次动作改到别的块/整篇，记块号与现象反馈定位修复。
- [ ] 满足进入 [`v0.1.2`](../v0.1.2/) 的编辑与草稿前置条件。

## 3. AI 任务拆分

| ID     | 顺序 | AI 开发任务                         | 主要产物                  | 依赖           |
| ------ | ---- | ----------------------------------- | ------------------------- | -------------- |
| V011-A | 1    | 固化 SVN 冲突角色与 marker 领域模型 | 纯函数、品牌类型、fixture | v0.1.0 go      |
| V011-B | 2    | 建立 `ConflictDiffView` 薄适配器    | `UnresolvedFile` 生命周期 | V011-A         |
| V011-C | 3    | 实现受控就地冲突动作                | 中文动作与草稿变更        | V011-B         |
| V011-D | 4    | 重排冲突页阅读层级与导航            | 用户可见统一工作区        | V011-C         |
| V011-E | 5    | 处理不支持输入、过期和降级          | fail-closed 分支          | V011-B         |
| V011-F | 6    | 测试、文档与人工验收                | 版本退出证据              | V011-D、V011-E |

### 3.1 V011-A · 角色与 marker 领域模型

新增或收敛到 `src/conflict/` 的纯逻辑必须负责：

- 输入由 Host 已校验的 BASE、Mine、Theirs、Working 文本和 revision 元数据组成。
- 生成稳定 `ConflictFileIdentity`、`ConflictRegionIdentity` 与内容 hash；索引不能作为跨刷新永久身份。
- 明确“我的修改（本地）”“对方修改（仓库 rN）”“共同基线（BASE）”“合并结果”的显示模型。
- 根据真实 marker 数据构造 Pierre 输入；解析失败返回结构化原因，不猜测或自动修复损坏 marker。
- current/incoming → Mine/Theirs 映射由 fixture 证明，交换 marker 顺序时测试必须失败或正确重映射。
- CRLF、BOM、末尾换行和无 BASE marker 不得被规范化后静默改变内容。

建议单元测试：`tests/unit/conflictDiffModel.test.ts`、扩展 `conflictMerge.test.ts`。

### 3.2 V011-B · `ConflictDiffView.svelte`

组件职责：

- 接收稳定 identity、语言、受控冲突内容、角色展示和只读/草稿模式。
- 挂载 `UnresolvedFile`，复用 `v0.1.0` 的 Pierre 生命周期、CSP observer、主题和错误分类。
- 使用 `mergeConflictActionsType` 渲染自定义中文动作，不直接依赖库默认英文按钮。
- 使用 `onMergeConflictAction` 上报语义动作；组件不持有最终业务主权。
- 暴露 `focusConflict`、当前/总冲突块、读取当前受控结果和清理接口。
- 组件销毁、文件切换、主题切换和异常恢复时无 observer/DOM/Worker 泄漏。
- 绝不发送 Host 写操作，也不接触绝对路径。

### 3.3 V011-C · 受控就地动作

本版本只提供三个稳定动作：

1. “采用我的修改”；
2. “采用对方修改”；
3. “保留双方修改”。

实现要求：

- 动作 payload 包含文件 identity、冲突 region identity、预期内容 hash、语义 resolution，不只传数组索引。
- Svelte/Host 在应用前重新核对 region 仍存在且内容 hash 匹配。
- 每次动作形成新的 draft revision，旧 revision 重放或乱序到达被拒绝。
- 动作后的结果立即回显，视口和键盘焦点保持在同一块附近。
- “保留双方”顺序在本版本明确为当前已验证顺序并在 Tooltip 中说明；另一顺序延期到 `v0.1.2`。
- 动作可通过现有“放弃草稿/恢复原内容”路径整体撤销；细粒度 undo 在下一版本交付。

如需协议变化，必须同步：

- `src/protocol/workbenchProtocol.ts` 字面量联合和运行时清单；
- Host action 路由和 task/scope/session 校验；
- `mockWorkbench.ts`；
- HostToWebview/WebviewToHost 守卫；
- 单元、组件、E2E。

若可以完全复用现有 `conflict/draft-*`，优先不新增协议。

### 3.4 V011-D · 冲突页重排

目标结构：

- 顶部：文件路径、来源 revision、剩余冲突文件数。
- 紧凑导航：上一个/下一个文件，上一个/下一个冲突块，当前块 X/Y。
- 固定角色说明：我的修改、对方修改、BASE、合并结果。
- 主体：`ConflictDiffView`，动作紧邻对应冲突块。
- 辅助来源 Tab 和 AI 解释放入“查看来源/需要帮助”，默认不与块级动作争夺首屏。
- 底部保留现有草稿/保存/Resolve 区，但本版本不改变其安全行为。

交互要求：

- 打开文件自动聚焦首个未处理块。
- 列表筛选不改变冲突集合或 operation scope。
- 切换文件触发现有草稿三选一，后台刷新不抢焦点。
- 角色、状态和选择不能只用颜色表达。
- 小高度下主体拥有明确滚动区，顶部导航和必要草稿状态可达。

### 3.5 V011-E · 安全降级

必须覆盖：

- `UnresolvedFile` 不支持或渲染异常；
- marker 缺失、嵌套、损坏或与 Host 结构不一致；
- 二进制、非法编码、超过当前编辑上限；
- 文件移出 scope、切换 working copy、revision/hash 变化；
- 草稿存在时组件失败；
- AI 未配置、AI 超时或解释结果过期。

处理方式：

- 保留草稿，不自动切换或丢弃。
- 提供“使用简化编辑器”“在编辑器中打开”“导出草稿”中适用的出口。
- 显示真实原因；本地 fallback 不标为 AI。
- 异常不会自动保存、Resolve 或扩大文件范围。

### 3.6 V011-F · 测试与文档

最低测试：

- 领域：角色映射、marker 顺序、CRLF/BOM/末尾换行、损坏 marker、hash 失效。
- 组件：自定义中文动作、键盘焦点、块 X/Y、主题、cleanup、fallback。
- Conflicts 集成：列表/正文进度、草稿三选一、刷新过期、AI 收起。
- 协议：新增 action 时全链一致性和旧会话拒绝。
- Webview E2E：采用三种结果、切换文件、故障降级、720×480。
- 严格 CSP：生产等价无违规。
- 人工：5 秒内正确指出四个角色，连续处理 10 个块无选错对象。

## 4. 主要代码落点

| 领域            | 主要位置                                                             | 约束                                   |
| --------------- | -------------------------------------------------------------------- | -------------------------------------- |
| 冲突模型        | `src/conflict/conflictMerge.ts`、候选 `conflictDiffModel.ts`         | 纯函数，不读 DOM/VS Code               |
| Pierre 冲突适配 | 候选 `src/webview/features/conflicts/ConflictDiffView.svelte`        | 复用共享生命周期，不复制 Diff 引擎     |
| 冲突页面        | `src/webview/features/conflicts/ConflictsModule.svelte`              | 保留草稿、解释、保存、Resolve 现有契约 |
| 协议/Host       | `workbenchProtocol.ts`、`WorkbenchController` 或冲突领域 action 文件 | 只有必要时修改；scope/task/hash 复验   |
| Mock            | `src/webview/mocks/mockWorkbench.ts`                                 | 正常/损坏/过期/fallback 可演示         |
| 测试            | `tests/unit`、`tests/components`、`tests/webview-e2e`                | 成功、拒绝、过期、失败、恢复           |

## 5. 验收清单

- [ ] 角色中文名称和 revision 始终可见。
- [ ] current/incoming 从不直接成为用户主文案。
- [ ] 每个块的动作与对应差异内容处于同一上下文。
- [ ] 三种动作都只改变草稿，并显示具体变化。
- [ ] 文件/region/hash 变化后旧动作被拒绝。
- [ ] 切换文件时草稿三选一不退化。
- [ ] Pierre 失败可回到简化编辑器且草稿不丢。
- [ ] AI 完全关闭时可完成全部本版本主路径。
- [ ] 键盘、IME、三主题、小视口通过。
- [ ] 不修改工作副本、不执行 Resolve 的边界有测试证明。

## 6. AI 完成报告格式

AI 必须报告：

1. 统一冲突视图的用户变化；
2. 角色映射的证据和 marker 假设；
3. 新增/复用协议；
4. 草稿与过期状态如何保护；
5. fallback 覆盖；
6. 自动化与人工结果；
7. 是否允许进入 [`v0.1.2`](../v0.1.2/)。

## 7. 延期

- `v0.1.2`：自由编辑、细粒度 undo/redo、两种保留双方顺序、查找。
- `v0.1.3`：保存核验、Resolve、下一个冲突和返回来路。
- `v0.1.8`：多窗格同步、locator、超大冲突性能。
