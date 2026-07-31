# SVN Workbench 设计阶段收束文档

> 产品暂名：SVN Workbench for VS Code / SVN 工作台  
> 文档类型：设计阶段收束与技术验证入口  
> 编写日期：2026-07-04  
> 当前阶段：设计阶段收束  
> 下一阶段：技术验证阶段  
> 适用平台：Windows / macOS 标准统一  
> 文档策略：新增文件，不覆盖旧文档

## 1. 阶段状态

当前研发周期：

```text
调研 -> 规划 -> 设计 -> 技术验证 -> 开发 -> 测试 -> 验收 -> 交付 -> 运营迭代
                  ↑
              当前收束点
```

设计阶段已经完成核心设计闭环：

- 页面地图。
- 提交页线框。
- AI 交互设计。
- OperationScope 范围边界。
- 中文文案规范。
- 错误状态设计。
- Windows/macOS 统一标准。

接下来可以进入：

```text
技术验证阶段
```

但进入技术验证前，需要明确本阶段的设计结论和验证任务。

## 2. 已完成设计文档

本阶段新增并纳入设计基线的文档：

| 文档 | 作用 |
| --- | --- |
| `2026-07-04-svn-workbench-from-zero-to-one-flow.md` | 从 0 到 1 总流程 |
| `2026-07-04-svn-workbench-ai-first-planning.md` | AI-first 规划 |
| `2026-07-04-svn-workbench-design-stage-kickoff.md` | 设计阶段启动与页面蓝图 |
| `2026-07-04-svn-workbench-cross-platform-requirements.md` | Windows/macOS 跨平台约束 |
| `2026-07-04-svn-workbench-cross-platform-unified-standards.md` | 双平台统一标准 |
| `2026-07-04-svn-workbench-commit-page-wireframe.md` | 提交页线框与交互 |
| `2026-07-04-svn-workbench-ai-interaction-design.md` | AI 交互设计 |
| `2026-07-04-svn-workbench-operation-scope-interaction.md` | OperationScope 范围边界 |
| `2026-07-04-svn-workbench-ui-copy-zh-cn.md` | 中文文案规范 |
| `2026-07-04-svn-workbench-error-states.md` | 错误状态与恢复交互 |

旧规划文档继续作为参考：

```text
docs/product-spec.md
docs/page-function-spec-2026-07-04.md
docs/ai-filter-and-merge-panel-spec-2026-07-04.md
docs/technical-feasibility-assessment-2026-07-04.md
```

## 3. 设计阶段核心结论

### 3.1 产品方向

SVN Workbench 不是简单 SVN 命令包装器，而是：

```text
面向 Windows/macOS、中文团队、AI-first 的 VS Code SVN 工作台。
```

核心价值：

- 范围明确。
- 提交安全。
- 文件筛选强。
- 生成物防误提交。
- AI 辅助判断。
- Windows/macOS 标准统一。

### 3.2 MVP 核心路径

MVP 只做最有价值的主流程：

```text
环境检测 -> 工作副本发现 -> 状态扫描 -> SCM 展示 -> 右键文件夹提交 -> 提交页筛选 -> 提交前检查 -> commit -> 日志/诊断
```

### 3.3 AI 定位

AI 是核心能力，但不是危险操作执行者。

AI 可以：

- 生成提交说明。
- 推荐提交/排除文件。
- 检查提交风险。
- 生成忽略规则草案。
- 分析冲突并生成合并方案。

AI 不可以：

- 自动提交。
- 自动更新。
- 自动还原。
- 自动删除。
- 自动标记冲突已解决。
- 突破 OperationScope。

### 3.4 双平台标准

Windows/macOS 必须统一：

- 功能统一。
- 交互统一。
- 文案统一。
- AI 统一。
- 安全边界统一。
- 验收标准统一。

平台差异只存在于底层适配：

- SVN 可执行文件发现。
- 路径处理。
- 编码处理。
- 外部工具发现。

### 3.5 差异与冲突策略

MVP 不自研完整 TortoiseMerge 级三方合并器。

MVP 使用：

```text
VS Code diff + AI 冲突决策卡片 + 可选外部工具
```

Windows 可选：

```text
TortoiseMerge
```

macOS 可选：

```text
FileMerge 或自定义工具
```

默认主流程仍然统一。

## 4. 关键设计决策

| 决策 | 结论 |
| --- | --- |
| 是否支持 macOS | 支持，且与 Windows 标准统一 |
| 是否依赖 TortoiseSVN | 不依赖，只作为 Windows 可选增强 |
| 提交页是否 Webview | 是，提交页交互复杂 |
| SCM 是否必须接入 | 是，必须接入 VS Code Source Control |
| AI 是否默认开启 | 否，首次使用需要配置和隐私确认 |
| AI 是否可自动提交 | 不可以 |
| AI 是否可应用冲突方案 | 只能预览，用户确认后应用 |
| 是否一刀切排除 bin | 不排除普通 `bin/**`，只排除明确生成物目录 |
| 是否允许模板扩大范围 | 不允许 |
| 是否允许 AI 扩大范围 | 不允许 |
| 是否允许一次提交跨工作副本 | 不允许 |

