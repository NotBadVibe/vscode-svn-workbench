import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { openModule } from "./navigation";

const evidenceDirectory =
  process.env.SVN_WORKBENCH_EVIDENCE_DIR ??
  path.join(".validation", "evidence", "unscoped", `playwright-${process.pid}`);
const artifactDirectory = path.join(evidenceDirectory, "pages");
mkdirSync(artifactDirectory, { recursive: true });
const darkTheme = {
  "--vscode-foreground": "#cccccc",
  "--vscode-editor-foreground": "#d4d4d4",
  "--vscode-editor-background": "#1e1e1e",
  "--vscode-sideBar-background": "#181818",
  "--vscode-editorWidget-background": "#252526",
  "--vscode-descriptionForeground": "#a8a8a8",
  "--vscode-panel-border": "#3c3c3c",
  "--vscode-focusBorder": "#007fd4",
  "--vscode-button-background": "#0e639c",
  "--vscode-button-foreground": "#ffffff",
  "--vscode-editorLineNumber-foreground": "#858585",
  "--vscode-editorGutter-background": "#1e1e1e",
  "--vscode-editor-selectionBackground": "#264f78",
  // 差异组件映射层依赖的 VS Code 默认值（Dark+ 主题）
  "--vscode-gitDecoration-addedResourceForeground": "#81b88b",
  "--vscode-gitDecoration-deletedResourceForeground": "#c74e39",
  "--vscode-diffEditor-insertedTextBackground": "rgba(156, 204, 44, 0.2)",
  "--vscode-diffEditor-removedTextBackground": "rgba(255, 0, 0, 0.3)",
} as const;

const acceptanceCaptureCss = `
    html[data-acceptance-capture="full"],
    html[data-acceptance-capture="full"] body,
    html[data-acceptance-capture="full"] #app {
      height: auto !important;
      min-height: 100% !important;
      overflow: visible !important;
    }
    html[data-acceptance-capture="full"] .workbench-shell {
      height: auto !important;
      min-height: 960px !important;
    }
    html[data-acceptance-capture="full"] .workbench-main {
      min-height: 960px !important;
    }
    html[data-acceptance-capture="full"] .workbench-content {
      overflow: visible !important;
    }
  `;

async function preparePage(page: Page, url = "/"): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 960 });
  // init script 在每次导航前注入主题与验收截图样式，模块切换（重新 goto）后仍然生效。
  await page.addInitScript(
    ({ values, css }) => {
      // init script 在文档创建早期执行，此时 documentElement/body 尚不存在；
      // 轮询等待 DOM 就绪后注入主题变量与验收样式，保证跨导航（重新 goto）生效。
      const timer = window.setInterval(() => {
        if (!document.documentElement || !document.body) {
          return;
        }
        for (const [name, value] of Object.entries(values)) {
          document.documentElement.style.setProperty(name, value);
        }
        document.body.classList.add("vscode-dark");
        if (!document.getElementById("acceptance-capture-style")) {
          const style = document.createElement("style");
          style.id = "acceptance-capture-style";
          style.textContent = css;
          document.head.appendChild(style);
        }
        window.clearInterval(timer);
      }, 20);
    },
    { values: darkTheme, css: acceptanceCaptureCss },
  );
  await page.goto(url);
  await expect(page.locator(".workbench-shell")).toBeVisible();
}

async function capture(page: Page, name: string): Promise<void> {
  await expect(page.locator('.module-state[aria-busy="true"]')).toHaveCount(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations, `${name} 存在 axe 可访问性问题`).toEqual([]);
  await page.evaluate(() => {
    document.documentElement.dataset.acceptanceCapture = "full";
  });
  try {
    await page.screenshot({
      path: `${artifactDirectory}/${name}.png`,
      animations: "disabled",
      fullPage: true,
    });
  } finally {
    await page.evaluate(() => {
      delete document.documentElement.dataset.acceptanceCapture;
    });
  }
}

