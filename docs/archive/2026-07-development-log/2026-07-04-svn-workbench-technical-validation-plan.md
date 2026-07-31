# SVN Workbench 技术验证计划

> 产品暂名：SVN Workbench for VS Code / SVN 工作台  
> 文档类型：技术验证阶段计划  
> 编写日期：2026-07-04  
> 当前阶段：技术验证阶段  
> 上一阶段：设计阶段  
> 下一阶段：开发阶段  
> 适用平台：Windows / macOS 标准统一  
> 文档策略：新增文件，不覆盖旧文档

## 1. 阶段目标

技术验证阶段的目标不是开发完整产品，而是用最小原型证明关键技术风险可控。

核心目标：

```text
证明 SVN CLI + VS Code API + OperationScope + 提交闭环 + AI Provider 的关键链路可行。
```

必须验证：

- Windows/macOS 都能运行。
- SVN 命令可检测、可执行、可诊断。
- `svn status --xml` 可稳定解析。
- VS Code SCM Provider 能展示 SVN 状态。
- 右键文件夹提交不会越界。
- 提交页最小 Webview 能承载筛选和提交。
- `svn commit <paths> -F <message-file>` 支持中文提交说明。
- VS Code diff 可用。
- AI Provider 原型可调用并返回结构化结果。

## 2. 技术验证边界

### 2.1 本阶段要做

- 初始化 VS Code Extension TypeScript 原型。
- 实现 SVN 可执行文件检测。
- 实现工作副本发现。
- 实现 `svn info --xml`。
- 实现 `svn status --xml`。
- 实现 XML parser。
- 创建 SCM Provider。
- 创建 OperationScope。
- 实现右键文件夹提交原型。
- 实现最小提交页 Webview。
- 实现生成物排除规则。
- 实现精确文件列表 commit。
- 实现 VS Code diff。
- 实现 Output Channel。
- 实现 OpenAI-compatible AI Provider 原型。

### 2.2 本阶段不做

- 完整 UI 美化。
- 完整工作台总览。
- 完整日志页。
- 完整冲突中心。
- 完整认证管理。
- 完整锁管理。
- 内置三方合并器。
- 完整模型供应商列表。
- 发布 VSIX。

### 2.3 验证优先级

优先级从高到低：

1. SVN 基础命令。
2. OperationScope 范围安全。
3. 提交闭环。
4. Windows/macOS 统一。
5. Diff。
6. AI Provider。

## 3. 最小原型范围

最小原型包含：

```text
VS Code Extension
  commands
  svn command runner
  repository discovery
  status parser
  SCM provider
  OperationScope
  commit webview prototype
  generated-file policy
  diff command
  output channel
  ai provider prototype
```

最小命令：

```text
SVN: 检查环境
SVN: 刷新状态
SVN: 提交此文件夹
SVN: 打开差异
SVN: 显示输出
SVN: AI 测试连接
SVN: AI 筛选当前范围
```

## 4. 原型目录建议

技术验证可以直接在正式工程结构上开始，避免验证代码完全报废。

建议目录：

```text
src/
  extension.ts
  commands/
    registerCommands.ts
  svn/
    svnExecutableResolver.ts
    svnCommandRunner.ts
    svnRepositoryDiscovery.ts
    svnTypes.ts
    parsers/
      infoXmlParser.ts
      statusXmlParser.ts
  scope/
    operationScope.ts
    pathBoundaryGuard.ts
  scm/
    svnScmProvider.ts
    svnResourceState.ts
  commit/
    commitPlan.ts
    generatedFilePolicy.ts
    commitFlow.ts
  diff/
    diffProvider.ts
  ai/
    aiProvider.ts
    openAiCompatibleProvider.ts
    aiResultValidator.ts
  diagnostics/
    outputChannel.ts
    errorMapper.ts
  webviews/
    commitPrototype/
```

## 5. 技术验证环境

### 5.1 Windows

必须验证：

- Windows 10/11。
- VS Code。
- SVN CLI。
- 中文路径。
- 空格路径。

SVN 来源至少验证一种：

- PATH 中的 `svn.exe`。
- 用户手动配置 `svn.exe`。

建议额外验证：

- TortoiseSVN 安装但不依赖它。

### 5.2 macOS

必须验证：

- macOS。
- VS Code。
- SVN CLI。
- 空格路径。

SVN 来源至少验证一种：

