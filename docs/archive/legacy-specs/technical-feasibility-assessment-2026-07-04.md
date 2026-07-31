> **归档声明（2026-07-30）**：本文只保留 SVN CLI、VS Code API、认证、编码、性能和远程开发等可行性论证。原 `docs/workbuddy/v1-spec-converged.md` 已不存在，原权威声明失效。当前产品决策以 [`SVN工作台原型v3`](../../SVN工作台原型v3/) 为准，技术契约以 [`SVN实现参考基线`](../../implementation-reference/SVN实现参考基线.md) 为准。
> **本文在 v1 不落地的章节（已归后期）**：§4.1 SCM Provider、§4.2 Activity Bar 与 Tree View、§5.4 远端变更精确预览（v1 降为"更新建议"）、§7.2 内置三方合并面板、§13/§14 路线中 M2/M3/M4 高级能力。v1 仅 Explorer 右键命令 + webview（Svelte 重写）。

# SVN 工作台技术可行性评估

> 文档类型：技术方案评估  
> 编写日期：2026-07-04  
> 关联文档：`docs/product-spec.md`、`docs/page-function-spec-2026-07-04.md`、`docs/ai-filter-and-merge-panel-spec-2026-07-04.md`  
> 版本策略：新增文档，不修改旧版。

## 1. 总体结论

当前文档中的方案 **可以实现**，但要按阶段交付。

可直接落地的部分：

- VS Code SVN SCM Provider。
- Activity Bar / Tree View 工作台。
- 文件右键、文件夹右键、SCM 面板命令。
- 右键文件夹限定范围提交。
- 提交页文件筛选、模板筛选、生成物排除。
- SVN status/log/info/diff/update/commit/revert/add/remove/resolve/lock/unlock。
- Explorer 文件状态标记。
- SecretStorage 保存扩展侧敏感配置。
- Output Channel、Progress、QuickPick、设置项。
- AI 生成提交说明、AI 推荐筛选提交文件。
- 检测 TortoiseMerge 并外部打开。

需要谨慎分阶段实现的部分：

- TortoiseSVN/TortoiseMerge 级别的内置三方冲突合并面板。
- 智能更新的“精确预览”和“冲突预测”。
- 多工作副本、大仓库、externals、mixed revision 的完整处理。
- SVN 凭据完全安全地透传给命令行。
- AI 自动筛选更新内容。

建议结论：

- **MVP 能做，而且价值明确。**
- **第一版不要把 AI 和内置三方合并当核心路径。**
- **第一版核心应是：稳定 SVN 状态模型 + 提交页面 + 范围规则 + 过滤规则 + 基础 diff/update/commit。**
- **TortoiseMerge 风格面板先做“外部联动 + VS Code 双栏 diff”，再逐步做内置 Webview 合并器。**

## 2. 依据来源

本评估对照了以下能力：

- VS Code Source Control API 支持自定义 SCM Provider、资源分组、资源行命令和 SCM 输入框。
- VS Code Tree View API 支持 Activity Bar / Side Bar 树视图。
- VS Code Webview API 支持复杂自定义界面，但官方建议谨慎使用，因为资源更重。
- VS Code FileDecorationProvider 支持文件装饰徽标、颜色、tooltip。
- VS Code SecretStorage 支持加密存储扩展侧 secrets。
- SVN `status --xml`、`status -u`、`log -v`、`resolve --accept working` 等命令能支撑状态、日志、远端检查和冲突解决流程。

参考链接见文末。

## 3. 功能可行性矩阵

