# SVN Workbench v0.0.2 开发草稿

> 状态：开发中，尚未形成可发布候选。

`v0.0.2` 以 `v0.0.1` 为基线，当前重点是 Windows 中文路径提交回退、Webview 内容安全策略与测试环境可靠性。具体改动和代码位置见 [`变更映射.md`](./变更映射.md)。

## 证据边界

- [`artifacts/imported-pre-migration/`](./artifacts/imported-pre-migration/) 是目录统一前生成的工作树证据，仅用于追溯，不作为发布签字。
- 新的普通验收默认进入 `.validation/evidence/v0.0.2/<运行编号>`，不会改动本目录。
- 只有 `npm run evidence:release` 会建立新的版本证据运行，而且不会覆盖同名目录。
- 正式发布时必须在干净提交上重跑门禁，填写 manifest 的提交、标签、VSIX 和已接受运行。