## 5. MVP 页面范围

### 5.1 必须进入 MVP

- 环境检测页。
- SCM 状态视图。
- 提交页。
- AI 配置引导。
- AI 提交说明。
- AI 提交筛选。
- VS Code diff。
- Output Channel。
- 错误提示与诊断复制。

### 5.2 可进入 MVP

- 工作台总览。
- 基础日志页。
- 基础更新页。
- 忽略规则草案。
- AI 风险审查。

### 5.3 MVP 后置

- 完整冲突中心。
- 内置三方合并器。
- Revision Graph。
- Merge 向导。
- Repo Browser。
- 完整认证管理。
- 锁管理完整页。
- 对话式 SVN 助手。

## 6. MVP 功能范围

### 6.1 必须实现

- SVN 命令检测。
- 工作副本发现。
- `svn info --xml`。
- `svn status --xml`。
- SCM Provider。
- Explorer 右键文件/文件夹命令。
- OperationScope。
- 提交页 Webview。
- 文件状态筛选。
- 文件类型筛选。
- 生成物默认排除。
- 未版本控制文件 `svn add`。
- 缺失文件 `svn remove` 或还原。
- `svn commit <paths> -F <message-file>`。
- VS Code diff。
- Output Channel。
- 错误模型和诊断脱敏。

### 6.2 推荐实现

- AI 生成提交说明。
- AI 提交筛选。
- AI 风险审查。
- 基础日志。
- 远端检查。
- 忽略规则草案。

### 6.3 暂不实现

- AI 自动更新。
- AI 自动提交。
- AI 自动 resolve。
- 完整三方合并器。
- 复杂分支/合并图谱。

## 7. 技术验证阶段目标

技术验证阶段不是开发完整产品，而是验证关键风险能否跑通。

目标：

```text
用最小原型证明 SVN CLI + VS Code API + OperationScope + 提交页基础链路可行。
```

必须验证：

- Windows/macOS 都可执行 SVN。
- XML 状态解析可靠。
- OperationScope 不越界。
- 右键文件夹提交范围正确。
- 中文提交信息可用。
- VS Code diff 可用。
- AI Provider 可插拔。
- AI 输出可校验。

## 8. 技术验证任务清单

### 8.1 环境验证

| 任务 | Windows | macOS |
| --- | --- | --- |
| 检测 PATH 中 SVN | 必测 | 必测 |
| 用户手动配置 SVN | 必测 | 必测 |
| `svn --version --quiet` | 必测 | 必测 |
| 输出诊断 | 必测 | 必测 |

### 8.2 工作副本验证

| 任务 | Windows | macOS |
| --- | --- | --- |
| `svn info --xml` | 必测 | 必测 |
| `svn status --xml` | 必测 | 必测 |
| 中文路径 | 必测 | 建议 |
| 空格路径 | 必测 | 必测 |
| 非 SVN 工作区 | 必测 | 必测 |

### 8.3 OperationScope 验证

| 任务 | Windows | macOS |
| --- | --- | --- |
| 右键文件 scope | 必测 | 必测 |
| 右键文件夹 scope | 必测 | 必测 |
| 多选 scope | 必测 | 必测 |
| 父子路径合并 | 必测 | 必测 |
| 跨工作副本阻止 | 必测 | 必测 |
| 模板越界拦截 | 必测 | 必测 |
| AI 越界拦截 | 必测 | 必测 |
| 最终提交路径校验 | 必测 | 必测 |

### 8.4 提交链路验证

| 任务 | Windows | macOS |
| --- | --- | --- |
| 未版本控制文件 `svn add` | 必测 | 必测 |
| missing 文件 `svn remove` | 必测 | 必测 |
| 中文提交说明 `-F` | 必测 | 必测 |
| 精确路径 commit | 必测 | 必测 |
| 提交成功刷新状态 | 必测 | 必测 |
| commit 失败错误映射 | 必测 | 必测 |

### 8.5 Diff 验证

| 任务 | Windows | macOS |
| --- | --- | --- |
| Working vs BASE | 必测 | 必测 |
| 新增文件预览 | 必测 | 必测 |
| 删除文件预览 | 必测 | 必测 |
| 二进制文件降级 | 必测 | 必测 |

### 8.6 AI 验证

| 任务 | Windows | macOS |
| --- | --- | --- |
| OpenAI-compatible provider | 必测 | 必测 |
| Ollama provider | 建议 | 建议 |
| 发送前确认 | 必测 | 必测 |
| 隐私过滤 | 必测 | 必测 |
| JSON 输出解析 | 必测 | 必测 |
| AI 筛选文件 | 必测 | 必测 |
| AI 冲突建议样本 | 建议 | 建议 |

## 9. 技术验证最小原型

最小原型只需要实现：

```text
VS Code 扩展骨架
SVN 可执行文件检测
工作副本发现
svn status --xml 解析
SCM Provider 展示状态
右键文件夹创建 OperationScope
提交页最小 Webview
生成物排除规则
commit -F 提交
VS Code diff
Output Channel
```

可暂时不做：

- 完整美化。
- 完整 AI UI。
- 完整历史页。
- 完整冲突中心。
- 完整设置页。

