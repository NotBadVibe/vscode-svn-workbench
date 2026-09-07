# SVN Workbench v0.2.1：历史查询、比较与更新明细

> 文档身份：`planned-version-record`。
>
> 状态：`draft/planned`，业务工作待实施。计划建立于 2026-09-07，观察基准为 v0.1.8 / `437f7757ce41f45a0ed7a56b51afe58706b6ce49`。
>
> 适用范围：本版本分配的 6 项任务；原评审编号保留为 R01～R59。不包含：不新增历史重写、撤销远端提交或修订树；不擅自改变 Update 到远端最新状态的既有策略。
>
> 依赖：[0.2.0](../v0.2.0/README.md)；路线总览与原问题完整映射见 [v0.2.x 开发路线](../v0.2.0/开发路线.md)。未来版本能力不得当作当前已实现事实。
>
> 主权威：[产品](../../current/产品与功能基线.md)、[交互](../../current/设计与交互基线.md)、[实现映射](../../current/实现与代码映射.md)、[验收](../../current/测试与验收基线.md)。

## 1. 用户结果与范围

**本版完成后：查到更早历史，直接看某次文件修改，并可信地检查更新与发布区间。**

用户可独立体验的主路径：查询不存在的作者后改条件，加载超过 300 条历史，挑两个版本，查看变更路径 Diff，再生成一个较早版本的发布说明。

进入条件：前置版本的所依赖能力与相关门禁已通过，或针对 v0.2.0 先复现当前问题并建立回归；不要求为了开始后续实现而提前发布。一次只把一个版本置为 `developing`，其余保持 `planned`。P0/P1 缺陷不得因等待后续版本而在本版掩盖。

## 2. 实施批次与接线边界

1. 复现 R06 并修正窗口化完整性，保留 v0.2.0 的查询入口。
2. R19/R20：比较两端和切修订筛选语义。
3. R17：文件变更直达，复用 v0.2.0 比较类型模型。
4. R14/R15：按范围采集与远端明细，覆盖失败/部分结果。

扩展历史目标/只读查询结果完整性、Update 远端明细字段时同步 Host、协议守卫和 Mock。分页游标绑定范围与查询，不可把前端搜索词当未经校验的 SVN 参数。

## 3. 问题与开发任务

<a id="v021-r06"></a>

### V021-R06 · 超过 300 条历史的窗口化滚动完整性

- **原评审映射：** 第 6 项。
- **优先级 / 证据等级：** P1 / 待复现风险（已复现并修复）。
- **实施状态：** 已实现（行高 64→68 与 CSS 对齐 + 首尾占位复用 Commit 模式；`HistoryModule.svelte`；`tests/components/HistoryV021R06.test.ts` 10 用例；复现证据见 `.validation/evidence/v0.2.1/r06-reproduction/`，工作区 gitignored）。
- **看到的现状：** History 使用默认 300 条阈值的 useFileList，只渲染 visibleRows，却没有全高容器或首尾占位；控制器行高 64 与 CSS 最小 68 也不一致。
- **用户影响：** 可能出现加载计数很大但滚不到末项、滚动跳动或键盘定位错误；上一轮未完成浏览器复现。
- **现有证据与预计改动入口：** [HistoryModule.svelte](../../../src/webview/features/history/HistoryModule.svelte)、[useFileList.svelte.ts](../../../src/webview/components/list/useFileList.svelte.ts)、[global.css](../../../src/webview/styles/global.css)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 先在未修版本构造 301/500/1000 条历史，记录末项可达性及真实滚动高度。
2. 确认后复用既有列表占位模型并统一行高，不新建另一套窗口化算法。
3. 筛选/排序重新定位，追加历史保留阅读锚点。
4. 若未复现，提交可解释反证及持续回归用例，不做无依据重构。

**验收场景与完成条件：**

- [x] 各档滚动、End、PageDown 可到真实最后修订。
- [x] 切换最早/最新顺序后首尾正确。
- [x] 追加一批与清除搜索后选中版本、比较对象和阅读位置可解释地保留。

<a id="v021-r14"></a>

### V021-R14 · 发布说明按修订范围完整采集

