# SVN Workbench v0.2.0：输入、选择与预览可靠性

> 文档身份：`planned-version-record`。
>
> 状态：`draft/planned`，业务工作待实施。计划建立于 2026-09-07，观察基准为 v0.1.8 / `437f7757ce41f45a0ed7a56b51afe58706b6ce49`。
>
> 适用范围：本版本分配的 14 项任务；原评审编号保留为 R01～R59。不包含：不做整页视觉重设计、历史高级功能、Shelf 索引、模型新能力和依赖升级。
>
> 依赖：[0.1.8](../v0.1.8/README.md)；路线总览与原问题完整映射见 [v0.2.x 开发路线](../v0.2.0/开发路线.md)。未来版本能力不得当作当前已实现事实。
>
> 主权威：[产品](../../current/产品与功能基线.md)、[交互](../../current/设计与交互基线.md)、[实现映射](../../current/实现与代码映射.md)、[验收](../../current/测试与验收基线.md)。

## 1. 用户结果与范围

**本版完成后：编辑和保存不丢输入，所见选择与最终执行一致，常用入口到正确目标。**

用户可独立体验的主路径：在包含修改和冲突的工作副本中，写提交说明、筛选文件、预览后改选、查看单文件历史，再处理大冲突草稿。

进入条件：前置版本的所依赖能力与相关门禁已通过，或针对 v0.2.0 先复现当前问题并建立回归；不要求为了开始后续实现而提前发布。一次只把一个版本置为 `developing`，其余保持 `planned`。P0/P1 缺陷不得因等待后续版本而在本版掩盖。

## 2. 实施批次与接线边界

1. R01/R02/R03/R07：稳定编辑器、输入区、列布局及配置草稿。
2. R04/R08/R16：共享选择与预览失效，先证实锚点风险。
3. R05/R09/R10/R11/R12/R13：查询恢复、比较类型、目标路由和选项语义。
4. R57：当前能力勘误、接口映射和完整回归。

R09 需要比较种类与身份的协议建模；R10/R08 需核对目标与计划绑定字段；R07 如触及密钥传递先审计既有安全通道。其余优先局部适配，不能为了方便关闭 Host 复验。

## 3. 问题与开发任务

<a id="v020-r01"></a>

### V020-R01 · 大冲突简化编辑器连续输入丢焦点

- **原评审映射：** 第 1 项。
- **优先级 / 证据等级：** P0 / 已记录缺陷。
- **实施状态：** 待实施。
- **看到的现状：** v0.1.8 的 500 块场景中，草稿回环后焦点回到 BODY；首字之后连续输入被吞。生命周期测试使用一次剪贴板粘贴，未证明逐键输入正常。
- **用户影响：** 最需要稳定编辑的大文件场景反而不能可靠写字；粘贴成功不能替代可编辑性。
- **现有证据与预计改动入口：** [ConflictResultEditor.svelte](../../../src/webview/features/conflicts/ConflictResultEditor.svelte)、[ConflictsModule.svelte](../../../src/webview/features/conflicts/ConflictsModule.svelte)、[v018g-lifecycle.spec.ts](../../../tests/webview-e2e/v018g-lifecycle.spec.ts)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 追踪 ConflictResultEditor、快照回显与父组件重建，按文件身份保持编辑器实例。
2. 区分用户编辑与 Host 回执，旧回执不得覆盖较新本地文本。
3. 保留光标、选区、undo/redo，后台同步不得抢焦点。
4. 保留切换文件、刷新、关闭任务时的草稿守卫和保存前内容哈希复验。

**验收场景与完成条件：**

- [ ] 500 块/12000 行 fixture 连续输入英文 200 字符、停顿后续写，内容逐字一致且焦点留在编辑器。
- [ ] 中文 composition 中 Enter 不触发确认，完成候选后正文与预期一致。
- [ ] 延迟/乱序回执、保存失败、切换再返回、undo/redo 后草稿不丢。
- [ ] 单次粘贴原用例保留，同时增加真实连续键入，不用 fill 或重聚焦循环掩盖问题。

<a id="v020-r02"></a>

