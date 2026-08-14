# SVN Workbench v0.0.7 候选：多根工作区与项目边界

> 文档身份：`release-candidate-record`
>
> 状态：候选（candidate）。三个开发批次已绑定不可变源码提交 `31379b0d0d5a74a58b44d576bec694ac1db13a75`、VSIX 指纹与 accepted evidence；本地完整门禁及干净安装/卸载/重装均通过。真实 GitHub Windows Runner 仍需由候选 PR 验证，真实 `EM.code-workspace`、`Code2 / bchd-front-Dev3.0` 为未执行的人工场景，不虚构通过。
>
> 基线版本：`v0.0.6`。当前实现事实仍以实际源码、测试和 [`../../current/`](../../current/) 为准。
>
> 优先级：P0，后续列表、提交与 AI 功能的共同前置版本。
>
> 当前边界：已落地内容覆盖 §10 的 0–7 项（跨平台路径 identity、Windows/CI 契约、领域类型与组合 identity、活动项目解析与多根选择器、范围视图与失效绑定、SCM 工作副本采集 + 项目切片、Diagnostics 归属分类、项目总览与范围栏项目切换、跨项目选择拆分与切换草稿守卫、团队规则项目层与迁移预览）。`workspaceContainerId` 仍由容器本地状态隐式表达，未进入协议字段；共享工作副本状态变化的跨窗口失效广播仍依赖既有刷新链路，未新增专门事件。
>
> 不包含：本版本不重构高密度文件列表，不接入新的 AI 能力，不改变 SVN 写操作的预览、确认令牌和执行前复验。

## 1. 版本结论

v0.0.7 只解决一个基础问题：**用户正在操作的项目、VS Code 工作区、本地 SVN 工作副本和远端 SVN 仓库必须被正确区分。**

当前实现把 `svn info --show-item wc-root` 得到的本地工作副本根存入 `repositoryRoot`，再用它生成页面标题、SCM 名称和全部 `relativePath`。当一个上层工作副本包含多个项目时，用户会看到 `Code2` 或本地 `code`，而不是自己打开的项目；项目级动作也存在扫描兄弟目录的风险。

这个问题必须先于全选、排序和 AI 处理。否则后续功能即使更好用，也可能在错误的项目边界上更快地完成错误操作。

本版本完成后，任何页面都必须能明确回答：

1. 当前 VS Code 工作区容器是什么；
2. 当前项目是什么；
3. 项目位于哪个本地 SVN 工作副本；
4. revision 属于哪个 SVN 仓库；
5. 这一次操作允许影响哪些文件或目录。

### 1.1 已并入 v0.0.7 的开发内容

以下内容已经由实际源码和测试支持，覆盖 v0.0.7 的三个开发批次；候选结论仍以本轮完整验收、发布 evidence 与 CI 为准。

#### 跨平台路径 identity

- 新增 `src/scope/pathIdentity.ts`，统一提供 `normalizePathIdentity`、`isSamePathIdentity`、`isSameOrDescendantPath` 和 `comparePathIdentity`；
- Windows 身份键按 `path.win32` 处理盘符、混合分隔符、大小写和 UNC，POSIX 保持大小写敏感；
- scope、security、commit、AI、update、conflict 与 Diff 编辑等既有绝对路径比较已迁移到同一规则，父子范围不再依赖字符串前缀；
- identity 只用于 Map/Set、相等和范围判断；界面与真实文件操作继续保留原始路径，不能把归一化后的内部键显示给用户。

这只是完整项目 identity 的底座。`workspaceContainerId`、`projectId`、`workingCopyId`、仓库身份和 `operationScope` 的组合建模仍未完成。

#### 项目边界领域类型与活动项目解析（开发批次 2）

