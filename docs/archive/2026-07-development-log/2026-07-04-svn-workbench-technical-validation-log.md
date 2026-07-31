# SVN Workbench 技术验证日志

> 产品暂名：SVN Workbench for VS Code / SVN 工作台  
> 文档类型：技术验证执行日志  
> 创建日期：2026-07-04  
> 当前阶段：技术验证阶段  
> 文档策略：新增文件，不覆盖旧文档

## 1. 验证环境记录

### 1.1 当前工作目录

```text
C:\Users\杨楠\Documents\vscode-svn
```

### 1.2 初始环境检测

执行时间：2026-07-04

| 检测项 | 结果 | 说明 |
| --- | --- | --- |
| PATH 中 `node` | 未找到 | PowerShell 无法识别 `node` |
| PATH 中 `npm` | 未找到 | PowerShell 无法识别 `npm` |
| PATH 中 `svn` | 未找到 | PowerShell 无法识别 `svn` |
| Codex 内置 Node | 可用 | `v24.14.0` |
| Codex 内置 pnpm | 可用 | `11.7.0` |
| git 工作区 | 异常 | 目录存在 `.git`，但 git 判断不是有效仓库 |

结论：

- 本机 PATH 中缺少 Node/npm/svn，符合环境检测页必须处理的场景。
- 技术验证可先使用 Codex 内置 Node/pnpm 创建和编译原型。
- SVN CLI 仍未安装或未加入 PATH，后续 SVN 命令验证需要安装 SVN 或手动配置 `svnWorkbench.svn.path`。

## 2. 已创建原型文件

创建时间：2026-07-04

| 文件 | 作用 |
| --- | --- |
| `package.json` | VS Code Extension manifest、命令、配置、脚本 |
| `tsconfig.json` | TypeScript 编译配置 |
| `.vscodeignore` | VSIX 打包排除规则 |
| `src/extension.ts` | 扩展入口和验证命令注册 |
| `src/diagnostics/outputChannel.ts` | Output Channel 和脱敏工具 |
| `src/svn/svnExecutableResolver.ts` | SVN 可执行文件检测 |
| `src/svn/svnCommandRunner.ts` | 跨平台 SVN 子进程运行器 |
| `src/svn/parsers/statusXmlParser.ts` | `svn status --xml` 解析 |
| `src/svn/parsers/infoXmlParser.ts` | `svn info --xml` 解析 |
| `src/scope/operationScope.ts` | OperationScope 创建 |
| `src/scope/pathBoundaryGuard.ts` | 范围边界校验 |
| `src/commit/generatedFilePolicy.ts` | 生成物排除策略 |
| `src/diff/diffProvider.ts` | VS Code diff 原型 |
| `src/ai/*` | OpenAI-compatible AI Provider 原型 |

## 3. 第一轮原型范围

本轮原型包含：

- VS Code Extension TypeScript 骨架。
- SVN 检测命令。
- SVN status 刷新命令。
- Explorer 右键提交范围原型。
- VS Code diff 原型。
- AI 连接测试原型。
- AI 当前范围筛选原型。

本轮暂未包含：

- 完整提交页 UI。
- 真正 `svn commit` 执行。
- SCM Provider 完整接入。
- 双平台实机验证。

## 4. 待验证命令

后续在 VS Code Extension Host 中验证：

```text
SVN: Check Environment
SVN: Refresh Status
SVN: Commit This Folder
SVN: Open Diff
SVN: Show Output
SVN: AI Test Connection
SVN: AI Select Current Scope
```

## 5. 当前阻塞项

### 5.1 SVN CLI 不在 PATH

影响：

- 无法实际执行 `svn --version`、`svn status --xml`、`svn info --xml`。

下一步：

- 安装 SVN CLI，或在 VS Code 设置中配置 `svnWorkbench.svn.path`。

### 5.2 未安装 npm 依赖

影响：

- 需要先安装 TypeScript 和 VS Code 类型依赖后才能编译。

下一步：

- 使用 Codex 内置 pnpm 执行依赖安装。

## 6. 下一步日志项

下一步记录：

- `pnpm install` 结果。
- `pnpm compile` 结果。
- 首轮 TypeScript 错误修复。
- SVN CLI 安装/配置后的命令验证。

## 7. 依赖安装记录

执行时间：2026-07-04

命令：

```text
pnpm install
```

结果：

```text
成功
```

安装依赖：

- `typescript`
- `@types/vscode`
- `@types/node`

备注：

- 使用 Codex 内置 pnpm 执行。
- 当前系统 PATH 仍未提供 `node`。

