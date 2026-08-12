# SVN Workbench v0.0.6 版本规划

> 状态：候选（阶段 0-4 已落地；VSIX、干净安装、真实 VS Code 页内编辑冒烟与不可变 release evidence 固化中）。
>
> 基线版本：`v0.0.5`。
>
> 本版本承接从 `v0.0.4` 拆出的 Webview 页内编辑能力。是否正式上线取决于真实 VS Code Webview edit mode Spike 的 go/no-go 结论。

## 1. 版本主题

在不削弱 `moduleId + taskId + operationScope`、文件写入和 SVN 写操作安全边界的前提下，为 Working Copy 与 BASE 对比提供可选页内编辑。

本版本不是冲突合并版本。作为 `v0.0.4` 完成条件的原生“在编辑器中对比”必须在本版本开始前成为稳定路径；Spike no-go 时不强行交付页内编辑。

## 2. 用户目标

- Working Copy 与 BASE 对比可在“审阅/编辑”之间切换。
- 只允许编辑 Working Copy 一侧；BASE 和历史修订保持只读。
- 支持保存、`Cmd/Ctrl+S`、上一个/下一个差异和逐块采用。
- 保存被拒绝或结果过期时保留草稿，并说明恢复方式。
- VS Code 编辑器中已有未保存内容时，不得被 Webview 静默覆盖。
- 截断、二进制、编码不明或特殊文件只提供原生编辑器出口。

## 3. 纳入范围

1. 真实 VS Code Webview edit mode Spike。
2. Host 侧 `DiffEditingService`、token registry、按文件保存互斥和草稿服务。
3. 强类型 `diff/save-working` 请求、结果和结构化拒绝原因。
4. 审阅/编辑切换、保存、差异导航与逐块采用。
5. 草稿持续检查点、恢复、放弃和导出入口。
6. 外部文件、`TextDocument`、BASE、范围和工作副本变化后的失效与恢复。
7. 三主题、High Contrast、IME、键盘、读屏、小高度和 200% 缩放验收。

## 4. 明确不做

- 不编辑 `rA ↔ rB` 历史内容。
- 不实现三窗格冲突合并。
- 不绕过既有 Revert、Resolve 的预览和确认令牌。
- 不让 AI 直接写文件或执行 SVN 写操作。
- 不为大文件设计流式编辑协议。
- 不删除原生 `vscode.diff` 逃生舱。
- 不保证 `@pierre/diffs` edit mode 必然上线；Spike no-go 是有效结论。

## 5. 写入安全契约

### 5.1 目标与路径

- Webview 只提交 Host 签发的不透明 `targetId`，不得提交可写绝对路径或 URI。
- 打开编辑态和每次保存前均执行 `lstat`、`realpath`、repository UUID 与 scope hash 复验。
- 规范路径必须仍位于工作副本根和原 `operationScope` 内。
- 页内编辑拒绝符号链接、junction、目录、设备文件、跨 `svn:externals` 和嵌套工作副本边界。

### 5.2 `editToken`

Host 保存的 token 至少绑定：

- 面板 session、`moduleId + taskId`；
- repository UUID、scope hash、规范目标身份；
- 原始完整字节 hash、BASE revision/hash；
- 打开的 `TextDocument.version`；
- `draftRevision`、签发和到期时间。

Token 单次使用。成功、失败、目标切换、范围变化、外部文件变化、SVN Update/Revert/Resolve/Switch、面板销毁和会话替换后旧 token 均失效。

### 5.3 原子保存与并发

- Host 按规范路径串行化保存。
- 请求携带递增 `draftRevision` 与 `expectedContentHash`，拒绝重放和乱序请求。
- 进入临界区后重新计算原始完整字节 hash。
- 写入同目录临时文件，保留权限、BOM、换行风格和最终换行，再原子替换目标。
- 失败时保留原文件并清理临时文件。
- 成功响应返回 `acceptedRevision`、新 hash、新 token 和刷新后的快照版本。

