# SVN Workbench v0.2.4：搁置恢复、多项目与上手

> 文档身份：`planned-version-record`。
>
> 状态：`draft/planned`，业务工作待实施。计划建立于 2026-09-07，观察基准为 v0.1.8 / `437f7757ce41f45a0ed7a56b51afe58706b6ce49`。
>
> 适用范围：本版本分配的 7 项任务；原评审编号保留为 R01～R59。不包含：不默认持久化源码草稿或敏感操作日志；不把打开说明当成 Checkout 已实现；不提供危险 SVN 操作一键撤销承诺。
>
> 依赖：[0.2.3](../v0.2.3/README.md)；路线总览与原问题完整映射见 [v0.2.x 开发路线](../v0.2.0/开发路线.md)。未来版本能力不得当作当前已实现事实。
>
> 主权威：[产品](../../current/产品与功能基线.md)、[交互](../../current/设计与交互基线.md)、[实现映射](../../current/实现与代码映射.md)、[验收](../../current/测试与验收基线.md)。

## 1. 用户结果与范围

**本版完成后：能找回搁置，能辨别项目状态，干净或异常项目都有下一步。**

用户可独立体验的主路径：创建中文名称搁置→重启→找到并预览恢复；在多个项目中找到冲突项目，另一个统计失败项目原地重试；干净仓库完成引导。

进入条件：前置版本的所依赖能力与相关门禁已通过，或针对 v0.2.0 先复现当前问题并建立回归；不要求为了开始后续实现而提前发布。一次只把一个版本置为 `developing`，其余保持 `planned`。P0/P1 缺陷不得因等待后续版本而在本版掩盖。

## 2. 实施批次与接线边界

1. R38/R48：搁置索引、中文显示名、旧数据兼容与恢复。
2. R39/R40/R42：项目状态模型、查找和异常恢复。
3. R41：按状态分支的新手引导。
4. R51：存续提示与非正文偏好，正文恢复仅完成安全设计或单独受控实现。

新增 Shelf 索引/读取恢复意图、项目统计状态需同步协议；存储与最终写入仅 Host 执行。索引原子保存、目录边界、权限失败与旧条目迁移必须可注入测试。

## 3. 问题与开发任务

<a id="v024-r38"></a>

### V024-R38 · 本地搁置可以查找、预览和恢复

- **原评审映射：** 第 38 项。
- **优先级 / 证据等级：** P1 / 源码已确认的任务闭环缺口。
- **实施状态：** 已实施（搁置索引/迁移 `src/repository/shelfIndex.ts` + Host 预览/恢复/导出/删除链 `repositoryWorkbenchActions.ts` + 清单 UI `PatchShelfTask.svelte`；证据见 `tests/unit/shelfIndex.test.ts`、`tests/components/PatchShelfTask.test.ts`、`tests/unit/workbenchShelfRestore.test.ts`）。
- **看到的现状：** Shelf 写入扩展存储目录后主要返回文件路径，页面提供创建与通用选择 Patch，缺少重启后可发现的搁置清单。
- **用户影响：** 能创建却难找回，用户必须记住私有存储目录，无法形成临时切换任务的闭环。
- **现有证据与预计改动入口：** [PatchShelfTask.svelte](../../../src/webview/features/repository/tasks/PatchShelfTask.svelte)、[repositoryWorkbenchActions.ts](../../../src/extension/workbench/repositoryWorkbenchActions.ts)、[advancedRepositoryTools.ts](../../../src/repository/advancedRepositoryTools.ts)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 建立按项目/仓库身份关联的搁置索引，显示名称/时间/文件数/基线/完整性。
2. 支持查看、恢复、导出，复用 Patch 精确预览与确认。
3. 恢复前核对当前工作副本及内容，过期/冲突只提示而不强行覆盖。
4. 恢复成功保留搁置，删除作为明确独立动作，不暗中清理。
5. 迁移现有存储时兼容无索引的旧项。

**验收场景与完成条件：**

- [x] 创建后重启可找到并预览正确条目。
- [x] 同名多项目不串用。
- [x] 损坏 Patch、丢文件、存储不可写、scope 不匹配均可恢复或导出。
- [x] 恢复需新 token，取消不改工作副本，成功不会自动提交。

<a id="v024-r39"></a>

### V024-R39 · 项目统计失败不能伪装为没有变化

