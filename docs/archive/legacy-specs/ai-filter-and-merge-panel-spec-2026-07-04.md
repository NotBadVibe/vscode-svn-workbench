> **归档声明（2026-07-30）**：本文只保留 AI 边界、筛选规则和冲突领域逻辑。原 `docs/workbuddy/v1-spec-converged.md` 已不存在，原权威声明失效；自建 Diff/三方合并页面不再是当前方案。当前产品决策以 [`SVN工作台原型v3`](../../SVN工作台原型v3/) 为准，技术契约以 [`SVN实现参考基线`](../../implementation-reference/SVN实现参考基线.md) 为准。
> **本文在 v1 不落地的章节（已归后期）**：§4 中"更新预览/远端变更精确预览"降为"更新建议"（近似，非精确）、§5.3 三栏+结果布局（默认改"左右+结果"）、§5.7 后三方合并器相关、§7 中 `merge.*`/`generatedFiles.*`/`update.smartUpdate.*`（smartUpdate 改名"更新建议"，其余后期）。**已解决矛盾**：AI 自动勾选 → 仅"建议勾选，用户确认生效"。

# AI 智能筛选与 TortoiseSVN 风格对比面板规格

> 文档类型：功能专项规格  
> 编写日期：2026-07-04  
> 关联文档：`docs/product-spec.md`、`docs/page-function-spec-2026-07-04.md`  
> 版本策略：新增文档，不修改旧版。

## 1. 结论

可以做两类智能能力：

1. **AI 自动筛选提交内容**  
   根据当前操作范围、文件类型、路径、SVN 状态、提交模板、历史提交习惯和项目规则，自动推荐哪些文件应该提交、哪些文件应该排除、哪些文件需要确认。

2. **AI 辅助筛选更新内容**  
   通过远端变更预览，推荐更新当前任务相关目录，提醒潜在冲突和高风险文件。SVN 支持按文件/目录更新，所以可以做“选择性更新”，但要明确提示这会造成 mixed revision 工作副本。

冲突和差异面板可以做成接近 TortoiseSVN/TortoiseMerge 的体验：

- 普通差异：左右双栏对比。
- 冲突解决：三栏或四栏视图，展示 `我的版本`、`远端版本`、`基准版本`、`合并结果`。
- 支持行内变化高亮、冲突块导航、选择使用本地/远端/两边都保留、手动编辑、标记已解决。
- 检测到 TortoiseSVN/TortoiseMerge 时，可提供 `用 TortoiseMerge 打开` 作为可选入口。

## 2. AI 的边界

AI 负责建议，不直接做不可逆操作。

| 行为 | AI 是否可自动执行 | 规则 |
| --- | --- | --- |
| 给文件分类 | 可以 | 本地计算优先，AI 补充解释 |
| 推荐勾选提交文件 | 可以 | 必须展示推荐结果 |
| 自动勾选低风险文件 | 可配置 | 默认关闭，需用户开启 |
| 排除 `bin/obj/dist` 等生成物 | 可以 | 默认规则先执行，AI 只解释和补充 |
| 生成忽略规则 | 可以 | 只生成草案，用户确认后应用 |
| 自动提交 | 不可以 | 必须用户点击提交 |
| 自动更新整个工作区 | 不可以 | 必须用户确认范围 |
| 自动解决冲突 | 不可以 | 只能给建议，用户确认每个冲突块 |
| 自动删除本地文件 | 不可以 | 必须二次确认 |

默认设计：

- AI 可以自动给出 `推荐提交`、`建议排除`、`需要确认` 三类。
- 默认不自动改变勾选状态。
- 用户可点击 `应用 AI 推荐`，再由页面批量勾选/取消。
- 企业设置可完全禁用 AI。

## 3. 提交内容智能筛选

### 3.1 文件分层

提交页文件先经过确定性规则，再进入 AI 判断。