### 5.4 双编辑副本

安全默认规则：同 URI 存在 `TextDocument.isDirty` 时禁止 Webview 保存，提示处理编辑器内容或使用原生对比。不得用 Node 文件写入绕过脏 `TextDocument`。

监听文档修改、保存、重命名、删除及文件 watcher；任何相关变化都立即使 token 失效。

### 5.5 禁止页内保存的内容

以下任一条件成立时，Webview 编辑与 Host 保存均禁用：

- `truncated=true` 或超过 5 MB；
- `binary=true`；
- 非法 UTF-8 或编码无法可靠确认；
- 无完整原始字节 hash；
- 无 BASE；
- 符号链接或其他非普通文件。

这些场景只提供中文说明和原生编辑器入口。

## 6. 草稿与目标切换

- 编辑时按 debounce 持续向 Host 提交检查点，并等待带 `draftRevision` 的 ACK。
- 单例窗口加载新目标前，脏草稿必须提供“保存并打开”“暂存并打开”“留在当前文件”。
- 草稿绑定 repository UUID、规范目标、scope hash、BASE hash 和原始磁盘 hash。
- 基准变化后不得自动套用或保存，只能恢复为对比、导出 Patch 或人工复制。
- 明确草稿是仅内存还是跨重启持久化；若持久化，必须定义权限、TTL、容量、隔离和清理策略。

## 7. 协议与架构

新增强类型请求字段：

- `targetId`
- `editToken`
- `draftRevision`
- `expectedContentHash`
- `content`

成功结果包含：

- `acceptedRevision`
- `newContentHash`
- `newEditToken`
- 新快照版本

拒绝原因至少区分：

- `tokenExpired`
- `scopeChanged`
- `diskChanged`
- `documentDirty`
- `targetMoved`
- `tooLarge`
- `unsupportedEncoding`
- `writeFailed`

修改协议时同步 Host、Webview、Mock、类型守卫和测试。Controller 只负责面板生命周期和路由；写入、token、锁和草稿进入可独立测试的 Host 领域服务。

## 8. 阶段计划

### 阶段 0：安全设计评审

- 固化路径、token、原子写入、双副本和草稿契约。
- 建立威胁模型及成功、拒绝、过期、失败、恢复测试矩阵。

完成条件：所有 P0 边界可测试，不再保留“实现时决定”的写入策略。

### 阶段 1：真实 VS Code edit mode Spike

验证最终生产 CSP 下的动态 chunk、Shadow DOM、contentEditable、恶意文本转义、中文 IME、键盘、读屏、主题、体积和性能。

完成条件：形成 go/no-go 记录。不得放宽为 `'unsafe-inline'`、`'unsafe-eval'` 或通配资源策略。

状态：✅ **Go**（2026-08-12）。`tests/spike` 扩展 edit-mode Spike（`tests/spike/src/edit-spike.ts`、`tests/spike/e2e/edit-spike.spec.ts`）在生产等价严格 CSP（`style-src 'self'`，无 `'unsafe-inline'`）下全部通过：

- `@pierre/diffs/edit` 以独立懒加载 chunk 加载；可编辑 FileDiff 挂载成功；新增侧可编辑、删除/注释侧不可编辑；
- 程序化输入与 onChange 事件可用；中文 IME 经真实输入管线（Playwright `keyboard.insertText` 在真实点击编辑区后）落盘验证通过；
- 恶意文本（`<script>`/`onerror` 负载）按纯文本转义渲染，不产生可执行元素；
- 宿主级 Cmd/Ctrl+S 捕获与编辑器共存；Light/Dark/High Contrast 三主题可用；
- 挂载 < 2000 ms；CSP 零违规、控制台零错误。

**关键适配发现（生产 `cspCompatObserver` 必须覆盖）**：编辑器注入的样式通道需经构造式样式表（adoptedStyleSheets）与 `style=` 属性改写适配，具体包括：