- 新增 `src/scope/projectIdentity.ts`：workspace folder、project、working copy 与 repository 的领域类型和组合 identity；`createScopedFileKey` 以 working copy identity + 规范化工作副本内路径作为 Host 文件 key，不再只使用 `projectRelativePath`；identity 键只用于比较，不进入用户可见路径；
- 新增 `src/scope/projectResolver.ts`：按 §5 固定顺序解析活动项目（命令 URI / Explorer 选择 → 活动编辑器最具体 folder → 容器保存的项目根 → 单根 folder → 多根选择器候选），明确目标不在任何 workspace folder 时按目标解析并标记提示，项目根无法可靠确定时由 `finalizeProjectRoot` 回退到工作副本根；
- `src/extension.ts` 删除全部业务入口对 `workspaceFolders[0]` 的隐式依赖；多根且无活动目标时打开可搜索、键盘可用的 QuickPick 项目选择器，突出最近项目但不自动进入；项目根与最近项目只保存在当前 workspace 容器的 `workspaceState`；目标不在工作区项目中时明确提示；
- `OperationScope` 增加可选 `project` 上下文（项目根、项目名、回退标记、工作副本内相对路径），`toScopeView` 映射到 `WorkbenchScopeView.projectName/projectRootIsFallback/projectWorkingCopyRelativePath`，范围栏以项目名为主显示、工作副本名为次级，回退时提示“尚未设置项目根”；`hashOperationScope` 纳入项目根，项目边界变化使旧预览、确认令牌与 AI 结果失效；
- 新增 `src/scope/workingCopyClassification.ts` 并由 Diagnostics 复用工作副本解析器：区分独立工作副本根、上层工作副本、嵌套工作副本、external、非 SVN 与路径不存在，位于上层工作副本的项目不再被误报为非 SVN；SVN 不可用时 external 与嵌套工作副本统一按嵌套报告；
- 对应回归位于 `tests/unit/projectIdentity.test.ts`、`tests/unit/projectResolver.test.ts`、`tests/unit/workingCopyClassification.test.ts`、`tests/components/ScopeBar.test.ts` 与 `tests/unit/workbenchArchitecture.test.ts`。

`workspaceContainerId` 目前仅由 `workspaceState` 隐式表达，未进入协议字段；项目总览、SCM 项目切片、跨项目选择和模块切换草稿守卫已在开发批次 3 完成，见下节。

#### 路径显示、SCM 切片、项目总览与切换守卫（开发批次 3）

