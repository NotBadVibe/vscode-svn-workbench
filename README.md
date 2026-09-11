# SVN Workbench (SVN 工作台)

> 面向 VS Code 的现代化、AI 增强型 Subversion 研发工作台。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-^1.92.0-007ACC.svg)](https://code.visualstudio.com/)

---

## 💡 为什么需要 SVN Workbench？

Subversion (SVN) 依然在游戏研发、政企金融、大型资产仓库与硬件嵌入式等领域扮演着重要基石角色。然而，长久以来 VS Code 生态中的 SVN 工具普遍面临**界面交互陈旧**、**操作反馈模糊**、**三方冲突难解**以及**缺乏现代代码理解能力**等痛点。

**SVN Workbench** 专为解决这些问题而生：

- **现代化交互体验**：基于 Svelte 5 构建清爽直观的 Webview 界面，告别简陋表格与黑盒弹窗。
- **任务级精准右键**：在资源管理器、编辑器与 SCM 中按需呼出对应任务模块，不强加笨重繁琐的全局大首页。
- **严谨安全的写操作**：提交、更新、清理、还原与合并均提供**影响清单预览**、**范围快照**与**双重确认令牌**，杜绝误操作。
- **务实透明的 AI 增强**：AI 不是黑盒玩具——提供**证据可溯源**的提交说明生成、变更解读与冲突意图分析；模型未配置或异常时 **100% 本地平滑降级**。

---

## ✨ 核心特性

### 1. ⚡ 场景化右键直达，即开即用

不需要在复杂的面板间来回切换。无论在文件列表、目录还是多选资源上右键，均可一键直达当前操作范围的核心功能：

- **查看与对比**：Working 对比 BASE、任意修订版本对比、文件演进历史与逐行 Blame。
- **本地修改管理**：实时捕获 SVN 真实状态，支持按状态（已修改、新增、删除、缺失、冲突、未版本化）自动分组与筛选。
- **资源级快速操作**：直接执行 Add、Delete、Revert、Ignore、Lock/Unlock、属性编辑及复制仓库 URL。

### 2. 🛡️ 安全第一的写操作保障

在企业级 SVN 协作中，安全高于一切：

- **预览先行**：所有写操作（Commit、Update、Cleanup、Revert、Switch、Merge 等）执行前，展示明确的影响文件清单与操作范围。
- **范围与时效校验**：基于 `moduleId + taskId + operationScope` 严格锁定范围，代码或 revision 发生变动后旧预览自动失效，防止竞态冲突。
- **混合仓库严格隔离**：针对多工作副本与嵌套 `svn:externals` 独立建模，禁止混合仓库合并提交为一个 revision，保障版本库边界清晰。

### 3. 🧠 证据可溯源的 AI 辅助（可选增强）

将现代大语言模型的代码理解能力注入传统 SVN 流程中，每一条结论都真实可信：

- **有据可查的提交说明**：结合差异证据与团队提交规范生成草稿建议，逐条结论关联代码行号与差异证据，不覆盖用户已输入内容。
- **变更深度解读**：快速理清“改了什么”、“需要确认的事项”、“潜在影响与验证建议”，本地阻止项绝不被模型降级。
- **改动意图智能拆分**：多项混合改动自动按业务意图聚类，可一键转换为 **SVN 原生 Changelist** 分批提交。
- **隐私与透明预算**：外发前明确展示模型、文件范围与字符预算，提交历史受严格预算限制；API Key 仅存放于 VS Code 安全密钥存储（SecretStorage）。
- **零依赖本地降级**：未配置 AI、网络超时或接口异常时，纯本地规则与完整手动 SVN 操作全量可用。

### 4. ⚔️ 可视化三方冲突中心

告别痛苦的手工搜索 `<<<<<<` 冲突标记：

- **三方块级比对**：直观对比 Working、Mine 与 Theirs 三方修改，支持单块采纳与手动编辑。
- **冲突意图解释**：AI 辅助分析双方修改背景与分歧原因，提供推荐处理思路与潜在业务风险提醒。
- **安全解决**：解决后重新验证语法与状态，由用户确认后再执行 `svn resolve`。

### 5. 🗂️ 完整的仓库与分支运维体系

无需频繁打开终端输入复杂的 SVN 命令：

- **分支与标签管理**：图形化 Branch / Tag 创建向导，命令预览让参数一目了然。
- **工作副本切换与重定位**：安全执行 Switch 与 Relocate，自动核验目标地址与差异。
- **交互式合并向导**：清晰选择修订范围，合并影响全景预览，冲突直接衔接冲突中心。
- **本地搁置（Patch Shelf）**：支持一键导出/应用 Patch，在不污染远程仓库的前提下安全暂存临时改动。
- **发布说明一键生成**：根据指定修订版本范围自动整理变更记录与发布日志。

### 6. 👥 团队规范与敏捷配置

- **团队规则沉淀**：通过项目根目录的 `.svn-workbench.json` 统一团队提交前检查规则、路径规范与敏感信息策略。
- **敏感信息扫描**：内置凭据、密钥、私钥与生成物检测，在提交前拦截潜在安全隐患。

---

## 🚀 快速上手

### 前置要求

- **VS Code**：`1.92.0` 或更高版本。
- **SVN 命令行工具 (SVN CLI)**：位于系统 `PATH`，或在设置中手动指定。
  - _Windows_：自动探测 `svn.exe`、TortoiseSVN、SlikSVN、VisualSVN。
  - _macOS_：自动探测 Homebrew（`/opt/homebrew/bin/svn`、`/usr/local/bin/svn`）或 Xcode CLI。
  - _Linux_：系统包管理器安装的 `svn`。

### 快速开始

1. **安装扩展**：在 VS Code 中搜索 `SVN Workbench` 或通过 VSIX 本地安装。
2. **环境自检**：打开包含 `.svn` 目录的工作区，按 `Ctrl+Shift+P` (macOS: `Cmd+Shift+P`) 执行 `SVN：检查环境`。
3. **开始使用**：
   - 在左侧资源管理器中，**右键任意文件或文件夹**，选择 `SVN Workbench` 即可开启对应操作。
   - 在左侧 SCM 面板中，查看工作副本的修改列表、暂存变更集与提交草稿。

---

## ⚙️ AI 模型配置

SVN Workbench 兼容主流国内外大模型服务商，可在工作台设置中根据不同场景灵活路由：

- **支持的服务商**：
  - DeepSeek
  - 通义千问 (Qwen DashScope)
  - 智谱 GLM (Zhipu Coding / General)
  - 月之暗面 (Kimi)
  - 任意兼容 OpenAI 接口标准的模型服务 (Custom Endpoint)
- **安全保障**：API Key 保存至 VS Code `SecretStorage`，绝不写入设置文件、日志面板或代码库中。

> 💡 **提示**：AI 为完全可选的增强能力。即使不配置任何模型，所有 SVN 核心管理功能依然 100% 完整可用。

---

## ⌨️ 常用命令一览

| 命令名称                  | 命令 ID                                   | 适用场景                               |
| :------------------------ | :---------------------------------------- | :------------------------------------- |
| **SVN：查看工作副本修改** | `svnWorkbench.openWorkbench`              | 查看当前工作副本全部变更与状态看板     |
| **SVN：检查环境**         | `svnWorkbench.checkEnvironment`           | 诊断 SVN CLI 路径、版本及网络环境      |
| **SVN：刷新状态**         | `svnWorkbench.refreshStatus`              | 重新采集当前工作副本状态               |
| **SVN：更新当前范围**     | `svnWorkbench.updateScope`                | 预览并更新当前选中的目录或文件         |
| **SVN：提交当前范围**     | `svnWorkbench.commitFolder`               | 呼出提交面板，支持 AI 建议与规则校验   |
| **SVN：打开差异对比**     | `svnWorkbench.openDiff`                   | 快速对比当前文件与 BASE 版本差异       |
| **SVN：查看历史**         | `svnWorkbench.openHistory`                | 检索修订记录、文件演进与变更列表       |
| **SVN：打开冲突中心**     | `svnWorkbench.openConflictCenter`         | 处理冲突文件，三方合并与意图分析       |
| **SVN：变更集管理**       | `svnWorkbench.openChangelists`            | 管理与调整本地 SVN Changelist          |
| **SVN：解读所选变更**     | `svnWorkbench.understandScope`            | AI 分析所选改动的业务意图与影响面      |
| **SVN：浏览仓库**         | `svnWorkbench.openRepositoryBrowser`      | 在线查看远程版本库目录树与节点信息     |
| **SVN：创建分支 / 标签**  | `svnWorkbench.createBranch` / `createTag` | 分支与标签创建向导                     |
| **SVN：切换工作副本**     | `svnWorkbench.switchWorkingCopy`          | 将本地工作副本切换至另一分支/路径      |
| **SVN：重定位仓库地址**   | `svnWorkbench.relocateWorkingCopy`        | 仓库迁移时重定位远程 URL               |
| **SVN：合并到工作副本**   | `svnWorkbench.mergeToWorkingCopy`         | 向导式多修订合并与预览                 |
| **SVN：补丁与本地搁置**   | `svnWorkbench.openPatchShelf`             | 生成/应用 Patch，支持本地临时搁置      |
| **SVN：生成发布说明**     | `svnWorkbench.openReleaseNotes`           | 基于修订范围自动聚合生成 Release Notes |
| **SVN：配置团队规则**     | `svnWorkbench.configureTeamConfig`        | 维护 `.svn-workbench.json` 协作规则    |

---

## 🛠️ 工程与贡献

本项目采用 [MIT License](LICENSE) 开源。

- **文档中心**：查阅 [文档中心](docs/README.md) 了解架构规范、测试门禁与演进路线。
- **参与贡献**：阅读 [贡献指南](CONTRIBUTING.md) 了解代码规范与 PR 提交流程。
- **安全反馈**：查阅 [安全策略](SECURITY.md) 了解漏洞提报通道。

```bash
# 本地构建与验证环境要求：Node.js 26 + npm 12
nvm use
npm ci
npm run check    # 执行 ESLint、Prettier、TypeScript 与 Svelte 校验
npm run verify   # 执行全套门禁验收（文档、测试、视觉、无障碍与真实 SVN 验证）
```
