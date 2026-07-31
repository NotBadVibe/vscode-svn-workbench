# SVN Workbench 扩展测试结果记录：32 项通过

日期：2026-07-04

阶段：开发

命令：

```powershell
npm.cmd run test:extension
```

结果：

```text
Exit code: 0
PASS activates and registers core commands
PASS refreshes status for a validation working copy
PASS reads BASE content through the svn-base provider
PASS classifies generated files for commit filtering
PASS keeps folder operation scope inside the selected folder
PASS merges parent and child roots in multi selection
PASS collects root commit candidates with generated file decisions
PASS collects folder commit candidates inside the selected folder only
PASS rejects out-of-scope AI mock selections
PASS lists editable AI provider presets
PASS validates AI provider configuration
PASS resolves AI scenario model overrides
PASS parses OpenAI-compatible model list
PASS opens commit panel for the selected folder command
PASS builds commit plan preview for missing files
PASS blocks generated files in commit plan preview
PASS blocks out-of-scope files in commit plan preview
PASS validates commit message templates
PASS builds commit message AI request from selected files
PASS creates safe fallback commit message
PASS converts commit preview to commit flow plan
PASS parses committed revision from svn output
PASS parses remote update status from svn xml
PASS checks remote updates for validation working copy
PASS builds update scope preview
PASS parses update revision and conflicts
PASS parses svn conflict info xml
PASS collects conflict items from validation working copy
PASS builds bounded conflict AI request
PASS keeps conflict AI advice decision only
PASS builds resolve conflict preview
PASS parses resolve conflict output
```

## 本轮新增覆盖

| 用例 | 覆盖点 |
| --- | --- |
| builds commit message AI request from selected files | AI 提交说明请求只包含当前勾选文件。 |
| creates safe fallback commit message | 模型不可用时，本地规则可生成可提交的中文草稿。 |

## 当前测试基线

当前自动化覆盖范围：

- 扩展激活与命令注册。
- SVN 状态刷新。
- Quick Diff 的 BASE 内容读取。
- 生成文件过滤策略。
- 右键文件夹/多选 scope 边界。
- 提交候选收集。
- AI 提交筛选越权拦截。
- AI 模型供应商预设。
- AI Provider 配置校验。
- AI 场景模型覆盖。
- OpenAI-compatible 模型列表解析。
- 提交页面打开。
- 提交计划预览。
- 生成文件提交阻止。
- 越权路径提交阻止。
- 提交说明模板。
- AI 提交说明请求构造。
- AI 提交说明本地 fallback。
- 提交流程计划转换。
- 提交 revision 解析。
- 提交前远端更新检查。
- 当前范围更新预览。
- 更新输出冲突识别。
- SVN 冲突 XML 解析。
- 冲突项收集。
- AI 冲突建议请求构造。
- AI 冲突建议安全降级。
- 冲突标记已解决命令预览。
- SVN resolve 输出识别。

## 结论

AI 提交说明生成原型已经进入自动化测试基线。

真实模型生成效果依赖用户配置 API Key 和 `commitMessage` 场景模型，自动化测试不访问真实模型服务。
