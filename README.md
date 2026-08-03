# SVN Workbench

SVN Workbench 是面向 VS Code 的 AI-first Subversion 工作台。正式业务界面统一使用 Svelte 5，Explorer、编辑器和命令面板中的入口会直接打开对应功能模块，不强制进入一个完整首页。

本项目采用 [MIT License](LICENSE) 开源；欢迎通过 Issue 和 Pull Request 参与改进，提交前请先阅读 [贡献指南](CONTRIBUTING.md) 与 [安全策略](SECURITY.md)。

## 主要能力

- 在文件、目录和多选资源的右键菜单中直接打开 Changes、Diff、历史、提交、冲突和 AI 模块。
- 为每个工作副本创建独立的 VS Code Source Control Provider；冲突、受控变更和未版本化资源使用按状态裁剪的原生右键菜单。
- 采集真实 SVN 状态，支持搜索、分组、多选、Add、Delete、Revert、Ignore、Lock、Unlock、Copy URL 和 Changelist。
- 提交、更新、Cleanup、属性修改、冲突解决和历史恢复均先预览，再通过范围快照与确认令牌执行。
- 支持 Working 与 BASE Diff、修订比较、Changed Paths、Blame、三方块级冲突合并和从修订恢复到工作副本。
- Repository 模块提供 Branch、Tag、Switch、Relocate、Merge、仓库浏览、Patch、本地 Shelf 和发布说明，并对危险操作二次确认。
- 支持 AI 智能选择、提交说明、变更审查、智能拆分、冲突建议、影响分析和逐步审批代理。
- AI Provider、模型和场景路由可配置；API Key 仅保存在 VS Code SecretStorage，提交历史默认不外发且受条数预算限制。
- 通过 `.svn-workbench.json` 配置团队提交规则；AI 不可用时保留本地规则和完整 SVN 手动流程。
- 提供安全认证输入、证书指纹核对、代理入口、工作副本恢复、环境诊断、严格 CSP、敏感信息裁剪和任务取消。

## 运行要求

- VS Code 1.92.0 或更高版本。
- SVN CLI 位于 `PATH`，或通过 `svnWorkbench.svn.path` 指定。
- 支持 Windows、macOS 与 Linux；三平台门禁定义在 `.github/workflows/verify.yml`。

插件会自动探测常见 SVN 路径：

- Windows: `svn.exe`, TortoiseSVN, SlikSVN, VisualSVN, VisualSVN Server.
- macOS: `svn`, `/opt/homebrew/bin/svn`, `/usr/local/bin/svn`, `/usr/bin/svn`.
- Linux: `svn` 或 `svnWorkbench.svn.path` 指定的可执行文件。

## 常用命令

- `SVN：检查环境`
- `SVN：打开工作台`
- `SVN：刷新状态`
- `SVN：更新当前范围`
- `SVN：提交当前范围`
- `SVN：打开差异对比`
- `SVN：查看历史`
- `SVN：打开冲突中心`
- `SVN：变更集与智能拆分`
- `SVN：AI 变更审查`
- `SVN：分析影响与测试`
- `SVN：受控 AI 任务代理`
- `SVN：AI 配置模型`
- `SVN：检查环境`

## 基本流程

1. 使用 VS Code 打开 SVN 工作副本，并运行 `SVN：检查环境`。
2. 在 Explorer 中右键文件、目录或多选资源，从 `SVN Workbench` 子菜单直接选择任务。
3. 在 Svelte 模块中确认仓库、操作范围和候选文件。
4. 需要时使用 AI 生成建议；采用建议前检查外发范围、证据和过期状态。
5. 对写操作检查命令预览和精确文件清单，再明确确认执行。
6. 完成后检查结果、工作副本新状态和恢复建议。

## AI 配置

在工作台设置模块中配置 Provider、Base URL、默认模型、按场景模型和 API Key。

当前内置预设包括：

- DeepSeek
- Qwen DashScope
- Zhipu Coding
- Zhipu General
- Kimi
- Custom OpenAI-compatible endpoint

AI 是可选增强能力。未配置、调用失败或结果无效时，核心 SVN 操作、规则扫描和人工流程仍然可用。

## 开发与验收

开发环境固定使用 Node.js 26 与 npm 12；执行 `nvm use` 会读取仓库中的 `.nvmrc`。

```bash
npm ci
npm run check
npm run verify
npm run prepare:manual-test-env
npm run package:vsix
npm run validate:vsix-install
```

`npm run check` 同时执行 ESLint、Prettier、TypeScript 与 Svelte 校验。`npm run verify` 会依次执行文档映射、高危依赖审计、静态检查、覆盖率门禁、Webview/视觉/无障碍验收、性能预算和 Extension Host/真实 SVN 验收。普通截图与性能证据写入 `.validation/evidence/v<版本>/<运行编号>/`；只有 `npm run evidence:release` 会向对应版本发布目录写入不可覆盖的证据运行。

详细架构、逐项验收方法、功能状态和候选版本结论见项目中的 `docs/README.md`。

## 打包

以下命令生成本地 VSIX：

```bash
npm run package:vsix
```

生成的 `.vsix` 可通过 VS Code 的“从 VSIX 安装...”命令安装。

干净 profile 的安装、卸载和重装检查：

```bash
npm run validate:vsix-install
```

## 许可证

本项目采用 [MIT License](LICENSE)。
