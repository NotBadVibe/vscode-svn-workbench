# SVN Workbench v0.2.6：仓库对象选择与精确合并

> 文档身份：`planned-version-record`。
>
> 状态：`draft/planned`，业务工作待实施。计划建立于 2026-09-07，观察基准为 v0.1.8 / `437f7757ce41f45a0ed7a56b51afe58706b6ce49`。
>
> 适用范围：本版本分配的 4 项任务；原评审编号保留为 R01～R59。不包含：不做反向合并、复杂重积分向导、跨仓库自动搬迁、历史重写；保持当前未提交修改阻止策略。
>
> 依赖：[0.2.5](../v0.2.5/README.md)；路线总览与原问题完整映射见 [v0.2.x 开发路线](../v0.2.0/开发路线.md)。未来版本能力不得当作当前已实现事实。
>
> 主权威：[产品](../../current/产品与功能基线.md)、[交互](../../current/设计与交互基线.md)、[实现映射](../../current/实现与代码映射.md)、[验收](../../current/测试与验收基线.md)。

## 1. 用户结果与范围

**本版完成后：从仓库浏览选择对象，为固定修订建标签，按需要挑选合并修订。**

用户可独立体验的主路径：浏览目标→选择来源→固定 rN 创建分支/标签预览；选择一个修复修订做 Merge 试运行，确认结果后才执行。

进入条件：前置版本的所依赖能力与相关门禁已通过，或针对 v0.2.0 先复现当前问题并建立回归；不要求为了开始后续实现而提前发布。一次只把一个版本置为 `developing`，其余保持 `planned`。P0/P1 缺陷不得因等待后续版本而在本版掩盖。

## 2. 实施批次与接线边界

1. R46/R43：只读浏览出口与表单对象选择。
2. R44：固定源修订的 Branch/Tag 预览与执行。
3. R45：eligible/merged 采集与精确 Merge 模式。
4. 隔离 SVN fixture 覆盖权限、远端变化、部分失败和冲突恢复。

这是新的 SVN 行为，按领域→Host→协议/守卫→Svelte→Mock→真实 SVN 测试顺序实施。revision/URL/作用对象进入冻结预览，试运行与最终命令一致性可核验。

## 3. 问题与开发任务

<a id="v026-r43"></a>

### V026-R43 · 仓库高级操作支持选对象而非只手写 URL

- **原评审映射：** 第 43 项。
- **优先级 / 证据等级：** P2 / 体验建议。
- **实施状态：** 待实施。
- **看到的现状：** Branch/Tag/Switch 等依赖完整 URL 输入，已有仓库浏览无法直接作为来源/目标选择器。
- **用户影响：** 地址长易拼错，用户需在浏览器与表单之间反复复制。
- **现有证据与预计改动入口：** [AdvancedTask.svelte](../../../src/webview/features/repository/tasks/AdvancedTask.svelte)、[BrowseTask.svelte](../../../src/webview/features/repository/tasks/BrowseTask.svelte)、[repositoryWorkbenchActions.ts](../../../src/extension/workbench/repositoryWorkbenchActions.ts)、[svnUrl.ts](../../../src/svn/svnUrl.ts)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 复用仓库浏览选源/目标，支持常用 branches/tags 路径与名称组合。
2. 显示完整 URL、仓库归属及存在性，保留高级手填。
3. 先接只读选择与预览，最终写入仍走各自安全契约。
4. 协议传结构化 URL/revision 意图，Host 负责解析编码/权限/边界。

**验收场景与完成条件：**

- [ ] 中文/空格/# 路径按段正确编码，不重复编码。
- [ ] 跨仓库目标、失效目录、权限失败就地解释。
- [ ] 切换源目标立即使旧预览失效。
- [ ] 浏览选择不扩大本地工作副本操作范围。

<a id="v026-r44"></a>

### V026-R44 · 分支与标签显式选择源 revision

- **原评审映射：** 第 44 项。
- **优先级 / 证据等级：** P2 / 明确功能边界扩展。
- **实施状态：** 待实施。
- **看到的现状：** 当前远端 copy 未带明确 -r 选择，用户看到工作副本 rN 容易误以为标签来自该版本。
- **用户影响：** 验收通过的版本与实际创建标签的内容可能不是同一来源。
- **现有证据与预计改动入口：** [AdvancedTask.svelte](../../../src/webview/features/repository/tasks/AdvancedTask.svelte)、[repositoryWorkbenchActions.ts](../../../src/extension/workbench/repositoryWorkbenchActions.ts)、[workbenchProtocol.ts](../../../src/protocol/workbenchProtocol.ts)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 源模式明确远端 HEAD 或指定 rN，HEAD 在预览时解析为固定 revision。
2. 预览显示源 URL@revision、目标及本地未提交修改不参与的事实。
3. 执行复验固定来源和目标存在性，不静默漂移到更新的 HEAD。
4. 已验证 revision 不存在或无权限给恢复动作。