- **原评审映射：** 第 14 项。
- **优先级 / 证据等级：** P1 / 源码已确认（已实现）。
- **实施状态：** 已实现（按范围只读分页采集 + HEAD 请求开始固定 + 完整性/取消/失败显式标记 + 20 路径省略与 `fullMarkdown` 完整导出；`repositoryWorkbenchActions.ts`、`advancedRepositoryTools.ts`、`svnHistory.ts`、`ReleaseNotesTask.svelte`；`releaseNotesRange.test.ts`、`advancedRepositoryTools.test.ts`、`RepositoryModule.test.ts` 及终审 `workbenchReleaseNotesUpdateHost.test.ts`、`releaseNotesUpdateProtocolGuards.test.ts`）。
- **看到的现状：** generateReleaseNotes 固定读取最近 200 条后在内存过滤；结束输入提示 HEAD 但 Host 仅接受数字；每修订路径只取前 20 条且缺省略提示。
- **用户影响：** 旧发布区间为空、大区间遗漏，用户可能拿不完整内容对外发布。
- **现有证据与预计改动入口：** [repositoryWorkbenchActions.ts](../../../src/extension/workbench/repositoryWorkbenchActions.ts)、[advancedRepositoryTools.ts](../../../src/repository/advancedRepositoryTools.ts)、[ReleaseNotesTask.svelte](../../../src/webview/features/repository/tasks/ReleaseNotesTask.svelte)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 按用户指定 revision 范围执行只读分页 log，明确端点包含语义。
2. 支持 HEAD 并在请求开始固定解析到 rN，或统一改为仅数字输入。
3. 显示已读取数量/完整性/取消或读取失败，不把部分结果冒充完整。
4. 展示省略路径数并提供完整导出，网络断开保留已采集内容及续查入口。

**验收场景与完成条件：**

- [x] 目标区间完全早于最近 200 条时仍生成正确说明。
- [x] 超过 200 修订、单修订超过 20 路径、空范围、反向范围、HEAD 均有确定结果。
- [x] 取消/分页失败显式标记部分结果，重试不重复计数。

<a id="v021-r15"></a>

### V021-R15 · 更新预览区分远端全部变化与本地重叠

- **原评审映射：** 第 15 项。
- **优先级 / 证据等级：** P1 / 源码已确认的展示缺口（已实现）。
- **实施状态：** 已实现（远端全清单与本地重叠区分 + `remoteIncomplete` 失败分支 + 预览时间与 HEAD 可变诚实文案；`updateWorkbenchActions.ts`、`updateFlow.ts`、`UpdateModule.svelte`；`updateRemoteDetail.test.ts`、`UpdateModule.test.ts` 及终审 `workbenchReleaseNotesUpdateHost.test.ts`、`releaseNotesUpdateProtocolGuards.test.ts`）。
- **看到的现状：** Update 意向单 paths 使用 overlapPaths，主界面重点呈现数量和重叠；无重叠时缺少全部远端变更对象的可检查清单。
- **用户影响：** 用户知道将更新若干项，却不能检查具体哪些路径，降低预览可信度。
- **现有证据与预计改动入口：** [UpdateModule.svelte](../../../src/webview/features/update/UpdateModule.svelte)、[updateWorkbenchActions.ts](../../../src/extension/workbench/updateWorkbenchActions.ts)、[updateFlow.ts](../../../src/update/updateFlow.ts)、[workbenchProtocol.ts](../../../src/protocol/workbenchProtocol.ts)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. Host 保留远端变更明细，区分远端变化 N 项与本地重叠 M 项。
2. 两类清单支持搜索、复制、状态查看，明确未完整读取的情形。
3. 不冒称枚举了目录更新的一切动态影响，说明预览时间及执行期间 HEAD 可变化。
4. 原 token、候选及工作副本状态复验保留，结果再呈现实际数量。

**验收场景与完成条件：**

- [x] 无本地重叠仍能查看远端文件全清单。
- [x] 重叠/新增/删除/外部工作副本归属准确。
- [x] 预览后远端变化时文案如实，不把预估数当执行保证。
- [x] 读取失败不能展示空清单并称无变化。

<a id="v021-r17"></a>

### V021-R17 · 历史变更路径直达该次修改

