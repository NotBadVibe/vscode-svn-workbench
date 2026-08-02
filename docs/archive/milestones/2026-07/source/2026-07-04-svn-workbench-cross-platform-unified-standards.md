# SVN Workbench Windows/macOS 统一标准

> 产品暂名：SVN Workbench for VS Code / SVN 工作台  
> 文档类型：跨平台统一产品标准  
> 编写日期：2026-07-04  
> 当前阶段：设计阶段补充  
> 文档策略：新增文件，不覆盖旧文档

## 1. 核心结论

Windows 和 macOS 必须采用同一套产品标准：

```text
同一套功能
同一套交互
同一套文案
同一套验收标准
同一套安全边界
同一套 AI 能力
```

平台差异只允许存在于底层适配层，不允许影响用户对产品的理解。

也就是说：

- 用户在 Windows 上学会怎么用，在 macOS 上也应该能一样使用。
- 文档、教程、截图说明应尽量保持一致。
- TortoiseMerge、FileMerge、路径格式、SVN 安装位置这些差异由插件处理。
- 产品核心能力不能因为平台不同而变成两套逻辑。

## 2. 统一标准原则

### 2.1 产品体验统一

以下体验必须一致：

- Activity Bar 名称和结构。
- SCM 面板分组。
- Explorer 右键菜单名称。
- 提交页布局。
- 文件筛选方式。
- 模板使用方式。
- AI 筛选方式。
- AI 冲突决策方式。
- 更新、提交、差异、日志、还原的流程。
- 错误提示结构。
- Output Channel 诊断方式。

### 2.2 功能能力统一

以下能力必须 Windows/macOS 都支持：

- SVN 环境检测。
- 工作副本发现。
- 状态扫描。
- 右键文件提交。
- 右键文件夹提交。
- 右键文件夹只提交当前文件夹范围。
- 文件类型筛选。
- 生成物排除。
- 提交模板。
- AI 生成提交说明。
- AI 推荐提交文件。
- AI 推荐排除生成物。
- AI 冲突分析。
- VS Code diff。
- 日志查看。
- 冲突阻止提交。
- 诊断复制。

### 2.3 安全边界统一

以下安全规则必须一致：

- AI 不自动提交。
- AI 不自动更新。
- AI 不自动解决冲突。
- AI 不突破 OperationScope。
- 敏感文件默认不发送内容。
- 提交前必须显示最终文件列表。
- 还原、删除、强制解锁、标记冲突已解决必须确认。
- 右键文件夹操作不能影响范围外文件。

### 2.4 文案统一

命令文案统一使用：

- 提交 Commit。
- 更新 Update。
- 差异 Diff。
- 日志 Log。
- 还原 Revert。
- 检出 Checkout。
- 锁定 Lock。
- 解锁 Unlock。
- 冲突 Resolve。

不因为平台不同改变产品术语。

## 3. 允许存在的平台差异

平台差异只能出现在实现和环境提示层。

| 差异点 | Windows | macOS | 用户体验要求 |
| --- | --- | --- | --- |
| SVN 可执行文件 | `svn.exe` | `svn` | 环境检测页自动识别 |
| 默认安装提示 | TortoiseSVN、SlikSVN、VisualSVN | Homebrew、Xcode CLT | 只在安装提示里不同 |
| 路径格式 | `C:\project` | `/Users/name/project` | UI 统一显示可读路径 |
| 外部合并工具 | TortoiseMerge 可选 | FileMerge/自定义工具可选 | 默认仍是 VS Code diff |
| 编码问题 | 可能 GBK/GB18030 | 通常 UTF-8 | 通过编码服务统一输出 |
| 文件权限 | 较少关注 executable | 需要关注 executable | 属性变更统一展示 |

## 4. 不允许的平台差异

以下情况不允许出现：

- Windows 有提交页，macOS 只有简单提交框。
- Windows 可以右键文件夹提交，macOS 不支持。
- Windows 可以 AI 筛选，macOS 不能。
- Windows 可以冲突决策卡片，macOS 不能。
- Windows 使用中文文案，macOS 使用英文文案。
- Windows 默认排除 `bin/Debug`，macOS 不排除生成物。
- Windows 提交前检查冲突，macOS 不检查。
- Windows 的 AI 输出需要用户确认，macOS 自动应用。

## 5. 统一交互标准

### 5.1 右键文件夹提交

Windows/macOS 行为完全一致：

```text
右键文件夹 -> SVN -> 提交此文件夹
```

结果：

- 只扫描此文件夹及子目录。
- 只展示此文件夹内候选文件。
- 全选不超过此文件夹范围。
- 模板筛选不超过此文件夹范围。
- AI 推荐不超过此文件夹范围。
- 提交命令只提交最终勾选文件。

### 5.2 提交页

Windows/macOS 布局完全一致：

```text
顶部：范围 / 状态 / 模板 / AI 筛选 / 更多
左侧：文件列表和筛选
右侧：Diff 预览
底部：提交信息和提交按钮
```

### 5.3 AI 模型设置

Windows/macOS 模型选择完全一致：

