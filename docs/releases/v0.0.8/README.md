# SVN Workbench v0.0.8：Changes 与 Commit 高频操作闭环

> 文档身份：`release-candidate-record`
>
> 状态：候选源码已完成。最终发布状态、源码提交、VSIX 指纹和自动化证据以本目录 `manifest.json` 为准。
>
> 当前进度：批次 0（路径身份/展示边界硬化）、批次 1（选择/排序/刷新纯内核）
> 与批次 2（共享列表底座 + Changes/Commit 集成闭环，见 §11b）已落地并有自动
> 化测试。真实设备与辅助技术观察项不作为发布阻断，也不得表述为已经执行。
>
> 规划基线：[`v0.0.7`](../v0.0.7/)。v0.0.7 已于 2026-08-14 正式发布；当前开发事实继续以源码、测试和 [`../../current/`](../../current/) 为准。
>
> 优先级：P0，高频用户价值；只覆盖 Changes、Commit 和共享列表底座的必要部分。
>
> 不包含：本版本不把共享列表推广到所有模块，不增加模型差异正文外发，不执行 AI 信息架构重构。

## 1. 版本结论

v0.0.8 解决截图直接暴露的高频问题：用户面对几十或数千个文件时，必须能快速筛选、排序、批量选择、看清完整路径，并准确知道下一步会处理多少对象。

本版本只做一个完整主路径：

```text
进入明确项目
  → 找到目标文件
  → 选择当前筛选可操作项
  → 核对隐藏选择与阻止项
  → 进入 Commit 检查
  → 生成准确预览
```

完成标准不是“有复选框和搜索框”，而是用户无需逐行点击即可完成“筛选 7 个已修改文件 → 全选 → 检查并提交所选”。

## 2. 为什么排在第二

- v0.0.7 先保证项目范围正确，本版本才能安全定义“当前筛选全部”；
- Changes 与 Commit 是最常用、最直接影响提交正确性的页面，优先级高于全模块视觉一致；
- 共享列表底座先在两个关键页面打磨，可以控制风险，避免一次改十多个页面；
- v0.0.9 的 AI 真实性修正会复用本版本的选择摘要和草稿保护入口，但不应阻塞基础批量操作。

## 3. 共享高密度列表底座

建议实现 `DataList`、`PathCell`、`SortHeader`、`SelectionSummary`、`BulkActionBar` 或等价 Svelte 5 领域组件。

最低能力：

- 语义化列头和 `aria-sort`，不使用伪表头表达排序；
- 搜索清除、匹配数量、空结果原因与恢复动作；
- 选中行、焦点行、悬停行和不可操作行分别表达；
- 表头与批量动作在局部列表滚动时可达；
- 行内 Diff 和 `…` 菜单支持鼠标、键盘与触屏；
- 5,000 文件继续虚拟化，但选择和排序作用于完整数据集，不遍历已挂载 DOM；
- 横向滚动只属于列表，不能形成页面级横向滚动；
- 列宽、密度、排序和可见列按 workspace 容器与模块保存在本地。

## 4. 全选与选择语义

### 4.1 集合定义

- **当前范围**：v0.0.7 建立的不可扩展 `operationScope`；
- **当前筛选**：搜索、状态和页面过滤后的可见集合；
- **当前筛选可操作项**：当前筛选中允许执行目标动作的集合；
- **推荐提交项**：本地规则标记为 `selected` 的集合；
- **当前已选**：用户手动保留的集合，可能包含隐藏项。

### 4.2 三态表头

1. 当前筛选可操作项无一选中时为未选；
2. 部分选中时为半选；
3. 全部选中时为全选；
4. 点击只影响当次快照的当前筛选可操作项；
5. `blocked` 永不被批量加入；
6. `excluded` 不进入推荐提交，但在允许的非提交动作中可由用户明确选择；
7. `needsReview` 保留“需要确认”状态；
8. 新筛选不自动取消隐藏选择；
9. 新出现文件不会因为过去点击过全选而自动加入；
10. 提供“只看已选”“清除隐藏选择”“清空全部”。

刷新后只保留 working-copy / repository identity、规范化仓库内路径与归属仍匹配的交集。消失、越界或变为阻止项的选择自动移除，并用 `role=status` 说明数量和原因；旧预览、确认 token 和 AI 结果继续失效。

## 5. 排序契约