| 功能 | 可行性 | 难度 | 结论 |
| --- | --- | --- | --- |
| SVN 命令行封装 | 高 | 中 | 可作为基础架构 |
| 工作副本发现 | 高 | 低 | 向上查找 `.svn` + `svn info --xml` |
| SCM Provider | 高 | 中 | 官方 API 支持 |
| Activity Bar 工作台 | 高 | 中 | Tree View + Webview View |
| 文件状态装饰 | 高 | 中 | FileDecorationProvider 可做 badge/color |
| 右键文件提交 | 高 | 低 | 命令参数带当前 URI |
| 右键文件夹限定提交 | 高 | 中 | 需要严格维护 CommitContext |
| 提交页筛选 | 高 | 中 | 前端状态管理问题 |
| 模板预设过滤文件 | 高 | 中 | glob + 状态模型即可 |
| 生成物自动排除 | 高 | 低 | 规则优先，AI 补充 |
| AI 推荐提交文件 | 中高 | 中 | 可做，但默认需用户确认 |
| AI 自动提交 | 不建议 | 高风险 | 不做 |
| 智能更新推荐 | 中 | 高 | 可做近似，不承诺完全精确 |
| 远端冲突预测 | 中 | 高 | 可做风险提示，不做强保证 |
| 双栏 diff | 高 | 中 | VS Code diff + 虚拟文档 |
| 内置三方合并面板 | 中 | 高 | Webview 自研，放后期 |
| TortoiseMerge 外部调用 | 高 | 中 | Windows 路径检测 + 子进程 |
| 图片差异 | 中 | 中高 | 可做轻量版 |
| Office/PDF 差异 | 低 | 高 | 只做元信息和外部打开 |
| 认证管理 | 中 | 高 | SecretStorage 可存，但 CLI 传密有风险 |
| 多工作副本 | 高 | 中高 | 每个 repo 独立模型 |
| externals | 中 | 高 | 先识别和默认排除 |
| mixed revision 管理 | 中 | 高 | 可检测和提示，难以完全规避 |

## 4. VS Code 侧可行性

### 4.1 SCM Provider

可实现。

VS Code 官方 Source Control API 支持：

- 创建 SourceControl。
- 创建资源分组。
- 为每个资源提供状态、装饰和点击命令。
- SCM 标题区、资源组、资源行上下文菜单。
- 多选资源行命令。
- SCM 输入框。

这足够实现：

- `修改`、`新增`、`删除`、`缺失`、`冲突`、`未版本控制` 分组。
- 每个 SVN 工作副本一个 SCM Provider。
- 行内 `Diff`、`Revert`、`Add`、`Commit selected`。
- SCM 顶部 `Refresh`、`Update`、`Commit`、`Log`。

注意：

- VS Code SCM API 没有 Git staging 那种内建语义，SVN 提交选择需要我们自己维护。
- SVN 没有 Git index，提交篮是产品层模型，不是 SVN 原生模型。
- SCM 输入框可以做轻量提交，但复杂提交页仍建议用 Webview。

### 4.2 Activity Bar 与 Tree View

可实现。

Tree View API 可以支持：

- SVN 工作台视图。
- 变更树。
- 冲突列表。
- 锁列表。
- 历史简表。

适合做轻量、原生、性能好的列表。

不适合做：

- 复杂提交页。
- 三栏合并器。
- 高级筛选面板。

这些更适合 Webview 或独立编辑器面板。

### 4.3 Webview 页面

可实现，但要克制。

适合用 Webview 的页面：

- 提交页。
- 模板管理。
- 认证管理。
- 冲突中心。
- AI 筛选结果。
- 图片差异。

技术注意：

- Webview 资源更重，不能所有小功能都 Webview。
- Webview 不能直接访问任意本地文件，需要通过 `asWebviewUri` 和 `localResourceRoots`。
- Webview 脚本默认关闭，开启脚本后必须做 CSP。
- Webview 需要和扩展进程通过 message passing 通信。
- Webview 要适配 VS Code theme CSS 变量。

建议：

- 第一版提交页可以用 Webview。
- 变更树和状态页优先用 Tree View。
- 三方合并面板后期再做 Webview，别让它拖慢 MVP。

### 4.4 Explorer 文件状态装饰

可实现。

FileDecorationProvider 支持：

- badge。
- tooltip。
- color。
- 向父级传播。

可以做：