1. `innerHTML` 与 `insertAdjacentHTML` 注入的 `style="…"` 属性（gutter `grid-row` 等）——解析期被 style-src-attr 拦截，需改写为 `data-hl-style` 后经 CSSOM `setProperty` 落地；
2. 编辑器 shadow 根内联 `<style data-editor-css>` / `<style data-editor-theme-css>` —— 拦截为 style-src-elem，转接 adoptedStyleSheets；
3. 编辑器 light DOM 全局 `<style data-editor-global-css>`（`[data-annotation-slot]{user-select:none}`）—— 拦截为 style-src-elem，转接 `document.adoptedStyleSheets`。

上述全部在严格 CSP 下可消除为零违规；No-Go 依据均不成立。

**验收更正（2026-08-12 独立验收）**：

- 验收实测证明 MutationObserver 事后转接无法消除 `securitypolicyviolation` 事件（样式可恢复，但违规已上报），Go 条件“CSP 零违规”必须由插入前拦截达成。生产 `cspCompatObserver.ts` 已升级为两层结构：插入前拦截垫片（全局改写 `innerHTML`/`insertAdjacentHTML`/`setAttribute("style")`，按标记收窄拦截 `<style>` 节点；已核查第一方 Svelte 模板无静态 style 属性、无 innerHTML 调用）+ 原观察器兜底。
- Spike 编辑路径此前未注册违规监听器（计数恒为 0，断言假阳性），已修复；edit Spike 现直接复用生产垫片代码（`@prod/csp-compat-observer` 别名），严格 CSP 下三主题零违规。
- 新增 `tests/webview-e2e/diff-edit-csp.spec.ts`：生产构建 + 生产等价严格 CSP 下的只读/编辑/恶意文本三用例，断言零违规与样式生效。

**验收更正（2026-08-12 第二轮，数据破坏 P0 修复）**：

- 根因：`openEdit` 初始草稿 content 误用 BASE（应为 Working Copy 当前内容），且切换守卫只判草稿存在不判脏——未修改进入编辑再切换会弹三选一，选“保存并打开”会把 BASE 沿安全链写回 Working Copy，静默撤销全部本地改动。
- 修复语义：草稿初始化为 Working Copy 内容并记录 `cleanContent`（编辑器文本模型：剥 BOM、统一 \n）；`content !== cleanContent` 才是脏草稿；快照只对脏草稿展示恢复入口；干净会话收到切换确认由 Webview 自动“暂存”不打扰用户；`saveDraft` 对干净草稿不写盘直接放行；保存成功后 `cleanContent` 更新为已保存内容。
- 授权绑定：`diff/target-switch-decision` 的 save 决定 targetId 必须等于 Host 挂起确认时记录的 currentTargetId（`diffTargetSwitch.ts` 纯函数），恶意/陈旧 targetId 被拒绝且不切换。
- 契约 §5.2 对齐：失败（含 tooLarge）后旧 token 必须失效——体量校验移到 token 消耗之后，并有失效回归测试。
- token 现绑定真实 `TextDocument.version`（Host 注入，无打开文档为 -1）；文档内容变化经 `watchDiffEditTargets` 立即撤销 token；Extension Host 集成测试覆盖真实 TextDocument 脏拒绝与不落盘。

**验收更正（2026-08-12 第三轮，Host 保存前 SVN 绑定复验）**：