- 支持路径、文件名、状态、选择建议和项目 / 仓库归属；
- 首次点击采用明确默认方向，再次点击反向；
- 路径使用自然、大小写不敏感的稳定比较；
- 状态与风险使用产品定义优先级，不按中文文案字典序；
- 排序不改变选择、活动行、滚动锚点、scope 或 Host 快照；
- 提供“恢复默认顺序”；
- 小屏以排序菜单替代列头，但能力不能消失。

## 6. 路径详情与操作

v0.0.7 建立路径 identity，本版本完善 `PathCell`：

- 第一行突出文件名，第二行显示项目内父目录；
- 空间不足优先中部省略，保留文件名、扩展名和靠近文件的目录；
- 单项目列表不逐行重复项目或仓库徽标；
- 读屏名称包含项目名、完整项目内路径、状态和选择状态；
- 路径详情可以选择文本，不把 `title` 当唯一出口；
- 分别提供“复制项目内路径”“复制仓库内路径”“复制 SVN URL”；
- Host 提供“复制本地完整路径”“在资源管理器中显示”“打开文件”；
- Escape 关闭详情并恢复焦点和滚动位置。

范围栏显示“工作区、项目、操作范围和候选数”。多范围详情逐项显示项目内路径、仓库内路径和归属，只允许查看和复制，不能扩大范围。

## 7. Changes 页面规格

推荐布局：

```text
┌ 项目：bchd-front-Dev3.0 · 范围：src… [范围详情] [刷新] ┐
├ [筛选文件… ×]  31 个结果  [排序：路径↑] [紧凑]        ┤
├ [已修改 7] [未版本化 21] [已删除 3] [只看已选]       ┤
├ [☐ 选择当前筛选可操作项（31）] 已选 0 · 隐藏 0       ┤
├───────────────────────────────────────────────────────┤
│ 文件 ↕                      状态 ↕  选择建议 ↕  操作   │
│ appsettings.json            已修改  常规可提交    …    │
│ SsoApi                                                │
├───────────────────────────────────────────────────────┤
│ 已选 7 [清空]       [加入变更集（7）] [检查并提交（7）]│
└───────────────────────────────────────────────────────┘
```

必做改动：

- 表头三态选择和“推荐提交 / 当前筛选 / 只看已选 / 清空选择”；
- 搜索匹配项目内路径、仓库内路径、文件名、状态、建议原因、项目和仓库名；
- 文件、状态、建议和归属稳定排序；
- 右键已选行显示“对 N 个已选文件操作”，右键未选行只作用于当前行；
- 已选摘要与批量动作使用列表内 Sticky 底栏；
- “提交所选”改为“检查并提交所选（N）”；
- “提交当前范围”改为“检查当前范围并提交（N）”；
- 合并重复的“进入提交页面”入口；
- 共享提交草稿可折叠，小高度默认折叠，脏草稿始终可见。

## 8. Commit 页面规格

- 全部、已选、推荐、需要确认、排除、阻止筛选；
- 当前筛选可提交项三态全选；
- 路径、状态、最终决策、规则来源和归属排序；
- 显示“已选 N / 候选 M，另有 K 个隐藏选择”；
- 排除和阻止原因与恢复动作就近展示；
- 规则或模型建议更新选择时，说明新增、移除及保留的手动选择；
- 生成预览按钮显示实际可提交数量；
- Changes → Commit → Preview 的项目、路径与数量必须一致；
- 提交仍执行既有远端检查、精确预览、明确确认和 Host 复验。

本版本不改变 AI 生成说明的产品结构；“不覆盖用户草稿”和来源真实性在 v0.0.9 处理。

## 9. 键盘、触屏与视口

列表聚焦时支持：

- `↑/↓`、`Home/End`、`PageUp/PageDown` 导航；
- `Space` 切换活动行；
- `Shift + Click` 与 `Shift + ↑/↓` 连续选择；
- 列表内 `Ctrl/⌘ + A` 选择当前筛选可操作项，不劫持搜索框或编辑器；
- `Enter` 打开默认只读动作；
- `Shift + F10` 或 Menu 键打开菜单；
- Escape 关闭详情 / 菜单，不直接退出任务。

所有快捷键保留中文 IME composition 保护。

720px 或 200% 缩放时使用两行卡片：首行保留文件名和状态，次行放父路径、建议和动作。Sticky 底栏不得遮挡最后一行或焦点。必须覆盖 Light、Dark、High Contrast 和 reduced motion。