### V020-R02 · 提交说明输入框退化为小尺寸

- **原评审映射：** 第 2 项。
- **优先级 / 证据等级：** P1 / 生产 Webview 已观察。
- **实施状态：** 待实施。
- **看到的现状：** 2026-09-05 在 437f775 的生产 Webview、1280×800 下测得 textarea 约 156×39px；global.css 的 .commit-compose textarea 规则依赖已不存在的祖先类。
- **用户影响：** 页面有大片空白，用户却只能在两行左右的小框内撰写和检查说明。
- **现有证据与预计改动入口：** [CommitMessageEditor.svelte](../../../src/webview/features/commit/CommitMessageEditor.svelte)、[CommitModule.svelte](../../../src/webview/features/commit/CommitModule.svelte)、[global.css](../../../src/webview/styles/global.css)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 将输入框布局归属 CommitMessageEditor 自身，去除已失效的祖先选择器依赖。
2. 铺满可用宽度、正常视口初始高度至少 150px，小高度时与页面布局协调。
3. 允许纵向调整，保留字数、团队规则、IME 与预览快捷键。
4. 检查抽组件时其他样式是否同时失去作用，不批量重构无关页面。

**验收场景与完成条件：**

- [ ] 1280×800 输入框宽度与内容区一致，最小高度达到约定。
- [ ] 720×480 可输入、调整高度并滚动到预览按钮。
- [ ] 输入多段中文、长路径、达到 2000 字符边界后光标及提示正常。

<a id="v020-r03"></a>

### V020-R03 · Changes 表头与数据列错位

- **原评审映射：** 第 3 项。
- **优先级 / 证据等级：** P1 / 生产 Webview 与源码已确认。
- **实施状态：** 待实施。
- **看到的现状：** 生产截图中选择建议出现在归属列附近，项目名换到下一行左侧；六列 grid 中状态解释、选择解释作为额外独立节点参与排版。
- **用户影响：** 文件归属与建议容易看错，行高增加且可能与窗口化行高不一致。
- **现有证据与预计改动入口：** [ChangesModule.svelte](../../../src/webview/features/changes/ChangesModule.svelte)、[StatusExplanation.svelte](../../../src/webview/components/svn/StatusExplanation.svelte)、[global.css](../../../src/webview/styles/global.css)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 将状态文字和解释按钮包成同一列，将选择建议和解释包成同一列。
2. 表头与行共用列定义，冲突动作及差异动作归入固定操作列。
3. 宽松/紧凑密度使用与虚拟列表一致的行高，保留两行路径展示。
4. 窄屏使用明确简化列方案，隐藏列仍可通过行详情查看。

**验收场景与完成条件：**

- [ ] 普通/冲突/外部工作副本/缺失状态所有列与表头对齐。
- [ ] 5000 文件从首行滚到末行无重叠、空洞和操作图标漂移。
- [ ] 同名文件不同项目不误认，三主题文字与解释按钮可辨识。

<a id="v020-r04"></a>

### V020-R04 · 变更集隐藏选择统计及清理失效

- **原评审映射：** 第 4 项。
- **优先级 / 证据等级：** P1 / 源码已确认。
- **实施状态：** 待实施。
- **看到的现状：** hiddenSelectionKeys 与 clearHiddenSelection 都接收 allEntries() 全集，未使用筛选后的匹配集合。
- **用户影响：** 筛选隐藏的已选文件继续参与动作，摘要却显示隐藏 0，清除按钮不能帮助用户收敛选择。
- **现有证据与预计改动入口：** [ChangelistsModule.svelte](../../../src/webview/features/changelists/ChangelistsModule.svelte)、[selectionCore.ts](../../../src/selection/selectionCore.ts)、[SelectionSummary.svelte](../../../src/webview/components/list/SelectionSummary.svelte)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 用当前匹配集合计算隐藏选择，与全量候选刷新求交区分。
2. 清除隐藏只移除匹配集合之外的选择，不取消当前匹配项。
3. 搜索与分组折叠采用稳定语义：折叠不等同筛选，匹配集合与渲染行分离。
4. 动作计数与最终预览路径使用同一合法选择结果。