- 路径显示与详情（§7.1）：`WorkbenchFileView.projectRelativePath` 为文件主路径默认显示（`withProjectFileView`，`src/extension/workbench/workbenchFileOperations.ts`），写操作身份仍是工作副本内路径；跨项目 scope 设置 `projectName` 徽标，单项目列表不逐行重复；路径详情经 `file/path-detail` 按需由 Host 计算（项目内路径/工作副本内路径/仓库内路径/SVN URL/本地完整路径），范围外路径拒绝；SVN URL 只能由工作副本根检出 URL（`svn info --show-item url`）加逐段编码的相对路径推导（`src/svn/svnUrl.ts`），禁止 repos-root 直接拼接，SVN 不可用或不可推导时如实缺省；本地完整路径的复制经 `file/copy-path` 由 Host 完成，不经过 Webview 可写字段；`WorkbenchScopeView` 不暴露工作副本根或仓库 URL。
- SCM 项目切片（§6.2）：`src/scm/projectSlicing.ts` 纯逻辑 + `svnSourceControlManager.ts` 重构——每个显式 workspace folder 一个项目级 provider（“SVN · 项目名”，同名补充父路径），同一工作副本共享一次状态采集再按项目根切片，未加载兄弟目录不进入任何项目 provider，嵌套/额外工作副本保留独立 provider，项目级提交/更新/变更命令携带明确 folder 目标。
- 项目总览（§6.1）：新模块 `projects`（任务 `projects/overview`），只读展示项目名、路径可用性、归属分类、工作副本与聚合计数；行内“打开变更/提交/更新”携带明确项目目标，不合成跨项目 scope；范围栏“切换项目”入口经 QuickPick 选择项目或进入总览，不静默切换。
- 跨项目选择（§7.2）：`prepareWorkbenchRequest` 逐目标解析工作副本——非 SVN 路径排除并说明；同一工作副本的明确跨项目多选允许形成一个 scope 并在提交预览按项目分组；跨工作副本/跨仓库选择拆分为独立执行单元由用户选择，同一仓库不同工作副本与不同仓库都不得合并为一次修订。
- 项目切换草稿守卫（§8）：`src/extension/workbench/projectSwitchGuard.ts` 与 `projectDraftStore.ts` + `WorkbenchController.open()` 接线——从项目 A 加载项目 B 前检查提交说明草稿、手动选择、AI 结果与各类待确认预览，三选一（保留为项目 A 草稿并切换 / 放弃内容并切换 / 留在当前项目）；草稿按 projectId + moduleId + scopeHash 隔离存入容器 `workspaceState`（容器边界由 workspaceState 隐式保证），只保存提交说明与手动选择；切回时一次性恢复并重新采集候选复验手动选择（已不存在、越界或不再可选的路径剔除并反馈；采集失败安全清空旧选择，只保留提交说明），旧预览与确认 token 永不恢复（会话替换即撤销旧会话编辑令牌）；`hashOperationScope` 纳入项目根与排序后的跨项目项目集合。
- 团队规则项目层（§9）：`resolveSvnWorkbenchConfigLocation`/`resolveSvnWorkbenchConfigWriteRoot`（`src/config/svnWorkbenchConfig.ts`）——项目根有独立配置时优先，否则继承工作副本根并在设置页明示来源；新建与保存默认写入已确认项目根；迁移经 `settings/preview-team-migration` → `settings/execute-team-migration`（`src/config/teamConfigMigration.ts`），预览写明源/目标/键清单/影响，执行前复验源哈希、目标存在性与项目边界，只迁移白名单键（commitConvention、commitSelection）；执行层 `src/config/teamConfigMigrationExecutor.ts` 按预检（源哈希/目标不存在）→ 排他创建目标（wx，防 TOCTOU 覆盖）→ 同目录临时文件 fsync + rename 原子替换源 → 执行后复验的顺序执行；源替换失败或复验失败时先原子恢复源到迁移前内容、再仅在目标仍是本次内容时删除目标，两个补偿动作独立失败都返回结构化 partial 结果与人工恢复步骤，任何失败都不显示成功。
- SCM provider 标题动态消歧：同名 workspace folder 加入/移除时 dispose/recreate 对应 provider（label 不可变），命令目标保持各自 folder URI。
- 对应回归位于 `tests/unit/projectFileView.test.ts`、`tests/unit/svnUrl.test.ts`、`tests/unit/workbenchPathDetail.test.ts`、`tests/unit/scmProjectSlicing.test.ts`、`tests/unit/svnSourceControlManager.test.ts`、`tests/unit/projectSwitchGuard.test.ts`、`tests/unit/workbenchProjectSwitch.test.ts`、`tests/unit/teamConfigProjectLayer.test.ts`、`tests/unit/teamConfigMigrationExecutor.test.ts`、`tests/components/FilePathDetail.test.ts`、`tests/components/ProjectsModule.test.ts`、`tests/components/SettingsTeamMigration.test.ts`。

#### Windows 文件系统契约

- `src/diffEdit/diffAtomicWriter.ts` 的临时文件写入通过可注入的 `writeAndSyncTempFile` 固定为 `write -> fsync -> close`，并明确使用写句柄，避免 Windows `FlushFileBuffers` 因只读访问产生 `EACCES`；
- `src/test/suite/testTempDirectory.ts` 对真实 SVN/Extension Host 临时目录执行有限重试，只允许 Windows 的 `EPERM | EBUSY | ENOTEMPTY` 延迟到临时 Runner 回收；其他平台或错误码继续失败；
- 对应回归位于 `tests/unit/windowsPlatformContracts.test.ts` 与 `tests/unit/extensionHostTempCleanup.test.ts`。

#### GitHub Actions 与专项测试

