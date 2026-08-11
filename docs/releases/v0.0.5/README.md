# SVN Workbench v0.0.5 发布记录

> 状态：已发布（2026-08-11）。受支持的 Node.js 26 + npm 12 工具链下，完整 `verify`、真实 VS Code 多窗口冒烟、VSIX 打包及隔离安装/卸载/重装，以及正式不可变 release evidence 均已通过；真实 VS Code 隔离实例人工复核已由仓库维护者在全新 profile 中补验。
>
> 基线版本：已发布的 `v0.0.4`。

## 1. 版本主题

将 `v0.0.4` 的 Diff 独立窗口试点推广为统一的“每个功能模块一个 Webview 窗口”架构，并在所有入口可达后移除 Webview 左侧 Rail。

本版本只改变模块的窗口承载、打开与跨模块路由，不改变模块内部业务能力，也不引入新的工作副本写入协议。

## 2. 用户目标

- 从右键菜单、命令面板和模块内动作打开功能时，目标功能在自己的窗口中展示。
- 同模块重复打开时复用单例窗口并加载新目标；不同模块互不顶替。
- 历史到 Diff、提交到 AI 设置等跨模块跳转打开或复用目标模块窗口，源窗口状态保持不变。
- 移除窗口内左侧 Rail，保留模块内部任务标签和必要的返回/关联入口。
- 关闭一个模块窗口不影响其他窗口的会话、认证状态和进行中操作。

## 3. 版本范围

### 3.1 模块窗口管理器

新增 Host 侧统一窗口管理器，键必须使用协议中的实际 `WorkbenchModuleId`：

- `changes`
- `commit`
- `diff`
- `history`
- `conflicts`
- `changelists`
- `ai-review`
- `impact`
- `agent`
- `repository`
- `settings`
- `diagnostics`

管理器负责：

- 按模块惰性创建 `WorkbenchController`；
- 同模块单例复用、关闭后重建；
- 面板标题、图标、打开位置和生命周期；
- 将新目标传入既有控制器；
- 扩展停用时统一释放资源。

`WorkbenchController` 继续保持“一控制器、一面板、一活动会话”，不膨胀为全局窗口注册表。

### 3.2 统一路由

把 `v0.0.4` 的 Diff 特例路由推广为统一模块路由：

- VS Code 命令和右键入口解析为 `moduleId + taskId + operationScope`；
- Webview 的跨模块 action 由 Host 窗口管理器路由；
- 同模块 action 留在当前控制器处理；
- 目标模块、任务或范围非法时拒绝，不回退到任意默认范围；
- 源窗口保持原快照、滚动位置和未完成输入；
- 路由失败显示中文原因和恢复动作。

实现前建立完整入口清单，至少覆盖：

- 资源管理器和 SCM 右键入口；
- 命令面板入口；
- History → Diff；
- Changes → Commit / Changelists / Conflicts；
- Commit → AI 设置与选择规则设置；
- Repository → Recovery / Diagnostics；
- Settings、Diagnostics 等支持模块的深链接。

### 3.3 移除 Rail

只有当入口清单全部接入并有测试证据后才移除 Rail：

- 删除 Shell 中的功能列表和对应布局占位；
- 保留模块内任务导航；
- 空态、错误页和设置页仍提供必要的关联入口；
- 右键显式打开时，激活目标窗口并把焦点放到标题或第一个可操作控件；
- 后台刷新不得无故抢焦点；
- 窄宽、小高度和 200% 缩放下不得因 Rail 移除产生页面级横向滚动。

### 3.4 多窗口会话与安全语义

- 窗口关闭或换范围不得清除其他窗口正在使用的认证和证书信任上下文。
- 安全上下文按 repository identity 管理，窗口只持有会话引用；失效时向相关窗口广播明确事件。
- `moduleId + taskId + operationScope` 在每个窗口独立保存，跨模块路由只能保持或缩小范围。
- 提交选择规则变化只让依赖该规则的快照失效；本版本先保证正确性，不做额外刷新性能优化。
- 写操作继续使用既有预览、确认令牌和执行前复验，本版本不改变其安全链路。
- 一个窗口的异常、关闭或重建不能取消其他窗口正在执行的操作。

### 3.5 状态保留策略

本版本采用统一且保守的默认策略：

- 面板隐藏后允许按当前基线重新采集快照；
- 模块自身已有的未提交输入按现有机制处理，不借窗口重构新增持久化能力；
- 关闭窗口视为结束该窗口会话；
- 不在本版本做逐模块 `retainContextWhenHidden` 性能调优。