## 8. 编译记录

执行时间：2026-07-04

第一次尝试：

```text
pnpm compile
```

结果：

```text
失败
```

原因：

```text
pnpm script 调用 tsc 时需要 PATH 中存在 node，但当前 PowerShell 无法识别 node。
```

第二次尝试：

```text
Codex 内置 node.exe .\node_modules\typescript\bin\tsc -p .\
```

结果：

```text
成功
```

结论：

- TypeScript 原型代码当前可编译。
- 当前机器环境缺少 PATH 中的 Node，后续开发环境需要安装 Node 或配置 PATH。

## 9. 模块烟测记录

执行时间：2026-07-04

验证模块：

- `statusXmlParser`
- `generatedFilePolicy`

输入：

```text
modified: src/pages/order/OrderList.vue
unversioned: src/pages/order/debug.log
conflicted: src/pages/order/conflict.ts
```

输出：

```text
OrderList.vue -> modified
debug.log -> unversioned
conflict.ts -> conflicted
```

生成物规则输出：

```text
dist/app.js -> exclude
bin/Debug/app.exe -> exclude
bin/deploy.sh -> review
```

结论：

- XML 状态解析最小样本通过。
- 生成物规则符合设计决策：排除明确生成物，不一刀切排除普通 `bin`。

## 10. 当前验证结论

已通过：

- 项目骨架创建。
- 依赖安装。
- TypeScript 编译。
- 状态 XML parser 烟测。
- 生成物策略烟测。
- SCM Provider 原型编译验证。

仍待验证：

- 真实 SVN CLI。
- 真实 SVN 工作副本。
- VS Code Extension Host。
- SCM Provider 在 Extension Host 中展示状态。
- OperationScope 在真实 Explorer 右键场景中的行为。
- Commit Flow。
- VS Code Diff。
- AI Provider 真实模型调用。

## 11. SCM Provider 原型记录

执行时间：2026-07-04

新增文件：

```text
src/scm/svnScmProvider.ts
```

能力：

- 创建 VS Code SourceControl。
- 创建 Conflicts / Modified / Added / Deleted / Missing / Unversioned 分组。
- 将 `SvnStatusItem` 映射为 `SourceControlResourceState`。
- 资源行点击调用 `SVN: Open Diff`。
- `SVN: Refresh Status` 解析 status 后更新 SCM Provider。

验证结果：

```text
TypeScript 编译通过。
```

仍待验证：

- 在 Extension Host 中执行 `SVN: Refresh Status`。
- 检查 Source Control 面板是否正确显示分组。
- 检查资源行 Diff 命令是否可用。

## 12. 本机开发环境安装记录

执行时间：2026-07-04

用户要求：

```text
后续环境使用这台电脑作为开发环境，不依赖沙盒环境。
```

已安装：

| 工具 | 版本 | 来源 |
| --- | --- | --- |
| Node.js | `v24.18.0` | `winget install OpenJS.NodeJS.LTS --scope user` |
| npm | `11.16.0` | Node.js 自带 |
| Slik Subversion | `1.14.2-SlikSvn` | `winget install Slik.Subversion` |
| svnadmin | `1.14.2-SlikSvn` | Slik Subversion |

说明：

- PowerShell 执行 `npm` 会优先命中 `npm.ps1`，而当前执行策略禁用 ps1 脚本。
- 后续在 PowerShell 中使用 `npm.cmd`。
- 已改用本机 npm 生成 `package-lock.json`。

## 13. 本机 npm 编译记录

执行时间：2026-07-04

命令：

```text
npm.cmd install --ignore-scripts
npm.cmd run compile
```

结果：

```text
成功
```

说明：

- 项目现在可使用本机 Node/npm 编译。
- 早前使用 Codex 内置 pnpm 生成的 `pnpm-lock.yaml` 已删除。

## 14. SVN 中文路径验证记录

执行时间：2026-07-04

尝试：

```text
svnadmin create C:\Users\杨楠\Documents\vscode-svn\.validation\2026-07-04-local-svn\repo
```

结果：

```text
失败
```

错误摘要：

```text
svnadmin: E720003: Repository creation failed
Can't create directory ... 系统找不到指定的路径。
```

结论：

- 当前 SlikSVN 在中文用户路径下创建本地仓库失败。
- 这不代表普通工作副本一定失败，但说明中文路径是必须单独验证和处理的兼容风险。
- 后续需要继续验证 `svn status`、`svn commit` 在中文路径工作副本中的行为。