- `.github/workflows/verify.yml` 保留 Linux、macOS、Windows 完整矩阵；开发分支由 `pull_request` 验证，`push` 只覆盖 `main` 与 `v*` 标签；
- 同一 PR/引用的新运行会取消旧运行，减少同一提交重复占用三平台 Runner；
- Windows 在完整覆盖率前执行 `npm run test:windows-contracts`，更早暴露平台边界问题；不得用跳过 Windows、`continue-on-error` 或全局放宽超时换取通过；
- `tests/unit/githubWorkflow.test.ts` 锁定触发条件、并发取消和 Windows 前置门。

当前开发工作树已通过 `npm run test:windows-contracts` 和 `npm run verify`。这些是本地开发验证，不是候选 evidence；实际 GitHub Windows Runner 仍需在下一次 PR 中验证。

### 1.2 候选限制与后续项

- `EM.code-workspace`、`Code2 / bchd-front-Dev3.0` 与真实 Windows Runner 的候选验收（人工主路径与 CI）；
- 共享工作副本状态变化的跨窗口专门失效事件（当前依赖既有刷新与哈希失效链路）；
- `workspaceContainerId` 进入协议字段（当前由容器本地状态隐式表达）。

## 2. 为什么列为 P0

- 范围身份错误会影响 Changes、Commit、Update、AI 外发、SCM 和危险写操作，不是单纯文案问题；
- 多根 `.code-workspace` 可以加载任意磁盘位置、不同仓库或非 SVN 目录，不能用第一个 folder 代表全部上下文；
- 同一个上层工作副本可以包含多个用户项目，不能按工作副本根把它们折叠为一个用户项目；
- 项目内相对路径可能重名，不能用显示路径作为 Host 写操作身份；
- 只有先稳定项目与路径 identity，v0.0.8 的全选和 v0.0.11 的差异外发才能安全实施。

## 3. 统一概念模型

### 3.1 工作区容器位于 SVN 四层模型之外

多根 VS Code workspace 是项目集合，不是 SVN 操作范围：

```text
workspace container（例如 EM.code-workspace）
├─ workspace folder / project A
│    └─ working copy X
│         └─ repository R
├─ workspace folder / project B
│    └─ working copy X
│         └─ repository R
└─ workspace folder / project C
     └─ working copy Y
          └─ repository S
```

工作区容器只负责组织项目和保存本地 UI 偏好，不进入 SVN 命令参数、repository identity 或写操作确认 token。

### 3.2 单个目标的四层边界

| 层级             | 回答的问题                        | 权威来源                              | 默认展示             |
| ---------------- | --------------------------------- | ------------------------------------- | -------------------- |
| SVN 仓库身份     | revision、认证和远端 URL 属于哪里 | repository UUID、repository root URL  | 次级；仓库级动作突出 |
| 本地工作副本根   | SVN 命令和状态复验在哪里执行      | `svn info --show-item wc-root`        | Host 持有；按需显示  |
| 项目根           | 用户当前维护哪个项目              | 明确设置或 workspace folder           | 日常页面主上下文     |
| `operationScope` | 本次动作允许影响哪些对象          | 命令 URI、Explorer 选择或明确项目动作 | 始终可见，不得扩大   |

项目根可以与工作副本根重合，也可以只是上层工作副本中的一个子目录。项目根不是独立 SVN 仓库，工作副本根也不是用户项目名。

### 3.3 建议领域字段

Host 模型应明确区分：

- `workspaceContainerId`、`workspaceFolderId`、`projectId`；
- `projectRoot`、`projectName`；
- `workingCopyRoot`、不透明 `workingCopyId`；
- `repositoryRootUrl`、`repositoryUuid`；
- `projectRelativePath`、`repositoryRelativePath`；
- 不可扩大的 `operationScope`。

当前表示本地工作副本根的 `repositoryRoot` 应迁移为语义准确的字段。Webview 不需要获得可写绝对路径；Host 文件 key 至少包含 working-copy / repository identity 与规范化仓库内路径，不能只使用 `projectRelativePath`。

