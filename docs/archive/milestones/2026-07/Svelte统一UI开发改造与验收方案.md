# SVN Workbench v3 · Svelte 统一 UI 开发改造与验收方案

> 状态：CURRENT / IMPLEMENTATION-AUTHORITY  
> 决策日期：2026-07-30  
> 适用范围：SVN Workbench v3 的 UI 架构改造、功能迁移、测试、验收和发布  
> 产品范围：以 [`产品与功能基线.md`](../../../current/产品与功能基线.md) 为准
> 技术实现与交付：以本文为准  
> 当前实现追踪：[`v0.0.1 实现状态与验收追踪`](./v0.0.1实现状态与验收追踪.md)
> 最新候选验收：[`v0.0.1`](../../../releases/v0.0.1/)

## 1. 改造结论

SVN Workbench v3 采用统一 Svelte 业务 UI：

- 所有 SVN 可见业务界面统一使用 **Svelte 5 + TypeScript**。
- 使用 **Vite** 构建 Webview 静态资源，不使用 SvelteKit。
- 使用一个可复用的 Svelte Workbench Shell，按命令直接进入具体功能模块，不设置强制访问的“大首页”。
- Explorer、编辑器标签和命令面板中的右键/命令只负责提供宿主入口；用户进入任务后，范围展示、文件选择、差异、历史、提交、冲突、设置、进度、确认和 AI 交互均由 Svelte 承载。
- SVN CLI、文件系统、SecretStorage、AI 请求和安全校验继续运行在 VS Code Extension Host。Extension Host 是后台能力层，不是第二套 UI 框架。
- 迁移结束后不再保留面向用户的旧内联 HTML/CSS/JavaScript 面板，也不保留两套重复的提交、冲突或配置流程。

“统一 Svelte UI”不代表把 SVN 和 AI 业务逻辑放进浏览器。Webview 随时可能被销毁，所有写操作、持久状态和安全边界必须由 Extension Host 掌握。

## 2. 目标与非目标

### 2.1 改造目标

1. **统一体验**：所有模块共享布局、主题、组件、状态表达和交互规则。
2. **降低维护成本**：替换 TypeScript 文件中的大段 HTML 字符串、重复 CSS 和分散消息监听。
3. **模块化入口**：右键命令直接打开 `changes`、`commit`、`history`、`conflicts`、`ai-review` 等具体模块。
4. **保证性能**：首屏只加载 Shell 和当前模块，差异/合并、图表和 AI 富内容按需加载。
5. **保护领域契约**：范围、仓库边界、状态快照、危险操作确认和 AI 结果校验不因换 UI 而弱化。
6. **形成可验证交付**：建立单元、组件、浏览器、Extension Host、真实 SVN、视觉、性能和 VSIX 安装验收链路。

### 2.2 非目标

- 不在本次改造中重写已经稳定的 SVN 命令解析和领域算法。
- 不引入 SvelteKit、SSR、服务端路由或独立 Web 服务。
- 不允许 Webview 直接执行 shell、访问 SecretStorage 或调用 AI Provider。
- 不为了“全 Svelte”复制一套 VS Code 编辑器内核；差异/合并能力选择轻量、可懒加载的 Web 组件实现。
- 迁移期先完成 P0/P1 和架构收口；统一架构稳定后，P2 仓库管理能力继续在同一 Repository 模块内实现，不引入第二套 UI。
- 不以“看起来与原型相似”代替真实 SVN、安全和异常恢复验收。

## 3. 当前基线与主要问题

当前项目已有可复用的 SVN、范围、提交、拆分、更新、冲突和 AI 领域代码，也已有 Extension Host 测试基础。UI 主要问题是：

| 当前事实 | 风险 | 改造处理 |
| --- | --- | --- |
| `src/commit/commitPanel.ts` 约 3826 行 | 页面、状态、消息和领域调用高度耦合 | 先提取协议和控制器，再迁移为 Svelte 功能组件 |
| 多个 Panel 各自拼接 HTML/CSS/JS | 重复样式、主题漂移、难以复用 | 统一为一个 Workbench Shell 和组件层 |
| 多处直接监听/发送 Webview message | 协议不完整、难测试、容易串消息 | 建立版本化、可判别联合类型的 Bridge |
| 多个面板默认 `retainContextWhenHidden: true` | 隐藏页面仍占用 Chromium 和状态资源 | 默认关闭，状态回收到 Extension Host |
| 只有 Extension Host 测试 | UI 行为、主题、键盘和视觉回归缺口 | 增加 Vitest、Svelte Testing Library、Playwright |
| 现有产品文档以原生表面和 Webview 混合为主 | 与统一 Svelte 决策冲突 | 由本文覆盖旧 UI 表面建议并同步验收矩阵 |

改造原则是保留领域价值、替换展示方式，不直接把旧 HTML 逐字复制到 `.svelte` 文件。

