# SVN Workbench 扩展测试记录：83 PASS

日期：2026-07-06

阶段：开发 -> 测试

## 本轮验证内容

本轮新增“按阻止原因重生成拆分”的输入范围优化：

- 核心层支持按阻止原因收集阻止项路径。
- 页面层在重新生成拆分建议时优先使用当前阻止原因相关路径。
- 页面层会将阻止项路径映射为当前可用候选文件。
- 如果当前原因下没有可用候选文件，则回退到当前已选文件。

## 执行命令

```powershell
npm.cmd run compile
npm.cmd run test:extension
npm.cmd audit
```

## 结果

- TypeScript 编译：通过
- VS Code Extension Host 测试：83 PASS
- npm audit：found 0 vulnerabilities

## 新增测试用例

新增：

- `collects commit split queue preview issue paths by reason`

覆盖点：

- 按候选列表缺失原因收集路径并去重。
- 按范围不匹配原因收集路径。
- 缺失预览详情时回退到原拆分建议路径。

## 当前测试基线

当前自动化测试从 82 个增加到 83 个。

覆盖范围继续保持：

- SVN 环境检查与状态刷新
- 右键范围与多选范围保护
- 提交候选文件筛选
- AI 文件选择
- AI 拆分提交建议
- 拆分队列状态、计划、预览、重试、草稿、提交生命周期
- 阻止项详情、分组、原因筛选、处理建议、快捷动作、按原因重生成拆分
- 提交计划预览与提交安全
- 提交说明模板、规范、AI 生成
- 远端更新检查
- 更新预览
- 冲突中心与 AI 冲突建议

