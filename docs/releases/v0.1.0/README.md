# SVN Workbench v0.1.0：差异底座重整与可测基线

> 文档身份：`planned-version-record`
>
> 状态：开发中（`draft/in-progress`）。V010-A～V010-E 已实现并通过单元/组件/e2e 门禁；V010-F 验证与文档收尾中。尚未发布，不代表已验收结论。
>
> 基线版本：[`v0.0.18`](../v0.0.18/)。
>
> 路线来源：[以人为本易用性审查与优化报告（v0.0.18 融合修订）](../../archive/product-reviews/2026-08-23/以人为本易用性审查与优化报告.md)第 6、8、10 节。
>
> 优先级：P0。先证明现有 `@pierre/diffs` 在真实 Webview 中可继续承担普通 Diff 与后续冲突编辑，再进入 `v0.1.1`。
>
> 用户可独立体验的主路径：打开一个 Working Copy ↔ BASE Diff，查看当前/总变更块，使用统一控件导航和切换视图，进入页内编辑，保存后继续输入、切换主题或重新打开时不丢失必要上下文；组件失败时能看懂原因并使用安全降级。
>
> 不包含：生产冲突页切换到 `UnresolvedFile`、Resolve、三方同步窗格、依赖升级、发布操作。

## 1. 版本目标与成功定义

本版本不是“只做技术 spike”。它同时交付两类结果：

1. **给用户的结果**：普通 Diff 页的导航、视图设置、加载/失败反馈和编辑会话更稳定、可理解。
2. **给后续版本的证据**：锁定安装版本 `@pierre/diffs@1.3.4` 的能力矩阵、性能 baseline、CSP/主题/生命周期验证和明确的 go/no-go 结论。

成功标准：

- 普通 Diff 的主要操作收敛到一个工具区，不重复出现同义按钮。
- 页面显示“变更块 X/Y”，上一/下一块动作和键盘行为一致。
- split/unified、上下文展开等偏好在同一 Webview 会话内稳定，不导致编辑实例无故重建。
- 保存后的 Host 权威快照刷新不打断快速二次输入，既有 `v0.0.6` token/hash 契约不退化。
- Pierre 挂载失败、语言高亮失败、二进制、截断和超限分别给出真实原因及出口。
- 取得第 6 节数据矩阵的 baseline；任何“性能很好”的结论都带数据规模、设备和 P50/P95。

## 2. 进入与退出门禁

### 2.1 进入条件

- [ ] 工作树中的 `v0.0.18` 基线可通过 `npm run check`。
- [ ] 当前 Diff、编辑、CSP、生命周期和性能测试均有可重复的基线结果。
- [ ] 负责人使用固定 fixture 走完“打开 Diff → 导航 → 编辑 → 保存 → 再编辑”，记录点击数、停顿和卡顿。
- [ ] 调研官方 Diffs 文档和最多 2 个真实使用/失败案例；记录 API 与当前安装版本差异，不先升级依赖。

### 2.2 退出条件

- [ ] V010-A～V010-F 全部完成。
- [ ] 普通 Diff 主路径、失败降级和连续保存通过自动化与人工验收。
- [ ] Pierre `UnresolvedFile`/`Editor` 能力 spike 有明确 go/no-go；no-go 时 `v0.1.1` 必须改用保留旧冲突编辑器的适配方案，而不是假装通过。
- [ ] `npm run verify` 通过；未运行的真实设备观察项明确记录。
- [ ] 同步 current 实现映射、设计约束和测试映射，但不改写 `v0.0.18` 发布记录。

## 3. AI 任务拆分

