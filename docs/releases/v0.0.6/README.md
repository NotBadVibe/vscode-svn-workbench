# SVN Workbench v0.0.6 版本规划

> 状态：规划中，尚未形成候选源码或测试证据。
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

### 阶段 2：Host 安全底座

实现领域服务、强类型协议、路径守卫、token、互斥、原子写入、双副本保护和草稿检查点。

完成条件：无需 Webview UI 即可通过全部安全分支单元与 Extension Host 测试。

### 阶段 3：页内编辑交互

仅在 Spike go 后实现编辑切换、保存、差异导航、逐块采用、脏状态和草稿恢复；所有 UI 中文化。

### 阶段 4：候选验收

- 覆盖 720×480、1024×600、1440×900 与 100%/125%/150%/200%。
- 覆盖 Light、Dark、High Contrast、IME、无键盘陷阱和 `prefers-reduced-motion`。
- 覆盖并发保存、外部编辑、磁盘满、权限失败、目标移动、Extension Host 重启和草稿过期。
- 运行完整候选流水线并同步 `docs/current/`。

## 9. Go/No-Go

### Go

- 真实 VS Code CSP 零违规；
- 安全写入契约全部可验证；
- 双编辑副本不会互相覆盖；
- 编辑态可访问性、性能和体积门禁通过。

### No-Go

任一 P0 无法满足时，页内编辑不发布；继续使用 `v0.0.4` 的只读 Diff 与原生编辑器对比入口。No-go 不阻塞核心 SVN 能力。
