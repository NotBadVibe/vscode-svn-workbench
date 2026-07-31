# SVN Workbench 仓库级团队配置

日期：2026-07-04

阶段：开发 -> 测试

## 目标

上一轮已经支持通过 VS Code 设置配置团队提交规范。本轮把规则升级为仓库级配置文件，让同一个 SVN 工作副本在 Windows 和 macOS 上使用同一套标准。

## 配置文件

仓库根目录支持：

```text
.svn-workbench.json
```

示例：

```json
{
  "commitConvention": {
    "enabled": true,
    "requiredPrefix": true,
    "allowedPrefixes": ["feat", "fix", "config", "docs", "refactor", "test", "chore"],
    "requiredModule": true,
    "allowedModules": ["order", "user", "config", "docs"],
    "requiredIssueId": true,
    "issueIdPattern": "[A-Z]+-\\d+|#\\d+"
  }
}
```

## 读取优先级

提交页打开时会解析最终规范：

1. 先读取个人 VS Code 设置 `svnWorkbench.commitConvention.*`。
2. 如果仓库根目录存在 `.svn-workbench.json`，读取其中的 `commitConvention`。
3. 仓库配置只覆盖自己声明的字段，未声明字段继续沿用个人设置或默认值。
4. 提交页面、AI 提交说明、提交前校验全部使用合并后的结果。

这样既支持个人试验，也支持团队统一。

## 新增命令

新增命令：

```text
SVN: Open Team Config
```

行为：

- 如果仓库根目录不存在 `.svn-workbench.json`，自动创建默认模板并打开。
- 如果已经存在，只打开文件，不覆盖团队已有规则。
- 命令面板和资源管理器文件夹右键均可使用。

## 提交页变化

提交页规范提示会显示规则来源：

```text
团队提交规范已启用；来源：.svn-workbench.json；首行前缀：feat, fix；模块：order, user；工单号匹配：[A-Z]+-\d+|#\d+
```

如果仓库配置 JSON 无法解析，会在提示中显示配置提醒，避免用户无感知地绕过团队规则。

## AI 行为

AI 提交说明继续读取合并后的团队规范：

- 仓库配置启用时，模型优先按仓库规则输出。
- 工单号必填时，模型不能伪造真实工单号，只能提醒用户补充。
- 本地 fallback 会尽量使用允许前缀和模块生成规范化首行。

## 跨平台标准

`.svn-workbench.json` 是普通 UTF-8 JSON 文件：

- Windows 和 macOS 路径统一由 Node `path` 处理。
- 不依赖 shell。
- 不依赖 SVN 客户端差异。
- 可被 SVN 版本控制，适合团队共享。

## 已修改文件

- `src/commit/commitConvention.ts`：新增仓库配置解析、合并、默认文件生成。
- `src/commit/commitPanel.ts`：提交页读取仓库级规范解析结果。
- `src/extension.ts`：新增 `SVN: Open Team Config` 命令。
- `package.json`：新增命令、激活事件和资源管理器右键菜单。
- `src/test/suite/index.ts`：新增仓库配置解析、解析优先级、默认文件创建测试。

## 下一步建议

下一步可以继续做“团队配置可视化页面”：

- 用表单编辑 `.svn-workbench.json`。
- 给前缀、模块、工单号规则提供即时校验。
- 支持从当前已选文件推断模块。
- 支持一键生成适合当前项目的团队配置。