| ID     | 顺序 | AI 开发任务                    | 主要产物                    | 依赖           |
| ------ | ---- | ------------------------------ | --------------------------- | -------------- |
| V010-A | 1    | 建立自用与性能 before baseline | fixture、测量脚本、记录模板 | 无             |
| V010-B | 2    | 核对 Pierre 公共 API 与风险    | 能力矩阵、go/no-go 条件     | V010-A         |
| V010-C | 3    | 收敛 Diff 适配层生命周期       | 可测试适配器/纯决策逻辑     | V010-B         |
| V010-D | 4    | 重整普通 Diff 工具区与状态     | 用户可见 Diff 主路径        | V010-C         |
| V010-E | 5    | 补齐失败降级和可观测性         | 中文错误、fallback、诊断    | V010-C         |
| V010-F | 6    | 测试、性能、文档和候选验收     | 完整门禁与版本结论          | V010-D、V010-E |

### 3.1 V010-A · before baseline

AI 必须先只读执行：

1. 记录 `DiffView.svelte`、`DiffModule.svelte`、`diffViewLifecycle.ts`、`cspCompatObserver.ts`、`diff-theme.css` 当前职责。
2. 建立 100/1000/5000/10000 行普通 Diff fixture，覆盖小/中/大变更比例、超长行、CRLF、无末尾换行、TypeScript/JSON/XML/text。
3. 采集首个可见内容、完整高亮、上一/下一块响应、输入 P95、保存后再次输入、文件切换和内存回落。
4. 记录测试设备、VS Code、Node、缩放、主题与运行次数；不把单次最快结果当结论。
5. 输出 before 截图和数据到普通 `.validation/evidence/v0.1.0/<run>`，不得写入已发布 evidence。

### 3.2 V010-B · Pierre 能力矩阵

核对且用 fixture 验证：

- `FileDiff`、`Editor`、`UnresolvedFile`、`mergeConflictActionsType`、`onMergeConflictAction`。
- `VirtualizedFileDiff`、Worker Pool、`ScrollSyncManager`、`CodeViewCoordinator`。
- `Editor` 的 attach/cleanup、undo/redo、`applyEdits`、焦点、selection/state 持久化。
- 严格 CSP、Shadow DOM、Light/Dark/High Contrast、主题切换与 reduced motion。
- API 是否为 beta/experimental；当前包未导出的能力不得写进生产计划。
- 当前包没有 `VirtualizedUnresolvedFile` 时，明确记录，禁止用名称类推能力。

产出 `PierreCapabilityDecision`（建议作为测试 fixture 或版本文档表，不进入运行时协议），每项标记“已验证/受限/不可用/需后续实测”。

### 3.3 V010-C · 适配层重整

建议实现：

- 保留 `DiffView.svelte` 作为业务入口，提取只负责实例挂载的薄适配逻辑；不建立第二套业务 UI。
- 将实例创建、observer 注册、Editor attach、cleanup、fallback 和错误分类形成单一生命周期。
- 继续由 `shouldRebuildDiffView` 决定重建；新增状态时必须有纯函数测试，禁止通过拼接大文本生成不可靠 key。
- 编辑态同目标同容器保持实例；目标、容器、编辑模式或视图结构变化才重建。
- 清理旧实例、observer、Worker 请求和旧容器 DOM；组件销毁与异常路径幂等。
- 除非 UI 与 Host 确有新数据需求，本版本不改 `workbenchProtocol.ts`；若必须改，按 Host/Webview/Mock/守卫/测试全链同步。

### 3.4 V010-D · 普通 Diff 用户体验

用户可见任务：

- 将文件、BASE/Working、编辑状态、当前变更块 X/Y 和视图设置组织为一个紧凑工具区。
- “上一处差异”“下一处差异”同时支持按钮与一致快捷键；到达首尾给出非阻塞反馈。
- split/unified、展开/折叠上下文放入单一“显示设置”，不让每个开关与主操作同权。
- 编辑模式持续显示“正在编辑工作副本”；保存按钮写明对象，脏/保存中/已保存/失败状态不只靠颜色。
- 跳转后将目标块滚入 Diff 自己的滚动区，后台刷新不抢焦点。
- 保留“在编辑器中对比”和外部编辑出口，但根据目标类型准确禁用并解释。
- 视图偏好仅影响呈现，不改变文件内容、选择或 operation scope。