- PATH 中的 `svn`。
- Homebrew 路径中的 `svn`。
- 用户手动配置 `svn`。

### 5.3 AI 环境

至少验证：

- OpenAI-compatible 自定义 Provider。
- 一个可访问模型。

建议验证：

- Ollama 本地模型。

注意：

- AI 验证不要求模型质量完美。
- 只验证配置、请求、响应、JSON 校验和隐私过滤链路。

## 6. 测试仓库准备

需要准备一个 SVN 测试仓库，包含以下文件和状态。

### 6.1 基础结构

```text
project/
  src/
    pages/
      order/
        OrderList.vue
        api.ts
        style.scss
        debug.log
        assets/
          icon.png
      user/
        UserList.vue
    common/
      request.ts
  config/
    app.json
    prod.yaml
  dist/
    app.js
  bin/
    Debug/
      app.exe
    deploy.sh
  obj/
    cache.bin
  docs/
    readme.md
```

### 6.2 状态样本

必须制造：

- Modified：修改 `OrderList.vue`。
- Added：新增 `style.scss`。
- Deleted：用 SVN 删除一个文件。
- Missing：直接删除一个已版本控制文件。
- Unversioned：新增 `debug.log`。
- Conflict：制造一个文本冲突。
- Binary：修改 `icon.png`。
- Generated：新增 `dist/app.js`、`bin/Debug/app.exe`、`obj/cache.bin`。

### 6.3 路径样本

Windows：

```text
C:\Users\测试用户\Documents\svn workbench test
```

macOS：

```text
/Users/test user/Documents/svn workbench test
```

## 7. 验证任务一：SVN 可执行文件检测

### 7.1 验证内容

- 从 PATH 查找 SVN。
- 从用户配置查找 SVN。
- 执行 `svn --version --quiet`。
- 失败时显示环境检测错误。

### 7.2 验证命令

```bash
svn --version --quiet
```

### 7.3 成功标准

- 能输出 SVN 版本。
- Output Channel 记录命令、cwd、耗时、退出码。
- Windows/macOS 行为一致。

### 7.4 失败标准

- 找不到 SVN 时崩溃。
- 手动配置路径无效但没有提示。
- 错误信息不可诊断。

## 8. 验证任务二：工作副本发现

### 8.1 验证内容

- 从当前 workspace folder 向上查找 `.svn`。
- 执行 `svn info --xml`。
- 解析工作副本根、仓库 URL、修订号。
- 非 SVN 工作区显示引导。

### 8.2 验证命令

```bash
svn info --xml <path>
```

### 8.3 成功标准

- 能识别 SVN 工作副本。
- 能识别非 SVN 工作区。
- 多根 workspace 不互相污染。

## 9. 验证任务三：状态扫描与 XML 解析

### 9.1 验证内容

- 执行 `svn status --xml <scope>`。
- 解析 M/A/D/!/C/?。
- 解析属性变化。
- 解析锁状态，能解析多少算多少。
- 解析失败可诊断。

### 9.2 验证命令

```bash
svn status --xml <path>
```

### 9.3 状态映射

| SVN XML | 内部状态 |
| --- | --- |
| modified | modified |
| added | added |
| deleted | deleted |
| missing | missing |
| unversioned | unversioned |
| conflicted | conflicted |
| ignored | ignored |
| external | external |
| obstructed | obstructed |

### 9.4 成功标准

- 测试仓库状态全部可识别。
- 文件路径保留相对路径。
- 中文路径、空格路径可解析。
- Output Channel 有原始命令记录。

## 10. 验证任务四：SCM Provider

### 10.1 验证内容

- 创建 VS Code SourceControl。
- 按状态分组。
- 每个资源行显示状态。
- 资源行支持打开 diff。
- 顶部支持刷新。

### 10.2 最小分组

```text
冲突
已修改
已新增
已删除
缺失
未版本控制
```

### 10.3 成功标准

- Source Control 面板能看到 SVN 变更。
- 点击刷新能重新扫描。
- 点击资源能打开文件或 diff。

## 11. 验证任务五：OperationScope

### 11.1 验证内容

- 右键文件创建文件 scope。
- 右键文件夹创建文件夹 scope。
- SCM 选择创建选中文件 scope。
- 多选创建并集 scope。
- 跨工作副本阻止。
- AI/模板/最终路径越界拦截。

