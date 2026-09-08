# SVN Workbench v0.2.2：首屏布局与中文交互

> 文档身份：`planned-version-record`。
>
> 状态：`draft/planned`，业务工作待实施。计划建立于 2026-09-07，观察基准为 v0.1.8 / `437f7757ce41f45a0ed7a56b51afe58706b6ce49`。
>
> 适用范围：本版本分配的 12 项任务；原评审编号保留为 R01～R59。不包含：不另建首页、Rail 或平行业务 UI；不靠隐藏风险说明和全局 overflow 覆盖凑首屏。
>
> 依赖：[0.2.1](../v0.2.1/README.md)；路线总览与原问题完整映射见 [v0.2.x 开发路线](../v0.2.0/开发路线.md)。未来版本能力不得当作当前已实现事实。
>
> 主权威：[产品](../../current/产品与功能基线.md)、[交互](../../current/设计与交互基线.md)、[实现映射](../../current/实现与代码映射.md)、[验收](../../current/测试与验收基线.md)。

## 1. 用户结果与范围

**本版完成后：打开任务即可看见工作对象，正常窗口和小高度都能找到下一步。**

用户可独立体验的主路径：在 720×480 与常规窗口中完成查看修改→写说明→预览，以及查看历史和冲突错误恢复；不用先收起多层说明才能找到文件。

进入条件：前置版本的所依赖能力与相关门禁已通过，或针对 v0.2.0 先复现当前问题并建立回归；不要求为了开始后续实现而提前发布。一次只把一个版本置为 `developing`，其余保持 `planned`。P0/P1 缺陷不得因等待后续版本而在本版掩盖。

## 2. 实施批次与接线边界

1. R55 先建立生产 CSS 的实际尺寸/对齐/首屏断言。
2. R27/R28/R29：高度链、推荐与重复区域。
3. R30/R31/R32/R33/R34：术语、计数、解释、校验时机与无 AI 状态。
4. R35/R36/R37：Diff 工具栏、底座中文与冲突错误去重。

以 Webview/共享组件/CSS 为主，默认不改写操作协议；推荐过滤若需当前任务字段，优先使用已有 moduleId/taskId，计数缺权威来源才扩协议。

## 3. 问题与开发任务

<a id="v022-r27"></a>

### V022-R27 · 小窗口首屏先看到文件与历史

- **原评审映射：** 第 27 项。
- **优先级 / 证据等级：** P1 / 生产 Webview 已观察。
- **实施状态：** 已实施（高度链 + 小高度收起 + 窄屏列特异性；R55 断言由 `test.fail` 翻绿）。
- **看到的现状：** 720×480 实测 Changes 列表约从 y=699、History 列表从 y=655 开始，首屏看不到列表；可滚动到达，不是永久裁切。
- **用户影响：** 用户打开查看修改却只看到说明、草稿和控件，误以为没有数据。
- **现有证据与预计改动入口：** [global.css](../../../src/webview/styles/global.css)、[ChangesModule.svelte](../../../src/webview/features/changes/ChangesModule.svelte)、[HistoryModule.svelte](../../../src/webview/features/history/HistoryModule.svelte)、[AppShell.svelte](../../../src/webview/components/ui/AppShell.svelte)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 重排实际 flex/grid 高度链，列表获得剩余空间，不再主要靠 vh 减常数。
2. 小高度默认收起共享草稿、长帮助、预设编辑，保留一键展开。
3. 范围与真实阻止警告不能为增加行数而隐藏。
4. 顶部说明收敛与推荐条规则配合，不添加全局 overflow 覆盖。

**验收场景与完成条件：**

- [x] 720×480 普通无阻止场景首次打开至少看到 2 个完整文件/修订行。
- [x] 阻止场景先展示必要警告且仍可抵达列表及主操作。
- [x] 底部 Terminal 展开和 200% 真缩放无永久裁切。
- [x] 滚动列表不带走关键范围与动作。

<a id="v022-r28"></a>

### V022-R28 · 推荐下一步结合当前任务