- `M` 修改。
- `A` 新增。
- `D` 删除。
- `!` 缺失。
- `C` 冲突。
- `?` 未版本控制。
- `L` 锁定。

限制：

- 这是 VS Code Explorer 内的装饰，不是 Windows 资源管理器 overlay。
- badge 很短，不能放复杂状态。
- 多状态同文件要定义优先级，如冲突优先于修改。

### 4.5 右键菜单与操作范围

可实现。

Explorer context menu 能把当前资源 URI 传给命令。多选时也可以接收选中资源数组。

关键在内部模型：

```ts
interface OperationScope {
  repositoryId: string;
  source: 'file' | 'folder' | 'workspace' | 'scmSelection';
  roots: vscode.Uri[];
  allowExpandScope: false;
}
```

右键文件夹提交的实现要点：

- 根据 URI 找到所属 SVN 工作副本。
- 用该文件夹作为 status 路径。
- status 结果再次做路径边界校验。
- UI 所有筛选、模板、AI 推荐都只作用于这个 scope。
- `全选` 只选 scope 内文件。

这是可实现的，而且必须作为第一批核心能力。

## 5. SVN 命令侧可行性

### 5.1 状态扫描

可实现。

推荐命令：

```bash
svn status --xml <path>
svn status --xml -u <path>
```

`svn status` 能表达：

- added。
- deleted。
- modified。
- conflicted。
- external。
- ignored。
- unversioned。
- missing。
- obstructed。
- lock 信息。
- tree conflict。
- out-of-date 标记。

结论：

- 本地状态扫描可靠。
- 远端 out-of-date 检查可用，但不是完整更新预览。

### 5.2 提交

可实现。

推荐流程：

```bash
svn add <unversioned-paths>
svn remove <missing-paths>
svn commit <selected-paths> -F <temp-message-file>
```

建议使用 `-F` 临时文件传提交信息，而不是 `-m`，原因：

- 避免命令行转义问题。
- 避免中文、多行、特殊字符问题。
- 降低日志信息出现在进程命令行中的概率。

注意：

- 提交前必须把 `?` 文件转为 `svn add`。
- 缺失文件要走 `svn remove` 或提示恢复。
- 选择性提交路径要处理父目录属性变更。
- SVN 提交目录路径时可能包含目录下所有已版本变更，所以建议最终提交路径使用精确文件列表。

### 5.3 更新

可实现，但智能更新要谨慎。

基础更新：

```bash
svn update <path>
svn update <file>
svn update <folder>
```

选择性更新可行。

风险：

- 选择性更新会导致 mixed revision。
- 更新目录可能带入子目录变更。
- 远端删除、本地修改、未版本控制同名文件会产生复杂冲突。
- externals 更新规则需要单独控制。

建议：

- 第一版提供普通更新和右键范围更新。
- 智能更新只做推荐路径和风险提示。
- 不承诺“完全无冲突预测”。

### 5.4 远端变更预览

部分可实现。

可用命令：

```bash
svn status -u --xml <path>
svn log --xml -v <url-or-path>
svn diff --summarize -r BASE:HEAD <path>
```

能力边界：

- `status -u` 能告诉某些路径 out-of-date，但不会给出完整 diff 内容。
- `log -v` 能列出修订的 changed paths，但要把 URL path 映射回本地路径。
- `diff --summarize` 对某些仓库和 mixed revision 场景要谨慎验证。

结论：

- 可做“远端有更新”和“更新风险提示”。
- 可做“远端提交列表”。
- “像 Git pull preview 一样精确展示所有将变文件”需要大量边界测试，放后期。

### 5.5 差异

可实现。

普通文本 diff：

```bash
svn diff <path>
svn cat -r BASE <path>
svn cat -r HEAD <path>
svn cat -r <rev> <url-or-path>
```

实现方式：

- 把 BASE/HEAD/REV 内容作为虚拟文档。
- 调用 VS Code `vscode.diff` 打开左右对比。
- 新增/删除文件做特殊处理。