## 4. 目标架构

```text
VS Code 宿主入口
Explorer / Editor / Command Palette / Activity Entry
                         │ command + uri[]
                         ▼
Extension Host（TypeScript）
├── CommandContextResolver：仓库、范围、多选、状态和能力
├── WorkbenchPanelHost：创建/复用 Webview、CSP、资源 URI
├── WorkbenchController：模块编排、请求取消、快照与恢复
├── Domain Services：SVN、提交、历史、冲突、Changelist
├── AI Services：上下文裁剪、调用、结构校验、降级
├── Security：SecretStorage、路径边界、危险操作审批
└── Protocol：HostToWebview / WebviewToHost
                         │ typed messages
                         ▼
Svelte Workbench Webview
├── App Shell：范围条、模块标题、导航、错误边界、任务状态
├── Feature Modules：按 route/moduleId 懒加载
├── UI Components：shadcn-svelte 源码 + Bits UI 行为基础
├── SVN Components：文件树、状态、Diff、历史、提交、冲突
├── AI Components：证据、风险、计划、步骤、预算和过期状态
├── State：Svelte 5 runes；Extension Host 为真实来源
└── Bridge：唯一 acquireVsCodeApi/postMessage 出口
```

### 4.1 宿主入口不是第二套业务 UI

以下 VS Code 能力仍然存在，但只承担宿主职责：

- Explorer/编辑器右键命令：解析当前 URI 和多选范围，然后打开指定 Svelte 模块。
- Command Palette：提供键盘入口。
- WebviewPanel：承载 Svelte 应用。
- SecretStorage：保存密钥。
- 文件选择、打开文件和定位行：由 Extension Host 调用 VS Code API。

右键菜单不能由 Svelte 注入到 VS Code Explorer 内部；这是 VS Code 扩展机制的边界。Svelte 工作台内部的文件树右键菜单全部由 Svelte 组件实现。

### 4.2 单 Shell、多模块、无强制首页

只维护一个 Workbench Panel 实例。命令打开方式示例：

```ts
openWorkbench({
  moduleId: 'commit',
  selectedUris,
  source: 'explorer-context'
});
```

如果面板已经存在，则切换模块并刷新范围；不存在时创建。用户触发“查看历史”后直接进入历史模块，不先进入仪表盘。

## 5. 技术选型与依赖原则

### 5.1 固定选型

| 领域 | 选型 | 使用原则 |
| --- | --- | --- |
| UI 框架 | Svelte 5 | 新代码只使用 runes 模式 |
| 语言 | TypeScript strict | Extension、协议和 Webview 共享类型 |
| 构建 | Vite + `@sveltejs/vite-plugin-svelte` | 独立 Webview 构建，生成 manifest |
| 基础交互 | Bits UI | Context Menu、Dialog、Popover、Tabs、Tooltip 等 |
| 样式组件 | 选择性引入 shadcn-svelte 源码 | 不整库复制；组件归项目维护 |
| 样式 | Tailwind CSS + CSS Variables | Tailwind 仅构建期；主题值来自 VS Code 变量映射 |
| 图标 | Codicons 或项目统一 SVG | 不混入多套图标库 |
| 单元/组件测试 | Vitest + Svelte Testing Library | 从用户可观察行为测试组件 |
| 浏览器与视觉 | Playwright | Mock Bridge、交互、视觉、键盘、性能冒烟 |
| Extension 集成 | `@vscode/test-electron` | 继续复用现有测试入口并扩展 |

参考：