## 10. 状态与动作反馈

- 未选择时在按钮附近说明“先选择至少 1 个可提交文件”；
- 按钮写明数量，例如“检查并提交所选（7）”；
- 包含不可执行项时显示“7 个可提交、2 个排除、1 个阻止”；
- 筛选后显示“已选 12，其中 9 个不在当前筛选”；
- 刷新后说明保留、移除和失效数量；
- 成功后保留结果摘要、失败项和恢复动作，不只显示短 Toast；
- 所有看起来像“提交”的入口都先进入检查 / 预览，不直接执行 SVN 写操作。

## 11. 实施顺序

1. 先实现纯逻辑的自然排序、选择集合、三态和刷新交集（✅ 批次 1 已完成，见 §11a）；
2. 实现 PathCell、SortHeader、SelectionSummary 和 BulkActionBar；
3. 在 Changes 完成截图中的 31 文件闭环；
4. 对齐 Commit 的权威选择、规则来源、隐藏选择和实际数量；
5. 增加虚拟化、小屏、200%、键盘和中文 IME 测试；
6. 运行候选验证并同步 `docs/current/`。

## 11a. 批次 1 已实现（纯逻辑内核）

本批次只交付可复用、无 DOM/VS Code/Svelte 依赖的 TypeScript 领域模块与
unit tests（`src/selection/`）：选择集合与三态（selectionCore）、自然稳定
排序（selectionSort）、刷新合法交集（selectionRefresh）。契约点：SelectionKey
复用批次 0 的 PathIdentityKey 品牌（与 DisplayPath 编译期互斥）；actionability
是调用方权威输入（可操作项 = actionable ∧ 非 blocked，blocked 二次 fail-closed，
excluded/needsReview 可操作性由动作决定）；三态只基于当前筛选可操作项；表头
toggle 只影响当次快照；blocked 永不被批量加入；excluded 不进入推荐但可由调用
方明确选择；needsReview 保留；推荐合并只加不减；隐藏选择计数/清除/
only-selected；刷新只保留 selected ∩ 保留项并返回结构化移除原因、重复 identity
快照冲突 fail-closed 取消选择、新文件绝不自动加入；natural compare（file2 <
file10）稳定兜底；状态/建议按产品优先级表、未知值恒排末尾。

本小节只记录批次 1 当时的纯逻辑边界；Svelte、Host、协议、Mock、虚拟列表与
真实 SVN 数据接入已在批次 2 完成，最终状态以 §11b、源码和自动化测试为准。

## 11b. 批次 2 已实现（列表集成闭环）

批次 1 的三个纯内核已接入共享列表底座与 Changes/Commit 页面：

- 身份与适配：`WorkbenchFileView.selectionKey`（协议 type-only 复用
  `PathIdentityKey`）由 Host 经 `createScopedFileKey` 在权威 working-copy +
  路径归属上生成，无法建立身份时 fail-closed 排除并记录；Webview 只做
  key ↔ relativePath 查表（`src/webview/app/fileSelection.ts`），动作仍提交
  relativePath 由 Host 复验；actionability 按动作权威（blocked 永不可操作，
  excluded 不进批量但 Changes 允许逐项明确选择，Commit 下 excluded 不可选）。
- 共享底座：`src/webview/components/list/`（PathCell 两行路径卡 + 中部省略、
  SortHeader 语义列头 + aria-sort + 中文方向、SelectionSummary、BulkActionBar、
  listModel 纯函数）与 `src/webview/app/listPreferences.ts`（排序/密度按模块
  经 Webview state 本地保存，不发 Host、不跨模块串用）。
- Changes：搜索清除/匹配数/空态恢复、状态筛选、五字段稳定排序与默认顺序
  恢复、表头三态（只作用于当前筛选可操作项）、隐藏选择计数/清除、只看已
  选、清空全部、推荐项入口、Sticky 批量底栏（数量与 payload 一致）、右键已
  选行提示“对 N 个已选文件操作”、快照刷新经 refreshSelectionSet 保留合法
  交集并 role=status 播报移除原因、5,000 文件继续窗口化（选择/排序作用全量）。