```text
操作范围
  -> SVN status
  -> 安全排除规则
  -> 项目过滤规则
  -> 模板过滤规则
  -> AI 推荐分类
  -> 用户确认
```

AI 不突破操作范围。

示例：

用户右键 `src/order` 提交，AI 只能分析 `src/order` 内的候选文件，不能把 `src/user` 或项目根的改动加入推荐。

### 3.2 推荐分类

AI 输出四类：

| 分类 | 含义 | 默认操作 |
| --- | --- | --- |
| 推荐提交 | 与本次模板/工单/目录相关，风险低 | 可一键勾选 |
| 建议排除 | 明显是生成物、缓存、日志、临时文件 | 默认不勾选 |
| 需要确认 | 大文件、二进制、敏感、路径异常、锁相关 | 用户逐个确认 |
| 阻止提交 | 冲突、他人锁定、认证/状态异常 | 不允许提交 |

### 3.3 默认排除生成物规则

默认建议排除：

| 类型 | 路径/后缀 |
| --- | --- |
| Node 依赖 | `node_modules/**` |
| 前端构建 | `dist/**`、`build/**`、`.next/**`、`.nuxt/**`、`.vite/**`、`coverage/**` |
| Java 构建 | `target/**`、`*.class` |
| .NET 构建 | `bin/Debug/**`、`bin/Release/**`、`obj/**`、`*.dll`、`*.pdb`、`*.exe` |
| Python 缓存 | `__pycache__/**`、`*.pyc`、`.pytest_cache/**` |
| IDE 文件 | `.vs/**`、`.idea/workspace.xml`、`.vscode/*.log` |
| 日志临时 | `logs/**`、`*.log`、`*.tmp`、`*.bak`、`*.swp` |
| 压缩包 | `*.zip`、`*.rar`、`*.7z`、`*.tar`、`*.gz` |
| Unity/游戏常见生成 | `Library/**`、`Temp/**`、`Obj/**`、`Build/**` |

注意：

- 不粗暴排除所有名为 `bin` 的目录，因为有些项目会把脚本或工具源文件放在 `bin`。
- 默认强排除的是典型构建目录，如 `bin/Debug`、`bin/Release`、`obj`。
- 如果 `bin` 目录下是 `.sh`、`.ps1`、`.bat`、无扩展脚本或项目明确版本控制的工具文件，则归类为 `需要确认`，不直接排除。

### 3.4 AI 判断输入

AI 可读取：

- 文件路径。
- SVN 状态。
- 文件后缀。
- 文件大小。
- 是否二进制。
- 是否锁定。
- 是否在 externals 中。
- 当前提交模板。
- 用户填写的工单号/摘要。
- 最近 N 次提交的路径模式。
- 用户允许时读取 diff 摘要。

默认不读取：

- 密码、token、证书。
- `.env` 内容。
- 用户未勾选且未授权分析的文件内容。
- 大型二进制内容。

### 3.5 AI 输出格式

内部建议结构：

```ts
interface AiCommitSelectionResult {
  recommended: AiFileDecision[];
  excluded: AiFileDecision[];
  needsReview: AiFileDecision[];
  blocked: AiFileDecision[];
  suggestedIgnoreRules: SuggestedIgnoreRule[];
  summary: string;
}

interface AiFileDecision {
  path: string;
  decision: 'include' | 'exclude' | 'review' | 'block';
  confidence: number;
  reason: string;
  matchedRules: string[];
}
```

### 3.6 提交页 UI

顶部新增 `AI 筛选` 按钮。

点击后出现结果面板：

```text
AI 已分析当前范围 38 个文件

推荐提交：12 个
建议排除：19 个
需要确认：6 个
阻止提交：1 个
```

操作按钮：

- `应用推荐选择`
- `仅显示推荐提交`
- `查看建议排除`
- `生成忽略规则草案`
- `重新分析`
- `关闭 AI 建议`

文件行展示：

