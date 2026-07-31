# SVN Workbench 团队提交规范配置

日期：2026-07-04

阶段：技术验证 -> 开发

## 目标

提交页面需要支持团队级提交说明规范，降低“提交内容选对了，但说明不合规”的日常成本。该能力默认关闭，团队可以在 Windows 和 macOS 上使用同一组 VS Code 设置启用，不依赖平台差异。

## 本轮新增能力

### 1. 提交规范配置

新增 `svnWorkbench.commitConvention.*` 配置组：

- `enabled`：是否启用团队提交规范校验。
- `requiredIssueId`：是否要求提交说明包含工单号。
- `issueIdPattern`：工单号正则，默认 `[A-Z]+-\d+|#\d+`，覆盖 `PROJ-123` 和 `#123` 两类常见习惯。
- `requiredModule`：是否要求首行带模块，例如 `fix(order): 修复订单列表`。
- `allowedModules`：允许的模块名，默认 `order/user/config/docs`。
- `requiredPrefix`：是否要求首行带提交前缀。
- `allowedPrefixes`：允许的前缀，默认 `feat/fix/config/docs/refactor/test/chore`。

### 2. 提交前拦截

点击提交页的“确认提交”时，系统会同时执行：

- 基础提交说明校验：不能为空，不能超过 2000 字符。
- 团队规范校验：前缀、模块、工单号。
- 提交计划校验：是否有可提交路径、是否误选生成物、是否越过当前右键范围。

任一校验失败都会阻止真实 `svn commit`，并在提交结果面板展示原因。

### 3. 提交页提示

当团队规范启用后，提交说明区域会显示规范摘要，例如：

```text
团队提交规范已启用；首行前缀：feat, fix；模块：order, user；工单号匹配：[A-Z]+-\d+|#\d+
```

这样用户不需要切到设置页确认当前规则。

### 4. AI 生成/补全感知规范

AI 提交说明请求会携带同一份规范信息，包括：

- 是否启用规范。
- 是否必填工单号。
- 工单号正则。
- 允许前缀。
- 允许模块。
- 给模型阅读的人类提示。

真实模型调用时会提示模型：

- 使用简体中文。
- 不编造未提供的变更。
- 按团队规范生成提交说明。
- 工单号缺失时不能编造真实工单号，只能提醒用户补充。

本地 fallback 会在可判断时生成规范化首行，例如：

```text
fix(order): 整理当前 SVN 提交范围
```

如果团队要求工单号，本地 fallback 会给出提醒，但不会伪造 `PROJ-123`。

## 交互细节

### 推荐团队配置示例

```json
{
  "svnWorkbench.commitConvention.enabled": true,
  "svnWorkbench.commitConvention.requiredPrefix": true,
  "svnWorkbench.commitConvention.allowedPrefixes": ["feat", "fix", "config", "docs", "refactor", "test", "chore"],
  "svnWorkbench.commitConvention.requiredModule": true,
  "svnWorkbench.commitConvention.allowedModules": ["order", "user", "payment", "config", "docs"],
  "svnWorkbench.commitConvention.requiredIssueId": true,
  "svnWorkbench.commitConvention.issueIdPattern": "[A-Z]+-\\d+|#\\d+"
}
```

### 合规提交说明示例

```text
fix(order): PROJ-123 修复订单列表刷新异常

原因: 列表刷新后未正确同步筛选条件
影响: 订单列表查询
风险: 低；仅影响订单列表页面
```

### 不合规示例

```text
修复订单列表
```

会被阻止，原因包括：

- 首行缺少允许前缀。
- 首行缺少模块。
- 缺少工单号。

## 跨平台标准

Windows 和 macOS 均使用 VS Code 配置系统读取规则：

- 不写死路径。
- 不依赖 shell。
- 不依赖操作系统专属配置文件。
- 提交前校验在扩展进程内完成。

这保证两端提交规范一致。

## 已修改文件

- `package.json`：新增 `svnWorkbench.commitConvention.*` 配置项。
- `src/commit/commitConvention.ts`：新增团队提交规范读取、提示构建、校验逻辑。
- `src/commit/commitPanel.ts`：提交页显示规范提示，提交前执行规范校验，AI 请求携带规范。
- `src/ai/aiProvider.ts`：提交说明 AI 请求增加 `convention` 字段。
- `src/ai/commitMessageAiGenerator.ts`：本地 fallback 支持规范化首行和规范提醒。
- `src/ai/openAiCompatibleProvider.ts`：真实模型提示词增加团队规范约束。
- `src/test/suite/index.ts`：新增 3 个团队提交规范相关扩展测试。

## 后续建议

下一步可以继续推进“团队规范管理页面”：

- 在 VS Code 命令中打开可视化配置页。
- 支持从 `.svn-workbench.json` 或仓库配置读取团队规范。
- 支持按项目类型预设规范，例如前端项目、后端项目、配置仓库、文档仓库。
- 支持 AI 根据已选文件自动建议模块，但仍由用户确认。