- DeepSeek。
- 通义千问 / 阿里云百炼。
- 智谱 GLM / Z.ai。
- Kimi / Moonshot。
- 腾讯混元。
- 百度千帆。
- Ollama。
- OpenAI-compatible 自定义。
- VS Code Language Model。

平台只影响本地服务是否可连接，不影响 UI 结构。

### 5.4 冲突处理

Windows/macOS 默认一致：

```text
VS Code diff + AI 冲突决策卡片
```

平台增强：

- Windows 可额外显示 `用 TortoiseMerge 打开`。
- macOS 可额外显示 `用 FileMerge/自定义工具打开`。

增强入口放在 `更多` 菜单，不改变主流程。

## 6. 统一技术标准

### 6.1 平台差异封装

所有平台差异必须进入适配层：

```text
PlatformService
SvnExecutableResolver
ExternalToolResolver
EncodingService
PathBoundaryGuard
```

业务层不直接判断：

```ts
if (process.platform === 'win32') {
  // 业务流程
}
```

业务层只能调用平台服务。

### 6.2 命令调用统一

所有平台使用同一套命令构造器：

```ts
spawn(svnPath, args, { shell: false });
```

禁止按平台拼接 shell 字符串。

### 6.3 路径边界统一

所有提交、更新、AI 输出文件都必须通过：

```text
PathBoundaryGuard
```

规则：

- 规范化路径。
- 解析真实路径。
- 判断是否在 OperationScope 内。
- 防止 `../` 越界。
- 防止大小写差异导致误判。

### 6.4 AI 输出统一校验

AI 返回的文件路径必须统一校验：

- 是否存在于当前候选文件集合。
- 是否在 OperationScope 内。
- 是否为 SVN 工作副本路径。
- 是否被规则阻止。

Windows/macOS 不能有不同校验标准。

## 7. 统一验收标准

### 7.1 功能验收

同一套测试用例必须在 Windows/macOS 都通过：

- 打开 SVN 工作副本。
- 扫描 SVN 状态。
- 右键文件提交。
- 右键文件夹提交。
- 提交页筛选文件类型。
- 排除生成物。
- AI 推荐提交文件。
- AI 生成提交说明。
- 打开 VS Code diff。
- 提交成功后显示修订号。
- 冲突文件阻止提交。
- 输出诊断可复制。

### 7.2 范围验收

同一套 OperationScope 测试必须在 Windows/macOS 都通过：

- 右键文件只包含该文件。
- 右键文件夹只包含该文件夹内文件。
- 多选文件夹只包含范围并集。
- 模板筛选不越界。
- AI 推荐不越界。
- 搜索清空不越界。
- 全选不越界。

### 7.3 AI 验收

同一套 AI 测试必须在 Windows/macOS 都通过：

- 模型连接测试。
- 发送前确认。
- 敏感文件不发送内容。
- AI 推荐有原因。
- AI 输出路径校验。
- AI 冲突建议只预览不自动应用。

## 8. UI 差异呈现规则

### 8.1 不同平台安装提示可以不同

允许：

```text
Windows: 你可以安装 TortoiseSVN 或 SlikSVN。
macOS: 你可以通过 Homebrew 安装 Subversion。
```

### 8.2 外部工具提示可以不同

允许：

```text
Windows: 用 TortoiseMerge 打开。
macOS: 用 FileMerge 或自定义工具打开。
```

### 8.3 主按钮不能不同

不允许：

```text
Windows: 提交
macOS: 上传
```

必须统一：

```text
提交 Commit
```

## 9. 文档与教程统一

官方文档默认写统一流程。

示例：

```text
右键文件夹，选择 SVN -> 提交此文件夹。
```

只有在安装、外部工具、路径示例时区分平台：

```text
Windows 示例路径：C:\project
macOS 示例路径：/Users/name/project
```

## 10. 设计阶段影响

后续设计文档必须遵守：

- 提交页线框不区分 Windows/macOS。
- AI 交互设计不区分 Windows/macOS。
- 冲突主流程不区分 Windows/macOS。
- 外部工具作为增强入口，不进入主流程。
- 环境检测页可以区分安装提示。
- 设置页可以按平台隐藏不可用外部工具。

## 11. 技术验证阶段影响

技术验证阶段必须按同一标准在两个平台执行。

建议测试矩阵：

| 用例 | Windows | macOS |
| --- | --- | --- |
| `svn --version` | 必测 | 必测 |
| `svn info --xml` | 必测 | 必测 |
| `svn status --xml` | 必测 | 必测 |
| 中文提交信息 | 必测 | 必测 |
| 空格路径 | 必测 | 必测 |
| 右键文件夹范围 | 必测 | 必测 |
| VS Code diff | 必测 | 必测 |
| AI 筛选 | 必测 | 必测 |
| AI 冲突建议 | 必测 | 必测 |

## 12. 当前决策

1. Windows/macOS 标准统一。
2. 产品功能、交互、文案、AI、安全边界统一。
3. 平台差异只放在环境检测、外部工具和底层适配层。
4. TortoiseMerge/FileMerge 都是可选增强，不影响主流程。
5. 后续所有设计和测试按双平台同标准推进。