限制：

- 二进制文件不能直接文本 diff。
- 大文件需要限制。
- 编码需要检测。

### 5.6 冲突解决

可实现基础流程。

SVN 冲突解决核心是：

```bash
svn resolve --accept working <path>
```

但重要边界：

- `svn resolve` 本身不理解语义，只是告诉 SVN 冲突已解决。
- 如果文件里还留着 `<<<<<<<`、`=======`、`>>>>>>>`，SVN 仍可能允许标记 resolved。
- 因此插件必须在 `resolve --accept working` 前检查冲突标记。

内置冲突流程可行：

1. 识别冲突文件。
2. 找到 `.mine`、`.rOLD`、`.rNEW` 等辅助文件。
3. 打开 mine/base/theirs/result。
4. 用户手动保存 result。
5. 检查冲突标记。
6. 执行 `svn resolve --accept working`。

高阶三方合并器难点：

- diff3 算法。
- 大文件性能。
- 行内高亮。
- 同步滚动。
- 语法高亮。
- undo/redo。
- 与 VS Code 编辑器体验一致。

建议：

- M1：检测冲突 + 外部 TortoiseMerge + VS Code diff 辅助。
- M2：冲突中心 + 结果文件检查 + resolve。
- M3：内置三方 Webview 合并器。

### 5.7 锁管理

可实现。

命令：

```bash
svn lock <path>
svn unlock <path>
svn info --xml <path>
svn status -u --xml <path>
```

注意：

- 他人锁信息通常需要访问远端。
- 强制解锁要清晰确认。
- `svn:needs-lock` 属性需要读取属性。

### 5.8 忽略规则

可实现。

SVN 忽略规则不是 `.gitignore`，而是目录属性：

```bash
svn propget svn:ignore <dir>
svn propset svn:ignore <value> <dir>
svn propedit svn:ignore <dir>
```

实现注意：

- 忽略规则按目录生效。
- 已经版本控制的文件不会因为加入 ignore 自动消失。
- 从版本库移除但保留本地需要 `svn remove --keep-local`，这是高风险操作，必须二次确认。

## 6. AI 能力可行性

### 6.1 AI 提交筛选

可实现，建议做。

最佳架构：

```text
确定性规则 -> 本地风险分类 -> AI 解释/补充 -> 用户确认
```

确定性规则先解决 80%：

- `dist/**`
- `build/**`
- `target/**`
- `bin/Debug/**`
- `bin/Release/**`
- `obj/**`
- `node_modules/**`
- `*.log`
- `*.tmp`
- `.env`

AI 适合做：

- 解释为什么排除。
- 根据工单号/提交摘要判断相关文件。
- 发现可疑文件。
- 生成提交说明。
- 生成 ignore 草案。

AI 不适合做：

- 自动提交。
- 自动删除。
- 自动 resolved。
- 自动强制解锁。

### 6.2 AI 更新筛选

可实现基础版，但风险比提交筛选高。

原因：

- 提交筛选只是在本地候选文件里选择。
- 更新会改变工作副本内容。
- SVN 远端预览不是完整事务模拟。
- 选择性更新会造成 mixed revision。

建议：

- 第一版不叫“AI 自动更新”，叫“智能更新建议”。
- AI 只输出更新计划。
- 用户必须点 `更新推荐项`。
- 更新前列出风险和 mixed revision 提示。

### 6.3 AI 接入方式

两条路线都可行：

1. VS Code Language Model API  
   优点：与 VS Code 生态一致。  
   缺点：依赖用户 VS Code/Copilot/模型可用性，企业环境可能禁用。

2. OpenAI-compatible Provider  
   优点：适合企业内网模型、私有网关、国产模型兼容接口。  
   缺点：需要自己做密钥、代理、隐私提示和错误处理。

建议：

- 抽象 `AiProvider` 接口。
- 默认关闭 AI。
- 支持 `disabled`、`vscode-lm`、`openai-compatible`。
- 第一版 AI 不作为主流程依赖。