## 4. 两个基准场景

### 4.1 上层 `Code2` 工作副本中的单个项目

以下使用匿名地址表达用户场景：

```text
仓库根 URL       https://svn.example.internal/svn/Code2
项目 URL         …/Code2/2024Project/bchd-front-Dev3.0
工作副本根       …/code
项目根           …/code/2024Project/bchd-front-Dev3.0
操作范围         …/code/2024Project/bchd-front-Dev3.0/src
```

日常页面显示项目 `bchd-front-Dev3.0`，文件主路径显示 `src/...`；`Code2`、仓库内路径和本地完整路径进入详情。项目级 Changes、Commit、Update 和 AI 候选不得扫描兄弟项目。

### 4.2 `EM.code-workspace` 多根项目

用户提供的工作区包含：

```text
EM.code-workspace
├─ EmApi
├─ EMSystem-front-pro
└─ EMApi-oauth-bridge
```

实际核对表明三个 folder 位于同一个更上层的本地工作副本，并属于同一 `Code2` 仓库。正确表达是：

```text
1 个工作区容器 → 3 个项目 → 1 个本地工作副本 → 1 个 SVN 仓库
```

三个项目可以共享底层状态采集、认证和失效广播，但 SCM 资源、筛选、选择、草稿和项目级动作必须隔离。未加入 `EM.code-workspace` 的兄弟目录不进入任一项目级候选。

## 5. 活动项目解析契约

每次命令按以下顺序确定目标：

1. 命令携带的 URI 或 Explorer 明确选择；
2. 当前活动编辑器所属的最具体 workspace folder；
3. 用户为当前 workspace 容器明确保存的项目根；
4. 只有一个 workspace folder 时使用该 folder；
5. 多根且没有活动目标时打开可搜索、键盘可用的项目选择器，突出最近项目但不自动进入；
6. 明确目标不属于任何 workspace folder 时，按目标解析并提示“当前目标不在工作区项目中”；
7. 无法可靠确定项目根时回退到目标所属工作副本根，同时显示“尚未设置项目根”。

禁止业务入口固定使用 `workspaceFolders[0]`。`.code-workspace` 中的相对 `path` 由 VS Code 解析成 URI，扩展不得假设各 folder 存在共同父目录。

项目标志文件可以用于推荐候选根，但不能只凭 `.sln`、`package.json`、`pom.xml` 或目录名静默改变边界。保存项目根前必须规范化真实路径，验证其仍存在、位于对应工作副本内且包含当前目标；symlink、external 和嵌套工作副本必须重新判断归属。

## 6. 项目、SCM 与诊断

### 6.1 工作区项目总览

提供只读优先的项目总览，显示：

- workspace folder / 项目名称；
- 路径是否仍可用；
- SVN、非 SVN、external 或嵌套工作副本状态；
- 所属工作副本和仓库；
- 变更、冲突和未版本化数量；
- “打开变更”“提交”“更新”等带明确项目目标的入口。

总览可以聚合数量，但不能把多个 folder 自动合成一个 `operationScope`。

### 6.2 VS Code SCM

- 每个显式 workspace folder 建立项目级 SCM provider；
- 同一工作副本内的多个项目共享一次状态采集，再按项目切片；
- SCM 标题显示 `SVN · 项目名`，次级详情显示仓库和工作副本；
- 项目级提交和更新只作用于该项目；
- 不扫描当前 workspace 未加载的兄弟目录；
- 同名项目补充可辨识父路径，不依赖显示名作为 identity。

### 6.3 Diagnostics

Diagnostics 必须复用工作副本解析器，不能只检查项目根是否直接包含 `.svn`。结果区分：

- 位于上层工作副本；
- 独立工作副本；
- external 或嵌套工作副本；
- 非 SVN；
- 路径不存在。

`EM.code-workspace` 的三个项目不能因为自身没有 `.svn` 被误报为非 SVN。

## 7. 路径和范围表达

### 7.1 默认显示

