# SVN Workbench 扩展测试记录：51 PASS

日期：2026-07-05

阶段：开发 -> 测试

## 本轮验证目标

验证真实 AI 提交文件筛选接入后，提交页、AI Provider、候选文件边界、提交说明、团队规则、冲突中心和更新流程没有回归。

## 执行命令

```powershell
npm.cmd run compile
npm.cmd run test:extension
npm.cmd audit
```

## 结果

- TypeScript 编译：通过。
- VS Code 扩展测试：51 PASS。
- npm 安全审计：0 vulnerabilities。

## 本轮新增测试

### 1. builds commit selection AI request from commit candidates

验证 AI 请求会包含提交候选文件、生成物策略、默认选择和右键范围策略。

### 2. creates local commit selection fallback

验证本地回退逻辑会按候选默认策略分组：

- 常规可提交 -> 推荐。
- 缺失/未版本控制 -> 待确认。
- 生成物 -> 排除。
- 冲突/异常 -> 阻止。

### 3. rejects invented commit selection AI paths

验证 AI 返回结果会拦截：

- 当前范围外路径。
- 当前范围内但不是 SVN 候选文件的虚构路径。
- 相对路径会按仓库根目录解析后再校验。

## 当前完整测试覆盖

当前 51 个扩展测试覆盖：

- 扩展激活与命令注册。
- SVN 状态刷新。
- Quick Diff BASE 内容读取。
- 生成物识别与提交过滤。
- 右键文件夹范围和多选范围边界。
- 根目录与文件夹提交候选收集。
- AI 提交文件筛选请求、本地回退、越权和幻觉路径拦截。
- AI Provider 预设、模型列表、场景模型路由。
- AI 团队规则推荐请求、本地推荐和模型结果归一化。
- 提交页打开、提交计划预览、提交前远端更新检查。
- 提交说明模板、团队规范、仓库级团队配置。
- 团队规则可视化配置页的输入归一化、校验和保存策略。
- AI 提交说明生成、轻量 diff 摘要、模板补全。
- 当前范围更新预览。
- SVN 冲突解析、冲突中心、AI 冲突建议、标记解决预览。

## 结论

提交页 AI 文件筛选已经从 mock 验证推进到可用闭环：

- 可调用模型。
- 可本地回退。
- 自动应用推荐勾选。
- 不自动提交。
- 范围和候选文件双重校验。