### 11.2 关键用例

| 用例 | 预期 |
| --- | --- |
| 右键 `src/pages/order` | 只包含 `src/pages/order/**` |
| 模板匹配 `src/pages/user` | 忽略 |
| AI 推荐 `src/common/request.ts` | 当前 scope 外则忽略 |
| 全选可提交 | 不超过 scope |
| 最终 commit path | 全部在 scope 内 |

### 11.3 成功标准

- PathBoundaryGuard 能拦截范围外文件。
- Windows/macOS 同一套用例通过。
- 越界提示进入错误模型。

## 12. 验证任务六：生成物排除

### 12.1 验证内容

默认排除：

```text
node_modules/**
dist/**
build/**
target/**
bin/Debug/**
bin/Release/**
obj/**
__pycache__/**
*.log
*.tmp
```

不一刀切排除：

```text
bin/**
```

### 12.2 成功标准

- `dist/app.js` 默认排除。
- `bin/Debug/app.exe` 默认排除。
- `obj/cache.bin` 默认排除。
- `debug.log` 默认排除。
- `bin/deploy.sh` 标记为需要确认，不直接排除。

## 13. 验证任务七：提交页最小 Webview

### 13.1 验证内容

最小提交页包含：

- 范围 Banner。
- 文件列表。
- 选择框。
- 生成物排除标记。
- 提交说明输入框。
- 提交按钮。
- 提交前检查结果。

### 13.2 暂不验证

- 完整 UI 样式。
- 完整 AI 抽屉。
- 完整模板系统。
- 完整响应式布局。

### 13.3 成功标准

- 右键文件夹能打开提交页。
- 页面只显示 scope 内文件。
- 用户能勾选文件。
- 用户能填写中文提交说明。
- 点击提交能进入 Commit Flow。

## 14. 验证任务八：Commit Flow

### 14.1 验证内容

流程：

```text
selected files
  -> pre-check
  -> svn add unversioned
  -> svn remove missing
  -> write message temp file
  -> svn commit selected paths -F message
  -> refresh status
```

### 14.2 验证命令

```bash
svn add <paths>
svn remove <paths>
svn commit <paths> -F <message-file>
```

### 14.3 成功标准

- 未版本控制文件可 add。
- missing 文件可 remove。
- 中文提交说明可提交。
- 提交路径精确。
- 提交成功后显示修订号。
- 失败后显示错误状态。

## 15. 验证任务九：VS Code Diff

### 15.1 验证内容

- Working vs BASE。
- 新增文件预览。
- 删除文件预览。
- 二进制文件降级。

### 15.2 验证命令

```bash
svn cat -r BASE <path>
svn cat -r HEAD <path>
```

或：

```bash
svn diff <path>
```

### 15.3 成功标准

- 文本文件能打开 VS Code diff。
- 二进制文件不当文本打开。
- 中文路径文件可打开。

## 16. 验证任务十：AI Provider 原型

### 16.1 验证内容

- OpenAI-compatible 配置。
- Base URL / API Key / Model。
- 测试连接。
- 发送前确认。
- 隐私过滤。
- 结构化 JSON 返回。
- AI 输出路径校验。

### 16.2 最小请求

输入：

```json
{
  "scope": "src/pages/order",
  "files": [
    {
      "path": "src/pages/order/OrderList.vue",
      "status": "modified",
      "type": "frontend-source"
    },
    {
      "path": "src/pages/order/debug.log",
      "status": "unversioned",
      "type": "log"
    }
  ]
}
```

期望输出：

```json
{
  "recommended": [
    {
      "path": "src/pages/order/OrderList.vue",
      "reason": "当前模块源码变更"
    }
  ],
  "excluded": [
    {
      "path": "src/pages/order/debug.log",
      "reason": "日志文件"
    }
  ],
  "needsReview": [],
  "blocked": []
}
```

### 16.3 成功标准

- 能成功调用模型。
- 能解析 JSON。
- 能处理模型返回非 JSON。
- 能拦截范围外路径。
- AI 失败不影响提交基础功能。

## 17. 验证任务十一：错误模型与诊断

### 17.1 验证内容

- SVN 命令失败映射到 AppError。
- AI 失败映射到 AppError。
- OperationScope 越界映射到 AppError。
- Output Channel 记录诊断。
- 复制诊断脱敏。

### 17.2 成功标准

