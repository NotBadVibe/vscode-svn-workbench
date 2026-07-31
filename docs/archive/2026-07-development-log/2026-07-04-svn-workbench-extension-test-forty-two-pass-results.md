# SVN Workbench 扩展测试记录：42 PASS

日期：2026-07-04

阶段：开发 -> 测试

## 本轮验证目标

验证仓库级 `.svn-workbench.json` 团队配置接入后，提交页、AI 提交说明、冲突中心、更新流程和既有提交安全机制没有回归。

## 执行命令

```powershell
npm.cmd run compile
npm.cmd run test:extension
npm.cmd audit
```

## 结果

- TypeScript 编译：通过。
- VS Code 扩展测试：42 PASS。
- npm 安全审计：0 vulnerabilities。

## 本轮新增测试

### 1. parses repository team config commit convention

验证 `.svn-workbench.json` 中的 `commitConvention` 可以被解析，并会清理无效数组项、去重模块和前缀。

### 2. resolves repository team config over workspace settings

验证仓库配置存在时优先参与最终规范解析，并可以让如下提交说明通过：

```text
config(payment): PAY-321 调整支付配置
```

### 3. creates default repository team config file

验证 `SVN: Open Team Config` 底层创建逻辑：

- 首次会创建 `.svn-workbench.json` 默认模板。
- 文件已存在时不覆盖。

## 当前完整测试覆盖

当前 42 个扩展测试覆盖：

- 扩展激活与核心命令注册。
- SVN 状态刷新。
- Quick Diff BASE 内容读取。
- 生成物识别与提交过滤。
- 右键文件夹范围和多选范围边界。
- 根目录与文件夹提交候选收集。
- AI mock 筛选越权拦截。
- AI Provider 预设、模型列表、场景模型路由。
- 提交页打开、提交计划预览、提交前远端更新检查。
- 提交说明模板、团队规范、仓库级团队配置。
- AI 提交说明生成、轻量 diff 摘要、模板补全。
- 当前范围更新预览。
- SVN 冲突解析、冲突中心、AI 冲突建议、标记解决预览。

## 结论

仓库级团队配置已经形成闭环：

- 可创建。
- 可提交进仓库。
- 可跨平台读取。
- 可覆盖个人设置。
- 可驱动提交页校验和 AI 提交说明。
