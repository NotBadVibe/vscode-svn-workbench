# SVN Workbench 扩展测试记录：39 PASS

日期：2026-07-04

阶段：技术验证 -> 开发 -> 测试

## 本轮验证目标

验证团队提交规范配置接入后，现有提交页、AI 提交说明、冲突中心、更新流程和 SVN 状态能力没有回归。

## 环境

- 操作系统：Windows
- VS Code 测试宿主：1.104.0
- Node.js：v24.18.0
- npm：11.16.0
- SVN：1.14.2-SlikSvn
- Git：2.55.0.windows.1

## 执行命令

```powershell
npm.cmd run compile
npm.cmd run test:extension
npm.cmd audit
```

## 结果

- TypeScript 编译：通过。
- VS Code 扩展测试：39 PASS。
- npm 安全审计：0 vulnerabilities。

## 本轮新增测试

### 1. validates team commit convention requirements

覆盖：

- 合规格式：`fix(order): PROJ-123 修复订单列表`。
- 缺少前缀、模块、工单号时阻止提交。
- 模块不在白名单时返回明确原因。

### 2. passes team commit convention into commit message AI request

覆盖：

- AI 提交说明请求带上 `convention` 字段。
- 前缀、模块、工单号规则进入模型上下文。
- 规范提示文本包含工单号要求。

### 3. creates convention-aware fallback commit message

覆盖：

- 本地 fallback 可生成 `fix(order): ...` 风格首行。
- 要求工单号时只提醒用户补充真实工单号，不伪造工单号。

## 完整测试范围

当前 39 个扩展测试覆盖：

- 扩展激活与核心命令注册。
- SVN 状态刷新。
- Quick Diff 读取 BASE 内容。
- 生成物识别与提交过滤。
- 右键文件夹范围边界。
- 多选父子目录合并。
- 根目录与文件夹提交候选收集。
- AI mock 筛选越权拦截。
- AI Provider 预设、模型列表与场景模型路由。
- 提交页命令打开。
- 提交计划预览、缺失文件、生成物阻止、越权阻止。
- 提交说明模板与团队提交规范。
- AI 提交说明请求、本地 fallback、轻量 diff 摘要、模板补全。
- commit flow plan 转换与提交 revision 解析。
- 提交前远端更新检查。
- 当前范围更新预览与冲突检测。
- SVN 冲突信息解析、冲突项收集、AI 冲突建议、resolve 预览与输出解析。

## 结论

团队提交规范能力已经完成第一版闭环：

- 可配置。
- 可提示。
- 可校验。
- 可影响 AI 生成。
- 可阻止不合规提交。
- 不影响既有 36 个测试场景。