**验收场景与完成条件：**

- [ ] 选 A/B 再搜索 A，显示已选 2/隐藏 1，清除隐藏后仅 A 进入预览。
- [ ] 清空搜索不会自动选回 B。
- [ ] 折叠分组不暗中改变筛选定义，刷新后已删除/越界文件被剔除且说明。

<a id="v020-r05"></a>

### V020-R05 · 历史空结果或末页后无法重新查询

- **原评审映射：** 第 5 项。
- **优先级 / 证据等级：** P1 / 源码已确认。
- **实施状态：** 待实施。
- **看到的现状：** 唯一加载按钮受 snapshot.hasMore 控制；按条件查询区域只有字段，没有独立查询动作。
- **用户影响：** 查不到作者或翻到末页之后，修改条件也缺少重新请求入口，容易误认为历史不存在。
- **现有证据与预计改动入口：** [HistoryModule.svelte](../../../src/webview/features/history/HistoryModule.svelte)、[WorkbenchController.ts](../../../src/extension/workbench/WorkbenchController.ts)、[HistoryModule.test.ts](../../../tests/components/HistoryModule.test.ts)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 新增始终可用的按条件查询入口，与加载下一批分离。
2. 新查询清理旧游标但保留输入，取消或失败保留上一成功结果并说明。
3. 本地搜索只筛已加载结果，服务端条件不修改操作范围。
4. 请求绑定当前会话和查询身份，慢旧响应不能覆盖新查询。

**验收场景与完成条件：**

- [ ] 不存在的作者得到空结果后改成有效作者可直接查询。
- [ ] hasMore=false 后仍可更改日期/修订条件。
- [ ] 非法范围就地提示，取消不清掉输入与已有结果。
- [ ] 组件点击和 Host 请求均验证，不只断言按钮存在。

<a id="v020-r07"></a>

### V020-R07 · 测试连接与读取模型列表覆盖配置草稿

- **原评审映射：** 第 7 项。
- **优先级 / 证据等级：** P1 / 源码链确认。
- **实施状态：** 待实施。
- **看到的现状：** Settings 的 effect 收到快照即回填已保存配置并清空新密钥；test-ai/list-models 返回的快照会触发同一路径。
- **用户影响：** 填写新地址和模型后测试，再保存可能写回旧值；密钥还可能在保存前消失。
- **现有证据与预计改动入口：** [SettingsModule.svelte](../../../src/webview/features/settings/SettingsModule.svelte)、[WorkbenchController.ts](../../../src/extension/workbench/WorkbenchController.ts)、[SECURITY.md](../../../SECURITY.md)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 将表单 dirty draft 与连接测试/模型列表反馈分离，仅初次装载、明确保存成功或放弃时重置。
2. 异步结果绑定测试输入版本，用户继续编辑后旧结果标为过期。
3. 密钥使用既有安全输入通道与 SecretStorage，先审计当前 UI 传递契约，不以修复草稿为由缓存密钥或放入快照。
4. 保存/切换页签明确未保存状态。

**验收场景与完成条件：**

- [ ] 修改地址/模型→测试成功→保存，实际持久化值为新值。
- [ ] 测试失败、模型列表返回、延迟旧响应均不覆盖后续输入。
- [ ] 密钥只验证安全存储效果，日志/快照/浏览器状态与 fixture 无明文凭据。
- [ ] 放弃修改才回到已保存值。

<a id="v020-r08"></a>

### V020-R08 · 变更集方案更改后旧预览仍可确认