- 根因：`openEdit`/`saveWorking`/`saveDraft` 只比较 token 绑定值，保存前从不重新解析目标当前的 repository UUID、工作副本归属与 BASE；`analyzeUtf8` 对含 NUL 的合法 UTF-8 返回 ok，恶意 Webview 可对二进制目标直接 `diff/open-edit` 签发 token。
- 修复：新增 Host adapter `diffSvnBinding.ts`（`svn info --show-item wc-root/repos-uuid` + `svn cat -r BASE`），作为可注入依赖在打开与每次保存（含三选一 `saveDraft`）前复验：wcroot 与主工作副本根不一致即拒绝（nestedOrExternal→scopeChanged，覆盖嵌套 WC 与 svn:externals 目录）、UUID 变化拒绝（scopeChanged）、BASE hash 变化拒绝（diskChanged，草稿保留不落盘）；`diffPathGuard` 新增 NUL 二进制拒绝（code=binary，保存路径映射 unsupportedEncoding）。真实隔离 SVN fixture 的 Extension Host 测试覆盖嵌套 WC、externals 与 BASE 前进（working hash 未变）拒绝；UUID 变化在单元层覆盖（`svnadmin setuuid` 后既有 WC 的 `svn info` 仍读本地元数据，真实 fixture 无法触发）。
- file external 闭环：同仓库 file external 的 wc-root/UUID 与主 WC 相同，probe 采用双信号识别——目标自身 `svn status --xml` 的 `file-external="true"` 属性（标准场景）+ 父目录 `svn propget svn:externals --xml` 的本地目标名（`parseSvnExternalsTargetNames`；覆盖删除后同名重新挂载等 status 不报告的残留场景，svn 1.14.5 实测确认该场景 status 无标记）。openEdit/saveWorking/saveDraft 三链路拒绝（保存映射 scopeChanged），真实 fixture 覆盖"打开后目标被转为 file external（内容字节不变）保存拒绝且不落盘"。probe 任何一步失败安全拒绝；`propget` 未设置属性时的 W200017 警告按空集合处理。
- 保存后干净状态闭环（第四/五轮）：`DiffDraftService.markSaved` 是更新 `cleanContent` 的唯一路径（此前 upsert 保留旧基准导致保存后仍显示未保存草稿——真实 VS Code 复现确认）；`revokeForPath` 改为 hash 感知——watcher 捕获到自身原子写入（磁盘内容与草稿登记一致）时跳过撤销，保存后新 token 不被误撤，连续保存可用；真实外部变化照撤。
- 连续保存基准轮换（第六轮，真实 VS Code 复现驱动）：`module/loading` 使 Diff 组件真实重挂载，本地状态只从 `editSession` 恢复，而此前仅 mutation 了 `editToken`——第二次保存携带旧 hash 被 diskChanged 拒绝。修复：`diff/save-result` 携带 `targetId`，`workbenchState` 在保存成功时统一轮换 editSession 的 token/rawHash/draftRevision（单一事实源，组件不再 mutation props）；`savedText` 以实际提交正文（pendingSaveContent）为基准，不依赖快照刷新时序。回归：workbenchState 单测 + mock 严格校验负载并模拟 loading 重挂载的连续保存 e2e（旧代码红）。
- 目标切换守卫收紧为 `shouldConfirmTargetSwitch`（脏草稿必确认；干净草稿但编辑会话活动仍确认——防 debounce 检查点竞态，由 Webview 自动暂存不弹窗；干净且无活动会话不确认）；“保存并打开”顺序保证（先刷新检查点再发 save 决定）有组件级 invocationCallOrder 回归。

### 阶段 2：Host 安全底座

实现领域服务、强类型协议、路径守卫、token、互斥、原子写入、双副本保护和草稿检查点。

完成条件：无需 Webview UI 即可通过全部安全分支单元与 Extension Host 测试。

状态：✅ 已落地。新增 `src/diffEdit/` 领域模块：