- 顶部显示“工作区：EM · 项目：EmApi”，次级显示“SVN 仓库：Code2”；
- 文件默认使用 `projectRelativePath`；
- 路径详情分别标注“项目内路径”“仓库内路径”“SVN URL”“本地完整路径”；
- 本地绝对路径只由 Host 完成复制和定位，不进入 AI 请求；
- 跨项目列表显示项目徽标，单项目列表不逐行重复项目和仓库名。

本版本只建立正确路径模型和最小详情入口；完整 PathCell、排序、全选和小屏布局进入 v0.0.8。

### 7.2 跨项目选择

- 同一工作副本、同一 repository identity：只有用户明确跨选时才建立跨项目 scope；预览按项目分组，可以产生一个 revision；
- 不同工作副本但同一 repository identity：拆成独立执行单元；
- 不同 repository identity：必须按仓库拆分，不能合并 revision；
- 非 SVN folder：不进入 SVN 候选，并说明原因；
- 右键确定的文件或文件夹范围不能被项目根、模板、Changelist 或 AI 扩大。

## 8. 项目切换与状态失效

每个模块窗口可以继续复用，但从项目 A 加载项目 B 前必须检查：

- 提交说明草稿和手动文件选择；
- Diff 页内编辑草稿；
- AI 结果与用户确认；
- 写操作预览和确认 token。

存在未完成内容时提供“保留为项目 A 草稿并切换”“放弃后切换”“留在项目 A”。保留数据以 `workspaceContainerId + projectId + moduleId + operationScope` 隔离；切回后重新采集状态，旧确认 token 永不恢复有效。

项目根、workspace folder 或工作副本归属变化后，依赖旧边界的快照、选择 key、AI 结果和预览失效。共享工作副本状态变化时，所有关联项目收到失效通知，但项目私有草稿不能互相串用。

## 9. 配置边界

- 项目根、最近项目和视图偏好只保存在当前 workspace 容器的本地状态；
- 新建项目团队规则时默认写入已确认项目根下的 `.svn-workbench.json`；
- 项目可以继承工作副本根的既有规则，但界面必须显示来源；
- 既有工作副本根配置不得静默移动、复制或覆盖；迁移必须单独预览并明确确认。

## 10. 实施顺序

0. **已完成（开发批次 1）**：统一现有绝对路径 identity，补齐 Windows 写入、清理和 CI 专项契约；
1. **已完成（开发批次 2）**：建立 workspace folder、project、working copy、repository 和 scope 的领域类型与组合 identity（`src/scope/projectIdentity.ts`）；`workspaceContainerId` 暂由容器本地状态隐式表达；
2. **已完成（开发批次 2）**：删除无目标业务入口对 `workspaceFolders[0]` 的隐式依赖，加入多根项目选择器（`src/scope/projectResolver.ts`、`src/extension.ts`）；
3. **已完成（开发批次 2/3）**：`WorkbenchScopeView` 增加项目上下文并与失效哈希绑定，范围栏显示项目名与回退提示；批次 3 补齐文件主路径默认项目内路径与可访问的路径详情；
4. **已完成（开发批次 3）**：SCM 重构为“工作副本采集、项目切片”（`src/scm/projectSlicing.ts`、`svnSourceControlManager.ts`）；
5. **已完成（开发批次 2）**：Diagnostics 复用工作副本解析器，识别上层工作副本、嵌套工作副本与 external；
6. **已完成（开发批次 3）**：项目总览模块与范围栏项目切换入口；
7. **已完成（开发批次 3）**：跨项目选择拆分与模块切换草稿守卫；
8. **已完成（候选）**：完整本地门禁、发布 evidence、VSIX 打包与干净安装/卸载/重装已通过；三平台 GitHub CI 随候选 PR 验证。

## 11. 候选验收

### 11.1 边界与目标