- **原评审映射：** 第 28 项。
- **优先级 / 证据等级：** P1 / 生产 Webview 与源码已确认。
- **实施状态：** 已实施（Webview 按已有 moduleId/taskId 过滤，协议不改写；单测 + E2E 回归）。
- **看到的现状（已修复）：** 全局推荐在提交页仍可能显示前往检查并提交，并占据设置/历史/Diff 的明显首屏区域。
- **用户影响：** 用户在完成任务时被重复引导，主按钮竞争且挤占内容。
- **现有证据与预计改动入口：** [AppShell.svelte](../../../src/webview/components/ui/AppShell.svelte)、[nextStepRecommendation.ts](../../../src/extension/workbench/nextStepRecommendation.ts)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 当前 module/task 已等于推荐目标时隐藏同义推荐。
2. 对历史/设置等只读或配置任务按相关性降低推荐，编辑脏状态不推无关跳转。
3. 只有当前阻止或必要恢复保持显著。
4. 忽略规则维持会话状态变化后的合理恢复，不永久压制新问题。

**验收场景与完成条件：**

- [x] 提交页无跳回自身的推荐按钮。
- [x] 冲突风险仍可从适用任务直达且数量准确。
- [x] 忽略后同状态不重复，真实状态改变可重新推荐。
- [x] 推荐不执行写操作、不扩大范围。

<a id="v022-r29"></a>

### V022-R29 · 减少重复标题与说明卡片

- **原评审映射：** 第 29 项。
- **优先级 / 证据等级：** P2 / 体验建议。
- **实施状态：** 待实施。
- **看到的现状：** 部分页面同时有任务标题、模块标题、卡片标题、用途说明、来源说明和帮助说明，重复表达同一任务。
- **用户影响：** 用户需要阅读大量文字才能找到工作对象，页面看起来像控制台配置表。
- **现有证据与预计改动入口：** [CommitModule.svelte](../../../src/webview/features/commit/CommitModule.svelte)、[SettingsModule.svelte](../../../src/webview/features/settings/SettingsModule.svelte)、[ConflictsModule.svelte](../../../src/webview/features/conflicts/ConflictsModule.svelte)、[TaskSummary.svelte](../../../src/webview/components/task/TaskSummary.svelte)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 逐页标注唯一任务标题和主操作，保留已有独立任务窗口体系。
2. 相同状态仅保留一个权威摘要，详细解释折叠。
3. 卡片仅用于独立任务/风险，不为了视觉层级增加边框嵌套。
4. 提交调整文件展开态合并重复推荐按钮与数量摘要。

**验收场景与完成条件：**

- [ ] Changes/Commit/History/Conflicts/Settings 每页标题层级清楚。
- [ ] 同一状态/推荐不在多个卡片重复出现。
- [ ] 辅助区收起后核心任务仍可完整执行。
- [ ] 不以删掉错误与恢复说明达成精简。

<a id="v022-r30"></a>

### V022-R30 · 普通文案去内部实现术语

- **原评审映射：** 第 30 项。
- **优先级 / 证据等级：** P2 / 界面已观察。
- **实施状态：** 待实施。
- **看到的现状：** 界面可见扩展主机草稿、Host 内存草稿、入口内部跳转、verification-blocked 等术语。
- **用户影响：** 用户需要理解实现才能判断是否保存、为什么阻止以及下一步怎么做。
- **现有证据与预计改动入口：** [terminology.ts](../../../src/webview/i18n/terminology.ts)、[ScopeBar.svelte](../../../src/webview/components/svn/ScopeBar.svelte)、[ConflictStepBar.svelte](../../../src/webview/features/conflicts/ConflictStepBar.svelte)、[ActivityModule.svelte](../../../src/webview/features/activity/ActivityModule.svelte)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 普通视图改为与提交页共享、仅本次会话保留、尚未写入文件、校验未通过。
2. 协议名/诊断代码进入可展开详情，保持复制诊断能力。
3. 复用 i18n 术语库，时间格式及数量量词统一。
4. 路径/命令/API 必要技术标识保留原文。

**验收场景与完成条件：**

- [ ] 核心任务正常/失败/过期状态无需阅读 Host/token/hash 才能行动。
- [ ] 保存位置描述真实。
- [ ] 诊断仍可找到精确代码且不包含凭据。
- [ ] 读屏名称与可见文案一致。

<a id="v022-r31"></a>

### V022-R31 · 统一范围与选择数量口径

