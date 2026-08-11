import { expect, type Page } from "@playwright/test";

/**
 * 0.0.5 每个功能模块一个独立 Webview 窗口：mock 通过 `?module=` 查询参数
 * 模拟 Host 打开指定模块窗口（等同右键菜单/命令入口）。Rail 已移除，
 * e2e 通过重新导航到目标模块窗口来切换模块，保留其余查询参数（dataset 等）。
 */
const moduleIdByLabel: Record<string, string> = {
  本地修改: "changes",
  提交: "commit",
  历史: "history",
  冲突: "conflicts",
  变更集: "changelists",
  "AI 审查": "ai-review",
  影响分析: "impact",
  任务代理: "agent",
  仓库操作: "repository",
  设置: "settings",
  诊断: "diagnostics",
};

export async function openModule(page: Page, name: string): Promise<void> {
  const moduleId = moduleIdByLabel[name];
  if (!moduleId) {
    throw new Error(`未知模块：${name}`);
  }
  const url = new URL(page.url());
  url.searchParams.set("module", moduleId);
  await page.goto(url.pathname + url.search);
  await expect(page.locator('.module-state[aria-busy="true"]')).toHaveCount(0);
}