**验收场景与完成条件：**

- [ ] 预览后远端 HEAD 前进，确认仍按已确认源版本或明确要求重预览。
- [ ] 工作副本有未提交修改时不宣称其进入远端 copy。
- [ ] 旧 token/改变 source revision/目标已存在被拒绝。

<a id="v026-r45"></a>

### V026-R45 · 合并支持可解释的修订选择

- **原评审映射：** 第 45 项。
- **优先级 / 证据等级：** P2 / 明确功能边界扩展。
- **实施状态：** 待实施。
- **看到的现状：** 目前主要输入 sourceUrl 并构造 svn merge URL WC，不便完成单个修复回补。
- **用户影响：** 高级用户仍需转到命令行挑选修订，无法在界面判断已合并与可合并。
- **现有证据与预计改动入口：** [AdvancedTask.svelte](../../../src/webview/features/repository/tasks/AdvancedTask.svelte)、[repositoryWorkbenchActions.ts](../../../src/extension/workbench/repositoryWorkbenchActions.ts)、[workbenchProtocol.ts](../../../src/protocol/workbenchProtocol.ts)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 提供全部符合条件/指定修订/修订范围三种明确模式。
2. 只读采集合并信息与 eligible/merged revision，映射 SVN revision 范围语义。
3. 生成试运行、预计文件/冲突与准确命令，再由用户确认。
4. 本地未提交修改阻止策略不放宽，反向合并/重积分等额外模式单独延期。

**验收场景与完成条件：**

- [ ] 单修订、连续范围、不连续选择、已合并修订、无 mergeinfo 支持分别有正确结果。
- [ ] dry-run 不改工作副本，执行前复验源/目标/本地状态/token。
- [ ] 产生冲突后进入冲突处理，取消及部分失败重采状态，不自动提交。

<a id="v026-r46"></a>

### V026-R46 · 仓库浏览后继续看内容和历史

- **原评审映射：** 第 46 项。
- **优先级 / 证据等级：** P2 / 能力完善。
- **实施状态：** 待实施。
- **看到的现状：** 文件条目主要复制 URL，尚未形成远端内容预览/文件历史/修订比较的顺滑入口。
- **用户影响：** 用户找到目标后任务中断，尤其历史删除文件无法靠 Explorer 继续。
- **现有证据与预计改动入口：** [BrowseTask.svelte](../../../src/webview/features/repository/tasks/BrowseTask.svelte)、[HistoryModule.svelte](../../../src/webview/features/history/HistoryModule.svelte)、[DiffModule.svelte](../../../src/webview/features/diff/DiffModule.svelte)、[repositoryWorkbenchActions.ts](../../../src/extension/workbench/repositoryWorkbenchActions.ts)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 新增只读远端内容、历史与 revision 比较出口，复用 R09/R17 的目标模型。
2. 明确当前浏览 revision 与本地项目根关系。
3. 二进制/大文件/无权限显示限制和复制 URL 等恢复。
4. 本地写动作不因仓库浏览扩大 scope，浏览历史与工作副本范围单独验证。

**验收场景与完成条件：**

- [ ] 浏览文件可看指定 revision 内容且来源明确。
- [ ] 删除/复制历史、跨目录返回不丢位置。
- [ ] 权限/网络失败保留导航状态。
- [ ] 远端预览不产生本地文件写入或隐式外发。

## 4. 测试落点

下列是已存在的回归入口，实施时扩展真实行为用例；如需新测试文件，按任务 ID 建立并同步实现映射。本次未新增待开发功能的验收用例；现有回归运行结果见路线的本次验证记录，不代表新功能已经通过。

- [RepositoryModule.test.ts](../../../tests/components/RepositoryModule.test.ts)
- [workbenchProtocol.test.ts](../../../tests/unit/workbenchProtocol.test.ts)
- [operationIntent.test.ts](../../../tests/unit/operationIntent.test.ts)
- [domainAcceptanceCoverage.test.ts](../../../tests/unit/domainAcceptanceCoverage.test.ts)

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