- **原评审映射：** 第 31 项。
- **优先级 / 证据等级：** P2 / 体验建议。
- **实施状态：** 待实施。
- **看到的现状：** 范围数、候选数、结果数、可操作数、推荐数与已选数同时出现，同页可能有 4 与 3 等不同数字但解释分散。
- **用户影响：** 用户不能迅速确认到底会改动多少文件。
- **现有证据与预计改动入口：** [ScopeBar.svelte](../../../src/webview/components/svn/ScopeBar.svelte)、[SelectionSummary.svelte](../../../src/webview/components/list/SelectionSummary.svelte)、[CommitModule.svelte](../../../src/webview/features/commit/CommitModule.svelte)、[UpdateModule.svelte](../../../src/webview/features/update/UpdateModule.svelte)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 主操作旁突出最终将操作 N 个文件，选择区显示匹配 M/已选 N/隐藏 K。
2. 范围详情解释外部、阻止、排除和目录根数，不把目录数当文件数。
3. 主按钮、意向单与 Host 最终候选使用同一合法集合。
4. 动态远端数量仍标预估或未知。

**验收场景与完成条件：**

- [ ] 混合状态、多目录、外部工作副本、隐藏选择情况下各数字可核算。
- [ ] 预览后状态变化数量同步且旧确认失效。
- [ ] 读屏不重复播报无变化数字。

<a id="v022-r32"></a>

### V022-R32 · 减少密集解释图标与多余焦点

- **原评审映射：** 第 32 项。
- **优先级 / 证据等级：** P2 / 界面已观察。
- **实施状态：** 待实施。
- **看到的现状：** 状态、选择建议、路径分别增加独立信息按钮，行内控件密集且已发生 grid 排版副作用。
- **用户影响：** 降低扫描效率，键盘用户需要大量 Tab 才能离开一行。
- **现有证据与预计改动入口：** [StatusExplanation.svelte](../../../src/webview/components/svn/StatusExplanation.svelte)、[PathCell.svelte](../../../src/webview/components/list/PathCell.svelte)、[FilePathDetail.svelte](../../../src/webview/components/svn/FilePathDetail.svelte)、[ChangesModule.svelte](../../../src/webview/features/changes/ChangesModule.svelte)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 在 R03 列结构稳定后，将相关解释收敛进同一语义单元或行详情。
2. 常见状态直接文字表达，复杂原因可聚焦展开。
3. 保留完整路径稳定出口，不能只依赖 title/hover。
4. 活动行/选择/阻止状态保持文字与轮廓等多通道。

**验收场景与完成条件：**

- [ ] 键盘可查看完整路径和阻止原因并回到原触发点。
- [ ] 关闭详情不跳滚动位置。
- [ ] 减少解释按钮后信息仍完整，axe 与手动读屏分别记录。

<a id="v022-r33"></a>

### V022-R33 · 空提交表单先提示再校验

- **原评审映射：** 第 33 项。
- **优先级 / 证据等级：** P2 / 生产 Webview 已观察。
- **实施状态：** 待实施。
- **看到的现状：** 初始未输入提交说明就展示提交说明不能为空的警告色块。
- **用户影响：** 用户尚未操作就被呈现为失败，界面显得紧张。
- **现有证据与预计改动入口：** [CommitMessageEditor.svelte](../../../src/webview/features/commit/CommitMessageEditor.svelte)、[CommitModule.svelte](../../../src/webview/features/commit/CommitModule.svelte)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 初始为空显示中性写作提示，失焦或请求预览后显示字段错误。
2. 一旦编辑修正立即更新提示，不等全页刷新。
3. 真实范围冲突/安全阻止项始终立即展示。
4. 控制错误播报频率，不逐键反复打断读屏。

**验收场景与完成条件：**

- [ ] 首次进入空表单无错误色误报。
- [ ] 请求预览仍严格拒绝空说明。
- [ ] 修正后错误消失且已有草稿不被重置。
- [ ] composition 期间不触发预览或提前错误播报。

<a id="v022-r34"></a>

### V022-R34 · 无模型时外发说明改为准确本地状态