- Commit：六档筛选、可提交项三态、五字段排序（含规则来源）、“已选 N / 候选
  M，另有 K 个隐藏选择”、只看已选/清除隐藏/清空全部、空选择预览按钮说明
  与禁用、选择变化即本地撤销旧预览可用性、Host 权威选择的回声防护（未回
  显前旧快照不覆盖用户操作）、规则/AI 更新选择反馈新增/保留/移除明细
  （`src/commit/selectionChangeSummary.ts`，provenance 只对最后一次手动选择
  计算，规则/AI 推荐不虚构成手动选择）；>300（含 5,000）候选窗口化（复用
  listModel.windowedRows，mounted rows < 100）；小屏排序菜单（路径/文件名/
  状态/最终决策/规则来源/归属/默认）与密度切换按模块保存；小屏语义列头保留。
- Host 提交选择 fail-closed（批次 2 收口）：commit/update-selection 逐项候选
  复验（路径 ∈ 当前候选集合且非 excluded/blocked），重复路径规范化为唯一，
  非法输入不修改既有选择并返回中文错误与恢复动作（`src/commit/commitSelectionValidation.ts`）；
  buildCommitSnapshot 对初始路由/草稿恢复/旧状态同样过滤消失/excluded/blocked
  并经一次性 feedback 说明数量与原因。
- Changes → Commit 动作资格：excluded/blocked 可逐项选择（非提交动作），
  “检查并提交所选”在含不可提交项时禁用并 role=status 提示“有 N 个所选文件
  不可提交，请取消选择后继续”，按钮数量显示可提交数量且与 payload 一致；
  Changes 本地选择改变后旧操作预览失效并提示重新预览。
- 键盘/IME：列表内 ↑/↓/Home/End 导航、Space 切换、Shift+Click 与
  Shift+↑/↓ 连续选择、Ctrl/⌘+A 幂等选择当前筛选可操作项（连按不反向
  清空，不劫持输入框与 IME 候选）、Enter 打开差异；PageUp/PageDown 为
  活动行分页导航（按一页可见行数移动并保持局部滚动）。
- 回归：tests/unit/listModel.test.ts、tests/unit/fileSelection.test.ts、
  tests/unit/commitSelectionValidation.test.ts、
  tests/unit/workbenchCommitSelectionGate.test.ts、
  tests/components/ListSelection.test.ts、tests/webview-e2e/list-operations.spec.ts
  （UX08-SEL-01/02/03/04/06/07、SORT-01/02、FLOW-01/02、A11Y-01、VIEW-01、
  PERF-01）。
- 状态：批次 2 自动化工件（check、platform-contracts、coverage、webview、
  performance、Extension Host）已全绿。真实设备与辅助技术观察项按 §12.4
  如实保留，但不作为发布阻断。

## 12. 候选验收

### 12.1 选择与安全

- `UX08-SEL-01`：三态与当前筛选可操作项完全一致——[自动化通过]
  `tests/webview-e2e/list-operations.spec.ts`（表头全选数量与可操作项一致）、
  `tests/components/ListSelection.test.ts`、`tests/unit/selectionCore.test.ts`；
- `UX08-SEL-02`：筛选和排序不静默改变选择——[自动化通过]
  list-operations（筛选/排序后选择保持）、ListSelection（toggle 快照语义、
  新文件不自动加入）、selectionCore；
- `UX08-SEL-03`：隐藏选择可见、可查看、可单独清除——[自动化通过]
  list-operations（隐藏 N → 清除隐藏 → 隐藏 0）、ListSelection、selectionCore；
- `UX08-SEL-04`：刷新只保留合法交集，不自动选择新文件——[自动化通过]
  list-operations（刷新后保留且不自动全选）、selectionRefresh、组件刷新用例；
- `UX08-SEL-05`：`blocked`、范围外、过期、external 和混合仓库安全拒绝或拆分
  ——[部分自动化] blocked（e2e 禁用 + 组件 + unit）、范围外（Host 候选复验
  `workbenchCommitSelectionGate.test.ts` 整批拒绝）、过期 AI（workbench.spec
  stale 只读）；external 规则阻止与混合仓库拆分在当前自动化中没有针对
  多工作副本/混合仓库的真实端到端用例（prepareWorkbenchRequest 的拆分
  逻辑未发现独立自动化）；真实多工作副本/混合仓库工作区的 external 归属与
  拆分保留为非阻断观察项。