- `UX07-ROOT-01`：`Code2` 上层工作副本中的项目页面显示项目名，仓库身份仍正确；
- `UX07-ROOT-02`：`EM.code-workspace` 显示“3 个项目、1 个工作副本、1 个仓库”；
- `UX07-ROOT-03`：多根无目标命令不使用第一个 folder，而是根据活动目标定位或打开项目选择器；
- `UX07-ROOT-04`：项目级 Changes、Commit、Update、SCM 和 AI 候选不包含兄弟项目；
- `UX07-ROOT-05`：同一工作副本多项目、不同磁盘、不同仓库、非 SVN、external 和嵌套工作副本均正确解析；
- `UX07-ROOT-06`：项目根无法可靠确定时明确回退，不静默猜测；
- `UX07-ROOT-07`：右键 scope 不因项目识别、全选或 AI 建议扩大；
- `UX07-ROOT-08`：同名 folder、同名项目内路径通过规范 URI 和不透明 identity 区分。

### 11.2 SCM、路径和诊断

- `UX07-SCM-01`：共享工作副本只采集一次状态，三个项目分别展示且无重复文件；
- `UX07-SCM-02`：未加载的兄弟目录不进入项目级 SCM；
- `UX07-PATH-01`：默认显示项目内路径，详情可获得仓库内路径、SVN URL 和 Host 本地定位；
- `UX07-PATH-02`：显示路径不能直接成为写操作 identity；
- `UX07-DIAG-01`：位于上层工作副本的项目不会因自身没有 `.svn` 被误报；
- `UX07-CONFIG-01`：既有工作副本根配置不被静默迁移。

### 11.3 切换与安全

- `UX07-SWITCH-01`：复用模块窗口切换项目时，提交草稿、选择、Diff 草稿和预览不被静默覆盖；
- `UX07-SWITCH-02`：保留内容按项目隔离，返回项目后重新复验；
- `UX07-SAFE-01`：Relocate、Cleanup 和工作副本恢复突出显示完整工作副本影响，不以项目名缩小风险；
- `UX07-SAFE-02`：工作副本或项目归属变化后，旧快照、AI 结果和确认 token 正确失效。

### 11.4 已落地基础的回归门禁

- `UX07-PLATFORM-01`：Windows 盘符、分隔符、大小写和 UNC identity 正确，POSIX 大小写语义不变；
- `UX07-PLATFORM-02`：`/repo/a` 不覆盖 `/repo/ab`，合法 `..cache` 子目录不被误拒绝，内部 identity 不进入用户可见路径；
- `UX07-PLATFORM-03`：原子写入使用写句柄完成 `write -> fsync -> close`，失败关闭句柄并保留原错误；
- `UX07-PLATFORM-04`：测试目录清理只对规定的 Windows 锁占用错误延迟回收，不掩盖其他平台或未知错误；
- `UX07-CI-01`：PR 不与开发分支 `push` 重复运行矩阵，同一 PR 的旧运行可取消，Windows 专项测试早于完整覆盖率执行。

人工主路径必须覆盖 `Code2 / bchd-front-Dev3.0`、`EM.code-workspace`、不同工作副本的多根 workspace、非 SVN folder 和跨项目脏草稿切换。

### 11.5 自动化覆盖与候选结果

候选源码 `31379b0d0d5a74a58b44d576bec694ac1db13a75` 已通过 Node `26.0.0` / npm `12.0.2` 的 `npm run verify`：覆盖率套件 `810/810`、Lines `93.39%`，Webview E2E `59/59`，性能预算与真实 SVN Extension Host 通过；`svn-workbench-0.0.7.vsix`（`8,520,755` 字节，SHA256 `185B3A997AFBDF465A5AFE0601DFD642B8B69C4890D519A6B7F05AF03514FEA2`）在 VS Code `1.133.0` 完成干净安装、卸载与重装。accepted evidence 为 `2026-08-14T01-30-23-555Z-79ee9304`。

候选 PR 首次 Windows 运行发现 synthetic POSIX 路径测试未显式注入平台，同时用户可见的 Windows 项目相对路径被内部 identity 小写化；候选源码已改为“identity 路径用于边界和 Host key、原始路径用于显示”，并为 POSIX/Windows 测试显式注入各自路径语义。首次运行不作为发布通过结论。