- **原评审映射：** 第 34 项。
- **优先级 / 证据等级：** P2 / 生产 Webview 已观察。
- **实施状态：** 待实施。
- **看到的现状：** ai=disabled 的提交样例仍以外发预览标题说明本地规则，不含实际外发动作。
- **用户影响：** 用户不确定是否需要配模型才能提交，也可能误认为本地动作会上传。
- **现有证据与预计改动入口：** [CommitModule.svelte](../../../src/webview/features/commit/CommitModule.svelte)、[ReceiptSummary.svelte](../../../src/webview/components/assistance/ReceiptSummary.svelte)、[SuggestionSourceBadge.svelte](../../../src/webview/components/assistance/SuggestionSourceBadge.svelte)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 本地生成显示本地生成/不会外发，隐藏不适用的模型预算术语。
2. 外部动作才展示模型、数据类型、范围、预算和确认回执。
3. 本地失败与模型回退分别标来源。
4. 不因此省略实际模型外发确认或降低敏感信息裁剪。

**验收场景与完成条件：**

- [ ] 未配置模型可独立写说明、检查并预览提交。
- [ ] 本地动作不产生模型请求。
- [ ] 启用模型后回执要素完整且可取消。
- [ ] 失败回退保留草稿和选择。

<a id="v022-r35"></a>

### V022-R35 · Diff 工具栏按频率分层

- **原评审映射：** 第 35 项。
- **优先级 / 证据等级：** P2 / 生产 Webview 已观察。
- **实施状态：** 已实施（常驻文件名/基线/块导航/编辑保存 + 更多菜单 + 窄屏二行紧凑 + 定位器规模/视口折叠 + 工具栏 sticky；单测 + 组件回归）。
- **看到的现状：** 多项导航、显示、编辑、原生对比、打开、提交和返回并列，文件名被截短，下一处按钮出现换行。
- **用户影响：** 比较双方和文件身份被挤压，工具多却不好找。
- **现有证据与预计改动入口：** [DiffModule.svelte](../../../src/webview/features/diff/DiffModule.svelte)、[DiffOverview.svelte](../../../src/webview/features/diff/DiffOverview.svelte)、[global.css](../../../src/webview/styles/global.css)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 常驻文件名、左右基线、块导航、当前编辑/保存状态。
2. 低频出口收进更多菜单，保留返回来源任务。
3. 窄屏允许二行紧凑工具区，不把单个短按钮挤成碎字。
4. 定位器按规模和视口折叠，不强制占用代码宽度。

**验收场景与完成条件：**

- [x] 1280/1024/720 宽按钮文字完整，路径可展开复制。
- [x] 更多菜单键盘可达、Esc 回焦。
- [x] 差异滚动不带走文件身份/保存动作。
- [x] 历史 Diff 不出现 R09 已移除的不适用动作。

<a id="v022-r36"></a>

### V022-R36 · 底层差异组件中文补齐

- **原评审映射：** 第 36 项。
- **优先级 / 证据等级：** P2 / 生产 Webview 已观察。
- **实施状态：** 已实施（底座审计：无公开本地化能力，外层中文对照 + 折叠按钮中文 aria-label，不操作私有 Shadow DOM；限制登记于 `terminology.diffBottomUntranslatable`）。
- **看到的现状：** 正常 Diff 中仍显示 6 unmodified lines 等英文界面字串，外层任务已中文化。
- **用户影响：** 用户阅读与导航在中英文任务词之间切换，初学者理解成本增加。
- **现有证据与预计改动入口：** [DiffView.svelte](../../../src/webview/features/diff/DiffView.svelte)、[diffViewAdapter.ts](../../../src/webview/features/diff/diffViewAdapter.ts)、[ConflictDiffView.svelte](../../../src/webview/features/conflicts/ConflictDiffView.svelte)、[terminology.ts](../../../src/webview/i18n/terminology.ts)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 审计底座公开文案配置/适配层，覆盖未修改行、折叠展开、查找、无结果等。
2. 没有公开本地化能力时采用可维护的适配出口并记录限制，不操作私有 Shadow DOM。
3. 代码/路径和必要 SVN 术语保持原文。
4. 集中 i18n 避免单页造同义词。

**验收场景与完成条件：**

- [x] 普通/历史/冲突/降级视图核心操作文案中文一致。
- [x] 国际化不影响行号/导航/编辑数据。
- [x] 无法翻译的底层项逐条登记，不宣称全部完成。

<a id="v022-r37"></a>

### V022-R37 · 冲突错误去重并保留就近恢复

