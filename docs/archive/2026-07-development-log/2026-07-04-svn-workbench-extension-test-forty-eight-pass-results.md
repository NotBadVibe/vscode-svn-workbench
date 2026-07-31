# SVN Workbench 扩展测试记录：48 PASS

日期：2026-07-04

阶段：开发 -> 测试

## 本轮验证目标

验证 AI 团队规则推荐接入后，团队规则页面、AI Provider、提交页、冲突中心、更新流程和既有仓库配置能力没有回归。

## 执行命令

```powershell
npm.cmd run compile
npm.cmd run test:extension
npm.cmd audit
```

## 结果

- TypeScript 编译：通过。
- VS Code 扩展测试：48 PASS。
- npm 安全审计：0 vulnerabilities。

## 本轮新增测试

### 1. builds team rules AI request from repository structure

验证仓库扫描能力：

- 能读取 `src/pages/order`、`src/pages/user` 等业务目录。
- 会排除 `dist` 等生成目录。
- 会收集文件样本供模型判断。

### 2. creates local team rules recommendation

验证本地推荐器：

- 可以从目录推断 `order/user/config/docs` 模块。
- 可以根据配置、文档、测试信号推荐对应前缀。
- 会生成摘要、理由、提醒和置信度。

### 3. normalizes team rules AI recommendation

验证模型输出归一化：

- 非法正则会被本地校验捕获。
- 空前缀列表会被修正。
- 非法置信度会回退为 `medium`。
- 非字符串理由会被过滤。

## 当前完整测试覆盖

当前 48 个扩展测试覆盖：

- 扩展激活与命令注册。
- SVN 状态刷新。
- Quick Diff BASE 内容读取。
- 生成物识别与提交过滤。
- 右键文件夹范围和多选范围边界。
- 根目录与文件夹提交候选收集。
- AI mock 筛选越权拦截。
- AI Provider 预设、模型列表、场景模型路由。
- AI 团队规则推荐请求、本地推荐和模型结果归一化。
- 提交页打开、提交计划预览、提交前远端更新检查。
- 提交说明模板、团队规范、仓库级团队配置。
- 团队规则可视化配置页的输入归一化、校验和保存策略。
- AI 提交说明生成、轻量 diff 摘要、模板补全。
- 当前范围更新预览。
- SVN 冲突解析、冲突中心、AI 冲突建议、标记解决预览。

## 结论

团队规则页已经进入 AI 辅助形态：

- 模型可推荐。
- 本地可回退。
- 推荐只应用到表单。
- 保存仍由用户确认。
- 结果经过本地校验后才可写入仓库配置。