test("保存每个 Svelte 功能页面的验收截图", async ({ page }) => {
  await preparePage(page);

  await test.step("Changes", async () => {
    await expect(
      page.getByRole("list", { name: "SVN 变更文件" }),
    ).toBeVisible();
    await capture(page, "01-changes");
  });

  await test.step("Diff", async () => {
    await page
      .getByRole("button", { name: "查看 src/extension.ts 差异" })
      .click();
    await expect(page.getByText("BASE ↔ 工作副本 · typescript")).toBeVisible();
    await capture(page, "02-diff");
  });

  await test.step("Commit", async () => {
    await openModule(page, "提交");
    await page.getByRole("button", { name: "生成建议草稿" }).click();
    // V014-D：无预览时唯一主操作为“预览提交 N 个文件”。
    await page.getByRole("button", { name: /预览提交/ }).click();
    await expect(page.getByText("范围、状态和远端检查已通过")).toBeVisible();
    await capture(page, "03-commit");
  });

  await test.step("History", async () => {
    await openModule(page, "历史");
    await page.getByRole("button", { name: "查看逐行责任" }).click();
    await expect(page.getByLabel("文件逐行责任")).toBeVisible();
    await capture(page, "04-history");
  });

  await test.step("Conflicts", async () => {
    await openModule(page, "冲突");
    await page.getByText("需要帮助（合并建议与解释）").click();
    await page.getByRole("button", { name: "AI 分析" }).click();
    await expect(page.getByText("两侧都修改了同一处行为")).toBeVisible();
    await page.getByRole("button", { name: "生成解决预览" }).click();
    await expect(
      page.getByRole("button", { name: "确认使用当前工作副本内容并标记解决" }),
    ).toBeVisible();
    await capture(page, "05-conflicts");
  });

  await test.step("Changelists", async () => {
    await openModule(page, "变更集");
    await page.getByRole("button", { name: "生成分组建议" }).click();
    await page.getByRole("button", { name: "套用并调整" }).click();
    await page.getByRole("button", { name: "生成应用预览" }).click();
    await expect(
      page.locator(".changelist-preview > code").first(),
    ).toBeVisible();
    await expect(
      page.locator(".changelist-preview > code").first(),
    ).toContainText('svn changelist "webview"');
    await capture(page, "06-changelists");
  });

  await test.step("Understanding", async () => {
    await openModule(page, "变更解读");
    await expect(
      page.getByText(/理解当前修改、找出需要确认的风险/),
    ).toBeVisible();
    await page.getByRole("button", { name: "只运行本地检查" }).click();
    await expect(
      page.getByRole("heading", { name: "这次改了什么" }),
    ).toBeVisible();
    await capture(page, "07-understanding");
  });

  await test.step("Update", async () => {
    // v0.0.17 批次 A/B：更新独立模块，结果页常驻冲突 CTA。
    await openModule(page, "更新");
    await page.getByRole("button", { name: "生成更新预览" }).click();
    await expect(page.getByText("中风险")).toBeVisible();
    await capture(page, "09-update-preview");
  });

  await test.step("Repository", async () => {
    await openModule(page, "仓库操作");
    // v0.0.17 批次 D：任务分组默认折叠“维护与迁移”与“危险操作”，先展开。
    await page
      .locator('[data-task-group="maintenance"]')
      .getByRole("button", { name: /维护与迁移/ })
      .click();
    await page.getByRole("button", { name: "清理与恢复", exact: true }).click();
    await page.getByRole("button", { name: "生成清理预览" }).click();
    await expect(
      page.locator(".property-preview > code").first(),
    ).toBeVisible();
    await expect(
      page.locator(".property-preview > code").first(),
    ).toContainText("svn cleanup");
    await capture(page, "10-repository-recovery");
    await page.getByRole("button", { name: "发布说明", exact: true }).click();
    await page.getByRole("button", { name: "从 SVN 历史生成" }).click();
    await expect(page.getByText("3 条修订")).toBeVisible();
    await capture(page, "10a-repository-browser-release-notes");
  });

  await test.step("Repository destructive advanced preview", async () => {
    await page
      .locator('[data-task-group="dangerous"]')
      .getByRole("button", { name: /危险操作/ })
      .click();
    await page.getByRole("button", { name: "切换", exact: true }).click();
    await page
      .getByRole("textbox", { name: "目标 URL" })
      .fill("https://svn.example.test/repos/workbench/branches/next");
    await page
      .getByRole("button", { name: "生成切换工作副本（Switch）预览" })
      .click();
    await expect(
      page.getByRole("heading", { name: "切换工作副本", exact: true }).last(),
    ).toBeVisible();
    // V015-C2：前置复选框已移除，预览后直开意向单一次确认。
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await page.getByRole("button", { name: "确认执行切换工作副本" }).click();
    await expect(
      page.getByRole("dialog", { name: "切换工作副本" }),
    ).toBeVisible();
    await capture(page, "10b-repository-destructive-preview");
  });

  await test.step("Settings AI", async () => {
    await openModule(page, "设置");
    await expect(
      page.getByRole("heading", { name: "设置与团队规范" }),
    ).toBeVisible();
    await capture(page, "11-settings-ai");
  });

  await test.step("Settings Team", async () => {
    await page.getByRole("tab", { name: "团队提交规范" }).click();
    await page.getByRole("button", { name: "AI 推荐" }).click();
    await expect(
      page.getByText("已根据仓库目录生成团队规则建议。"),
    ).toBeVisible();
    await capture(page, "12-settings-team");
  });

  await test.step("Settings SVN Security", async () => {
    await page.getByRole("tab", { name: "SVN 安全" }).click();
    await expect(
      page.getByRole("heading", { name: "SVN 用户认证" }),
    ).toBeVisible();
    await capture(page, "13-settings-svn-security");
  });

  await test.step("Diagnostics", async () => {
    await openModule(page, "诊断");
    const acceptanceTab = page.getByRole("tab", { name: "验收清单" });
    if ((await acceptanceTab.count()) > 0) {
      await acceptanceTab.click();
      await page.getByRole("button", { name: "核心流程" }).click();
      await expect(page.getByText("确认安全提交链路。")).toBeVisible();
    } else {
      await expect(
        page.getByRole("heading", { name: "环境诊断", exact: true }).last(),
      ).toBeVisible();
    }
    await capture(page, "13-diagnostics");
  });
});