- 推荐图标。
- 排除图标。
- 风险图标。
- 推荐原因 tooltip。

### 3.7 生成忽略规则

当 AI 发现大量生成物：

```text
检测到 42 个 dist/ 构建文件、18 个 *.log 日志文件，建议加入 svn:ignore。
```

用户可选：

- `查看规则草案`
- `应用到当前目录 svn:ignore`
- `只在本次提交排除`
- `不再提醒此规则`

AI 只能生成草案，真正写入 `svn:ignore` 必须用户确认。

### 3.8 与模板预设联动

模板可以声明 AI 筛选偏好：

```json
{
  "name": "前端页面",
  "aiSelection": {
    "prefer": ["src/**/*.vue", "src/**/*.ts", "src/**/*.scss"],
    "exclude": ["dist/**", "node_modules/**", "*.map"],
    "review": ["public/**", "package-lock.json"]
  }
}
```

交互：

- 选择模板后，页面先按模板筛选。
- 点击 `AI 筛选` 后，AI 在模板结果基础上判断。
- AI 不改变模板的操作范围。

### 3.9 典型场景

场景：用户右键 `src/modules/order` 提交。

候选文件：

```text
src/modules/order/OrderList.vue
src/modules/order/api.ts
src/modules/order/style.scss
src/modules/order/debug.log
src/modules/order/dist/order.bundle.js
src/modules/order/assets/icon.png
```

AI 输出：

| 文件 | 分类 | 原因 |
| --- | --- | --- |
| `OrderList.vue` | 推荐提交 | 当前模块源码 |
| `api.ts` | 推荐提交 | 当前模块接口调用 |
| `style.scss` | 推荐提交 | 当前模块样式 |
| `debug.log` | 建议排除 | 日志文件 |
| `dist/order.bundle.js` | 建议排除 | 构建产物 |
| `assets/icon.png` | 需要确认 | 图片资源，无法文本 diff |

## 4. 更新内容智能筛选

### 4.1 SVN 更新的现实边界

SVN 可以按文件或目录执行 update：

```text
svn update path/to/file
svn update path/to/folder
```

因此可以做选择性更新。需要同时提示：

- 选择性更新会让工作副本出现 mixed revision。
- 不建议长期只更新部分文件。
- 提交前仍建议检查远端和本地状态。

### 4.2 更新预览

更新前先做远端预览：

- `svn status -u --xml`：查看本地与远端状态。
- `svn log --xml -v`：读取远端提交和变更路径。
- `svn diff --summarize`：在可行时获取远端路径摘要。

页面展示：

- 远端新增。
- 远端修改。
- 远端删除。
- 可能冲突。
- 与当前本地修改重叠的文件。

### 4.3 AI 更新推荐分类

| 分类 | 含义 | 默认操作 |
| --- | --- | --- |
| 建议更新 | 与当前任务目录相关，冲突风险低 | 可一键勾选 |
| 可稍后更新 | 与当前工作无关，风险低 | 不默认勾选 |
| 风险更新 | 与本地修改重叠、二进制、锁相关 | 用户确认 |
| 阻止更新 | 当前有未解决冲突或状态异常 | 先处理异常 |

### 4.4 更新范围入口

| 入口 | AI 更新范围 |
| --- | --- |
| 右键文件更新 | 只分析该文件远端变化 |
| 右键文件夹更新 | 只分析该文件夹远端变化 |
| 提交页 `更新并继续` | 优先分析当前提交范围相关远端变化 |
| 工作台 `智能更新` | 分析整个工作副本 |

### 4.5 更新页 UI

新增 `智能更新` 模式：

```text
远端有 16 个变更

建议立即更新：6 个
可稍后更新：7 个
风险更新：3 个
```

筛选：

- 仅当前目录。
- 仅与本地修改重叠。
- 仅可能冲突。
- 排除生成物。
- 排除二进制。
- 按提交人筛选。
- 按提交信息关键字筛选。