- `diffPathGuard.ts`：lstat/realpath、scope 内复验、拒绝 symlink/junction/目录/设备、≤5 MB、严格 UTF-8（BOM/EOL/末尾换行分析）；
- `diffEditTokenRegistry.ts`：editToken 单次使用、TTL、绑定 session/module/task/repo/scope/目标/磁盘 hash/BASE/TextDocument.version/draftRevision；按 scope/session/target/路径撤销；
- `diffAtomicWriter.ts`：按路径互斥、同目录临时文件、保留权限/BOM/EOL/末尾换行、fsync 后原子 rename、失败保留原文件并清理临时文件；
- `diffDraftService.ts`：**仅内存**草稿（不跨重启持久化，已文档化）、递增 draftRevision 拒绝重放/乱序、容量上限、导出统一 diff；
- `diffEditingService.ts`：openEdit（守卫→签发 token→登记草稿/恢复既有草稿）与 saveWorking（消耗 token→绑定校验→路径守卫→脏 TextDocument 拒绝→expectedContentHash 与磁盘复验→原子写入→签发新 token→更新草稿）；saveDraft（目标切换“保存并打开”：同一安全链落盘草稿后清除草稿并撤销目标 token）；saveWorking 拒绝超过 5 MB 的提交内容且不消耗 token；
- Host 接线 `src/extension/workbench/diffEditHost.ts`（TextDocument 脏状态、磁盘现状注入；`watchDiffEditTargets`：文档修改/保存/重命名/删除与工作区文件 watcher 命中后按 realpath 规范路径立即撤销 token）与 `WorkbenchController` 协议路由（diff/open-edit、diff/save-working、diff/draft-checkpoint、diff/draft-abandon、diff/draft-export、diff/target-switch-decision；会话替换/面板销毁撤销 token）。

单元测试 `tests/unit/diffEditingService.test.ts`（覆盖成功/拒绝/过期/移动/乱序/双副本/超量内容/路径撤销/saveDraft）与 Extension Host 集成用例 `testDiffEditIntegration` 通过。

### 阶段 3：页内编辑交互

仅在 Spike go 后实现编辑切换、保存、差异导航、逐块采用、脏状态和草稿恢复；所有 UI 中文化。

状态：✅ 已落地。

- `DiffModule.svelte`：审阅/编辑切换、保存（按钮 + Ctrl/Cmd+S，IME composition 保护）、上一个/下一个差异、逐块采用（还原当前块为 BASE）、脏状态提示、保存拒绝中文原因+草稿版本与“重新建立编辑会话（保留草稿）”恢复动作、草稿恢复/放弃/导出、不支持编辑的中文原因、脏草稿目标切换三选一阻断对话框（保存并打开/暂存并打开/留在当前文件，Esc 等同留在当前文件）；
- `DiffView.svelte`：编辑态附加 @pierre/diffs Editor（仅工作副本侧可编辑），onReady 暴露 getText/focusLine/applyRegionEdit；
- `diffHunks.ts`：行级 LCS 计算差异块（NEW 侧行号）；
- 草稿恢复：快照以草稿内容作为可编辑侧，openEdit 恢复既有草稿不重置；
- Mock 支持编辑流；组件测试（`tests/components/DiffModule.test.ts` 编辑用例）与 Webview E2E（真实 Chromium 编辑+Ctrl+S 保存）通过。

### 阶段 4：候选验收

- 覆盖 720×480、1024×600、1440×900 与 100%/125%/150%/200%。
- 覆盖 Light、Dark、High Contrast、IME、无键盘陷阱和 `prefers-reduced-motion`。
- 覆盖并发保存、外部编辑、磁盘满、权限失败、目标移动、Extension Host 重启和草稿过期。
- 运行完整候选流水线并同步 `docs/current/`。

状态：⏳ 自动化门禁（docs/verify、check、单元/组件、Webview E2E、性能、Extension Host）已通过；独立验收修复：生产 CSP 垫片零违规（含严格 CSP e2e 证据）、脏草稿三选一、连续保存 hash 更新、外部变化立即使 token 失效、5 MB 内容上限。覆盖矩阵与候选证据固化待发布流程。

## 9. Go/No-Go

### Go

- 真实 VS Code CSP 零违规；
- 安全写入契约全部可验证；
- 双编辑副本不会互相覆盖；
- 编辑态可访问性、性能和体积门禁通过。

### No-Go

任一 P0 无法满足时，页内编辑不发布；继续使用 `v0.0.4` 的只读 Diff 与原生编辑器对比入口。No-go 不阻塞核心 SVN 能力。