- **原评审映射：** 第 39 项。
- **优先级 / 证据等级：** P1 / 源码已确认。
- **实施状态：** 已实施（统计状态显式建模 `ProjectStatsStatus` + `statsSeq` + 定向重试 `projects/retry-stats`，Host 按工作副本分组采集；证据见 `tests/unit/projectStats.test.ts`、`tests/unit/projectsProtocolGuards.test.ts`、`tests/unit/workbenchProjectsActions.test.ts`、`tests/components/ProjectsModule.test.ts`）。
- **看到的现状：** 统计异常写入输出面板，counts 缺失时 UI 隐藏整块数量。
- **用户影响：** 用户分不清干净、未读取、失败和过期，多项目状态不可相信。
- **现有证据与预计改动入口：** [ProjectsModule.svelte](../../../src/webview/features/projects/ProjectsModule.svelte)、[WorkbenchController.ts](../../../src/extension/workbench/WorkbenchController.ts)、[workbenchProtocol.ts](../../../src/protocol/workbenchProtocol.ts)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 项目级统计状态显式建模 loading/ready/error/stale。
2. 保留上一成功值时显示时间与过期原因。
3. 单项失败提供原地重试/诊断，不阻塞其他项目。
4. 复用工作副本级采集，避免每个项目重复执行 SVN。

**验收场景与完成条件：**

- [x] 一个工作副本失败时其他项目仍显示可信统计。
- [x] 零修改明确显示 0，不与未读取等同。
- [x] 重试只影响目标项目/共享副本，旧请求晚到不会覆盖新状态。

<a id="v024-r40"></a>

### V024-R40 · 项目总览按任务优先级筛选与直达

- **原评审映射：** 第 40 项。
- **优先级 / 证据等级：** P2 / 能力完善。
- **实施状态：** 已实施（名称/路径搜索、只看有修改、冲突优先/名称排序、冲突数直达单项目冲突任务、完整路径复制；证据见 `tests/components/ProjectsModule.test.ts`、`tests/unit/workbenchProjectsActions.test.ts`、`tests/unit/scmProjectSlicing.test.ts`）。
- **看到的现状：** 当前总览缺少名称路径搜索、排序，冲突/变更数主要是静态 chip。已有独立项目动作不重复新增。
- **用户影响：** 多仓库用户不能迅速找到需要处理的项目。
- **现有证据与预计改动入口：** [ProjectsModule.svelte](../../../src/webview/features/projects/ProjectsModule.svelte)、[WorkbenchController.ts](../../../src/extension/workbench/WorkbenchController.ts)、[projectSwitchGuard.ts](../../../src/extension/workbench/projectSwitchGuard.ts)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 增加名称/项目路径搜索、只看有修改、冲突优先排序及当前项目标识。
2. 点击冲突数量直接打开该项目冲突任务。
3. 完整路径可查看复制，默认突出显示路径而非身份键。
4. 切换项目沿用草稿守卫，不混合仓库 revision。

**验收场景与完成条件：**

- [x] 同名项目路径消歧，搜索清空与排序记忆正常。
- [x] 点击某项目冲突数只打开该项目。
- [x] 失败统计不当作 0 排序，仍有醒目标记。
- [x] 多根/嵌套/external 范围不扩张。

<a id="v024-r41"></a>

### V024-R41 · 新手引导按工作副本状态分支

- **原评审映射：** 第 41 项。
- **优先级 / 证据等级：** P2 / 源码已确认。
- **实施状态：** 已实施（`deriveOnboardingBranch` 五态纯推导 + `OnboardingStrip` 分支展示与只读恢复；证据见 `tests/unit/onboarding.test.ts`、`tests/components/OnboardingStrip.test.ts`、`tests/components/ChangesOnboardingBranch.test.ts`）。
- **看到的现状：** 查看修改的步骤依赖 files.length>0，选择步骤依赖 selected.size>0；干净仓库可能停在固定流程。
- **用户影响：** 第一次安装就打开干净项目的用户无法完成引导，误认为需要制造修改。
- **现有证据与预计改动入口：** [onboarding.svelte.ts](../../../src/webview/app/onboarding.svelte.ts)、[ChangesModule.svelte](../../../src/webview/features/changes/ChangesModule.svelte)、[OnboardingStrip.svelte](../../../src/webview/components/ui/OnboardingStrip.svelte)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 干净分支解释正常状态并引导历史/只读检查更新。
2. 有修改分支保留选择→预览，有冲突分支先处理冲突。
3. 随状态变化重新计算下一步，允许跳过、重开。
4. 引导永远在最终写确认前停止，不替用户运行写操作。

