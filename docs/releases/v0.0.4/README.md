# SVN Workbench v0.0.4 版本规划

> 状态：候选验收中。阶段 2 和自动化候选门禁已完成；受支持的 Node.js 26 + npm 12 工具链下，完整 `verify`、真实 Extension Host Diff 路由、VSIX 打包及隔离安装/卸载/重装均已通过。发布前仍需人工真实 VS Code 视觉与认证恢复冒烟，并生成正式不可变 release evidence。
>
> 基线版本：`v0.0.3`。
>
> 本文是 `v0.0.4` 的唯一范围基准。早期“页内可编辑 Diff”设想已移至 [`v0.0.6`](../v0.0.6/README.md)，不再作为本版本完成条件。

## 1. 版本定位

`v0.0.4` 是 **Diff 展示与打开方式稳定化版本**，目标是先把只读比较做可靠，再为后续多窗口和安全编辑建立稳定边界：

1. 将 Working Copy ↔ BASE 和修订比较迁移到 `@pierre/diffs`；
2. 提供 unified/split、语法高亮、未变更区段折叠和可访问的只读浏览控件；
3. 让 Diff 使用独立模块窗口，但默认在当前编辑组中打开，不额外制造第二根标签栏；
4. 提供“在编辑器中对比”，由 VS Code 原生 Diff 编辑工作副本；
5. 保持严格 CSP、现有操作范围和 SVN 写操作安全链路不退化。

本版本不建立 Webview 文件写入协议。Webview 内仍为只读审阅界面；需要修改工作副本时进入 VS Code 原生编辑器。

## 2. 范围冻结

### 2.1 纳入范围

#### A. 只读 Diff 渲染

- Working Copy ↔ BASE 使用 `DiffSnapshot.original/modified` 两侧全文。
- 修订比较使用 SVN unified patch 结构化渲染。
- 提供 unified/split 切换、语法高亮和未变更区段折叠。
- Light、Dark、High Contrast 下均可辨识；增删状态保留 `+`/`-`、行号或文字，不只依赖颜色。
- `@pierre/diffs` 初始化、解析或语言加载失败时回退到现有 CodeMirror `MergeView` 或明确的文本空态。
- 保持 5 MB 截断、二进制检测和既有中文错误说明。

#### B. Diff 模块窗口

- Diff 使用独立 `WorkbenchController` 和模块单例窗口。
- `openDiff`、模块内 `open-diff`、`history/compare` 均路由到 Diff 窗口。
- 新增 `svnWorkbench.diff.openMode`：
  - `sameGroup`：默认值，在当前编辑组中打开；
  - `beside`：兼容已有并排使用习惯。
- 用户显式打开 Diff 时激活目标标签，并将焦点放到标题或首个可操作控件；后台刷新不得无故抢焦点。
- Diff 发起非 Diff 请求时转交主工作台；未接线或目标无效时明确拒绝，不得静默落回错误模块。

#### C. VS Code 原生对比入口

- 在 Working Copy ↔ BASE 页面提供“在编辑器中对比”。
- Host 提供只读 BASE 内容并调用 `vscode.diff`；右侧使用 Host 根据当前会话目标生成的工作副本 `fileUri`。
- BASE 虚拟文档使用不透明 ID，不在 URI、日志或错误文本中暴露凭据、带用户信息的仓库 URL或不必要的绝对路径。
- 内容提供器继续通过既有 `SvnCommandRunner`、认证与证书恢复链路读取内容，不自行拼接命令或缓存凭据。
- 二进制、无 BASE、超过支持上限、目标失效和认证失败时给出中文原因及恢复动作。
- 修订比较保持双侧只读；本版本不要求提供 `rA ↔ rB` 的原生编辑入口。

#### D. 候选稳定性

- 在真实 VS Code Extension Host Webview 中验证 CSP、窗口生命周期和主/Diff 双向路由。
- 锁定候选实际解析的 `@pierre/diffs`、`@pierre/theme` 版本，并将 `package-lock.json` 摘要绑定到候选证据。
- 记录最终 Webview 构建体积、Diff 首次打开耗时、VSIX 大小与文件清单。

### 2.2 明确不做

以下内容不属于 `v0.0.4`：

- Webview 页内编辑、`diff/save-working`、editToken 和草稿恢复；
- 逐块采用、整文件采用 BASE、查找替换和 TortoiseMerge 风格编辑操作；
- 三方冲突编辑或三窗格冲突合并；
- Blame、Changed Paths、AI 提交说明的功能改造；
- 把所有工作台模块迁移成独立窗口或移除全局 Rail；
- 删除 CodeMirror `MergeView` 回退路径；
- Commit、Update、Resolve、Revert、Switch、Merge 等 SVN 写操作流程变更。