- **原评审映射：** 第 37 项。
- **优先级 / 证据等级：** P2 / Mock 界面已观察，真实组合需复核。
- **实施状态：** 已实施（移除 marker 残留重复块，恢复出口唯一权威摘要 + 阶段条仅进度 + 就近定位入口 + 写盘/核验区分 + 恢复后清除；组件回归）。
- **看到的现状：** 默认冲突样例中仍检测到冲突标记在多个大区域重复出现；需核对真实 Host 各反馈来源组合。
- **用户影响：** 重复黄色警告挤压编辑区域，也让用户以为发生了多个不同故障。
- **现有证据与预计改动入口：** [ConflictsModule.svelte](../../../src/webview/features/conflicts/ConflictsModule.svelte)、[ConflictStepBar.svelte](../../../src/webview/features/conflicts/ConflictStepBar.svelte)、[TaskErrorState.svelte](../../../src/webview/components/task/TaskErrorState.svelte)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 按错误事件/阶段确定一个权威摘要，阶段条表达进度不复述整段原因。
2. 编辑处保留就近修复入口，详细输出折叠。
3. 不同原因不得因去重被合并，例如写盘失败与核验失败需区分。
4. 恢复成功后清除对应旧错误。

**验收场景与完成条件：**

- [x] 同一核验错误只保留一个完整解释。
- [x] 写盘失败、marker 残留、过期内容各自准确恢复。
- [x] 重试成功不残留红黄旧状态。
- [x] 普通与低高度编辑区可达。

<a id="v022-r55"></a>

### V022-R55 · 真实视口与实际控件尺寸验收

- **原评审映射：** 第 55 项。
- **优先级 / 证据等级：** P1 / 验收覆盖不足的已观察实例。
- **实施状态：** 已实施（断言基座先行；R02/R03 宽屏与主操作锁定通过，R27 首屏行数与 R03 窄屏四列记预期失败待业务修复）。
- **看到的现状：** 已有截图/axe 未阻止小 textarea 与错列；page-screenshots 用全页拼接专用高度/overflow 样式，不能代表真实小视口。
- **用户影响：** 自动化通过仍可能交付不好用的页面。
- **现有证据与预计改动入口：** [page-screenshots.spec.ts](../../../tests/webview-e2e/page-screenshots.spec.ts)、[visual-accessibility.spec.ts](../../../tests/webview-e2e/visual-accessibility.spec.ts)、[v017f-ux-matrix.spec.ts](../../../tests/webview-e2e/v017f-ux-matrix.spec.ts)、[v022r55-real-viewport.spec.ts](../../../tests/webview-e2e/v022r55-real-viewport.spec.ts)（R55 新增真实视口断言基座）。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 保留全页截图作内容检查，新增不改布局的真实视口断言。
2. 测输入区尺寸、列对齐、首屏有效行数、主操作不遮挡。
3. 在生产 CSS 下跑，不把 jsdom 无布局结果当像素证据。
4. 每项对应 R02/R03/R27 的行为约定，不无理由批量刷新视觉基线。

**验收场景与完成条件：**

- [x] 故意移除输入区样式或增加额外 grid 项时测试确实失败。
- [x] 真实 720×480 与等效缩放自动检查分别标注。
- [x] Light/Dark/High Contrast 可辨识，真实 VS Code 200% 另有人工记录。
- [x] 截图编号绑定提交与构建模式。

**R55 先行断言运行记录（`0bc2dc7`，`npm run build:webview` 生产 CSS）：**

- 基座 `v022r55-real-viewport.spec.ts` 11 项：9 通过 + 2 预期失败（R27 首屏 2 完整行、R03 窄屏简化四列）。
- 反证：运行时清零输入区高度使断言 `24 < 150` 失败、首行追加 grid 项使列数断言 `7 ≠ 6` 失败；临时反证用例已删，输出见 `.validation/evidence/v0.2.2/r55-0bc2dc7-run1/`。
- 附带发现（未改业务源码，留 V020-R03 修复）：窄屏 `@media (max-width: 720px)` 的 `display: none` 被后部同优先级 `display: flex` 覆盖，选择建议列仍参与排版。
- 真实 VS Code 200% 真缩放与读屏仍为人工观察项，未自动覆盖。

## 4. 测试落点

