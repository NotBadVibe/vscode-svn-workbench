# Changelog

## 0.0.2 (Unreleased)

### Changed

- Windows 中文文件名提交增加安全参数回退，并补充真实 SVN 与单元回归。
- Webview 内容安全策略覆盖 Vite 懒加载资源。
- Webview CSP nonce 改为使用 `crypto.randomBytes` 生成，并有静态回归测试。
- 开发工具链固定为 Node.js 22/npm 10，增加仓库元数据、ESLint、Prettier、高危依赖审计与关键提交流分文件覆盖率门禁。
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