页内安全编辑移至 `v0.0.6`；全模块独立窗口移至 `v0.0.5`。

## 3. 已有实现与证据

### 3.1 阶段 0：渲染 Spike（已完成）

2026-08-05 的 Spike 基于当时的 `@pierre/diffs@1.3.3`，结论为 **go（有条件）**：

- Chromium 等价严格 CSP 环境 8/8 用例通过；
- CSP 兼容需要限制在组件 Shadow DOM 内的适配层；
- 语言与主题必须按需裁剪，Spike 子集构建约 2.11 MB；
- 组件内建英文按钮、ARIA 和部分主题变量需要宿主覆盖；
- 该结果不能替代真实 VS Code Webview 候选冒烟。

候选若使用不同解析版本，必须重新执行 CSP、主题、体积、性能和回退路径验收。

### 3.2 阶段 1：只读 Diff 迁移（已完成）

已落地：

- `DiffView.svelte` 适配层；
- `cspCompatObserver.ts`；
- 语言子集与主题 shim；
- Working/BASE old/new 渲染；
- 修订 patch 直渲；
- unified/split 与展开/折叠按钮；
- 渲染失败时回退 `MergeView`；
- Diff 组件、Webview E2E、可访问性和性能测试。

已有阶段性记录确认 `npm run check`、相关单元/组件测试、`npm run test:webview`、Spike E2E、`npm run test:performance` 与 `npm run docs:verify` 曾通过；其中包含 Diff 组件用例和 `02-diff` axe 零违规记录。由于现有记录未绑定候选提交、依赖锁与 VSIX，具体测试数量不作为当前候选基线，必须在阶段 3 重新采集。

### 3.3 阶段 1 追加：Diff 独立窗口代码试点（已落地，候选验收未完成）

已落地：

- 专用 Diff `WorkbenchController`；
- Diff 窗口单例、关闭后重建；
- `openDiff`、`open-diff`、`history/compare` 路由；
- Diff 发起其他模块请求时转回主工作台；
- `diffWindowRouting.ts` 及单元测试。

已有针对路由纯逻辑的单元测试；阶段 2 已补齐默认 `sameGroup`、可选 `beside`、显式打开聚焦、同目标复用、协议 v2 会话隔离与原生编辑器对比。真实 VS Code 双窗口与原生 Diff 仍由阶段 3 候选冒烟收口。

## 4. 剩余实施计划

### 阶段 2：同组打开与原生对比（已完成）

1. [x] 为 Diff 窗口路由增加 `sameGroup`/`beside` 打开策略。
2. [x] 增加 `svnWorkbench.diff.openMode`，默认 `sameGroup`，manifest 提供中文说明。
3. [x] 实现 Host 管理的 BASE 内容提供器和不透明虚拟文档 ID。
4. [x] 增加“在编辑器中对比”协议动作及 `vscode.diff` 调用。
5. [x] 补齐二进制、截断、无 BASE、无文本差异、目标移动/删除、认证失败和取消后的中文空态或恢复动作。
6. [x] 用户显式打开时激活面板并将焦点放入 Diff 区域；同一目标重复 reveal 保留 Webview 上下文。

完成结果：默认同组打开，用户可切换 `beside`；原生对比在 Host 复验范围后打开，Webview 不获得文件写权限。

### 阶段 3：候选验收（自动化已完成，人工冒烟待执行）

1. [x] 单元测试：打开策略、路由、不透明内容句柄、URI 生命周期、协议会话与配置清单。
2. [x] 组件测试：渲染、视图切换、折叠、回退、焦点、截断、二进制和原生对比入口。
3. [x] Webview E2E：中文文案、键盘、三主题、720×480、200% 缩放和 axe 基线。
4. [x] Extension Host 自动化：在隔离真实 SVN 工作副本中验证同组打开、同目标单例复用、`svn-workbench-base:` 左侧与工作副本右侧，并实际调用 `vscode.diff`。
5. [x] 受支持工具链下完成完整 `verify`、VSIX 打包及隔离目录安装、卸载、重装闭环。
6. [ ] 人工真实 VS Code：双窗口关闭重建、视觉焦点/CSP 控制台及认证/证书恢复冒烟。
7. [x] 更新 `docs/current/` 的产品、设计、实现和测试映射。

### 4.1 本次自动化候选记录（非发布 evidence）

2026-08-10 在未提交候选工作树上完成以下复验；该记录用于开发验收，不替代 `npm run evidence:release` 生成的不可变发布证据：