如果实测重建成本超过现有性能门禁，应先记录问题和数据，不在本版本临时增加未设计的持久化层。

## 4. 明确不做

- 不实现 Diff Webview 页内编辑、`diff/save-working`、草稿恢复或逐块采用；这些属于 `v0.0.6`。
- 不删除 `MergeView` 回退路径。
- 不废弃协议中的 `open-module`；仅移除 Rail 触发源，协议清理后续单独评估。
- 不新增“关闭全部工作台窗口”命令。
- 不做逐模块差异化 `retainContextWhenHidden` 调优。
- 不做与正确性无关的规则失效广播性能优化。
- 不修改模块内部产品功能、SVN 命令语义或 AI 外发范围。
- 不引入 VS Code 之外的外部浮动窗口。

## 5. 实施阶段

### 阶段 0：契约清点与安全设计

- 固化入口和跨模块 action 清单。
- 明确所有 `WorkbenchModuleId`、默认 task 和显示标题。
- 设计窗口管理器、路由结果和 repository 安全会话生命周期。
- 建立测试矩阵和失败恢复矩阵。

完成条件：不存在未归属入口；安全上下文清除和广播语义有可测试契约。

状态：✅ 已落地（路由纯逻辑与安全注册表契约见 `src/extension/workbench/workbenchRouting.ts`、`src/security/svnSecurityContextRegistry.ts` 及对应单元测试）。

### 阶段 1：窗口管理器

- 实现按模块惰性创建、单例复用和关闭重建。
- 迁移现有主工作台与 Diff 控制器接线。
- 保持 `v0.0.4` 的 Diff `sameGroup`/`beside` 设置行为。
- 增加生命周期和模块 ID 防御测试。

完成条件：所有模块均可独立打开，同模块复用，不同模块互不顶替。

状态：✅ 已落地（`workbenchWindowManager.ts`、`workbenchWindowRegistry.ts`、`WorkbenchController` 的 `servedModule` 接线；测试 `workbenchWindowManager.test.ts`、`workbenchRouting.test.ts`）。

### 阶段 2：统一路由

- 接入所有命令、右键入口和跨模块 action。
- 实现范围保持/缩小校验与结构化失败响应。
- 落地 repository 安全上下文共享和相关窗口失效广播。
- 增加跨窗口路由、关闭、重建、认证与失败恢复测试。

完成条件：目标窗口正确打开，源窗口状态不变，非法路由被拒绝。

状态：✅ 已落地（`extension.ts` 统一入口、`open-module`/`open-diff`/`history/compare` 跨模块路由、安全上下文引用计数与失效广播）。

### 阶段 3：移除 Rail

- 移除 Rail 和布局占位。
- 更新 mock、组件测试、E2E 和视觉基线。
- 检查焦点、读屏、三主题、小高度与 200% 缩放。

完成条件：所有功能仍可达，窗口内不再显示功能列表，布局和可访问性无退化。

状态：✅ 已落地（`AppShell.svelte` 移除 Rail；mock 支持 `?module=` 模拟独立模块窗口；Webview E2E 全绿）。

### 阶段 4：候选验收

- 同步 `docs/current/设计与交互基线.md`、`实现与代码映射.md`、`测试与验收基线.md`。
- 运行 `npm run docs:verify` 和 `npm run verify`。
- 打包 VSIX、执行干净安装并在真实 VS Code 中完成多窗口冒烟。
- 固化候选提交、依赖锁、VSIX 指纹、测试和人工验收证据。

状态：✅ 已完成。自动化门禁（`docs:verify`、`verify`、`package:vsix`、`validate:vsix-install`、`prepare:manual-test-env`）全部通过；Extension Host 自动化多窗口冒烟通过；仓库维护者在全新 `/tmp` profile + 独立 extensions dir 的真实 VS Code 1.132.0 隔离实例中人工补验了五模块独立窗口、Changes→Commit / Commit→Settings / History→Diff 真实 Webview 按钮路径、跨窗口提交输入保留、Light 视觉与 Dark/High Contrast/720 宽 evidence 截图复核。

## 6. 测试矩阵