- 用户看到中文错误。
- Output 有原始诊断。
- API Key、密码、token 不出现在诊断复制内容中。

## 18. Windows/macOS 验证矩阵

| 验证项 | Windows | macOS |
| --- | --- | --- |
| SVN 检测 | 必测 | 必测 |
| 工作副本发现 | 必测 | 必测 |
| status XML | 必测 | 必测 |
| SCM Provider | 必测 | 必测 |
| 右键文件夹 scope | 必测 | 必测 |
| 生成物排除 | 必测 | 必测 |
| 提交中文说明 | 必测 | 必测 |
| VS Code diff | 必测 | 必测 |
| Output 诊断 | 必测 | 必测 |
| AI Provider | 必测 | 必测 |
| 空格路径 | 必测 | 必测 |
| 中文路径 | 必测 | 建议 |
| 外部工具 | 可选 | 可选 |

## 19. 技术验证执行顺序

建议顺序：

1. 初始化扩展工程。
2. Output Channel。
3. SVN Executable Resolver。
4. SVN Command Runner。
5. Repository Discovery。
6. status XML parser。
7. SCM Provider。
8. OperationScope。
9. Generated File Policy。
10. Commit Webview Prototype。
11. Commit Flow。
12. Diff Provider。
13. Error Mapper。
14. AI Provider Prototype。
15. 双平台验证。
16. 技术验证报告。

## 20. 技术验证产物

技术验证完成后应产出：

```text
VS Code 扩展原型
SVN 命令运行日志
Windows 验证记录
macOS 验证记录
OperationScope 测试记录
AI Provider 测试记录
技术验证报告
```

建议新增报告文档：

```text
2026-07-04-svn-workbench-technical-validation-report.md
```

## 21. 退出标准

技术验证阶段完成条件：

1. Windows/macOS 均能运行扩展原型。
2. Windows/macOS 均能检测 SVN。
3. Windows/macOS 均能解析 `svn status --xml`。
4. SCM Provider 能展示 SVN 状态。
5. 右键文件夹提交只显示当前范围文件。
6. OperationScope 能拦截越界路径。
7. 生成物默认排除逻辑正确。
8. commit -F 中文提交说明成功。
9. VS Code diff 可打开。
10. AI Provider 原型可调用、可校验、可失败降级。
11. 错误诊断可复制且脱敏。

## 22. 不通过处理

如果某项验证失败：

### 22.1 P0 失败

P0：

- SVN 无法检测。
- status 无法解析。
- OperationScope 越界。
- commit 路径不精确。
- Windows/macOS 主流程不一致。

处理：

```text
必须修复后才能进入开发阶段。
```

### 22.2 P1 失败

P1：

- 中文路径编码问题。
- AI Provider 不稳定。
- diff 部分边界失败。
- 错误诊断不完整。

处理：

```text
记录限制，决定是否修复后进入开发。
```

### 22.3 P2 失败

P2：

- 外部工具调用失败。
- Ollama 本地模型失败。
- 二进制预览不完善。

处理：

```text
可延后，不阻塞开发阶段。
```

## 23. 技术验证风险

| 风险 | 等级 | 对策 |
| --- | --- | --- |
| SVN 输出在不同版本差异大 | P0 | XML parser fixture |
| OperationScope 越界 | P0 | PathBoundaryGuard 单元测试 |
| Windows/macOS 路径差异 | P0 | 双平台测试 |
| 中文提交说明失败 | P1 | 使用 `-F` 临时文件 |
| AI JSON 不稳定 | P1 | schema 校验和重试 |
| Webview 原型过早复杂 | P2 | 只做最小交互 |

## 24. 下一步

技术验证计划完成后，可以开始真正创建扩展原型。

建议下一步：

```text
初始化 VS Code Extension TypeScript 项目
```

并新增开发记录文档：

```text
2026-07-04-svn-workbench-technical-validation-log.md
```

记录每个验证任务：

- 日期。
- 平台。
- 命令。
- 结果。
- 错误。
- 结论。

## 25. 当前决策

1. 技术验证阶段正式开始。
2. 技术验证只做最小原型，不做完整产品。
3. Windows/macOS 同标准验证。
4. OperationScope 和提交闭环是最高优先级。
5. AI Provider 先验证 OpenAI-compatible，不强行实现全部供应商。
6. 技术验证通过后再进入开发阶段。