## 7. TortoiseSVN 风格对比面板可行性

### 7.1 双栏 diff

可实现，建议第一版做。

方案：

- 用 `svn cat` 拿 BASE/HEAD/REV 内容。
- 用虚拟文档提供只读版本。
- 调用 VS Code 内置 diff。

优点：

- 开发快。
- 性能和编辑器体验由 VS Code 负责。
- 主题、语法高亮、滚动、搜索都天然可用。

不足：

- 不像 TortoiseMerge 那样提供底部行内细节。
- 不能直接做复杂冲突块按钮。

### 7.2 内置三方合并面板

可实现，但不建议放 MVP。

实现方式：

- Webview + CodeMirror 6 或 Monaco Editor。
- 后端扩展进程负责读取 mine/base/theirs/result。
- 前端负责三栏展示、冲突块导航、按钮操作。
- 保存时把 result 写回工作副本文件。
- 再调用 `svn resolve --accept working`。

难点：

- Webview 内不直接复用 VS Code 原生编辑器实例。
- 三栏同步滚动和 diff3 高亮工作量大。
- 大文件性能和内存要控制。
- 语法高亮要按文件类型加载。
- undo/redo、保存状态、脏状态提示都要自己做。

结论：

- 技术上能做。
- 体验要做到 TortoiseMerge 级别，成本较高。
- 应作为第二或第三阶段核心特色开发。

### 7.3 TortoiseMerge 外部联动

可实现，建议第一版就做。

Windows 检测：

- 常见安装路径。
- 注册表。
- 用户手动配置 `TortoiseMerge.exe`。

能力：

- 打开普通 diff。
- 打开冲突文件。
- 外部工具关闭后刷新状态。

限制：

- 只适合 Windows 本地工作区。
- Remote SSH / WSL / Dev Container 场景下，Windows 外部工具通常无法直接访问远端路径。
- 需要允许用户关闭该功能。

## 8. 凭据与认证风险

这是方案里最需要提前设计的一块。

### 8.1 SecretStorage 可用，但不是完整答案

VS Code SecretStorage 可以加密保存扩展自己的 secrets。

但 SVN CLI 认证有额外问题：

- 如果用 `svn --username xxx --password yyy`，密码可能出现在进程参数里。
- 如果依赖 SVN 自己的 auth cache，插件不完全控制认证状态。
- 企业内网、自签证书、多账号仓库会让认证流程复杂。

建议策略：

1. 第一优先：让 SVN CLI 使用它自己的认证缓存。
2. 插件 SecretStorage 保存账号映射、可选密码、token 或用户配置。
3. 只有用户明确选择“由插件管理凭据”时，才保存密码。
4. 命令执行输出必须脱敏。
5. 文档里明确说明 CLI 参数传密的安全边界。

### 8.2 非交互执行

所有后台命令建议：

```bash
svn ... --non-interactive
```

证书问题：

- 不默认静默信任证书。
- 提供明确弹窗让用户选择信任策略。
- 企业环境可配置。

## 9. 编码与中文路径

可实现，但需要专项测试。

风险：

- Windows 控制台编码。
- SVN 输出本地化。
- 中文路径。
- GBK/GB18030 文件内容。
- XML 输出中的路径编码。

建议：

- 状态、日志、info 优先使用 XML。
- 子进程 stdout/stderr 按 Buffer 接收，再通过编码服务解码。
- 支持 `auto / utf8 / gb18030 / gbk / big5`。
- 提交信息用 UTF-8 临时文件，并验证 SVN 客户端接受情况。
- 测试路径包含中文用户名、中文目录、空格、特殊符号。

## 10. 性能可行性

总体可控。

潜在问题：

- 大仓库 `svn status` 慢。
- `status -u` 访问远端，可能很慢。
- externals 多时扫描膨胀。
- Webview 提交页一次渲染大量文件会卡。
- AI 分析大量 diff 成本高。

建议：

