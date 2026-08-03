# 贡献指南

本项目当前是内部技术验证版。提交前请使用 Node.js 22 和 npm 10（`nvm use` 可读取 `.nvmrc`），并执行：

```bash
npm ci
npm run verify
npm run package:vsix
npm run validate:vsix-install
```

请遵守以下约束：

- 不提交 API Key、密码、证书私钥、VSIX 或测试生成物。
- 新增或修改行为时，同步补充单元、Webview 或 Extension Host 测试；关键安全/写操作应有分支级覆盖。
- 使用 `npm run lint` 和 `npm run format:check` 保持统一代码风格。
- 提交说明使用清晰的 Conventional Commit 前缀，例如 `feat:`、`fix:`、`test:` 或 `docs:`。
- 发布证据必须由 `npm run evidence:release` 生成；已发布版本的证据目录不得覆盖。