操作：

- `更新推荐项`
- `更新当前目录`
- `更新全部`
- `查看远端提交`
- `复制更新计划`

### 4.6 生成物在更新中的处理

如果远端提交了 `dist`、`bin/Debug`、`target` 等生成物：

- 如果用户执行 `更新全部`，SVN 会更新这些版本控制文件。
- 如果用户执行 `智能更新推荐项`，默认不勾选这些生成物。
- 页面提示：`远端包含生成物变更，建议确认团队是否需要继续版本控制这些文件。`

可提供后续建议：

- `本次跳过`
- `查看是谁提交的`
- `生成清理建议`
- `生成 svn:ignore 草案`
- `生成从版本库移除但保留本地的操作说明`

注意：

- 已经被 SVN 版本控制的生成物，加入 `svn:ignore` 不能直接让它消失。
- 若团队决定不再版本控制，需要执行 `svn remove --keep-local` 并提交，这必须走明确确认流程。

### 4.7 更新前冲突预测

预测依据：

- 本地 modified 文件。
- 远端同路径 modified/delete。
- 本地未版本控制文件与远端新增同名。
- 本地锁/他人锁。
- 二进制文件同路径修改。

结果展示：

```text
可能冲突：3 个文件
```

每个文件说明：

- 本地状态。
- 远端状态。
- 冲突原因。
- 推荐操作：先提交、先还原、跳过、备份后更新。

## 5. TortoiseSVN 风格差异与冲突面板

### 5.1 参考点

TortoiseSVN 的强项：

- 从文件/文件夹上下文进入操作。
- 提交对话框强，能围绕文件列表和日志消息完成一次提交。
- TortoiseMerge 提供双栏文件比较，修改行和行内变化高亮。
- 冲突解决时能同时看到自己的文件、他人修改和原始版本。
- 对图片差异有 TortoiseIDiff 这类专门工具。

VS Code 插件可以吸收这些体验，但实现方式用 VS Code 原生编辑器、Webview 和可选外部工具结合。

### 5.2 普通差异面板

布局：

```text
┌──────────────────────────────────────────────┐
│ 文件路径 | 比较模式 | 上一个 | 下一个 | 操作 │
├──────────────────────┬───────────────────────┤
│ 旧版本 BASE/HEAD      │ 当前工作副本             │
│ 行号 + 代码           │ 行号 + 代码              │
│ 删除红色              │ 新增绿色                 │
│ 行内变化高亮          │ 行内变化高亮             │
└──────────────────────┴───────────────────────┘
```

比较模式：

- `工作副本 vs BASE`
- `工作副本 vs HEAD`
- `修订 A vs 修订 B`
- `分支 A vs 分支 B`

操作：

- 上一个/下一个变更块。
- 忽略空白。
- 忽略换行。
- 复制 diff。
- 打开完整编辑器 diff。
- 加入提交篮。
- 还原文件。

实现建议：

- 文本 diff 优先使用 VS Code `vscode.diff`。
- 需要底部行内详情、过滤、批量操作时使用 Webview。
- 大文件自动降级为摘要视图。

### 5.3 冲突解决面板

提供两种布局：

#### 三栏布局

```text
┌──────────────┬──────────────┬──────────────┐
│ 我的版本 Mine │ 基准版本 Base │ 远端版本 Theirs │
└──────────────┴──────────────┴──────────────┘
┌────────────────────────────────────────────┐
│ 合并结果 Result，可编辑                     │
└────────────────────────────────────────────┘
```

#### 左右对比 + 结果布局

```text
┌──────────────────────┬──────────────────────┐
│ 我的版本 Mine         │ 远端版本 Theirs        │
├──────────────────────┴──────────────────────┤
│ 合并结果 Result，可编辑                      │
└─────────────────────────────────────────────┘
```

默认：

- 屏幕宽度足够时用三栏 + 结果。
- 小屏或窄面板时用左右对比 + 结果。