- **原评审映射：** 第 8 项。
- **优先级 / 证据等级：** P1 / 源码已确认。
- **实施状态：** 待实施。
- **看到的现状：** 意向单由 snapshot.preview 构造且 stale 固定 false；编辑名称、删 applyPaths 只改变本地状态，确认仍发送旧 token。
- **用户影响：** 用户看到自己刚改的方案，却可能执行旧方案。Host 仍有范围复验，此处不是已经证明的越权漏洞。
- **现有证据与预计改动入口：** [ChangelistsModule.svelte](../../../src/webview/features/changelists/ChangelistsModule.svelte)、[WorkbenchController.ts](../../../src/extension/workbench/WorkbenchController.ts)、[operationIntent.ts](../../../src/operation/operationIntent.ts)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 名称、路径、目标组变化立即让旧预览只读并关闭执行入口。
2. Host 保存计划指纹并在执行前验证最终方案，不能仅依赖 UI 禁用。
3. 显示方案已更改及重新预览入口，新预览产生新令牌。
4. 旧响应晚到不得恢复旧预览可执行状态。

**验收场景与完成条件：**

- [ ] 预览后改名、删文件、改组均不能凭旧令牌执行。
- [ ] 重新预览展示新名称和精确路径。
- [ ] 旧请求晚到、scope/revision 改变、执行失败后恢复均无过期确认。

<a id="v020-r09"></a>

### V020-R09 · 修订 Diff 混用展示标题和本地路径

- **原评审映射：** 第 9 项。
- **优先级 / 证据等级：** P1 / 源码已确认。
- **实施状态：** 待实施。
- **看到的现状：** runRevisionCompare 将“路径 · rA → rB”存入 relativePath；Diff 模板仍显示 BASE ↔ 工作副本并提供本地文件操作。
- **用户影响：** 用户无法确信比较基线，路径操作还可能收到拼接后的虚构路径。
- **现有证据与预计改动入口：** [WorkbenchController.ts](../../../src/extension/workbench/WorkbenchController.ts)、[DiffModule.svelte](../../../src/webview/features/diff/DiffModule.svelte)、[workbenchProtocol.ts](../../../src/protocol/workbenchProtocol.ts)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 协议明确比较种类、显示标题、真实路径及左右修订，旧快照缺省行为保守。
2. 本地比较、单文件历史比较、范围 Patch 比较按能力显示标题与动作。
3. 历史比较双侧只读，不能显示不适用的提交/编辑/本地路径操作。
4. 同步 Host、Webview、Mock、守卫及窗口复用目标键。

**验收场景与完成条件：**

- [ ] 本地 BASE/Working、单文件 rA/rB、目录修订 Patch 三类分别显示正确基线。
- [ ] 空、二进制、截断、多路径快照不产生虚构路径操作。
- [ ] 重复打开保持阅读位置，切目标失效旧编辑 token。

<a id="v020-r10"></a>

### V020-R10 · 行右键任务应定位所点文件

- **原评审映射：** 第 10 项。
- **优先级 / 证据等级：** P1 / 源码已确认，冲突定位待复现。
- **实施状态：** 待实施。
- **看到的现状：** Changes 查看历史仅发送模块/task，没有 contextFile；冲突行也只跳模块，是否定位目标仍需多文件复现。
- **用户影响：** 右键一个文件却进入目录历史，或处理冲突按钮打开另一文件，打断用户操作意图。
- **现有证据与预计改动入口：** [ChangesModule.svelte](../../../src/webview/features/changes/ChangesModule.svelte)、[WorkbenchController.ts](../../../src/extension/workbench/WorkbenchController.ts)、[workbenchProtocol.ts](../../../src/protocol/workbenchProtocol.ts)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 行菜单携带具体目标文件且由 Host 在原 scope 内复验。
2. 历史范围缩到目标文件，返回仍恢复来源列表。
3. 冲突入口带 active target，不扩大可操作范围。
4. 如果目标已删除/不再冲突，给出原因及回列表动作。

**验收场景与完成条件：**

- [ ] 目录中右键第二个文件只显示该文件历史，文件级 Blame/恢复能力正确。
- [ ] 多个冲突点击非首个文件直接定位正确对象。
- [ ] 伪造范围外路径被拒绝，后台刷新不抢焦点。

<a id="v020-r11"></a>

### V020-R11 · 空白选项名称与主代码视图效果一致