### 3.5 V010-E · 失败与降级

建立结构化错误分类：

- Pierre 实例创建失败；
- patch 解析为空/失败；
- 高亮资源失败；
- CSP/样式注入失败；
- Editor attach 失败；
- 内容二进制、截断、超限、无 BASE、非法编码；
- 文件/范围/revision 过期。

每种状态必须回答“发生了什么 / 可能原因 / 现在能做什么”。fallback 到 CodeMirror/原生编辑器时显示“简化视图”来源和恢复入口，不静默形成常态双实现；草稿存在时先保护草稿。

### 3.6 V010-F · 验证与文档

最低新增/调整测试：

- `tests/unit/diffViewLifecycle.test.ts`：新挂载状态、异常、清理和 Worker 取消。
- `tests/components/DiffModule.test.ts`：X/Y、导航、工具区、保存状态、错误降级。
- `tests/components/AppLifecycle.test.ts`：快照刷新不重挂载、不抢焦点。
- `tests/webview-e2e/diff-edit-csp.spec.ts`：生产等价 CSP 零违规。
- `tests/webview-e2e/workbench.spec.ts`：导航、连续保存、切换主题/文件。
- 性能脚本：数据规模、运行次数、P50/P95、内存和长任务输出可复核。

## 4. 主要代码落点

| 领域      | 主要位置                                                             | 约束                                        |
| --------- | -------------------------------------------------------------------- | ------------------------------------------- |
| Diff 适配 | `src/webview/features/diff/DiffView.svelte`                          | 继续封装 Pierre，不向业务泄漏不稳定内部 API |
| 任务状态  | `src/webview/features/diff/DiffModule.svelte`                        | 不复制 Host 草稿/token 状态机               |
| 生命周期  | `src/webview/features/diff/diffViewLifecycle.ts`                     | 纯逻辑、全分支测试                          |
| CSP       | `src/webview/features/diff/cspCompatObserver.ts`                     | 不放松 Webview CSP                          |
| 主题      | `src/webview/styles/diff-theme.css`                                  | 使用 VS Code token，三主题可辨识            |
| 性能      | `scripts/measure-webview-performance.js` 或独立 diff fixture         | 不覆盖已发布 evidence                       |
| 测试      | `tests/unit`、`tests/components`、`tests/webview-e2e`、`tests/spike` | spike 结论不得替代生产测试                  |

## 5. 验收场景

1. 打开 3 个变更块的 TypeScript Diff，5 秒内说出比较双方和当前块位置。
2. 只用键盘浏览所有变更块，首尾无焦点丢失。
3. 开始编辑、保存、立即继续输入，第二轮内容不被保存回执覆盖。
4. 切换 split/unified、主题和目标文件，实例按契约保持或重建。
5. 模拟高亮和 Pierre 挂载失败，草稿保留且简化视图可用。
6. 在 5000 行 fixture 中首个可见内容候选目标 P95 ≤ 800ms；若未达标，记录原因并阻止把高级冲突视图推进生产。
7. 720×480、200%、Light/Dark/High Contrast、中文 IME 下主操作和状态可达。

## 6. AI 完成报告格式

AI 完成本版本时必须按以下顺序报告：

1. 用户现在能完成什么；
2. 实际修改文件；
3. Pierre 能力矩阵与 go/no-go；
4. 性能数据及设备条件；
5. 安全契约是否变化；
6. 实际运行的检查和未运行项；
7. 剩余风险与明确延期；
8. 是否满足进入 [`v0.1.1`](../v0.1.1/) 的条件。

## 7. 延期到后续版本

- `v0.1.1`：`UnresolvedFile` 接入生产冲突视图。
- `v0.1.2`：可编辑合并结果、反向“两者都要”、undo/redo。
- `v0.1.3`：保存、核验、Resolve 和下一个冲突。
- `v0.1.8`：大文件虚拟化、Worker 最终策略、同步窗格与 locator。