- `UX08-SEL-06`：5,000 文件全选覆盖完整数据，不只覆盖挂载行——[自动化通过]
  list-operations SEL-06/PERF-01、ListSelection（5,000 全选 + End/PageDown
  远端行挂载聚焦）、selectionCore；
- `UX08-SEL-07`：所有批量按钮和 Host 预览数量一致——[自动化通过]
  list-operations（提交按钮 3 → Commit 已选 1/候选 → 生成预览（1））、
  FLOW-01/02 数量断言、Changes 提交资格组件测试（excluded 阻止 + 数量一致）。

### 12.2 路径与排序

- `UX08-PATH-01`：鼠标、键盘和触屏均能查看并复制完整项目内 / 仓库内路径
  ——[部分自动化] 鼠标/键盘（FilePathDetail 组件：四路径标注、项目内/仓库内/
  SVN URL 复制按钮写入剪贴板断言、Host file/copy-path 复制本地完整路径）；
  真实触屏设备上的查看与复制保留为非阻断观察项；
- `UX08-PATH-02`：中部省略保留文件名、扩展名和辨识目录——[自动化通过]
  `tests/unit/listModel.test.ts`（多段 + 单段扩展名保留）、page-screenshots
  5000 文件窗口化截图基线；
- `UX08-PATH-03`：关闭详情后焦点与滚动位置保持——[部分自动化] 焦点恢复
  （FilePathDetail/ListSelection：关闭按钮与 Escape 后触发点重新聚焦）；
  真实滚动位置保持的目视确认保留为非阻断观察项（组件逻辑无滚动副作用，e2e 未直接
  断言 scrollTop）；
- `UX08-SORT-01`：排序方向有图标、文字和 `aria-sort`——[自动化通过]
  list-operations SORT-01（aria-sort ascending/descending + 升序/降序文字）、
  SortHeader 组件；
- `UX08-SORT-02`：排序稳定，不改变选择、活动文件或 scope——[自动化通过]
  list-operations（恢复默认顺序）、selectionSort（稳定性 + 输入不变异 +
  5,000 项）、ListSelection（排序不改变选择）。

### 12.3 主路径与可访问性

- `UX08-FLOW-01`：筛选 7 个已修改文件后可一次全选并进入 Commit——[自动化
  通过] list-operations FLOW-01（dataset=seven：筛选“已修改 7”→ 表头全选
  7 → 检查并提交所选（7）→ Commit 已选 7 / 候选 10（含 blocked/excluded）
  → 生成提交预览（7），批量语义真实覆盖）；
- `UX08-FLOW-02`：Changes、Commit 和 Preview 的项目、路径与数量一致——
  [自动化通过] list-operations FLOW-01/02、FilePathDetail（跨项目提交预览
  分组）、Controller 预览复验（既有 commit 测试）；
- `UX08-A11Y-01`：键盘、读屏、触屏和中文 IME 完成相同流程——[部分自动化]
  键盘（list-operations A11Y-01：方向键/Space/Shift 连续/Ctrl+A 幂等）、
  IME（ListSelection IME 候选不触发 + chinese-scroll）、读屏（axe 无违规 +
  aria-label/role 断言 + reduced motion 用例）、Shift+F10/Menu 行菜单与
  Escape 关闭详情（ListSelection 新增用例）；真实读屏软件（NVDA/VoiceOver）
  与触屏设备的完整流程保留为非阻断观察项；
- `UX08-VIEW-01`：720×480、1024×600、1440×900 和 100%～200% 下主操作可达
  ——[部分自动化] visual-accessibility（三主题 × 三尺寸 axe 无违规 + 无页面
  横向滚动）、chinese-scroll SCR-12/13/14/15（720×480@200% 认证页矩阵）、
  VIEW-01（720×480 列表主操作 + 无横向滚动）、VIEW-01b（Sticky 批量底栏不
  遮挡列表末行与焦点）；列表页 200% 缩放的目视确认保留为非阻断观察项；
- `UX08-PERF-01`：5,000 文件保持既有挂载行与滚动预算，新增筛选、排序和
  选择不遍历 DOM——[自动化通过] `scripts/measure-webview-performance.js`
  （挂载行 16 < 100、滚动 51ms < 500ms、bundle gzip 预算）、list-operations
  SEL-06/PERF-01（全选后挂载行仍 < 100）、visual-accessibility 窗口化滚动。

### 12.4 自动化证据与非阻断观察项