- **原评审映射：** 第 11 项。
- **优先级 / 证据等级：** P1 / 源码已确认的功能语义缺口。
- **实施状态：** 待实施。
- **看到的现状：** 正常 DiffView 未接收 showWhitespace；显示符号主要在备用 Patch pre 生效。冲突侧选项部分只影响图例、横幅或定位器；普通 Diff 忽略空白已有呈现处理，不能笼统说全部无效。
- **用户影响：** 开关让用户以为已经显示/忽略空白，实际主代码仍可能未变化，影响比较判断。
- **现有证据与预计改动入口：** [DiffModule.svelte](../../../src/webview/features/diff/DiffModule.svelte)、[ConflictDiffView.svelte](../../../src/webview/features/conflicts/ConflictDiffView.svelte)、[diffWhitespace.ts](../../../src/webview/features/diff/diffWhitespace.ts)、[diffOverviewModel.ts](../../../src/webview/features/diff/diffOverviewModel.ts)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 逐一列出普通/历史/备用/冲突/编辑五类视图支持表。
2. 支持显示符号的主视图渲染空格/Tab 且不写回文本。
3. 底座不能支持的视图禁用并解释，或准确命名为标记纯空白块。
4. 忽略纯呈现差异不得标记 SVN 冲突已解决，不改变 marker/hash/行号身份。

**验收场景与完成条件：**

- [ ] 含空格、Tab、CRLF、尾随空白的 fixture 开关前后代码视图实际效果可观察。
- [ ] 切入编辑时限制与提示一致，保存字节不包含展示符号。
- [ ] 纯空白冲突仍需人工处理与 Resolve 确认。
- [ ] 正常渲染和降级渲染分别测试。

<a id="v020-r12"></a>

### V020-R12 · 外部合并工具入口消除同名异义

- **原评审映射：** 第 12 项。
- **优先级 / 证据等级：** P1 / 源码已确认。
- **实施状态：** 待实施。
- **看到的现状：** 冲突大文件降级区“在外部工具打开”发 open-file，另一个真正外部合并工具入口走 conflict/preview-external-merge。
- **用户影响：** 用户想避开内置大文件瓶颈，却只打开普通编辑器。
- **现有证据与预计改动入口：** [ConflictsModule.svelte](../../../src/webview/features/conflicts/ConflictsModule.svelte)、[externalMergeToolHost.ts](../../../src/extension/workbench/externalMergeToolHost.ts)、[externalMergeTool.ts](../../../src/conflict/externalMergeTool.ts)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 降级区复用真实外部合并工具预览/确认链。
2. 普通文件出口命名为在 VS Code 编辑器打开。
3. 启动前明确四角色、磁盘版本与未落盘草稿的关系。
4. 退出重采工作副本和冲突，不自动 Resolve，保留未配置/启动失败/超时恢复。

**验收场景与完成条件：**

- [ ] 两个外部入口都到相同准确预览，四角色与路径一致。
- [ ] 未保存草稿不会被静默当成工具输入或覆盖。
- [ ] Windows/macOS/Linux 配置路径与参数校验沿用现有安全单测。
- [ ] 缺工具与工具退出后下一步清楚。

<a id="v020-r13"></a>

### V020-R13 · 更新结果按钮落点与名称一致

- **原评审映射：** 第 13 项。
- **优先级 / 证据等级：** P1 / 源码已确认。
- **实施状态：** 待实施。
- **看到的现状：** Update 成功后的查看本地修改映射到 Diff，返回编辑映射到 Changes。
- **用户影响：** 干净工作副本可能打开无差异页面，返回编辑也没有回到编辑器。
- **现有证据与预计改动入口：** [UpdateModule.svelte](../../../src/webview/features/update/UpdateModule.svelte)、[updateWorkbenchActions.ts](../../../src/extension/workbench/updateWorkbenchActions.ts)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 查看本地修改进入 Changes。
2. 真正恢复来源编辑器时才叫返回编辑，无有效来源改为准确任务名称。
3. 保留处理 N 个冲突为有冲突时的主要下一步。
4. 路由失败提供回范围列表，不重新执行更新。

**验收场景与完成条件：**

