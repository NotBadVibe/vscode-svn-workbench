# Changelog

## Unreleased

## 0.1.0 (2026-08-24)

### Added

- v0.1.0 差异底座重整：普通 Diff 的文件信息、比较双方、编辑状态、当前变更块 X/Y 与视图设置收敛为单一工具区；上一处/下一处差异支持按钮与 Alt+↑/↓ 快捷键，到达首尾给出非阻塞文字反馈；split/unified 与上下文展开收敛进“显示设置” popover。
- 结构化 Diff 错误分类（diffErrorTaxonomy）：Pierre 挂载失败、patch 解析为空、高亮/CSP/Editor attach 失败、二进制、截断、无 BASE 等 10 种状态分别给出“发生了什么/可能原因/现在能做什么”，降级页提供重试渲染/重试高亮出口。
- 新增确定性 Diff 性能 fixture 与测量脚本（`npm run test:diff-performance`）：100/1000/5000/10000 行 × 多档变更比例，覆盖超长行、CRLF、无末尾换行与 TS/JSON/XML/text，输出首个可见内容、高亮、导航、输入 P95、目标切换与内存数据。

### Changed

- Diff 编辑态徽章固定为“正在编辑工作副本”，保存按钮写明对象“保存到工作副本”，保存中与已保存用文字表达。
- DiffView 薄化为 props 驱动的业务入口，Pierre 实例创建、observer 注册、Editor attach 与清理收敛到 diffViewAdapter 单一生命周期（幂等 dispose）。
- `@pierre/diffs` 锁定为精确版本 1.3.4，并补充能力矩阵静态契约测试（含 VirtualizedUnresolvedFile 不存在的明确记录）。

### Fixed

- 修复 pierre Editor 语法高亮 tokenizer 经 globalThis.postMessage 的自调度消息被误判为“协议版本不兼容”导致会话终止的问题。
- 修复退出 Diff 编辑后会因 editSession 仍在而立即重置回编辑态的问题。
- 修复 mock 环境下切换差异目标后旧会话消息被协议守卫丢弃的问题。

## 0.0.18 (2026-08-23)

### Added

- v0.0.18 深水区与打磨：新增可跳过、可重开且止步最终提交确认前的新手引导；状态词提供键盘可达的就地解释；History 可明示加载边界，并以已校验的修订号、作者和日期范围发起可取消的只读“加载更早”请求；变更解读显示逐文件已看进度；范围栏补齐候选数、工作副本 revision、入口来源与可展开复制清单。
- v0.0.17 发现性与核心任务效率：全局推荐下一步带（Host 按候选状态推导，挂在范围栏下方，可忽略、忽略不持久惩罚）；
  Update 拆分为独立模块（`update`，与 Changes/Commit 平级），更新结果页与 Changes 冲突行提供“处理 N 个冲突”直达入口；
  Repository 剩余任务按“分支与集成 / 维护与迁移 / 危险操作”分组并记忆展开状态；
  Changes/Commit 增加文件类型筛选（选项从候选推导）与会话级命名筛选预设（Changes/Commit 共读，只影响视图不改变操作范围）；
  Update/Changes/Commit 空状态补齐“发生了什么 / 是否正常 / 现在能做什么”。

### Changed

- v0.0.17 批次 A：`repository/update` 任务与 `repository/preview-update`/`repository/execute-update`
  动作迁移为 `update/preview` 任务与 `update/preview`/`update/execute` 动作，旧深链安全失效；
  `svnWorkbench.updateScope` 命令与项目总览入口指向新 update 模块。
- v0.0.12 批次 C 入口收敛：移除旧 `ai-review`、`impact`、`agent` 一级模块/命令/菜单，
  变更解读（`understanding`）为唯一变更解读主路径；本地检查/影响分析引擎
  （`src/ai/changeIntelligence.ts`）保留供变更解读本地适配。

## 0.0.8 (2026-08-15)

### Added

- Changes 与 Commit 增加面向高密度列表的筛选、自然稳定排序、三态批量选择、隐藏选择管理和默认顺序恢复。
- 文件路径改为项目内路径主显示，并提供项目内、工作副本内、仓库内、SVN URL 与本地完整路径详情及复制入口。
- Commit 支持 5,000 项窗口化、键盘分页导航、小屏排序菜单与模块级密度偏好。
- 增加双平台路径语义、路径身份/展示品牌边界和跨平台契约门禁，减少 Windows 路径问题延迟到 CI 才暴露。

### Changed

- Host 对提交选择、预览和提交说明生成统一执行候选集合复验；缺失、排除、阻止或重复身份均 fail-closed。
- Changes 到 Commit 的批量动作数量与实际 payload 保持一致，选择变化会使旧预览失效。
- 路径详情、行菜单、Escape 焦点恢复、中文 IME、reduced motion、200% 与高对比度场景补充自动化契约。