## 8. Pierre 能力矩阵（V010-B 结论，`@pierre/diffs@1.3.4` 精确锁定）

证据：`tests/unit/pierreCapability.test.ts`（静态契约测试，防止升级静默改变结论）。

| 能力                                                 | 状态       | 说明                                                              |
| ---------------------------------------------------- | ---------- | ----------------------------------------------------------------- |
| `FileDiff`                                           | 已验证     | 包根导出；生产 Diff 渲染主入口                                    |
| `Editor`（`@pierre/diffs/edit`）                     | 已验证     | attach/detach/cleanUp 可用；本版本补齐 dispose 顺序               |
| `UnresolvedFile`                                     | 已验证导出 | 包根导出存在；**未在真实设备验证**，`v0.1.1` 接入前需实测         |
| `mergeConflictActionsType` / `onMergeConflictAction` | 已验证导出 | 类型与回调可用                                                    |
| `VirtualizedFileDiff`                                | 已验证导出 | 存在；本版本未接入，`v0.1.8` 大文件虚拟化再评估                   |
| `ScrollSyncManager` / `CodeViewCoordinator`          | 已验证导出 | 存在                                                              |
| `VirtualizedUnresolvedFile`                          | **不可用** | 1.3.4 不存在该导出，禁止按名称类推能力                            |
| WorkerPoolManager                                    | 受限       | 未从包根导出，生产计划不得依赖                                    |
| unified 视图页内编辑                                 | **不可用** | 1.3.4 实测 unified 下输入无法落地；进入编辑时强制 split，退出恢复 |

go/no-go：普通 Diff + split 页内编辑 **go**；`UnresolvedFile` 生产冲突视图 **暂缓**（未实测 + 5000 行性能预算未达标，见 §9）。

## 9. 性能基线（V010-A/F）

脚本：`npm run test:diff-performance`（`scripts/measure-diff-performance.js` + `src/webview/mocks/diffFixtures.ts` 确定性 fixture，同 ID 字节级一致）。证据目录：`.validation/evidence/v0.1.0/`。

设备：Apple M4 / 24 GB / Node 26.7.0 / Chromium（Playwright）。before 运行：`2026-08-24T08-48-54-992Z-a0ef2a8f`（v0.0.18 代码）；after 运行：`2026-08-24T09-43-18-779Z-403426f1`（v0.1.0 适配层；导航 10 次、输入 30 次取样，取 P95）。

| fixture                         | 首可见 before → after                      | 导航 P95 after    | 输入 P95 before → after              | 保存后再输入 after | 目标切换 after | 堆峰值 after | GC 后增量 |
| ------------------------------- | ------------------------------------------ | ----------------- | ------------------------------------ | ------------------ | -------------- | ------------ | --------- |
| ts-100-small                    | — → 189ms                                  | 36ms              | — → 9ms                              | 7ms                | 47ms           | 10 MB        | 0         |
| ts-1000-mid                     | — → 473ms                                  | 41ms              | — → 34ms                             | 23ms               | 388ms          | 17 MB        | 0         |
| ts-5000-mid                     | 1980ms → 1923ms（预算 ≤800ms，**未达标**） | 102ms（≤300ms ✓） | 371ms → 342ms（预算 ≤100ms，未达标） | 101ms              | 2117ms         | 50 MB        | 0         |
| ts-10000-mid                    | 4620ms → 4496ms                            | 271ms             | — → 870ms                            | 272ms              | 4990ms         | 123 MB       | 0         |
| ts-5000-mid-longline-crlf-noeol | — → 4375ms                                 | 109ms             | — → 319ms                            | 188ms              | 4608ms         | 60 MB        | 0         |
| json-5000-mid                   | — → 848ms                                  | 86ms              | — → 187ms                            | 86ms               | 996ms          | 40 MB        | 0         |
| xml-1000-mid                    | — → 205ms                                  | 41ms              | — → 18ms                             | 10ms               | 161ms          | 35 MB        | 0         |