test("保存 5000 文件窗口化页面截图", async ({ page }) => {
  await preparePage(page, "/?dataset=large");
  const list = page.getByRole("list", { name: "SVN 变更文件" });
  await expect(list).toHaveClass(/file-list--virtual/);
  expect(await list.getByRole("listitem").count()).toBeLessThan(100);
  await capture(page, "14-changes-5000-files");
});

test("保存 SVN 认证恢复页面截图", async ({ page }) => {
  await preparePage(page, "/?error=authentication");
  await expect(page.getByRole("button", { name: "配置认证" })).toBeVisible();
  await expect(page.getByText("密码只通过标准输入交给 SVN")).toBeVisible();
  await capture(page, "15-authentication-recovery");
});

test("保存 SVN 证书核对页面截图", async ({ page }) => {
  await preparePage(page, "/?error=certificate");
  await expect(page.getByText("svn.example.test:8443")).toBeVisible();
  await expect(page.getByText("AA:BB:CC:DD:EE:FF:00:11")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "核对并信任证书" }),
  ).toBeEnabled();
  await capture(page, "16-certificate-recovery");
});

test("保存 SVN 代理恢复页面截图", async ({ page }) => {
  await preparePage(page, "/?error=proxy");
  await expect(page.getByText("代理连接失败")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "打开 VS Code 代理设置" }),
  ).toBeVisible();
  await capture(page, "17-proxy-recovery");
});
