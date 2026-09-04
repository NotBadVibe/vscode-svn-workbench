import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Webview Content Security Policy", () => {
  it("allows Vite dynamic import chunks from the Webview resource origin", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/extension/workbench/renderWebviewShell.ts"),
      "utf8",
    );

    expect(source).toContain(
      "script-src 'nonce-${nonce}' ${webview.cspSource}",
    );
  });

  it("V018-B Worker 未启用：CSP 无 worker-src/blob，改动需同步更新本断言", () => {
    // V018B_WORKER_DISPOSITION（diffPerformancePolicy.ts）：Worker no-go，
    // CSP 不动。启用 Worker 必须补最小授权 worker-src 并验证 vite 打包。
    const source = readFileSync(
      resolve(process.cwd(), "src/extension/workbench/renderWebviewShell.ts"),
      "utf8",
    );

    expect(source).not.toContain("worker-src");
    expect(source).not.toContain("child-src");
    expect(source).not.toContain("blob:");
    expect(source).toMatch(/randomBytes\(32\)\.toString\(["']base64url["']\)/);
    expect(source).not.toContain("Math.random");
  });
});