下列是已存在的回归入口，实施时扩展真实行为用例；如需新测试文件，按任务 ID 建立并同步实现映射。本次未新增待开发功能的验收用例；现有回归运行结果见路线的本次验证记录，不代表新功能已经通过。

- [page-screenshots.spec.ts](../../../tests/webview-e2e/page-screenshots.spec.ts)
- [visual-accessibility.spec.ts](../../../tests/webview-e2e/visual-accessibility.spec.ts)
- [v017f-ux-matrix.spec.ts](../../../tests/webview-e2e/v017f-ux-matrix.spec.ts)
- [v022r55-real-viewport.spec.ts](../../../tests/webview-e2e/v022r55-real-viewport.spec.ts)（R55 新增真实视口断言基座）
- [ScopeBar.test.ts](../../../tests/components/ScopeBar.test.ts)

## 开发与验证约束

- 先完整阅读根 README、文档索引、current 索引、四份当前基线、SECURITY（安全/外发/写操作相关）、本版与直接前置版计划。开始实现前列出已读文档。
- 只读复现先于修复；每个待复现项必须记录 fixture、操作、预期、实际、构建/提交与证据。反证成立则标为“不复现/已有保护”，不凭推测重构。
- 沿用 Svelte 5 与现有领域/共享组件。Host 负责 SVN、文件系统、凭据与最终校验，Webview 只展示和发意图。展示路径与身份键分离。
- 写操作继续精确预览→一次明确确认→执行前复验范围/候选/工作副本或 revision/token；方案与范围变化撤销旧预览。不得额外添加全局重复批准，也不能因优化步骤跳过确认。
- `moduleId + taskId + operationScope` 保持；选择、筛选、AI、审阅队列只在既定范围内缩小，跨仓库不得合为一个 revision。AI 不可用时手动 SVN 流程继续可用。
- 调整协议同步检查 Host、Webview、Mock、运行时守卫和测试；不增加控制器可独立抽出的纯业务逻辑。密钥/密码只进入 SecretStorage 或既有安全输入通道，不进入 Webview 消息、日志或 fixture。
- 代码变更至少执行 `npm run check` 与直接相关测试；行为/源码/测试映射变化同步相应 current 基线并执行 `npm run docs:verify`；完整版本交付执行 `npm run verify`。Node.js 26、npm 12。
- 普通证据写 `.validation/evidence/v0.2.x/<run>/`，记录实际提交、设备和命令。只有用户显式要求发布才能执行 `npm run evidence:release`、发布/标签或绑定发布产物；本计划不授权发布。
- 各版自行覆盖正常、空、加载、失败、取消、过期与恢复；有写操作时成功/拒绝/过期/失败/恢复均测。键盘、中文 composition、小高度、200% 和 Light/Dark/High Contrast 随改动验收，不推迟到最后一版才检查。

## 完成状态与交付清单

- 已完成：本版问题与任务建档。除条目单独注明的文档索引纠偏外，不代表业务实现完成。
- 待实施：本版全部业务修复/增强、最小复现与关联回归。
- 候选门禁：针对本版业务实现尚未执行；本次对现有代码的回归不等同本版候选验收，不引用旧版通过数字代替新实现结果。

- [ ] 各任务有实现或明确反证/候选 no-go；未修复的确定缺陷不得以文档完成代替。
- [ ] 用户主路径可独立完成，不依赖后续版本补齐基本可用性。
- [ ] 每项验收有实际结果与证据位置；测试文件名以最终落地为准，新增用例不是仅扫描源码或复制实现断言。
- [ ] `npm run check`、相关测试、`npm run docs:verify` 与完整 `npm run verify` 实际执行，失败和未运行项逐项说明。
- [ ] 修改过的 current 基线与协议映射同步，旧已发布目录不改写。
- [ ] 未执行的真人/真机/读屏项目标为待观察；明确发现的内容丢失/范围错误不能被“人工未执行”标签掩盖。

## 失败、回退与延期处理

功能性 UI 回归优先回退本版相应组件/适配变更并保留新增复现用例；不能靠回退安全校验解决。持久化功能需保留旧数据可读/可导出，迁移失败不得清除原文件。降级不应丢草稿或默认执行写操作。无法在本版交付的增强项需标明具体边界、原因、受影响任务与替代出口；确定缺陷保持未完成，不以“后续优化”掩盖。
