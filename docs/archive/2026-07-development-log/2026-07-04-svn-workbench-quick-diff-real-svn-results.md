# SVN Workbench Quick Diff 真实 SVN 命令验证结果

> 阶段：技术验证  
> 日期：2026-07-04  
> 环境：Windows + SlikSVN 1.14.2 + 本机验证工作副本

## 1. 验证命令

验证 Quick Diff 所依赖的基线读取命令：

```text
svn cat -r BASE <file>
```

验证工作副本：

```text
C:\svn-workbench-validation-test-wc
```

## 2. 已版本控制文件

命令：

```text
svn cat -r BASE C:\svn-workbench-validation-test-wc\src\pages\order\OrderList.vue
```

结果：

```text
成功返回 BASE 内容
```

结论：

- Modified/Normal 文件可直接用于 `svn-base` Quick Diff。
- 当前测试文件已经在前序验证中提交过，所以状态不再是 modified，但命令路径和 BASE 读取能力成立。

## 3. Missing 文件

命令：

```text
svn cat -r BASE C:\svn-workbench-validation-test-wc\docs\readme.md
```

结果：

```text
成功返回 BASE 内容
```

结论：

- Missing 文件也可以通过工作副本元数据读取 BASE。
- 后续 Diff UI 可以支持“左侧 BASE，右侧缺失/空内容”的恢复场景。

## 4. Unversioned 文件

命令：

```text
svn cat -r BASE C:\svn-workbench-validation-test-wc\src\pages\order\debug.log
```

结果：

```text
svn: warning: W200005: '<file>' is not under version control
svn: E200009: Could not cat all targets because some targets are not versioned
svn: E200009: Illegal target for the requested operation
```

结论：

- Unversioned 文件没有 BASE，这是 SVN 的正常行为。
- 当前实现会返回空内容，但后续正式 UI 应明确展示“新增文件，无基线版本”。

## 5. 技术结论

Quick Diff 基线读取在当前 Windows/SlikSVN 环境下通过：

- 已版本控制文件：通过。
- Missing 文件：通过。
- Unversioned 文件：符合预期失败，需要 UI 友好化。

下一步建议：

- 在 Extension Host 中肉眼验收 Source Control 分组和 Quick Diff。
- 为新增文件、未版本控制文件、missing 文件分别补差异视图提示。
- 在 macOS 环境复跑同一组三类文件验证，保证两个平台标准一致。