## 15. ASCII 本地 SVN 仓库验证记录

执行时间：2026-07-04

路径：

```text
Repository: C:\svn-workbench-validation-test-repo
Working Copy: C:\svn-workbench-validation-test-wc
```

结果：

```text
成功
```

已验证：

- `svnadmin create`
- `svn mkdir`
- `svn checkout`
- `svn add`
- `svn commit`
- `svn status --xml`

真实 `svn status --xml` 解析结果：

```text
bin\Debug -> unversioned -> exclude
dist -> unversioned -> exclude
docs\readme.md -> missing -> include
obj -> unversioned -> exclude
src\pages\order\OrderList.vue -> modified -> include
src\pages\order\debug.log -> unversioned -> exclude
src\pages\order\style.scss -> added -> include
```

结论：

- SVN CLI 主链路在 ASCII 路径下可用。
- `statusXmlParser` 能解析真实 SVN XML 输出。
- 生成物策略符合设计：明确生成物排除，业务源码保留。

## 16. Commit Flow 中文提交验证记录

执行时间：2026-07-04

### 16.1 第一次验证：用户 Temp 路径失败

尝试：

```text
svn commit ... -F C:\Users\杨楠\AppData\Local\Temp\svn-workbench-validation-message.txt
```

结果：

```text
失败
```

错误摘要：

```text
Can't open file ... 系统找不到指定的路径。
```

结论：

- SlikSVN 在当前环境下无法读取中文用户名路径下的 `-F` 提交说明文件。
- Commit Flow 不能直接使用 `os.tmpdir()` 作为 Windows 提交说明临时目录。

修复：

```text
Windows 下改用 C:\Users\Public\SVNWorkbench\Temp
```

### 16.2 第二次验证：换行风格失败

尝试：

```text
UTF-8 提交说明文件，内容包含混合 LF/CRLF
```

结果：

```text
失败
```

错误摘要：

```text
Error normalizing log message to internal format
Inconsistent line ending style
```

修复：

```text
Commit Flow 写入提交说明前统一换行为 LF。
```

### 16.3 第三次验证：缺少 --encoding 导致入库乱码

尝试：

```text
UTF-8 文件，不带 --encoding utf-8
```

结果：

```text
提交成功，但 svn log 中中文乱码。
```

尝试：

```text
GBK 文件，不带 --encoding utf-8
```

结果：

```text
提交成功，但 svn log 中中文仍乱码。
```

修复：

```text
svn commit ... -F <message-file> --encoding utf-8
```

### 16.4 第四次验证：成功

命令：

```text
svn commit C:\svn-workbench-validation-test-wc\config\app.json -F C:\Users\Public\SVNWorkbench\Temp\svn-workbench-validation-message-utf8.txt --encoding utf-8
```

结果：

```text
Committed revision 5.
```

`svn log --xml` 结果：

```text
需求: 验证utf8参数中文提交说明

范围: 配置
```

结论：

- Windows + SlikSVN 下中文提交说明必须使用 UTF-8 文件，并显式传 `--encoding utf-8`。
- Commit Flow 已更新为：
  - Windows 使用公共 ASCII 临时目录。
  - 提交说明统一 LF。
  - commit 命令追加 `--encoding utf-8`。

## 17. 本轮技术验证新结论

新增通过：

- 本机 Node/npm/SVN 环境安装。
- 本机 npm 编译。
- ASCII 本地 SVN 仓库创建。
- 真实 `svn status --xml` 解析。
- 真实 SVN 生成物分类。
- 中文提交说明成功入库。

新增风险：

- SlikSVN 对中文用户名路径下的 `svnadmin create` 和 `commit -F` 文件读取存在问题。
- 插件必须避免把 SVN 临时文件放在中文路径下。
- 后续仍需验证普通中文路径工作副本的 `svn status` 和 `svn commit` 行为。

## 18. 本机环境最终核对

执行时间：2026-07-04

工具版本：

```text
Node.js: v24.18.0
npm: 11.16.0
SVN: 1.14.2-SlikSvn
```

编译：

```text
npm.cmd run compile -> 成功
```

锁文件：

```text
package-lock.json 已由本机 npm 生成，未发现 .pnpm 路径残留。
```

当前验证工作副本状态：

```text
? bin\Debug
? dist
! docs\readme.md
? obj
? src\pages\order\debug.log
```

说明：

- 已提交源码变更和中文提交说明验证用变更。
- 当前剩余状态符合预期：生成物、日志、missing 文件仍留作后续提交页筛选和 missing 文件处理验证。
