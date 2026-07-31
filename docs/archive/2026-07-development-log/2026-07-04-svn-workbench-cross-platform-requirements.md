# SVN Workbench Windows/macOS 跨平台要求

> 产品暂名：SVN Workbench for VS Code / SVN 工作台  
> 文档类型：跨平台约束与设计补充  
> 编写日期：2026-07-04  
> 当前阶段：设计阶段补充  
> 文档策略：新增文件，不覆盖旧文档

## 1. 补充结论

SVN Workbench 必须支持：

```text
Windows
macOS
```

第一版不以 Linux 为主要目标，但技术实现不能故意阻断 Linux。也就是说：

- Windows 和 macOS 是正式支持平台。
- Linux 可作为社区兼容或后续支持。
- 所有核心 SVN 能力不能依赖 Windows-only 工具。
- TortoiseSVN/TortoiseMerge 只能作为 Windows 可选增强，不能作为基础依赖。

## 2. 产品边界调整

### 2.1 必须跨平台的能力

以下功能必须在 Windows 和 macOS 都可用：

- SVN 命令检测。
- 工作副本发现。
- SCM Provider 状态展示。
- Explorer 右键提交/更新/diff/log/revert。
- 右键文件夹限定范围提交。
- 提交页筛选。
- 生成物排除。
- 提交模板。
- AI 模型配置。
- AI 提交说明。
- AI 提交筛选。
- VS Code 原生 diff。
- 基础冲突中心。
- 日志查看。
- Output Channel 诊断。

### 2.2 平台可选增强

| 功能 | Windows | macOS |
| --- | --- | --- |
| TortoiseMerge 外部打开 | 支持 | 不支持 |
| FileMerge 外部打开 | 不默认 | 可选支持 |
| Beyond Compare 外部打开 | 可选 | 可选 |
| Kaleidoscope 外部打开 | 不默认 | 可选 |
| 系统钥匙串 | Windows Credential Manager 可调研 | macOS Keychain 可调研 |

### 2.3 不能作为核心依赖

以下不能作为 MVP 核心依赖：

- TortoiseSVN。
- TortoiseMerge。
- Windows 注册表。
- Windows 资源管理器图标覆盖。
- macOS 专属 diff 工具。
- shell 专属命令语法。

## 3. 平台差异清单

### 3.1 SVN 安装路径

Windows 常见来源：

- PATH 中的 `svn.exe`。
- TortoiseSVN bin 目录。
- SlikSVN。
- VisualSVN command line tools。
- 用户手动选择 `svn.exe`。

macOS 常见来源：

- PATH 中的 `svn`。
- Homebrew 安装路径，如 `/opt/homebrew/bin/svn` 或 `/usr/local/bin/svn`。
- Xcode Command Line Tools 相关环境。
- 用户手动选择 `svn`。

设计要求：

- 自动检测 PATH。
- 提供手动选择路径。
- 保存用户选择。
- 检测失败时给平台对应安装建议。

### 3.2 路径处理

必须使用 VS Code/Node 的跨平台路径能力：

- `vscode.Uri`。
- `path.normalize`。
- `path.resolve`。
- `path.relative`。
- `path.sep`。

禁止：

- 手写 `\` 或 `/` 拼路径。
- 用字符串 startsWith 做最终安全边界判断。
- 假设盘符存在。
- 假设路径大小写敏感或不敏感。

范围校验必须基于规范化绝对路径。

### 3.3 命令执行

SVN 命令必须使用参数数组调用。

推荐：

```ts
spawn(svnPath, ['status', '--xml', targetPath], {
  cwd,
  shell: false
});
```

避免：

```ts
exec(`svn status --xml ${targetPath}`);
```

原因：

- Windows/macOS 转义规则不同。
- 中文路径和空格路径容易出错。
- shell 注入风险更高。

### 3.4 编码

Windows：

- SVN 输出可能受系统代码页影响。
- 中文路径和错误信息可能出现 GBK/GB18030。

macOS：

- 通常以 UTF-8 为主。

设计要求：

- XML 输出优先。
- stdout/stderr 以 Buffer 接收。
- 编码服务支持 `auto / utf8 / gb18030 / gbk / big5`。
- 提交信息使用临时文件 `-F`，避免命令行转义和编码问题。

### 3.5 文件大小写

Windows 默认文件系统大小写不敏感。

macOS 常见文件系统通常大小写不敏感，但也可能大小写敏感。

设计要求：

- 不假设大小写规则。
- 路径比较需要平台感知。
- SVN 状态以 SVN 返回路径为准。

### 3.6 换行符

Windows 常见 CRLF。

macOS 常见 LF。

设计要求：

- diff 展示尊重文件原始换行。
- 提交信息统一由临时文件写入。
- 不在扩展中主动改写用户文件换行。

### 3.7 文件权限

macOS 更常见可执行权限问题。

设计要求：

- 对脚本类文件显示权限变化提示。
- 支持查看 SVN 属性变化。
- 后续可支持 `svn:executable` 属性管理。

### 3.8 外部工具

Windows：

- 可检测 TortoiseMerge。

macOS：

- 可支持系统 FileMerge 或用户配置外部 diff 工具。

统一设计：

- 外部 diff/merge 工具做成通用配置。
- 内置默认使用 VS Code diff。
- 找不到外部工具时不影响核心功能。

## 4. UI 设计调整

### 4.1 环境检测页

环境检测页根据平台显示不同提示。

Windows 提示：

```text
未找到 svn.exe。你可以安装 TortoiseSVN、SlikSVN、VisualSVN command line tools，或手动选择 svn.exe。
```

macOS 提示：

```text
未找到 svn。你可以通过 Homebrew 安装 Subversion，或手动选择 svn 可执行文件。
```

### 4.2 外部合并工具设置

设置页新增：

```text
外部 Diff/Merge 工具
```

选项：

- 使用 VS Code 内置 diff。
- 使用 TortoiseMerge，仅 Windows 显示。
- 使用 FileMerge，仅 macOS 显示。
- 使用自定义工具。

自定义工具字段：

- 可执行文件路径。
- 普通 diff 参数模板。
- 三方 merge 参数模板。

### 4.3 AI 页面不区分平台

AI 功能应完全跨平台。

包括：

- 模型配置。
- OpenAI-compatible。
- 国产模型。
- Ollama。
- AI 提交说明。
- AI 筛选。
- AI 冲突建议。

注意：

- Ollama 本地模型需要用户自己确保本机服务可访问。
- Windows/macOS 的默认 Ollama 地址都可使用 `http://localhost:11434`。