**验收场景与完成条件：**

- [x] 干净/修改/冲突/非 SVN/CLI 缺失五态有可完成的路径或明确恢复。
- [x] 中途刷新不丢手工草稿。
- [x] 跳过后不自动再次打开。
- [x] 引导完成不产生提交。

<a id="v024-r42"></a>

### V024-R42 · 项目空态与失效路径提供可执行恢复

- **原评审映射：** 第 42 项。
- **优先级 / 证据等级：** P2 / 能力完善。
- **实施状态：** 已实施（空/非 SVN/路径丢失/CLI 缺失各态可执行恢复，只复用诊断安全动作白名单；证据见 `tests/components/ProjectsModule.test.ts`、`tests/components/DiagnosticsModule.test.ts`、`tests/unit/diagnosticActions.test.ts`）。
- **看到的现状：** 部分空态只有非 SVN/请先检出/路径失效说明，没有连接打开文件夹或诊断动作。
- **用户影响：** 知道原因却不知道在产品里怎么继续。
- **现有证据与预计改动入口：** [ProjectsModule.svelte](../../../src/webview/features/projects/ProjectsModule.svelte)、[DiagnosticsModule.svelte](../../../src/webview/features/diagnostics/DiagnosticsModule.svelte)、[environmentDiagnostics.ts](../../../src/diagnostics/environmentDiagnostics.ts)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 无项目接打开文件夹，非 SVN 接检出说明及环境诊断，路径失效接重新选择。
2. 复用既有安全动作白名单，不把任意 URL/命令作为修复按钮。
3. 保留已打开其他项目状态。
4. Checkout 向导不在本版承诺范围，不能把说明按钮命名为已具备检出功能。

**验收场景与完成条件：**

- [x] 空/非 SVN/路径丢失/CLI 缺失各态至少一个有效下一步。
- [ ] 取消选择不清理其他工作区。
- [x] 安全动作参数非法被 Host 拒绝且错误可理解。

<a id="v024-r48"></a>

### V024-R48 · 搁置显示名称与内部文件名分离

- **原评审映射：** 第 48 项。
- **优先级 / 证据等级：** P2 / 源码已确认。
- **实施状态：** 已实施（中文显示名与内部安全 ID/文件名分离，Webview 实时提示 + Host 复验；证据见 `tests/unit/shelfIndex.test.ts`、`tests/components/PatchShelfTask.test.ts`）。
- **看到的现状：** 名称输入只提示长度，Host 限定 [A-Za-z0-9._-]；中文名称到预览才被拒。
- **用户影响：** 中文产品中输入修复登录这样的常见名称失败，反馈太晚。
- **现有证据与预计改动入口：** [PatchShelfTask.svelte](../../../src/webview/features/repository/tasks/PatchShelfTask.svelte)、[repositoryWorkbenchActions.ts](../../../src/extension/workbench/repositoryWorkbenchActions.ts)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 支持中文显示名称，内部使用独立安全 ID/文件名。
2. 校验空名称、长度、重复名称与控制字符，路径分隔不进入内部路径。
3. 迁移旧 ASCII 名称保持可检索。
4. 输入处实时提示，Host 始终复验。

**验收场景与完成条件：**

- [x] 中文/空格展示名称创建与重启列表读取一致。
- [x] ../、NUL、换行不能改变存储路径。
- [x] 同名条目通过日期/项目消歧。
- [x] 旧 Shelf 仍可预览恢复。

<a id="v024-r51"></a>

### V024-R51 · 草稿和操作记录说明存续范围