- [ ] 无冲突更新后查看本地修改打开 Changes。
- [ ] 有冲突更新仍优先显示准确数量与直达。
- [ ] 来源编辑器关闭后按钮不承诺无法完成的返回。
- [ ] 结果动作不额外发出写命令。

<a id="v020-r16"></a>

### V020-R16 · 排序筛选后的 Shift 选择锚点

- **原评审映射：** 第 16 项。
- **优先级 / 证据等级：** P1 / 待复现风险。
- **实施状态：** 待实施。
- **看到的现状：** resetNavigation 清活动行和滚动却未重置 anchorIndex；范围选择按旧位置切片。
- **用户影响：** 先点第 80 行，再筛成 5 行，Shift 点击可能选择非预期的文件区间。
- **现有证据与预计改动入口：** [useFileList.svelte.ts](../../../src/webview/components/list/useFileList.svelte.ts)、[listModel.ts](../../../src/webview/components/list/listModel.ts)、[ChangesModule.svelte](../../../src/webview/features/changes/ChangesModule.svelte)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 先固定长列表→筛选/排序→Shift 鼠标与键盘的复现。
2. 锚点使用稳定身份，目标不在新集合时清除并建立新锚点。
3. 全选/范围选择始终过滤不可操作项，旧隐藏选择不被扩大。
4. 未复现时记录反证及保留相应契约。

**验收场景与完成条件：**

- [ ] 80 行锚点筛至 5 行后不会沿用越界位置。
- [ ] 升降序、折叠、追加刷新之后 Shift 选择符合可见顺序。
- [ ] blocked/external 不被批量选中，输入框与 composition 不截获快捷键。

<a id="v020-r57"></a>

### V020-R57 · 版本事实与当前能力文档纠偏

- **原评审映射：** 第 57 项。
- **优先级 / 证据等级：** P2 / 源码/版本索引已确认。
- **实施状态：** 本次仅完成可变版本索引纠偏；当前能力文案与一致性治理待实施。
- **看到的现状：** docs/README 曾称最新 v0.1.0、后续全 planned；实际 v0.1.8 已发布。部分当前基线仍说 Webview Diff 只读，旧版本 README 标题亦保留规划措辞。
- **用户影响：** 用户和后续开发者会把已实现功能当缺失，或把规划当现状。
- **现有证据与预计改动入口：** [README.md](../../README.md)、[README.md](../README.md)、[catalog.json](../../catalog.json)、[产品与功能基线.md](../../current/产品与功能基线.md)、[设计与交互基线.md](../../current/设计与交互基线.md)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 本次计划建档立即纠正可变索引的最新版本与新路线入口。
2. v0.2.0 实施时核对 Diff 页内编辑/确认语义等当前基线与实际代码，形成单一事实来源。
3. 评估由 catalog/manifest 生成索引或增加一致性检查，不复制测试数。
4. 定位文案突出 SVN 日常任务与可选 AI，发布目录的旧措辞在新版本作勘误说明，不改写已发布文件。

**验收场景与完成条件：**

- [ ] 最新已发布、当前代码、draft/planned 三种身份无混淆。
- [ ] 所有 0.2.x 计划可从文档索引找到。
- [ ] 当前能力说明有代码/测试对应，未来能力不写成 CURRENT。
- [ ] docs:verify 通过且旧发布目录无 diff。

## 4. 测试落点

下列是已存在的回归入口，实施时扩展真实行为用例；如需新测试文件，按任务 ID 建立并同步实现映射。本次未新增待开发功能的验收用例；现有回归运行结果见路线的本次验证记录，不代表新功能已经通过。

- [v018g-lifecycle.spec.ts](../../../tests/webview-e2e/v018g-lifecycle.spec.ts)
- [CommitModule.test.ts](../../../tests/components/CommitModule.test.ts)
- [HistoryModule.test.ts](../../../tests/components/HistoryModule.test.ts)
- [selectionCore.test.ts](../../../tests/unit/selectionCore.test.ts)
- [workbenchProtocol.test.ts](../../../tests/unit/workbenchProtocol.test.ts)
- [externalMergeToolHost.test.ts](../../../tests/unit/externalMergeToolHost.test.ts)

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