## 5. 技术架构调整

### 5.1 PlatformService

新增平台服务：

```ts
interface PlatformService {
  os: 'windows' | 'macos' | 'linux';
  isWindows(): boolean;
  isMacOS(): boolean;
  getDefaultSvnCandidates(): string[];
  getDefaultExternalMergeTools(): ExternalToolCandidate[];
  normalizePath(filePath: string): string;
  isPathInside(parent: string, child: string): boolean;
}
```

### 5.2 SvnExecutableResolver

职责：

- 从 PATH 查找 SVN。
- 从平台默认路径查找 SVN。
- 从用户设置读取 SVN。
- 验证 `svn --version --quiet`。

### 5.3 ExternalToolResolver

职责：

- 查找 TortoiseMerge。
- 查找 FileMerge。
- 查找用户自定义工具。
- 根据平台隐藏不可用选项。

### 5.4 PathBoundaryGuard

职责：

- 校验提交范围。
- 校验 AI 输出文件路径。
- 校验模板筛选结果。
- 校验最终提交路径。

它必须跨平台可靠。

## 6. MVP 跨平台验收标准

### 6.1 Windows 验收

必须通过：

- 路径包含中文用户名。
- 路径包含空格。
- SVN 来自 PATH。
- SVN 来自用户手动配置。
- 右键文件夹提交不越界。
- `dist`、`bin/Debug`、`obj` 默认排除。
- VS Code diff 可用。
- Output Channel 不乱码或可通过编码设置修复。

### 6.2 macOS 验收

必须通过：

- SVN 来自 PATH。
- SVN 来自 Homebrew 路径。
- SVN 来自用户手动配置。
- 路径包含空格。
- 右键文件夹提交不越界。
- `dist`、`build`、`target`、`obj` 默认排除。
- VS Code diff 可用。
- AI 功能可配置。

### 6.3 双平台共同验收

- SCM Provider 可展示状态。
- 提交页可打开。
- 提交信息可用中文。
- 未版本控制文件可 `svn add`。
- missing 文件可提交删除或恢复。
- 冲突文件阻止提交。
- SVN 命令失败可复制诊断。

## 7. 技术验证阶段新增任务

进入技术验证阶段时，必须增加跨平台验证任务：

1. Windows 执行 `svn --version`。
2. macOS 执行 `svn --version`。
3. Windows 中文路径 `svn status --xml`。
4. macOS 空格路径 `svn status --xml`。
5. Windows 右键文件夹 OperationScope 校验。
6. macOS 右键文件夹 OperationScope 校验。
7. Windows 提交中文提交信息。
8. macOS 提交中文提交信息。
9. Windows VS Code diff。
10. macOS VS Code diff。

## 8. 对既有设计的影响

### 8.1 TortoiseMerge 定位变化

原定位：

```text
TortoiseMerge 是冲突处理的重要增强。
```

调整为：

```text
TortoiseMerge 是 Windows 专属可选增强，不影响 macOS 核心功能。
```

### 8.2 外部工具抽象提前

因为要支持 macOS，外部工具不能只写 TortoiseMerge。

应改成：

```text
External Diff/Merge Tool
```

再按平台提供默认候选。

### 8.3 内置能力更重要

由于 macOS 没有 TortoiseMerge 兜底，MVP 至少要保证：

- VS Code diff 稳定可用。
- 冲突中心能打开文件并检查冲突标记。
- AI 冲突决策卡片跨平台可用。

## 9. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| Windows/macOS 路径差异导致范围判断错误 | 误提交 | PathBoundaryGuard + 双平台测试 |
| macOS 无 TortoiseMerge | 冲突体验不一致 | VS Code diff + AI 决策卡片 + 自定义外部工具 |
| Windows 编码乱码 | 用户看不懂错误 | XML 优先 + 编码设置 |
| 用户未安装 SVN | 无法使用 | 环境检测页平台化提示 |
| 外部工具参数差异 | 打不开 diff | 工具模板配置 + 默认内置 diff |
| 只在一个平台测试 | 发布后大量问题 | 技术验证阶段双平台验收 |

## 10. 设计阶段后续补充

后续设计文档需要体现跨平台：

- 提交页线框不应出现 Windows-only 交互。
- AI 交互不区分平台。
- 外部工具设置页要按平台显示。
- 环境检测页要按平台显示安装建议。
- 技术验证文档必须包含 Windows/macOS 测试矩阵。

## 11. 当前决策

1. Windows 和 macOS 是正式支持平台。
2. 核心功能只依赖 SVN CLI 和 VS Code API。
3. TortoiseMerge 仅作为 Windows 可选增强。
4. macOS 使用 VS Code diff + 可选外部工具 + AI 冲突决策卡片。
5. 技术验证阶段必须双平台验证。
6. 任何路径和命令实现都必须跨平台设计。