- 工具链：Node.js `26.0.0`、npm `12.0.2`、VS Code `1.132.0`、macOS `26.6` arm64；
- 基线 HEAD：`5d853e519bdd81ab67e2222d266f9d5e1e83a42f`（候选改动尚未提交，不能作为最终候选 commit）；
- `package-lock.json` SHA256：`d77869938d7b39fa09b72813ee31cb36f827f11c286e305377454f2c7f2e655e`；实际解析 `@pierre/diffs@1.3.4`、`@pierre/theme@2.0.0`；
- `npm run verify`：通过；Vitest 48 个文件、550 项测试通过，行覆盖率 `93.55%`；Webview E2E 52 项通过，证据目录 `.validation/evidence/v0.0.4/2026-08-10T10-19-57-115Z-dfc9df8f`；Extension Host 退出码 0；
- 性能：20 次交互 p50 `49 ms`、p95 `53 ms`，5000 文件仅挂载 18 行、滚到底部 `42 ms`，全部预算通过；
- Webview 构建：Diff 懒加载 chunk `467.84 kB`（gzip `136.64 kB`，source map 不计运行时载荷）；
- VSIX：`svn-workbench-0.0.4.vsix`，3701 个文件，`8,401,107` bytes；SHA256 `2e054371084913c6e026004fb6419f7adf4256d4c36be440935093799d4d7ddf`；隔离安装 run `2026-08-10T10-20-36-691Z` 完成安装、卸载和重装。

仍未把本记录标记为 accepted evidence：候选 commit、相对 `v0.0.3` 的完整体积增量、人工视觉/认证恢复结果及正式 immutable evidence path 尚待发布流程收口。

## 5. 候选验收矩阵

| 场景           | 单元/组件            | Webview E2E                     | Extension Host/真实 VS Code        |
| -------------- | -------------------- | ------------------------------- | ---------------------------------- |
| Working ↔ BASE | 两侧全文、语言、回退 | unified/split、折叠、主题、键盘 | 真实文件与 BASE、CSP 零违规        |
| 修订比较       | patch 解析、只读边界 | 结构化渲染、空态                | revision 读取与认证恢复            |
| Diff 窗口      | 打开策略、单例、路由 | 焦点与源窗口状态                | 同组/并排、关闭重建、双向路由      |
| 原生对比       | 句柄、范围和生命周期 | 按钮及错误恢复                  | `vscode.diff`、二进制/无 BASE/过期 |
| 降级           | 初始化与语言加载失败 | 中文回退提示                    | 不放宽 CSP，核心 Diff 仍可用       |

至少覆盖 Light、Dark、High Contrast；高度覆盖 480、600、720、900px，缩放覆盖 100%、125%、150%、200%。代码区可独立横向滚动，文件头、警告和主操作不得随代码横向滚走。

## 6. 候选与发布门禁

代码验收：

```bash
npm run check
npm run test:unit
npm run test:webview
npm run test:performance
npm run test:extension
npm run docs:verify
npm run verify
```

候选交付还必须执行：

```bash
npm run package:vsix
npm run validate:vsix-install
```

候选 evidence 必须绑定：

- Git commit、`package-lock.json` 摘要和实际依赖版本；
- Node、npm、VS Code、OS；
- VSIX 文件名、大小、SHA256 和文件清单；
- Webview 构建体积及相对 `v0.0.3` 的增量；
- Diff 首次打开与语言加载实测；
- 真实 VS Code 冒烟、人工 UI 验收和已知问题；
- accepted evidence run 和不可变 evidence path。

在上述字段完成前，`manifest.json` 保持 `draft`，不得把阶段性测试记录表述为候选或发布通过。

## 7. 回退与风险控制

- 当前 `@pierre/diffs` 严格 CSP Spike 8/8 通过，但上游折叠控件仍报告 `tabIndex=-1`；正式 Webview 由宿主按钮和 axe E2E 门禁兜底，升级依赖时必须重跑 Spike。
- CSP 适配失败时不得加入 `'unsafe-inline'`、`'unsafe-eval'` 或通配来源来换取通过。
- 原生 BASE 提供失败时保留 Webview 只读 Diff，并给出重新认证、刷新或返回修改列表的动作。
- `sameGroup` 出现兼容性问题时用户可切换 `beside`；非法配置值回退到 `sameGroup`。
- 主工作台切换范围后，旧 Diff 会话必须刷新或明确失效，不能继续使用旧安全上下文。

## 8. 后续版本关系

- [`v0.0.5`](../v0.0.5/README.md)：把 Diff 独立窗口试点推广为按模块单例窗口，并移除 Rail。
- [`v0.0.6`](../v0.0.6/README.md)：在稳定窗口与 Diff 基础上评估并实现 Webview 页内安全编辑。
- 三窗格冲突合并、删除 `MergeView`、批量关闭窗口和深度性能优化暂不分配版本，待前述版本完成后重新评估。