结论：适配层重整后性能与 v0.0.18 基本持平（无回归）；超长行 + CRLF 组合明显更贵（4375ms）；编辑/保存/目标切换后 GC 堆增量为 0，未见泄漏。按验收场景 6：5000 行首个可见内容未达候选目标，已记录原因（首次渲染含完整语法高亮与 Shadow DOM 构建），并作为阻止把高级冲突视图推进生产的依据（§8 go/no-go 一致）。

## 10. 完成报告（按 §6 格式）

见 §10.1～§10.8。

### 10.1 用户现在能完成什么

打开 Working Copy ↔ BASE Diff 后：在一个工具区内看到比较双方、编辑状态与“变更块 X/Y”，用按钮或 Alt+↑/↓ 浏览全部变更块（首尾有文字反馈）；在“显示设置”里切换 split/unified 与上下文展开；进入页内编辑时徽章明确“正在编辑工作副本”，保存按钮写明“保存到工作副本”并有保存中/已保存文字状态；渲染或高亮失败时能看到中文三要素说明并重试，草稿优先保护。

### 10.2 实际修改文件

新增：`src/webview/features/diff/diffViewAdapter.ts`、`diffErrorTaxonomy.ts`、`src/webview/mocks/diffFixtures.ts`、`scripts/measure-diff-performance.js`、`tests/unit/pierreCapability.test.ts`、`diffErrorTaxonomy.test.ts`、`diffViewAdapter.test.ts`、`diffFixtures.test.ts`、`vscodeBridge.test.ts`。

修改：`DiffModule.svelte`、`DiffView.svelte`、`diffHunks.ts`、`vscodeBridge.ts`、`mockWorkbench.ts`、`terminology.ts`、`diff-theme.css`、`package.json`/`package-lock.json`（0.1.0 + pierre 精确版本）、`tests/components/DiffModule.test.ts`、`tests/unit/diffHunks.test.ts`、`tests/webview-e2e/workbench.spec.ts`、`diff-edit-csp.spec.ts`、`docs/current/` 三份基线与 CHANGELOG。

### 10.3 Pierre 能力矩阵与 go/no-go

见 §8。普通 Diff + split 编辑 go；`UnresolvedFile` 冲突视图 no-go（延期 `v0.1.1` 前必须实测）。

### 10.4 性能数据及设备条件

见 §9。

### 10.5 安全契约是否变化

无协议变化（`workbenchProtocol.ts` 未改）；写操作链路（editToken/路径守卫/原子写入/绑定探测）未动；bridge 仅新增入站消息过滤 `isWorkbenchEnvelope`，收窄不误判，不放松 CSP。

### 10.6 实际运行的检查和未运行项

已运行完整 `npm run verify` 门禁（2026-08-24，全部通过）：`docs:verify`、`audit:dependencies`（0 漏洞）、`check`（eslint 0 错误、prettier、tsc、svelte-check 0 错误）、`test:platform-contracts`（52 用例）、`test:coverage`（123 文件 1374 用例）、`test:webview`（83 用例，含本版本新增差异主路径）、`test:performance`、`test:extension`（扩展宿主，含真实 SVN fixture）；另运行 `test:diff-performance`（§9 数据，5000 行两项预算未达标已如实记录）。未运行：真实设备人工验收（720×480、200%、三主题、中文 IME 目视）作为非阻断观察项保留。

### 10.7 剩余风险与明确延期

5000/10000 行首个可见内容与编辑输入 P95 未达候选预算（§9）；unified 页内编辑不可用以强制 split 兜底；`UnresolvedFile` 未实测。三者均不阻塞普通 Diff 主路径，已分别延期到 `v0.1.1`/`v0.1.8`。

### 10.8 是否满足进入 v0.1.1 的条件

满足前置：能力矩阵、性能 baseline、适配层与错误分类已就绪。`v0.1.1` 开工前必须先完成 `UnresolvedFile` 真实设备实测；若 no-go，按 §2.2 改用保留旧冲突编辑器的适配方案。