### Fixed

- 修复 Windows 路径大小写被身份归一化结果污染展示的问题，并让纯路径函数显式注入平台与 cwd 语义。
- 修复范围守卫在合成 POSIX/Windows 路径上误用宿主 `path.resolve` 的问题。
- 修复 Commit 虚拟列表远端行程序化滚动后窗口未立即重算，以及推荐选择被回放成手动选择的问题。

## 0.0.2 (2026-08-03)

### Changed

- 项目改为使用 MIT License 公开发布，并补充开源协作与安全报告说明。
- Windows 中文文件名提交增加安全参数回退，并补充真实 SVN 与单元回归。
- Webview 内容安全策略覆盖 Vite 懒加载资源。
- Webview CSP nonce 改为使用 `crypto.randomBytes` 生成，并有静态回归测试。
- 开发工具链固定为 Node.js 26/npm 12，增加仓库元数据、ESLint、Prettier、高危依赖审计与关键提交流分文件覆盖率门禁。
- CI 使用最小权限和固定 SHA 的 GitHub Actions，新增 CodeQL 与 Dependabot。
- Workbench Host 的会话状态、展示/输入、文件操作、状态哈希和仓库工作流拆到独立模块，并为边界补充单测。
- 文档统一为 `current`、`releases/vX.Y.Z`、`archive` 三层，版本清单映射源码、VSIX、测试和证据。
- 普通 Webview 与性能证据写入 `.validation/evidence`；发布证据按版本和运行编号保存且禁止覆盖已发布版本。
- CI 证据使用版本、平台和提交 SHA 命名，并增加文档与版本映射门禁。
- 更正 v0.0.1 manifest 的证据树指纹记录；归档证据内容未发生变更。

## 0.0.1

Svelte 统一 UI 改造候选版本。

### Added

- Svelte 5 + TypeScript + Vite 的单 Workbench Shell，所有模块按需加载。
- Explorer、编辑器和命令面板的模块级直接入口，以及 Svelte 内部文件右键菜单。
- 每个工作副本独立的 VS Code Source Control Provider，以及按 conflicted/versioned/unversioned 状态裁剪的原生 SCM 菜单。
- Changes 状态分组、筛选、多选、虚拟列表与常用 SVN 文件操作。
- Working/BASE Diff、修订比较、历史详情、Changed Paths、Blame、三方块级冲突编辑与修订恢复。
- 提交、更新、Cleanup、Properties 和冲突解决的预览、状态哈希、确认令牌与取消。
- 原生 SVN Changelist 的创建、移动、移出，以及 AI 拆分建议。
- AI 智能选择、提交说明、变更审查、冲突建议、影响分析和受控任务代理。
- AI 外发范围预览、场景模型路由、结构化结果校验、本地降级和 SecretStorage 密钥保存。
- 工作副本根与仓库 UUID 校验，阻止跨独立工作副本混合操作。
- SecretStorage 认证、证书指纹与信任范围确认、代理入口，以及锁定、中断和 CLI 缺失的恢复引导。
- Branch、Tag、Switch、Relocate、Merge、Repository Browser、Patch、本地 Shelf 与发布说明。
- 本地团队记忆、缓存来源/清理入口，以及默认关闭的 AI 提交历史外发预算。
- 严格 CSP、版本化消息协议、运行时校验和大输出截断保护。
- Vitest/Istanbul 硬覆盖率门禁、Playwright、Extension Host、真实 SVN、逐页截图、视觉、可访问性、性能与 VSIX 验收链路。

### Changed

- 删除旧提交、冲突、团队配置、AI 配置和验收清单的内联 HTML Panel。
- API Key 不再作为普通设置项暴露，统一由 Extension Host SecretStorage 管理。
- 默认关闭隐藏 Webview 状态保留，运行中任务禁止被其他模块静默替换。
- 构建扩展前清理旧 `out`，并从 VSIX 排除源码、测试、source map 与本地验证文件。
- Webview 验收改用生产构建的 Vite Preview，避免截图写盘触发开发服务器重载。

### Known limitations

- VS Code Explorer 的公开菜单贡献不支持按任意资源异步计算 SVN 状态；为避免冷启动激活循环，Explorer 模块子菜单对 `file` 资源稳定可见，精确的冲突/未版本化/受控状态菜单由原生 Source Control 视图和 Svelte 文件树提供。所有 Explorer 命令仍会在 Host 侧复验工作副本与范围。
- 真实外部 AI Provider、企业代理和企业 CA 的连通性取决于用户环境；无配置或失败时保持本地规则与基础 SVN 流程。