- **原评审映射：** 第 51 项。
- **优先级 / 证据等级：** P2 / 明确存续边界与候选扩展。
- **实施状态：** 部分实施（视图偏好白名单 + 操作时间线存续告知已落地，证据见 `tests/unit/draftPersistenceTiers.test.ts`、`tests/components/ActivityPersistenceNotice.test.ts`；正文跨重启恢复未批准未实现，第四项验收不适用）。
- **看到的现状：** 冲突草稿、部分预设和时间线仅内存；已有会话内保护，不等于跨重启恢复。
- **用户影响：** 用户看到已同步或已保存检查点，可能误以为关掉 VS Code 后也能找回。
- **现有证据与预计改动入口：** [projectDraftStore.ts](../../../src/extension/workbench/projectDraftStore.ts)、[ActivityModule.svelte](../../../src/webview/features/activity/ActivityModule.svelte)、[listPreferences.ts](../../../src/webview/app/listPreferences.ts)、[projectSwitchGuard.ts](../../../src/extension/workbench/projectSwitchGuard.ts)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 明确区分未同步/仅会话保留/已写入工作副本，并在重载退出提示未落盘内容。
2. 本版优先保留不含正文的视图偏好，确认 workspace/project 隔离及清理入口。
3. 正文跨重启恢复先设计容量、保留期、启停、磁盘失败与隐私策略，未完成设计不默认落盘。
4. 现有复制/导出作为可靠出口，恢复不复活旧写令牌或 AI 确认。

**验收场景与完成条件：**

- [x] 会话检查点不会被标为已写文件。
- [x] 重启后没有正文恢复时明确告知，不假装已恢复。
- [x] 偏好跨项目不串用。
- [ ] 如果批准正文持久化实现，则必须覆盖内容版本失配、磁盘不可写、清理与用户删除，不把凭据写入。

## 4. 测试落点

下列是已存在的回归入口，实施时扩展真实行为用例；如需新测试文件，按任务 ID 建立并同步实现映射。本次未新增待开发功能的验收用例；现有回归运行结果见路线的本次验证记录，不代表新功能已经通过。

- [ChangesOnboardingBranch.test.ts](../../../tests/components/ChangesOnboardingBranch.test.ts)（V024-R41 新增：干净/冲突分支集成与草稿保留）
- [OnboardingStrip.test.ts](../../../tests/components/OnboardingStrip.test.ts)（V024-R41 扩展：五态恢复只读断言）
- [onboarding.test.ts](../../../tests/unit/onboarding.test.ts)（V024-R41 扩展：五态推导/必需步骤/重算）
- [ProjectsModule.test.ts](../../../tests/components/ProjectsModule.test.ts)（V024-R39/R40/R42：统计状态/筛选直达/空态恢复）
- [projectStats.test.ts](../../../tests/unit/projectStats.test.ts)（V024-R39：统计装配 ready/error/stale/分组隔离/定向重放）
- [projectsProtocolGuards.test.ts](../../../tests/unit/projectsProtocolGuards.test.ts)（V024-R39：协议守卫）
- [workbenchProjectsActions.test.ts](../../../tests/unit/workbenchProjectsActions.test.ts)（V024-R39 重试拒绝、V024-R40 冲突直达）
- [diagnosticActions.test.ts](../../../tests/unit/diagnosticActions.test.ts)（V024-R42：安全动作白名单）
- [shelfIndex.test.ts](../../../tests/unit/shelfIndex.test.ts)（V024-R38/R48：中文显示名分离、索引/迁移/原子保存；P3-2 控制字符文件名拒绝）
- [workbenchShelfRestore.test.ts](../../../tests/unit/workbenchShelfRestore.test.ts)（V024-R38 Host 级恢复链：token 失配拒绝/候选变化拒绝/取消不改工作副本/成功不提交且保留搁置；P3-1 repositoryUuid 白名单）
- [PatchShelfTask.test.ts](../../../tests/components/PatchShelfTask.test.ts)（V024-R38/R48：清单/恢复/导出/删除/IME）
- [draftPersistenceTiers.test.ts](../../../tests/unit/draftPersistenceTiers.test.ts)（V024-R51：三态文案、偏好隔离/白名单/清理）
- [ActivityPersistenceNotice.test.ts](../../../tests/components/ActivityPersistenceNotice.test.ts)（V024-R51：时间线徽标与重启告知）
- [DiagnosticsModule.test.ts](../../../tests/components/DiagnosticsModule.test.ts)
- [projectSwitchGuard.test.ts](../../../tests/unit/projectSwitchGuard.test.ts)
- [workbenchProjectSwitch.test.ts](../../../tests/unit/workbenchProjectSwitch.test.ts)
- [manualAcceptanceEnv.test.ts](../../../tests/unit/manualAcceptanceEnv.test.ts)

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