- status debounce。
- 写操作同工作副本串行，读操作有限并发。
- 右键文件夹提交只扫描范围目录。
- 大列表虚拟滚动。
- diff 懒加载。
- AI 只分析已勾选或当前筛选文件。
- `status -u` 不自动频繁执行，只按配置间隔或用户触发。

## 11. Remote / WSL / Dev Container 支持

文档当前默认 Windows 本地开发，这没问题，但要提前设边界。

可实现策略：

- 本地工作区：完整支持 SVN CLI + TortoiseMerge。
- WSL/Remote SSH/Dev Container：SVN CLI 必须安装在远端扩展宿主环境。
- 外部 TortoiseMerge：默认不可用于远端路径，除非做路径映射。
- SecretStorage 在远端/本地行为要测试。

建议：

- MVP 声明目标为 Windows 本地 VS Code。
- 后续再扩展 WSL/Remote。
- 检测 remote 环境时隐藏或降级 TortoiseMerge 联动。

## 12. 技术架构建议调整

建议把架构分成 7 层。

```text
VS Code UI Layer
  SCM Provider / Tree View / Webview / Commands / Decorations

Application Layer
  Commit Flow / Update Flow / Conflict Flow / Lock Flow

Domain Model
  Repository / WorkingCopyItem / OperationScope / CommitSelection

SVN Adapter
  Command Builder / Process Runner / XML Parsers / Error Mapper

Policy Engine
  Ignore Rules / Generated File Rules / Template Rules / AI Recommendations

Storage Layer
  Workspace State / Global State / SecretStorage / Temp Files

Integration Layer
  AI Providers / TortoiseMerge / External Diff Tools
```

关键原则：

- UI 不直接拼 SVN 命令。
- 所有路径先进入 OperationScope。
- 所有写操作都经过 Application Flow。
- 所有 SVN 输出都经过 Parser/ErrorMapper。
- AI 永远输出建议结构，不直接调用 SVN 写操作。

## 13. 推荐实现路线

### M0：技术验证

目标：证明最核心链路能跑通。

任务：

1. 初始化 VS Code TypeScript 扩展。
2. 检测 `svn --version`。
3. 对一个工作副本执行 `svn info --xml`。
4. 对文件夹执行 `svn status --xml`。
5. 解析 M/A/D/!/C/?。
6. 创建 SCM Provider 展示状态。
7. 用 `vscode.diff` 打开一个文件与 BASE 的对比。

验收：

- 中文路径下可运行。
- Output Channel 有命令日志。
- status XML 解析测试通过。

### M1：可用 MVP

目标：日常提交可用。

任务：

1. 右键文件/文件夹提交。
2. OperationScope 强约束。
3. 提交页基础 Webview。
4. 文件状态筛选。
5. 文件类型/后缀筛选。
6. 生成物默认排除。
7. `?` 文件 add。
8. `!` 文件 remove/revert 选择。
9. commit -F 临时消息文件。
10. 提交成功后刷新状态。

验收：

- 右键文件夹提交不会带入范围外文件。
- `dist`、`bin/Debug`、`obj` 默认不勾选。
- 冲突文件阻止提交。

### M2：增强 SVN 工作台

目标：替代大部分 TortoiseSVN 日常操作。

任务：

1. Activity Bar 工作台。
2. Explorer decorations。
3. 日志页面。
4. 锁管理。
5. 忽略规则管理。
6. 认证管理。
7. 远端检查。
8. TortoiseMerge 外部联动。

### M3：智能与冲突

目标：形成产品特色。

任务：

1. AI 提交信息。
2. AI 提交筛选建议。
3. 智能更新建议。
4. 冲突中心。
5. 结果文件冲突标记检查。
6. 内置三方合并器原型。

### M4：高级 SVN

目标：覆盖复杂团队流程。

任务：

1. 分支/标签 switch。
2. Repo Browser。
3. Merge 向导。
4. Revision Graph 简版。
5. 项目策略文件。