- **原评审映射：** 第 17 项。
- **优先级 / 证据等级：** P1 / 能力完善。
- **实施状态：** 已实现（`history/view-path-diff` + `history/view-path-history`；纯规划 `src/history/historyChangedPath.ts`，Host `WorkbenchController.runHistoryPathDiffAction/runHistoryPathHistoryAction/runChangedPathDiff`，Webview `HistoryModule.svelte` 行动作，Mock 同步；`historyState` 不动，返回历史保留所选修订/比较两端）。
- **看到的现状：** Changed Paths 已有搜索/排序/复制/详情，缺少查看该修订文件差异和文件历史的直接动作。
- **用户影响：** 找到某次提交后仍需返回 Explorer 寻找文件，删除文件更难继续检查。
- **现有证据与预计改动入口：** [HistoryModule.svelte](../../../src/webview/features/history/HistoryModule.svelte)、[WorkbenchController.ts](../../../src/extension/workbench/WorkbenchController.ts)、[svnUrl.ts](../../../src/svn/svnUrl.ts)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 行主动作查看此修订修改，次级动作查看文件历史。
2. 分别构建新增、删除、修改、复制的左右内容与 peg revision。
3. 利用 R09 的比较种类和真实路径字段，不把标签当路径。
4. 路径越出原允许范围时明确拒绝或提示新任务需要重新选择范围。

**验收场景与完成条件：**

- [x] 新增比较空→新增内容，删除比较旧内容→空，复制显示可解释来源。
- [x] 历史文件已不在工作副本仍可只读查看合法修订内容。
- [x] 返回历史保留所选修订/筛选/比较两端，越界拒绝。

<a id="v021-r19"></a>

### V021-R19 · 历史比较两端可见且可调整

- **原评审映射：** 第 19 项。
- **优先级 / 证据等级：** P2 / 源码已确认的反馈缺口（已实现）。
- **实施状态：** 已实现（两端起点/终点芯片 + 移除/交换/设端 + 第三次替换明示；`HistoryModule.svelte`；`tests/components/HistoryModule.test.ts`）。
- **看到的现状：** 比较栏主要显示 0/2 数量；第三次勾选自动淘汰最早选择，跨搜索后不易辨认对象。
- **用户影响：** 用户可能比较错两个 revision，难追溯刚才的选择。
- **现有证据与预计改动入口：** [HistoryModule.svelte](../../../src/webview/features/history/HistoryModule.svelte)、[PrimaryActionBar.svelte](../../../src/webview/components/task/PrimaryActionBar.svelte)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 固定显示起点/终点 revision、作者、日期芯片。
2. 提供移除、交换、设为起点/终点。
3. 第三次选择明确说明替换对象，避免静默淘汰。
4. 比较只选两条，不添加无意义的历史全选。

**验收场景与完成条件：**

- [x] 跨分页/搜索仍看得见两端身份。
- [x] 第三条选择的替换对象明确。
- [x] 取消/清空/同一 revision/顺序反转与 Host 排序契约一致。

<a id="v021-r20"></a>

### V021-R20 · 切换修订时处理失效的路径筛选

- **原评审映射：** 第 20 项。
- **优先级 / 证据等级：** P2 / 源码已确认（已实现）。
- **实施状态：** 已实现（失效操作筛选自动清除并轻量说明 + 空态区分 + 一键清除不碰比较；`HistoryModule.svelte`；`tests/components/HistoryModule.test.ts`）。
- **看到的现状：** pathActionFilter 持续保留，但筛选按钮根据新修订类型生成；旧删除条件可能继续过滤只有修改的新修订。
- **用户影响：** 列表空了但导致空结果的筛选按钮已消失，用户无法理解。
- **现有证据与预计改动入口：** [HistoryModule.svelte](../../../src/webview/features/history/HistoryModule.svelte)、[SearchInput.svelte](../../../src/webview/components/list/SearchInput.svelte)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 新修订不支持旧操作类型时清除该条件并轻量说明。
2. 或显示可关闭的当前条件标签，但不能隐藏生效条件。
3. 文本筛选保留策略清晰，提供一键清除。
4. 无变更路径与被筛选隐藏使用不同空态。

**验收场景与完成条件：**

- [x] 删除筛选→只有修改的修订不会出现不明原因空列表。
- [x] 返回上一修订后筛选行为可解释。
- [x] 搜索无匹配可一键恢复且不改变比较选择。

## 4. 测试落点

下列是已存在的回归入口，实施时扩展真实行为用例；如需新测试文件，按任务 ID 建立并同步实现映射。本次未新增待开发功能的验收用例；现有回归运行结果见路线的本次验证记录，不代表新功能已经通过。

- [HistoryModule.test.ts](../../../tests/components/HistoryModule.test.ts)
- [UpdateModule.test.ts](../../../tests/components/UpdateModule.test.ts)
- [history-restore-intent.spec.ts](../../../tests/webview-e2e/history-restore-intent.spec.ts)
- [workbenchProtocol.test.ts](../../../tests/unit/workbenchProtocol.test.ts)

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