- 自动化证据：上述 [自动化通过] / [部分自动化] 条目对应测试文件与用例；
  `npm run verify`
  全绿（含 check、platform-contracts、coverage、webview、performance、
  Extension Host）。
- 下列真实设备或环境观察项未执行，不作为发布阻断，也不得用自动化冒充：
  1. 真实读屏软件（NVDA / VoiceOver）完成列表导航、选择与批量操作；
  2. 触屏设备（触摸 + 触控笔）完成查看/复制路径与行菜单；
  3. 真实多仓库/混合仓库工作区的 external 归属与拆分验证；
  4. 关闭路径详情后滚动位置保持的目视确认；
  5. 列表页 200% 缩放目视确认（自动化覆盖认证页矩阵）。
- 可选观察主路径：状态筛选全选、隐藏选择、刷新失效、长中文路径、同名文件、
  多项目归属、Diff 往返、阻止项、小屏、200% 和纯键盘操作。

## 13. 明确不做

- 不把全选解释为工作副本或仓库全部文件；
- 不在筛选变化后自动选择新匹配文件；
- 不允许阻止项被批量动作绕过；
- 不用 Tooltip 作为完整路径唯一出口；
- 不为了完整路径制造页面级横向滚动；
- 不把列表能力一次推广到 History、Conflicts、Repository 等所有页面；
- 不在本版本重做 AI Review、Impact、Agent 或模型上下文；

## 13a. 开发基线：路径身份与展示边界硬化（v0.0.8 批次 0）

本版本在 Changes/Commit 列表增强之前先系统性消除 Windows 路径大小写与平台
语义问题反复到 CI 才暴露的情况：

- 类型边界：`src/scope/pathBrands.ts`（品牌归属身份领域，零依赖；scope 不反向
  依赖 protocol）定义互不兼容的 `PathIdentityKey` 与 `DisplayPath` 品牌、
  `Assert<T extends true>` 编译期契约（品牌互斥 + `DisplayPathSource` 拒绝
  identity 键，由 npm run check 的 tsc 与 svelte-check 强制）；
  `normalizePathIdentity`/`workingCopyId`/`projectId`/`scmProjectKey`/
  `createScopedFileKey` 只返回 `PathIdentityKey`（Map/Set、比较、排序、缓存
  键、范围判断），协议展示字段（`WorkbenchScopeView`、
  `WorkbenchFileView.projectRelativePath`、`file/path-detail-result`）声明为
  `DisplayPath`，Host 构建处经唯一显式转换 `toDisplayPath` 进入协议；
  identity 键编译期无法赋给展示字段，直接传入 `toDisplayPath` 也是编译错误。
- 语义边界：全部纯路径 API 要求显式 `PathSemantics`（platform + cwd 必填，
  无默认回退），领域函数不读取 process；生产 Host 从唯一
  `nativePathSemantics` 边界注入，合成路径测试显式 posix/win32，真实路径
  夹具显式构造宿主语义对象。
- 测试边界：`tests/unit/dualPlatformPathContracts.test.ts` 显式注入
  posix/win32 语义，覆盖大小写保留与 identity 等价、盘符、UNC、斜杠、
  中文、同前缀兄弟目录、项目相对路径与 SCM 同名标题/切片；
  `tests/unit/pathIdentityBoundary.test.ts` 静态契约保证协议展示字段品牌、
  Webview 运行时不得导入身份/转换模块、pathBrands 零依赖。
- 门禁：新增 `npm run test:platform-contracts` 快速双平台契约门禁，纳入本地
  `npm run verify` 与 `.github/workflows/verify.yml`（Linux 先于完整覆盖率）；
  同一套合成用例不在 Windows Runner 重复执行，Windows 保留完整覆盖率与真实
  SVN 验收作为最终确认。
- 状态：本批次属于 v0.0.8 开发基线，不改变 v0.0.7 已发布事实；相关回归测试
  与文档同步见 `docs/current/`。

## 14. 后续版本关系

- `v0.0.9` 先修正 AI 命名、来源和提交草稿覆盖等信任问题；
- `v0.0.10` 把本版本验证成熟的列表 / 路径交互推广到其他模块；
- `v0.0.11` 在稳定选择与路径 identity 上建立受限差异、外发回执和提交说明建议；
- `v0.0.12` 才完成跨 Review、Impact、Changelist 和 Conflict 的变更解读闭环。