## 14. 需要修正或补充到后续规格的点

后续文档建议补充以下约束：

1. **提交路径要尽量传文件列表，不传大目录。**  
   这样更符合用户勾选结果，避免目录下其他变更被 SVN 一起提交。

2. **`bin` 不能一刀切排除。**  
   只默认排除 `bin/Debug`、`bin/Release`、`.NET obj` 等明确生成物。

3. **智能更新不能叫自动更新。**  
   改成“智能更新建议”，用户确认后再执行。

4. **内置三方合并器不是 MVP。**  
   第一阶段用 VS Code diff + TortoiseMerge 外部联动。

5. **认证方案要写安全边界。**  
   SecretStorage 只能解决插件存储问题，不能完全解决 SVN CLI 参数传递风险。

6. **远端预览要写成近似能力。**  
   `status -u` 和 `log -v` 能提示风险，但不是完整更新事务模拟。

7. **Remote 场景先降级。**  
   Windows 本地优先，远程环境后续支持。

## 15. 最大技术风险排序

| 优先级 | 风险 | 影响 | 对策 |
| --- | --- | --- | --- |
| P0 | SVN 状态解析不稳定 | 全部功能受影响 | XML fixtures + 多版本 SVN 测试 |
| P0 | 操作范围错误 | 误提交 | OperationScope 强约束 + 自动测试 |
| P0 | 提交路径选择错误 | 误提交/漏提交 | 提交前展示最终路径 |
| P1 | 凭据处理不安全 | 安全风险 | 默认依赖 SVN auth cache，脱敏，明确提示 |
| P1 | 中文编码乱码 | 国内用户体验差 | 编码服务 + 中文路径测试 |
| P1 | 大仓库性能 | 卡顿 | debounce + 虚拟列表 + 懒加载 |
| P2 | 智能更新预测不准 | 用户误解 | 文案降级为“建议/风险提示” |
| P2 | 内置合并器复杂 | 研发周期长 | 外部 TortoiseMerge 先兜底 |
| P2 | Remote 支持复杂 | 兼容性 | 本地优先，远端降级 |

## 16. 最终判断

技术可行，推荐开发。

但交付策略要务实：

- 第一阶段先把 SVN 基础能力做稳。
- 提交页做深，这是最有差异化和日常价值的部分。
- AI 先做推荐，不做自动写操作。
- 冲突面板先接 TortoiseMerge，再逐步内置。
- 智能更新先做风险提示和范围更新，不做“绝对准确预览”承诺。

最合适的 MVP 定义：

```text
一个能在 Windows 中文路径下稳定识别 SVN 工作副本、
在 VS Code SCM 中展示状态、
右键文件夹只提交该文件夹范围、
提交页能筛选文件类型和排除生成物、
能完成更新/提交/diff/revert/log 的 SVN 扩展。
```

这个 MVP 是可实现且有明显使用价值的。

## 17. 参考资料

- VS Code Source Control API：<https://code.visualstudio.com/api/extension-guides/scm-provider>
- VS Code Tree View API：<https://code.visualstudio.com/api/extension-guides/tree-view>
- VS Code Webview API：<https://code.visualstudio.com/api/extension-guides/webview>
- VS Code Common Capabilities / SecretStorage：<https://code.visualstudio.com/api/extension-capabilities/common-capabilities>
- VS Code FileDecorationProvider API：<https://code.visualstudio.com/api/references/vscode-api>
- VS Code Language Model API：<https://code.visualstudio.com/api/extension-guides/ai/language-model>
- SVN status reference：<https://svnbook.red-bean.com/en/1.8/svn.ref.svn.c.status.html>
- SVN log reference：<https://svnbook.red-bean.com/en/1.7/svn.ref.svn.c.log.html>
- SVN resolve reference：<https://svnbook.red-bean.com/en/1.6/svn.ref.svn.c.resolve.html>
- SVN basic work cycle / conflict resolution：<https://www.visualsvn.com/support/svnbook/tour/cycle/>