### 5.4 冲突块操作

每个冲突块上方显示操作按钮：

- `使用我的`
- `使用远端`
- `使用两边：我的在前`
- `使用两边：远端在前`
- `手动编辑`
- `标记此块已处理`

冲突块导航：

- 上一个冲突。
- 下一个冲突。
- 仅显示未处理冲突。
- 仅显示当前文件冲突。

### 5.5 合并结果区

结果区必须可编辑。

功能：

- 实时检测冲突标记。
- 保存。
- 格式化。
- 撤销当前块操作。
- 重做当前块操作。
- 与 BASE 比较。
- 与 Mine 比较。
- 与 Theirs 比较。

当结果区仍包含以下标记时，不允许 `标记已解决`：

```text
<<<<<<<
=======
>>>>>>>
```

### 5.6 冲突文件来源

SVN 冲突通常会产生辅助文件，如：

- `.mine`
- `.rOLDREV`
- `.rNEWREV`
- `working`

插件需要从 `svn status --xml` 和工作副本文件中识别：

- working/result 文件。
- mine 文件。
- theirs 文件。
- base 文件。

若自动识别失败：

- 提供手动选择 mine/base/theirs 文件。
- 提供 `用 TortoiseMerge 打开`。

### 5.7 冲突解决流程

1. 用户进入冲突中心。
2. 选择冲突文件。
3. 面板加载 mine/base/theirs/result。
4. 用户逐块处理。
5. 保存合并结果。
6. 点击 `检查冲突标记`。
7. 点击 `标记已解决`。
8. 执行 `svn resolve --accept working <path>`。
9. 刷新状态。
10. 返回提交页。

### 5.8 AI 辅助冲突解决

AI 可以做：

- 解释冲突原因。
- 标记可能安全采用的一侧。
- 总结 mine/theirs 的差异。
- 给出合并建议。
- 生成合并后的候选片段。

AI 不可以做：

- 自动保存合并结果。
- 自动执行 `svn resolve`。
- 自动丢弃一侧修改。

UI：

- 每个冲突块有 `AI 分析此冲突`。
- 输出：
  - `我的修改意图`
  - `远端修改意图`
  - `冲突点`
  - `建议合并方式`
  - `风险`

用户点击 `应用 AI 建议` 后，只把候选内容放入结果区，仍需用户保存和标记解决。

### 5.9 图片和二进制对比

图片对比：

- 左右图片。
- 叠加模式。
- 滑块模式。
- 差异高亮。
- 显示尺寸、文件大小、修改时间。

Office/PDF/压缩包：

- 显示文件元信息。
- 显示历史版本。
- 允许保存远端版本到临时文件。
- 推荐外部工具打开。

### 5.10 可选调用 TortoiseMerge

Windows 检测路径：

- `TortoiseMerge.exe`
- TortoiseSVN 安装目录。
- 注册表安装路径。

入口：

- 差异页：`用 TortoiseMerge 打开`
- 冲突页：`用 TortoiseMerge 解决`
- 设置页：`优先使用 TortoiseMerge 处理冲突`

策略：

- 默认使用内置面板。
- 用户可设置冲突时优先外部打开。
- 外部工具关闭后，插件刷新 SVN 状态。

## 6. UI 文案

### 6.1 AI 提交筛选

```text
AI 已根据当前范围和模板给出建议，请确认后再提交。
```

```text
这些文件看起来像生成物或临时文件，默认不建议提交。
```

```text
检测到 bin/Debug 和 obj 目录。它们通常是 .NET 构建产物，建议加入忽略规则。
```

### 6.2 AI 更新筛选

```text
智能更新只会更新你勾选的路径。SVN 允许这样做，但工作副本可能进入 mixed revision 状态。
```

```text
远端有生成物变更，本次已默认不勾选。你仍可以手动选择更新。
```

### 6.3 冲突面板

