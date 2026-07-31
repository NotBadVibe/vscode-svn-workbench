# SVN Workbench 团队规则可视化配置页

日期：2026-07-04

阶段：开发 -> 测试

## 目标

仓库级 `.svn-workbench.json` 已经可以统一 Windows 和 macOS 的团队提交规范。本轮新增可视化配置页，让团队成员不用手写 JSON，也能编辑提交前缀、模块和工单号规则。

## 新增命令

新增命令：

```text
SVN: Configure Team Rules
```

保留原命令：

```text
SVN: Open Team Config
```

两者区别：

- `Configure Team Rules`：打开表单页面，适合日常配置。
- `Open Team Config`：直接打开 `.svn-workbench.json`，适合高级编辑和排查。

## 页面功能

### 1. 启用团队提交规范

通过开关控制：

```text
启用团队提交规范
```

关闭时提交页不会执行团队规则拦截。

### 2. 提交前缀

支持设置：

- 是否要求首行必须使用前缀。
- 允许前缀列表。

示例：

```text
feat, fix, config, docs, refactor, test, chore
```

分隔符支持英文逗号、中文逗号、分号和换行。

### 3. 模块名

支持设置：

- 是否要求首行必须包含模块。
- 允许模块列表。

示例：

```text
order, user, config, docs
```

提交说明示例：

```text
fix(order): PROJ-123 修复订单列表
```

### 4. 工单号

支持设置：

- 是否要求提交说明必须包含工单号。
- 工单号正则。

默认正则：

```text
[A-Z]+-\d+|#\d+
```

覆盖 `PROJ-123` 和 `#123` 两类常见团队习惯。

### 5. 实时预览

页面根据当前表单生成首行预览，例如：

```text
feat(order): PROJ-123 整理当前变更
```

### 6. 保存策略

保存时写回仓库根目录：

```text
.svn-workbench.json
```

保存逻辑会保留该 JSON 中的其他字段，只替换 `commitConvention`。这样未来增加 AI 配置、过滤规则、团队模板时不会互相覆盖。

## 错误拦截

保存前会校验：

- 启用前缀校验时，至少要有一个允许前缀。
- 启用模块校验时，至少要有一个允许模块。
- 启用工单号校验时，正则必须合法。

校验失败时不会写入文件。

## 跨平台标准

该页面只使用 VS Code Webview 和 Node 文件 API：

- Windows 和 macOS 使用同一份 `.svn-workbench.json`。
- 路径由 Node/VS Code API 处理。
- 不依赖 shell。
- 不依赖平台特定配置。

## 已修改文件

- `src/commit/teamConfigPanel.ts`：新增团队规则可视化配置页。
- `src/commit/commitConvention.ts`：新增表单输入归一化、配置合法性校验、保存时保留其他字段。
- `src/extension.ts`：注册 `SVN: Configure Team Rules` 命令。
- `package.json`：新增命令、激活事件和资源管理器右键菜单。
- `src/test/suite/index.ts`：新增 3 个可视化配置相关测试。

## 下一步建议

下一步可以继续把 AI 融入团队配置页：

- 根据仓库文件结构自动推荐模块列表。
- 根据历史提交说明自动推荐前缀和工单号规则。
- 提供“AI 生成团队规则”按钮，用户确认后写入 `.svn-workbench.json`。