| 场景                     | 单元/组件 | Webview E2E | Extension Host / 真实 VS Code |
| ------------------------ | --------- | ----------- | ----------------------------- |
| 按模块创建与单例复用     | 必须      | 必须        | 必须                          |
| 关闭后重建               | 必须      | 必须        | 必须                          |
| 同模块与跨模块路由       | 必须      | 必须        | 必须                          |
| 非法 module/task/scope   | 必须      | 必须        | 必须                          |
| 源窗口状态保持           | 组件覆盖  | 必须        | 必须                          |
| Rail 移除后入口可达      | 组件覆盖  | 必须        | 人工点检                      |
| 多窗口认证与证书信任     | 必须      | 可选        | 必须                          |
| 窗口关闭不影响其他操作   | 必须      | 必须        | 必须                          |
| 三主题、焦点、键盘、读屏 | 组件覆盖  | 必须        | 人工点检                      |
| 720×480 与 200% 缩放     | 组件覆盖  | 必须        | 人工点检                      |

Extension Host 测试至少覆盖成功、拒绝、窗口已关闭、目标重建、认证失效、操作失败和恢复分支。

## 7. 发布门禁（已执行）

`npm run verify` 之外，本版本已执行并全部通过的候选交付门禁：

1. `npm run verify`；
2. `npm run package:vsix`；
3. 记录 VSIX 文件名、大小、SHA256 和文件清单；
4. `npm run validate:vsix-install`；
5. 真实 VS Code 多窗口冒烟（Extension Host 自动化 + 隔离实例人工补验）；
6. 接受并固化 evidence run；
7. 更新 `manifest.json` 的提交、测试和证据字段。

本版本未出现 P0 路由、安全会话或窗口隔离问题。

## 8. 完成定义

- 任一功能可通过正式入口打开独立模块窗口。
- 同模块复用、跨模块分离，关闭一个窗口不影响其他窗口。
- 跨模块跳转保持源窗口状态和原操作范围边界。
- Rail 已移除且所有入口仍可达。
- 多窗口认证、证书信任和失效广播行为明确并有测试证据。
- 三主题、键盘、读屏、小高度和 200% 缩放通过。
- 当前基线、manifest、VSIX 与证据已经同步。

## 9. 后续版本边界

- `v0.0.6`：Diff Webview 安全页内编辑。
- 后续再评估：`MergeView` 移除、`open-module` 协议清理、“全部关闭”命令、逐模块状态保留优化、规则广播性能优化和三窗格冲突合并。

## 10. 发布记录

本版本发布源码为本地提交 `ead84ed9c1074cd13bb7f0af03ae895ff2fe0654`（`feat(workbench): v0.0.5 per-module windows with unified routing and rail removal`），分支 `agent/release-v0.0.5`；`v0.0.5` tag 指向该提交。已接受证据运行、不可变证据路径及其树指纹以 [`manifest.json`](./manifest.json) 为准。

- 工具链：Node.js `26.0.0`、npm `12.0.2`、VS Code `1.132.0`、macOS `26.6` arm64；`npm ci` 干净安装。
- `npm run verify` 通过：570 项单元/组件测试、行覆盖率 `93.55%`、Webview E2E 52 项、性能预算与 Extension Host（含真实 VS Code 多窗口冒烟）均通过。
- 真实 VS Code 多窗口冒烟（Extension Host 自动化，非 Webview mock）：
  - 不同模块各自独立窗口（Changes/History/Diff/Commit/Settings 并存，互不顶替）；
  - 同模块重复打开复用单例窗口；
  - 关闭后按需重建；
  - 跨模块打开（Diff/Commit/Settings）不关闭其他窗口；
  - 关闭一个窗口不影响同仓库其他窗口。
  - 隔离实例人工补验覆盖：Changes→Commit、Commit→Settings、History→Diff 真实 Webview 按钮路径；跨窗口提交输入“feat(order): 保留跨窗口输入状态”切到 Settings 再返回后保留；Light 视觉正常，Dark/High Contrast/720 宽 evidence 截图复核正常。History→Diff 的 webview 按钮路径与非法 module/task/scope 拒绝亦由路由/协议单元测试与 Webview E2E 覆盖；三主题、键盘、720×480 与 200% 缩放由 Webview E2E（真实 Chromium 渲染）覆盖。
- VSIX `svn-workbench-0.0.5.vsix`：`8,405,271` bytes，SHA256 `DC63B635038E26C16B746B2B6C8FC9369D8A7167967A0F7CB967E0CD85965D7F`，共 3700 个文件；隔离 profile 完成安装、卸载与重装。
- 相对 `v0.0.4`，VSIX 增加 `4,230` bytes。
- 已接受证据 run `2026-08-11T08-16-40-665Z-0e016b6b`，不可变路径 `artifacts/2026-08-11T08-16-40-665Z-0e016b6b`。

本版本发布记录随不可变证据一并固化；远端发布操作（push、GitHub PR、Release、Marketplace 发布）不属于本文档范围，由仓库维护流程在授权后执行。