```text
先处理所有冲突块，保存合并结果后再标记已解决。
```

```text
结果文件仍包含冲突标记，暂不能标记已解决。
```

```text
AI 建议已插入结果区，请检查后保存。
```

## 7. 设置项

```json
{
  "svnWorkbench.ai.selection.enabled": false,
  "svnWorkbench.ai.selection.autoApply": false,
  "svnWorkbench.ai.selection.sendDiff": false,
  "svnWorkbench.ai.selection.maxFiles": 200,
  "svnWorkbench.ai.selection.maxDiffChars": 12000,
  "svnWorkbench.commit.generatedFiles.excludeByDefault": true,
  "svnWorkbench.commit.generatedFiles.rules": [
    "node_modules/**",
    "dist/**",
    "build/**",
    "target/**",
    "bin/Debug/**",
    "bin/Release/**",
    "obj/**",
    "__pycache__/**",
    "*.log",
    "*.tmp"
  ],
  "svnWorkbench.update.smartUpdate.enabled": true,
  "svnWorkbench.update.smartUpdate.warnMixedRevision": true,
  "svnWorkbench.merge.defaultTool": "builtin",
  "svnWorkbench.merge.allowTortoiseMerge": true,
  "svnWorkbench.merge.blockResolveWhenMarkersExist": true
}
```

## 8. 开发拆分

### 8.1 第一阶段

1. 确定性生成物过滤规则。
2. 提交页 `建议排除/需要确认` 分类。
3. AI 筛选按钮和结果面板。
4. `应用推荐选择`。
5. 生成忽略规则草案。

### 8.2 第二阶段

1. 更新预览。
2. 智能更新推荐。
3. 可能冲突预测。
4. mixed revision 提示。

### 8.3 第三阶段

1. 内置双栏 diff 面板增强。
2. 内置三方冲突解决面板。
3. 冲突块操作。
4. AI 冲突分析。
5. TortoiseMerge 外部调用。

## 9. 验收用例

### 9.1 AI 提交筛选

| 用例 | 预期 |
| --- | --- |
| 当前范围包含 `dist` | 默认建议排除 |
| 当前范围包含 `bin/Debug` | 默认建议排除 |
| 当前范围包含普通 `bin/deploy.sh` | 标记需要确认，不直接排除 |
| 当前范围包含 `.env` | 标记需要确认或阻止 |
| AI 筛选后点击应用 | 只改变当前范围内文件选择 |
| 用户手动固定文件 | AI 不取消固定选择 |
| 生成忽略规则 | 只生成草案，用户确认后应用 |

### 9.2 AI 更新筛选

| 用例 | 预期 |
| --- | --- |
| 右键文件夹智能更新 | 只分析该文件夹远端变更 |
| 远端修改与本地修改同文件 | 标记风险更新 |
| 远端新增文件与本地未版本控制同名 | 标记可能冲突 |
| 选择性更新 | 显示 mixed revision 提示 |
| 远端生成物变更 | 默认不勾选，但允许手动选择 |

### 9.3 冲突对比面板

| 用例 | 预期 |
| --- | --- |
| 文本冲突 | 显示 mine/base/theirs/result |
| 点击使用我的 | 当前冲突块写入 mine 内容 |
| 点击使用远端 | 当前冲突块写入 theirs 内容 |
| 结果仍有冲突标记 | 不允许标记已解决 |
| 保存并标记已解决 | 执行 `svn resolve --accept working` |
| 图片修改 | 显示图片对比而不是文本 diff |
| 检测到 TortoiseMerge | 显示外部打开入口 |

## 10. 参考

- TortoiseSVN 关于页：<https://tortoisesvn.subversion.org.cn/about.html>
- TortoiseMerge：<https://tortoisesvn.subversion.org.cn/TortoiseMerge.html>
- TortoiseSVN 屏幕截图：<https://tortoisesvn.subversion.org.cn/screenshots.html>