以下候选条目已有自动化测试支持（测试文件括注）；其余只能保留为“未执行人工/待 CI”，不得虚构通过。

- `UX07-ROOT-01/02/03/06`：`tests/unit/projectResolver.test.ts`、`tests/unit/projectIdentity.test.ts`（单项目名显示另见 `tests/components/ScopeBar.test.ts`）；
- `UX07-ROOT-04`（项目级动作不含兄弟项目）：`tests/unit/svnSourceControlManager.test.ts`、`tests/unit/scmProjectSlicing.test.ts`；
- `UX07-ROOT-05`（上层/嵌套/非 SVN 等归属解析）：`tests/unit/workingCopyClassification.test.ts`；不同磁盘多根与 external 的真实检出组合仍待候选人工；
- `UX07-ROOT-07`（右键 scope 不扩大）：`tests/unit/scopeGuards.test.ts` 与既有范围测试；
- `UX07-ROOT-08`（同名 folder/同名项目内路径以 identity 区分）：`tests/unit/scmProjectSlicing.test.ts`、`tests/unit/projectIdentity.test.ts`；
- `UX07-SCM-01/02`：`tests/unit/svnSourceControlManager.test.ts`（共享采集一次、按项目切片、兄弟目录不进入）；
- `UX07-PATH-01/02`：`tests/unit/projectFileView.test.ts`、`tests/components/FilePathDetail.test.ts`；
- `UX07-DIAG-01`：`tests/unit/workingCopyClassification.test.ts`；
- `UX07-CONFIG-01`（既有工作副本根配置不被静默迁移）：`tests/unit/teamConfigProjectLayer.test.ts`（迁移预览/阻止项/保存默认写项目根且不改动工作副本根配置）；
- `UX07-SWITCH-01/02`：`tests/unit/workbenchProjectSwitch.test.ts`、`tests/unit/projectSwitchGuard.test.ts`；
- `UX07-SAFE-02`（项目边界变化失效）：`tests/unit/workbenchArchitecture.test.ts`（范围哈希含项目根）、`tests/unit/workbenchProjectSwitch.test.ts`（旧预览/token 不恢复）；
- `UX07-PLATFORM-01..04`、`UX07-CI-01`：批次 1 既有测试（`tests/unit/windowsPlatformContracts.test.ts`、`tests/unit/extensionHostTempCleanup.test.ts`、`tests/unit/githubWorkflow.test.ts`）；
- 未执行人工/待 CI：`UX07-ROOT-05` 的真实检出组合、`EM.code-workspace` 与 `Code2 / bchd-front-Dev3.0` 人工主路径、`UX07-SAFE-01`（Relocate/Cleanup/恢复的工作副本级风险提示）与真实 Windows Runner；其中 Windows Runner 必须在发布前由候选 PR 通过。

## 12. 明确不做

- 不把 `.code-workspace` 当作 SVN 仓库或一次提交范围；
- 不把工作副本根直接当作用户项目根；
- 不因为 repository UUID 相同就自动跨项目选择；
- 不扫描未加载的兄弟项目作为项目级候选；
- 不把已落地的通用路径 identity 等同于完整项目、工作副本或操作范围 identity；
- 不在本版本实施全选、排序和全部页面列表改造；
- 不接入新的模型调用或修改 AI 产品结构；
- 不提前进入 v0.0.8 的功能开发；本轮仅为 v0.0.7 生成与候选源码绑定的发布 evidence。

## 13. 后续版本关系

- [`v0.0.8`](../v0.0.8/) 在本版本的项目与路径 identity 上重构 Changes / Commit 高频操作；
- `v0.0.9` 修复 AI 能力命名与草稿覆盖等信任问题；
- `v0.0.10` 将成熟列表交互推广到其他模块；
- `v0.0.11` 才允许在明确项目范围内采集受限差异并生成有证据的提交说明；
- `v0.0.12` 合并完整变更解读、语义拆分与冲突解释。