- [Svelte 官方文档](https://svelte.dev/docs/svelte/overview)
- [Svelte 官方 Vite 插件](https://svelte.dev/packages#bundler-plugins)
- [Bits UI](https://www.bits-ui.com/docs/introduction)
- [shadcn-svelte](https://www.shadcn-svelte.com/docs)
- [VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview)

### 5.2 不采用的方案

- 不使用已经废弃的 `@vscode/webview-ui-toolkit`。
- 不使用 SvelteKit。
- 不引入 React/Vue 组件作为孤岛。
- 不默认引入 Skeleton 等完整主题系统，避免与 VS Code 主题变量形成两套令牌。
- 不在第一阶段引入 Redux、XState 等额外全局状态框架；复杂任务状态优先使用领域层显式状态机。
- 不在 Webview 中引入 Node polyfill、shell SDK 或 AI SDK。

### 5.3 依赖准入

新增运行时依赖必须同时满足：

1. 支持当前 Svelte 5 和目标 VS Code Chromium。
2. 可按组件或模块导入，不要求整库加载。
3. 不使用 `eval`，可以通过严格 CSP。
4. 许可证与项目发布方式兼容。
5. 有可维护来源、类型声明和基本测试。
6. 记录引入前后 gzip 体积变化。

Diff/Merge 编辑器可选用 CodeMirror 6 的模块化能力，但必须先完成体积、中文、超大文件、键盘和冲突块验证；只有通过 M1 技术验证后才能固定依赖。

## 6. 目标目录

```text
src/
├── extension/
│   ├── activate.ts
│   ├── commands/
│   └── workbench/
│       ├── WorkbenchPanelHost.ts
│       ├── WorkbenchController.ts
│       ├── WebviewAssetManifest.ts
│       └── renderWebviewShell.ts
├── protocol/
│   ├── envelope.ts
│   ├── hostToWebview.ts
│   ├── webviewToHost.ts
│   ├── modules.ts
│   └── validators.ts
├── domain/
│   ├── scope/
│   ├── svn/
│   ├── changes/
│   ├── commit/
│   ├── history/
│   ├── conflict/
│   └── ai/
└── webview/
    ├── index.html
    ├── main.ts
    ├── App.svelte
    ├── app/
    ├── bridge/
    ├── components/
    │   ├── ui/
    │   ├── svn/
    │   └── ai/
    ├── features/
    │   ├── changes/
    │   ├── commit/
    │   ├── history/
    │   ├── conflicts/
    │   ├── repository/
    │   ├── settings/
    │   └── ai-agent/
    ├── stories/
    ├── mocks/
    └── styles/
        ├── vscode-tokens.css
        ├── semantic-tokens.css
        └── global.css

tests/
├── unit/
├── components/
├── webview-e2e/
├── extension/
├── svn-integration/
└── fixtures/
```

迁移期允许旧目录暂时保留。完成验收后，`commitPanel.ts`、`conflictCenterPanel.ts`、`teamConfigPanel.ts`、`aiConfigurationPanel.ts`、`acceptanceChecklistPanel.ts` 中的业务 HTML 渲染代码必须删除。

## 7. 功能模块与路由

| moduleId | 模块 | 典型入口 | 是否首屏懒加载 |
| --- | --- | --- | --- |
| `changes` | 工作副本状态与文件树 | Activity Entry、刷新、查看修改 | 否，Shell 默认能力 |
| `commit` | 智能提交 | 文件/文件夹/多选右键 | 是 |
| `diff` | 文件或修订差异 | 文件右键、历史、审查证据 | 是 |
| `history` | 文件/目录历史与详情 | 右键查看历史 | 是 |
| `conflicts` | 冲突列表、候选与合并 | 冲突资源右键 | 是 |
| `changelists` | 变更集与拆分计划 | 文件树右键、AI 拆分 | 是 |
| `ai-review` | AI 变更审查 | 范围右键 | 是 |
| `impact` | 影响与测试建议 | AI 助手菜单 | 是 |
| `agent` | 受控 AI 任务代理 | AI 助手菜单 | 是 |
| `repository` | 分支、标签、Switch、Merge、浏览 | 更多 SVN 操作 | 是 |
| `settings` | SVN、AI、团队规则 | 设置命令 | 是 |
| `diagnostics` | 环境检查、日志和验收信息 | 检查环境 | 是 |

路由不是 URL 页面路由，而是应用状态：

```ts
type WorkbenchModuleId =
  | 'changes'
  | 'commit'
  | 'diff'
  | 'history'
  | 'conflicts'
  | 'changelists'
  | 'ai-review'
  | 'impact'
  | 'agent'
  | 'repository'
  | 'settings'
  | 'diagnostics';
```

每个模块必须独立声明：

- 输入上下文类型。
- 初始快照类型。
- 可执行动作。
- 正常、加载、空、失败、取消、离线和过期状态。
- 权限与范围要求。
- 组件测试故事。

## 8. 组件与设计系统

### 8.1 基础组件

首批只引入实际使用的组件源码：

- Button、IconButton、Input、Textarea、Checkbox、Switch。
- Dialog、AlertDialog、Sheet、Popover、Tooltip。
- ContextMenu、DropdownMenu、Command、Tabs、Collapsible。
- Separator、Badge、Progress、Skeleton、ScrollArea。
- Resizable、Table 基础能力。

### 8.2 SVN 业务组件

- `RepositorySwitcher`
- `ScopeBar`
- `SvnFileTree`
- `SvnFileRow`
- `StatusBadge`
- `ChangelistBoard`
- `CommitComposer`
- `PreflightChecklist`
- `DiffViewer`
- `RevisionTimeline`
- `ConflictWorkspace`
- `OperationPreview`
- `DestructiveConfirmDialog`
- `TaskProgress`

### 8.3 AI 业务组件

- `AiFindingCard`
- `EvidenceLocation`
- `ConfidenceIndicator`
- `PrivacyBudget`
- `StaleResultBanner`
- `AgentPlan`
- `AgentStepCard`
- `CommandPreview`
- `ApprovalGate`
- `FallbackNotice`

### 8.4 视觉规则

- 颜色全部通过语义令牌引用 VS Code CSS 变量，不在业务组件写固定主题色。
- 默认使用 4px 基础间距体系；文件行建议 28–32px。
- 圆角、阴影和渐变克制使用；主要层级依赖间距、细边框和字体权重。
- AI 只使用一个克制的辅助强调色，不把所有 AI 区域设计成紫色卡片。
- 动画以 120–180ms 的透明度和位移反馈为主，并支持 `prefers-reduced-motion`。
- Light、Dark、High Contrast 三种主题都必须达到可用标准。

组件完成的定义不是“能显示”，而是同时具备：默认、hover、focus-visible、active、disabled、loading、error 和键盘状态。

## 9. 状态与通信协议

### 9.1 协议信封

```ts
interface MessageEnvelope<TType extends string, TPayload> {
  protocolVersion: 1;
  type: TType;
  requestId?: string;
  moduleId: WorkbenchModuleId;
  repositoryUuid?: string;
  scopeHash?: string;
  payload: TPayload;
}
```

Host 与 Webview 分别定义可判别联合类型，禁止使用 `{ command?: string; [key: string]: any }` 作为正式协议。

### 9.2 消息方向

Webview → Host：

- `webview/ready`
- `module/open`
- `snapshot/request`
- `operation/preview`
- `operation/execute`
- `operation/cancel`
- `operation/approve`
- `file/open`
- `clipboard/write`
- `draft/update`
- `state/persist-view`

Host → Webview：

- `app/initialize`
- `module/snapshot`
- `operation/progress`
- `operation/result`
- `operation/error`
- `operation/cancelled`
- `scope/changed`
- `result/stale`
- `draft/synchronized`

### 9.3 强制规则

1. `acquireVsCodeApi()` 只能在 `webview/bridge` 调用一次。
2. 业务组件不能直接注册全局 `message` 监听。
3. 每个异步请求必须有 `requestId`，响应不能更新已经切换的模块或过期请求。
4. 写操作必须携带 `repositoryUuid`、`scopeHash` 和最新状态版本。
5. Host 收到消息后仍需做运行时校验，不能信任 TypeScript 类型。
6. 模型返回的文件路径不能直接进入组件状态，必须先经过范围校验和归一化。
7. Webview 重载后由 Host 重新发送快照；关键草稿不能只存在浏览器内存。

## 10. 性能设计

### 10.1 实现要求

- Shell 与当前模块之外的功能使用动态导入。
- Diff/Merge、Markdown 高亮和图表必须独立懒加载。
- 文件树超过 300 行时启用窗口化；不得一次渲染数千个复杂行组件。
- Host 发送摘要、分页和增量更新，不发送整仓库无限制 Diff。
- 同一状态刷新在 100–200ms 窗口内合并，避免 SVN watcher 风暴造成重复渲染。
- 派生数据用 `$derived`，副作用只用于 Bridge、计时和直接 DOM 集成。
- 默认不启用 `retainContextWhenHidden`；必要视图状态通过 `setState` 或 Host 草稿恢复。
- 不在 Webview 直接访问外部网络，避免第三方脚本、字体和 CDN。

### 10.2 发布性能预算

以下是 v3 候选版本的验收预算；因测试机差异，报告必须记录设备和 VS Code 版本：

| 指标 | 门槛 |
| --- | --- |
| Shell 首包 JS（gzip） | ≤ 160 KB |
| Shell 首包 CSS（gzip） | ≤ 50 KB |
| 非当前模块 | 不得进入首包 |
| Mock 数据下命令到 Skeleton 可见 | P95 ≤ 300ms |
| Mock 数据下命令到模块可交互 | P95 ≤ 700ms |
| 普通点击视觉反馈 | P95 ≤ 100ms |
| 单条 Host→Webview 消息 | 常规 ≤ 1 MB；超过必须分页/分块 |
| 5000 文件状态列表 | 可搜索、滚动，无持续 1 秒以上主线程冻结 |
| 面板隐藏后 | 无轮询、无动画、无未取消的非必要请求 |

SVN 命令和 AI 网络耗时单独统计，不得计入纯 UI 首屏时间，也不得用加载动画掩盖没有进度的卡死。

## 11. 安全与隐私基线

- Webview 使用 nonce CSP，脚本仅允许扩展本地资源，禁止 `unsafe-eval`。
- 不允许 `{@html}` 渲染未经可信 Markdown/HTML 清洗的内容。
- AI 返回内容默认按文本渲染；代码片段使用安全高亮器。
- API Key 只由 Extension Host 通过 SecretStorage 读写，不发送回 Webview。
- Webview 只显示密钥是否已配置和掩码标识。
- SVN 密码、token、证书凭据、Authorization header 不进入消息、日志、截图和错误详情。
- 所有路径在执行前重新通过仓库根、UUID 和 scope 校验。
- Revert、Delete、Resolve、Switch、Relocate、Merge、Commit 等写操作必须使用 Host 生成的不可伪造预览标识；预览过期后拒绝执行。
- AI 上下文发送前展示文件数、数据类型、字符预算、模型和是否包含历史。
- scope、文件哈希或 revision 变化时，AI 结果立即标记过期。

## 12. 分阶段迁移计划

### M0 · 基线冻结与验证夹具

交付：

- 记录当前 `npm run compile`、`npm run test:extension` 结果。
- 为 modified、added、deleted、unversioned、conflicted、mixed repository 建立固定夹具。
- 为现有提交、冲突、AI 配置页面保存关键流程截图，仅作迁移对照。
- 建立产品 ID → 当前命令/代码 → 新模块的追踪表。

退出条件：现有领域能力可重复测试；任何当前失败都有记录，不把既有失败归因于 Svelte 改造。

### M1 · Svelte 基础设施技术验证

交付：

- 安装 Svelte 5、Vite、官方 Vite 插件、Vitest 和 `svelte-check`。
- 建立独立 Webview 构建、manifest、CSP、资源 URI 和 Mock Bridge。
- 实现 Shell、ScopeBar、主题令牌、错误边界和一个示例模块。
- 验证 Bits UI Context Menu/Dialog、shadcn-svelte 组件源码接入。
- 验证 Diff/Merge 候选方案的体积、中文、键盘和大文件性能。

退出条件：开发模式与 VS Code 调试模式都可运行；严格 CSP 下无错误；技术验证满足首包预算。

### M2 · 协议、状态与设计系统

交付：

- 建立协议联合类型、运行时校验、请求取消和过期响应保护。
- 建立 WorkbenchController 和单 Panel 复用逻辑。
- 完成基础组件和三主题令牌。
- 建立组件故事页、Vitest、Svelte Testing Library 和 Playwright 基线。

退出条件：组件无直接 `postMessage`；Light/Dark/High Contrast 视觉基线通过；Bridge 契约测试通过。

### M3 · 第一条垂直业务链

选择“查看修改”作为第一条真实链路：

```text
Explorer 右键
→ resolveCommandContext
→ 打开 Svelte diff 模块
→ Host 执行 svn diff / 读取 BASE
→ Svelte 显示加载、成功、空和错误
→ 打开文件/定位行
```

退出条件：真实 SVN 工作副本通过；不再调用旧 Diff UI；范围外路径被拒绝。

### M4 · 智能提交迁移

迁移顺序：

1. 候选文件与分组。
2. 文件选择和范围保护。
3. 提交说明与团队规则。
4. Preflight、远端检查和危险项。
5. AI 选择与说明生成。
6. 拆分建议和队列。
7. 提交执行、取消、结果和刷新。

应保留：

- `commitCandidate*`
- `commitConvention.ts`
- `commitPlanBuilder.ts`
- `commitSplitQueue*.ts`
- `preCommitRemoteCheck.ts`
- `generatedFilePolicy.ts`

这些代码应迁移到 domain/controller 边界，不复制进 Svelte 组件。

退出条件：提交模块功能等价或更好；旧 `commitPanel.ts` 不再作为正式入口；提交前/后范围与 revision 校验通过。

### M5 · 冲突、历史、设置与诊断

交付：

- 迁移冲突中心和 AI 冲突建议。
- 迁移历史、修订详情、Blame 和修订差异。
- 迁移 AI 设置、团队规则、环境诊断和验收信息。
- 统一认证、证书、离线、锁定、取消和重试状态组件。

退出条件：旧冲突、团队配置、AI 配置和验收面板均无正式入口；异常状态都有恢复动作。

### M6 · AI 审查、影响分析与任务代理

交付：

- AI 证据、置信度、隐私预算和过期状态组件。
- 受控计划、逐步审批、取消和状态重采集。
- 本地规则降级和 AI 未配置路径。

退出条件：AI 不可扩大 scope、不静默执行写操作；关闭 AI 后全部基础 SVN 流程可用。

### M7 · 收口、性能和发布

交付：

- 删除旧业务 HTML/CSS/JS 渲染器和重复入口。
- 清理未使用依赖、feature flag 和兼容适配器。
- 完成性能、视觉、无障碍、安全、真实 SVN 和 VSIX 验收。
- 生成版本候选验收报告。

退出条件：满足本文第 14～18 节全部门槛。

## 13. 开发规范与代码评审检查

### 13.1 Svelte 规范

- 新组件使用 `<script lang="ts">` 和 Svelte 5 runes。
- 单组件建议不超过 300 行；超过后必须说明为何不能拆分。
- 组件不访问 `vscode` 全局，不执行 SVN，不读取密钥。
- `App.svelte` 只负责装配 Shell、错误边界和动态模块。
- 跨功能业务状态不放在通用 UI 组件。
- `$effect` 不用于可由 `$derived` 表达的数据计算。
- 列表必须使用稳定 key，异步结果必须防止旧请求覆盖新状态。

### 13.2 样式规范

- 业务组件只能使用语义令牌，不直接使用 `#fff`、`#000` 等主题色。
- 不使用全局 `!important` 修复组件冲突。
- 焦点样式不可移除，滚动区域必须支持键盘。
- shadcn-svelte 组件进入项目后视为项目源码，修改时同时维护故事和测试。

### 13.3 Host 规范

- 所有 SVN 命令经 `SvnCommandRunner`。
- 所有入口先经统一 CommandContextResolver。
- 所有写操作在执行瞬间重新校验范围和版本。
- `renderWebviewShell.ts` 只能输出静态容器、CSP 和资源引用，不得继续承载业务 HTML。
- Webview 资源只从允许目录加载，不访问 CDN。

### 13.4 每个合并请求必须回答

1. 对应哪个功能 ID 和 moduleId？
2. 是否改变 scope、仓库或写操作安全边界？
3. 新增了哪些正常/失败/取消/过期状态？
4. 是否增加运行时依赖和首包体积？
5. 新增或更新了哪些自动化测试？
6. Light/Dark/High Contrast 是否验证？
7. AI 关闭时是否仍能完成基础流程？

## 14. 自动化测试与质量门槛

### 14.1 建议脚本

改造后 `package.json` 至少提供：

```json
{
  "scripts": {
    "dev:webview": "vite --config src/webview/vite.config.ts",
    "build:webview": "vite build --config src/webview/vite.config.ts",
    "check:webview": "svelte-check --tsconfig ./src/webview/tsconfig.json",
    "test:unit": "vitest run",
    "test:webview": "playwright test --project=webview",
    "test:extension": "npm run compile:extension && node ./out/test/runTest.js",
    "test:svn-integration": "...",
    "verify": "npm run check && npm run test:coverage && npm run test:webview && npm run test:performance && npm run test:extension",
    "package:vsix": "npm run build && vsce package --no-dependencies --allow-missing-repository"
  }
}
```

最终命令可根据构建目录调整，但能力不得缺失。

### 14.2 测试金字塔

| 层级 | 工具 | 必测内容 | 发布要求 |
| --- | --- | --- | --- |
| 静态 | `tsc`、`svelte-check`、ESLint | 类型、不可达分支、Svelte 警告 | 0 error |
| 领域单元 | Vitest/现有测试 | scope、状态、计划、AI schema、命令参数 | 全通过 |
| 组件 | Svelte Testing Library | 交互、焦点、状态、事件 payload | P0/P1 全覆盖 |
| 浏览器 | Playwright + Mock Bridge | 模块深链、主题、键盘、视觉、异常状态 | 全通过 |
| Extension | `@vscode/test-electron` | 命令、Panel、Bridge、资源 URI、CSP | 全通过 |
| SVN 集成 | 隔离仓库 | update/commit/conflict/history/lock 等 | P0 全通过 |
| 包安装 | VSIX 干净 profile | 安装、激活、资源加载、卸载重装 | 全通过 |

### 14.3 覆盖要求

- 协议 reducer、范围校验、预览令牌和 AI 结果校验分支覆盖率 ≥ 90%。
- Webview 业务状态和领域层总体分支覆盖率 ≥ 80%。
- 不以快照测试替代关键行为断言。
- 每个 P0 功能至少有一个成功、一个失败和一个范围保护自动化用例。
- 每个破坏性操作至少有“取消不执行”和“状态变化导致预览失效”用例。

覆盖率不是唯一准入条件；真实 SVN 与人工验收失败时，即使覆盖率达标也不能发布。

## 15. 功能验收

### 15.1 功能追踪

`完整功能清单与验收矩阵.md` 中的每个 P0/P1 ID 必须补充：

- 实现模块和代码位置。
- 自动化测试 ID。
- 人工验收用例 ID。
- 成功/失败证据。
- 是否存在已批准延期。

P0 不允许无实现、无测试或仅有 Mock。P1 延期必须明确版本和不影响主流程的理由。

### 15.2 P0 主流程

必须在真实隔离 SVN 仓库完成：

1. 从 Explorer 文件、文件夹和多选右键直接打开对应 Svelte 模块。
2. 操作范围始终可见，父子路径合并正确，范围外文件无法被选择或执行。
3. 状态刷新区分 modified、added、deleted、missing、conflicted、unversioned、ignored 和 external。
4. 查看修改可处理文本、二进制、空文件、重命名近似场景、中文路径和超大文件提示。
5. 智能提交完成选择、说明、规则校验、远端检查、确认、提交和提交后刷新。
6. 冲突模块完成冲突定位、候选比较、人工编辑、验证和显式 resolve。
7. AI 审查展示文件、行、证据、严重度和置信度；虚构路径被拒绝。
8. AI 拆分不能产生范围外文件，可转为可人工调整的 Changelist/提交批次。
9. AI 未配置、超时、返回非法 JSON 时，基础 SVN 流程正常可用。
10. Revert、Delete、Switch、Merge、Commit 等操作展示精确范围并重新确认。

### 15.3 多仓库和特殊路径

- 同一工作区至少覆盖两个独立 SVN 工作副本。
- 覆盖嵌套工作副本和 `svn:externals`。
- 混合仓库多选不能作为一次 revision 提交。
- 覆盖中文、空格、括号、`#`、长路径和大小写差异。
- 所有显示路径为工作区相对路径；日志不泄漏不必要的本机绝对路径。

## 16. UI、可访问性与视觉验收

> 中文术语、任务化页面、局部滚动、小高度/缩放和真实视口验收的增量门槛见 [`设计与交互基线.md`](../../../current/设计与交互基线.md)。

### 16.1 主题与尺寸矩阵

至少验证：

| 主题 | 720px | 1024px | 1440px |
| --- | --- | --- | --- |
| Light | 必测 | 抽测 | 必测 |
| Dark | 必测 | 抽测 | 必测 |
| High Contrast | 必测 | — | 必测 |

验收要求：

- 无横向页面级溢出；允许 Diff 等局部区域横向滚动。
- 主操作在不滚动整个页面时可识别，窄宽度下不被遮挡。
- 长路径截断后可通过 Tooltip/复制获得完整值。
- 加载、空、失败、离线、取消和过期状态不能只有颜色差异。
- 对话框焦点被正确约束，关闭后返回触发元素。
- 所有操作可用键盘完成；Context Menu 支持方向键、Enter 和 Escape。
- 屏幕阅读器可读出按钮名称、文件状态、进度和错误。
- `prefers-reduced-motion` 下无非必要动画。

### 16.2 视觉回归

以下组件/页面建立稳定截图基线：

- Shell + ScopeBar。
- Changes：正常、空、5000 项窗口化。
- Commit：普通、规则阻止、远端领先、AI 关闭。
- Diff：新增、删除、修改、二进制、超大文件提示。
- Conflicts：未分析、AI 候选、过期、已解决。
- AI Review：无问题、多级风险、非法结果降级。
- Agent：待批准、运行、失败、取消、完成。
- Dialog、Context Menu、Tooltip、Progress 的三主题状态。

只有确认是有意设计变更时才能更新基线，禁止用批量更新截图掩盖回归。

## 17. 性能验收方法

### 17.1 测试数据

至少准备：

- 小型：20 个状态文件。
- 中型：500 个状态文件，50 个 diff。
- 大型：5000 个状态文件，包含长路径和多状态。
- Diff：1 KB、500 KB、5 MB；5 MB 场景允许降级但不能卡死。
- AI：快速成功、30 秒延迟、流式更新、超时、非法结构和取消。

### 17.2 测量规则

- 使用 `performance.mark/measure` 记录 Shell 初始化、模块导入、首个快照和可交互时间。
- 冷启动至少测量 20 次，报告 P50/P95，不只记录最好值。
- 同时记录 VS Code、操作系统、CPU/内存和扩展版本。
- 使用 Vite 构建产物统计 gzip 体积，不能用开发服务器体积代替。
- 使用 Chromium Performance Trace 检查长任务、重复布局和滚动卡顿。
- SVN/AI 耗时必须拆分为 Host 时间、传输时间和 UI 渲染时间。

任一 P0 模块超过第 10.2 节预算时不得直接豁免；需给出原因、用户影响、优化计划和明确批准。

## 18. 安全、恢复与失败验收

必须人工或自动模拟：

| 场景 | 预期 |
| --- | --- |
| SVN CLI 缺失 | 模块可打开并解释修复方式，写操作禁用 |
| 认证失败 | 不泄漏密码，允许安全重试 |
| 证书异常 | 展示主机、指纹、原因和信任范围 |
| 网络离线/代理/DNS | 区分错误类型，不伪装成无更新 |
| 工作副本锁定 | 提供 Cleanup 预览，不默认删除未版本化文件 |
| 操作中取消 | 终止可取消任务，重新采集状态后才能重试 |
| Webview 重载 | 恢复模块、范围和草稿，不重复执行写操作 |
| Panel 关闭 | Host 中操作策略明确；不能静默丢失结果或重复提交 |
| 文件变化 | 旧预览/AI 结果过期，执行被阻止 |
| 恶意消息 | 未知 type、范围外路径、伪造审批令牌被拒绝并记录脱敏日志 |
| AI 返回 HTML/脚本 | 作为文本或安全 Markdown 显示，不能执行 |

## 19. 发布验收流程

### 19.1 候选版本顺序

1. 冻结候选提交和依赖锁文件。
2. 执行静态检查、Webview 构建和全部单元测试。
3. 执行 Playwright 交互、视觉和无障碍测试。
4. 执行 Extension Host 测试。
5. 在隔离 SVN 仓库执行 P0/P1 集成测试。
6. 完成人工主流程、异常、安全和性能验收。
7. 构建 VSIX，检查文件清单、体积和 source map 策略。
8. 使用干净 VS Code profile 安装并重复核心冒烟。
9. 记录已知问题、延期项和签字结论。

任一步失败都必须修复后从受影响层级重新执行；不得在最终报告中把失败项简单标记为“后续处理”后发布。

### 19.2 验收角色

| 角色 | 责任 |
| --- | --- |
| 开发 | 提供实现、自动化结果、性能数据和风险说明 |
| 产品/设计 | 确认入口、功能范围、状态表达和视觉一致性 |
| 测试/验收人 | 独立执行真实 SVN、异常、升级和干净安装流程 |
| 发布负责人 | 确认 P0/P1、已知问题、版本号、VSIX 和回滚方案 |

小团队可由同一人承担多个角色，但“开发自测”与“最终确认”应在报告中分开记录。

### 19.3 验收报告模板

建议保存为 `docs/releases/YYYY-MM-DD-vX.Y.Z.md`：

```markdown
# SVN Workbench vX.Y.Z 验收报告

- 候选提交：
- VSIX：
- SHA256：
- VS Code：
- 操作系统：
- SVN：
- Node/npm：

## 自动化结果

| 层级 | 命令 | 结果 | 产物链接 |
| --- | --- | --- | --- |

## 功能矩阵

| 功能 ID | 自动化 | 人工 | 结论 | 备注 |
| --- | --- | --- | --- | --- |

## 性能

| 指标 | P50 | P95 | 预算 | 结论 |
| --- | --- | --- | --- | --- |

## 视觉与可访问性

- 主题：
- 尺寸：
- 键盘：
- axe/人工检查：

## 安全与恢复

- Secret/日志：
- CSP：
- 范围保护：
- 破坏性确认：
- 取消与恢复：

## 已知问题与延期

| ID | 严重度 | 影响 | 计划版本 | 批准人 |
| --- | --- | --- | --- | --- |

## 结论

- [ ] 通过，可发布
- [ ] 有条件通过
- [ ] 不通过
```

## 20. 最终完成定义（Definition of Done）

只有同时满足以下条件，Svelte 改造才算完成：

- [x] 所有正式业务 UI 均由 Svelte 5 渲染。
- [x] 右键命令可直接进入目标模块，不强制打开首页。
- [x] 旧提交、冲突、AI 配置、团队配置和验收 Panel 不再作为正式入口。
- [x] TypeScript Host 中不存在业务页面 HTML/CSS/JS 大字符串。
- [x] 只有统一 Bridge 调用 `acquireVsCodeApi()` 和处理 message。
- [x] P0 全部实现并通过自动化与真实 SVN 验收。
- [x] P1 全部实现，无未批准延期。
- [x] AI 关闭后全部基础 SVN 流程可用。
- [x] scope、仓库、revision、危险操作和 AI 结果安全契约全部通过。
- [x] Light、Dark、High Contrast 和键盘验收通过。
- [x] 构建体积、启动、交互和大列表达到性能预算。
- [x] CSP、Secret、日志脱敏和消息运行时校验通过。
- [x] Webview 重载、关闭、取消、离线和状态变化均可安全恢复。
- [x] VSIX 可在干净 profile 安装、激活、运行、卸载并重装。
- [x] 文档、功能矩阵、测试记录和发布验收报告同步完成。

## 21. 改造完成后的代码审计命令

以下命令用于辅助确认架构收口，不能替代测试：

```bash
# 旧业务 Panel 是否仍被引用
rg "commitPanel|conflictCenterPanel|teamConfigPanel|aiConfigurationPanel|acceptanceChecklistPanel" src

# 是否仍在 Host 中拼接业务 HTML
rg "webview\.html|<script|<style|innerHTML" src --glob "*.ts"

# 是否绕过统一 Bridge
rg "acquireVsCodeApi|window\.addEventListener\(['\"]message|postMessage" src/webview

# 是否存在不安全渲染
rg "@html|unsafe-eval|unsafe-inline" src/webview src/extension

# 是否出现硬编码主题色
rg "#[0-9a-fA-F]{3,8}|rgb\(|hsl\(" src/webview --glob "*.svelte" --glob "*.css"
```

允许项必须通过集中封装或注释说明，例如 nonce 对应的启动脚本、设计令牌文件中的受控 fallback 颜色。业务组件中的散落命中视为验收失败。

---

本文解决的是开发与交付边界。任何新增功能仍应先登记到 `完整功能清单与验收矩阵.md`，再进入模块设计、开发和验收。