## 10. 技术验证退出标准

满足以下条件后，技术验证阶段可进入开发阶段：

1. Windows/macOS 均能检测 SVN。
2. Windows/macOS 均能解析 `svn status --xml`。
3. SCM 面板能展示 M/A/D/!/C/?。
4. 右键文件夹提交只显示该文件夹内变更。
5. `dist`、`bin/Debug`、`obj` 等生成物默认排除。
6. 中文提交说明可通过 `-F` 提交。
7. commit 成功后显示修订号并刷新状态。
8. VS Code diff 能打开文本文件对比。
9. OperationScope 越界能被拦截。
10. AI Provider 原型能返回结构化结果并通过校验。

## 11. 进入开发阶段前的未决问题

### 11.1 UI 技术栈

提交页 Webview 使用：

- 原生 HTML/CSS/TS。
- React。
- Vue。
- Svelte。

建议技术验证阶段用最小实现验证，不在此刻过早定框架。

### 11.2 AI Provider 首批内置列表

规划中已列：

- DeepSeek。
- 通义千问 / 阿里云百炼。
- 智谱 GLM / Z.ai。
- Kimi / Moonshot。
- 腾讯混元。
- 百度千帆。
- Ollama。
- OpenAI-compatible 自定义。
- VS Code Language Model。

开发阶段需要决定：

- 哪些作为预设。
- 哪些只通过自定义 OpenAI-compatible 支持。

### 11.3 凭据策略

第一版建议：

- 优先依赖 SVN CLI auth cache。
- 插件只做认证失败引导。
- 不默认传 `--password`。

开发阶段需要进一步设计认证管理细节。

### 11.4 测试仓库准备

需要准备：

- Windows 测试工作副本。
- macOS 测试工作副本。
- 中文路径样本。
- 空格路径样本。
- 冲突样本。
- missing 样本。
- unversioned 样本。
- 生成物样本。

## 12. MVP 验收范围

### 12.1 用户验收

用户可以完成：

1. 安装扩展。
2. 打开 SVN 工作副本。
3. 看到 SVN 变更。
4. 右键某个文件夹提交。
5. 在提交页筛选文件。
6. 排除生成物。
7. 生成或填写提交说明。
8. 提交成功。
9. 查看修订号。
10. 失败时复制诊断。

### 12.2 安全验收

必须保证：

- 右键文件夹不提交范围外文件。
- AI 不加入范围外文件。
- 模板不加入范围外文件。
- 冲突文件阻止提交。
- 他人锁定文件阻止提交。
- 敏感文件有确认。
- 诊断脱敏。

### 12.3 跨平台验收

同一套用例在 Windows/macOS 都通过：

- SVN 检测。
- 状态扫描。
- SCM 展示。
- 右键文件夹提交。
- 中文提交说明。
- VS Code diff。
- AI 筛选。
- 错误提示。

## 13. 开发阶段建议顺序

技术验证通过后，开发阶段建议按以下顺序：

1. 项目工程化。
2. SVN Adapter。
3. Repository Discovery。
4. SCM Provider。
5. OperationScope。
6. Commit Flow。
7. Commit Webview。
8. Diff Provider。
9. Error Mapper。
10. AI Provider。
11. AI Commit Message。
12. AI Commit Selection。
13. Update Flow。
14. Log Flow。
15. Ignore Rules。

## 14. 风险复盘

| 风险 | 等级 | 当前设计对策 |
| --- | --- | --- |
| 误提交范围外文件 | P0 | OperationScope + PathBoundaryGuard |
| Windows/macOS 行为不一致 | P0 | 统一标准 + 双平台验收 |
| 中文路径/编码失败 | P1 | XML 优先 + 编码服务 |
| 凭据处理不安全 | P1 | 默认 SVN auth cache |
| AI 推荐不可靠 | P1 | 用户确认 + 输出校验 |
| AI 泄露敏感内容 | P1 | 隐私级别 + 敏感过滤 |
| Webview 复杂度过高 | P2 | MVP 最小提交页 |
| 冲突面板研发周期长 | P2 | VS Code diff + AI 决策卡片 |

## 15. 设计阶段完成标准

以下条件已满足：

- 产品流程明确。
- 页面地图明确。
- MVP 范围明确。
- 提交页线框明确。
- AI 交互明确。
- 范围边界明确。
- 中文文案明确。
- 错误状态明确。
- 双平台统一标准明确。

因此设计阶段可以收束。

## 16. 下一步

下一阶段：

```text
技术验证阶段
```

建议新增文档：

```text
2026-07-04-svn-workbench-technical-validation-plan.md
```

该文档应包含：

- 技术验证目标。
- 原型范围。
- Windows/macOS 验证矩阵。
- SVN 命令验证清单。
- OperationScope 验证清单。
- AI Provider 验证清单。
- 退出标准。

## 17. 当前决策

1. 设计阶段收束完成。
2. 下一步进入技术验证阶段。
3. 技术验证优先证明核心链路，不做完整产品。
4. Windows/macOS 同标准验证。
5. MVP 开发必须以 OperationScope 和提交闭环为第一优先级。
