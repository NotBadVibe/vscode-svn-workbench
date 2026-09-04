import { expect, test, type Page } from "@playwright/test";

/**
 * V018-G 生命周期收口（v0.1.8 规划 §4.7/§6）。
 *
 * - Diff：同一堆内连续 100 次页内目标切换（mock `open-diff`，与界面同通道），
 *   采样 DOM 节点数 + `performance.memory.usedJSHeapSize`，断言无持续增长。
 * - 冲突：同一堆内 Diff/Conflicts 整树交替挂载/卸载 100 次（`open-diff` 新会话 +
 *   `open-module:conflicts`，两棵树全量走生产挂载/清理路径），同口径采样断言。
 * - 主题：三主题（浅色/深色/高对比）快速循环后 Diff/Conflicts 无泄漏、无异常。
 * - 降级恢复链：500 块简化档 → 简化编辑器编辑 → 恢复完整视图 → 保存成功。
 *
 * 断言平台无关（文本/testid/角色/DOM 规模与堆趋势，无像素、无毫秒硬门禁，
 * 无 waitForTimeout）。采样序列经 console 输出，落盘证据见
 * `.validation/evidence/v0.1.8/<run>/`（测量脚本侧）。
 */

interface LifecycleSample {
  step: number;
  domNodes: number;
  heapBytes: number | null;
}

async function sampleLifecycle(
  page: Page,
): Promise<Omit<LifecycleSample, "step">> {
  return page.evaluate((): Omit<LifecycleSample, "step"> => {
    const withMemory = performance as Performance & {
      memory?: { usedJSHeapSize?: number };
    };
    const heap = withMemory.memory?.usedJSHeapSize;
    return {
      domNodes: document.querySelectorAll("*").length,
      heapBytes: typeof heap === "number" ? Math.round(heap) : null,
    };
  });
}

/** 与界面同通道派发 mock 动作（等同用户点击触发的 open-diff）。 */
async function dispatchOpenDiff(
  page: Page,
  relativePath: string,
): Promise<void> {
  await page.evaluate((target: string) => {
    window.dispatchEvent(
      new CustomEvent("svn-workbench:mock-action", {
        detail: {
          protocolVersion: 2,
          type: "workbench/action",
          moduleId: "diff",
          taskId: "diff/working",
          sessionId: "mock-session-id",
          repositoryUuid: "mock-repository-uuid",
          scopeHash: "mock-scope-hash",
          payload: { action: "open-diff", data: { relativePath: target } },
        },
      }),
    );
  }, relativePath);
}

function logSamples(label: string, samples: LifecycleSample[]): void {
  console.log(`${label} ${JSON.stringify(samples)}`);
}

/**
 * 无持续增长断言：DOM 节点数稳定为主要门禁（确定性），堆为有界性兜底
 * （Chromium GC 时机不确定，只防失控增长，不做精确趋势门禁）。
 */
function assertNoSustainedGrowth(
  samples: LifecycleSample[],
  label: string,
): void {
  expect(samples.length).toBeGreaterThan(1);
  const first = samples[0];
  const last = samples[samples.length - 1];
  const domGrowth = last.domNodes - first.domNodes;
  expect(
    domGrowth,
    `${label}：DOM 节点持续增长 ${domGrowth}（${first.domNodes}→${last.domNodes}）：${JSON.stringify(samples.map((item) => item.domNodes))}`,
  ).toBeLessThanOrEqual(Math.max(60, Math.ceil(first.domNodes * 0.15)));
  const heaps = samples
    .map((item) => item.heapBytes)
    .filter((value): value is number => typeof value === "number");
  if (heaps.length >= 2) {
    const heapGrowth = heaps[heaps.length - 1] - heaps[0];
    expect(
      heapGrowth,
      `${label}：堆失控增长 ${heapGrowth}（${heaps[0]}→${heaps[heaps.length - 1]}）`,
    ).toBeLessThanOrEqual(Math.max(8_000_000, heaps[0]));
  }
}

const DIFF_SWITCH_FILES = [
  "src/app/v018g-alpha.ts",
  "src/app/v018g-beta.ts",
] as const;

test("V018-G1：Diff 连续 100 文件切换无持续增长", async ({ page }) => {
  test.setTimeout(240_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  await page.goto("/?module=diff", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("BASE ↔ 工作副本 · typescript")).toBeVisible({
    timeout: 30_000,
  });

  const samples: LifecycleSample[] = [
    { step: 0, ...(await sampleLifecycle(page)) },
  ];
  for (let index = 1; index <= 100; index += 1) {
    const target = DIFF_SWITCH_FILES[index % DIFF_SWITCH_FILES.length];
    await dispatchOpenDiff(page, target);
    await expect(
      page.getByRole("region", { name: `差异：${target}` }),
    ).toBeVisible({ timeout: 15_000 });
    if (index % 10 === 0 || index === 100) {
      samples.push({ step: index, ...(await sampleLifecycle(page)) });
    }
  }

  logSamples("V018G-DIFF-100-SWITCH", samples);
  assertNoSustainedGrowth(samples, "Diff 连续 100 文件切换");
  expect(pageErrors).toEqual([]);
});

/*
 * Conflicts 页内选文件在 mock 回环恒指向首文件（`conflict/select` 重发默认快照），
 * 字面意义的百次行点击无法形成挂载/卸载循环。本用例改用生产等价的整树切换：
 * `open-diff`（新会话 + 新快照挂载 Diff 整树）与 `open-module:conflicts`
 *（挂载 Conflicts 整树，含 ConflictDiffView/ConflictResultEditor）交替 100 次，
 * 同一堆内验证两棵树的实例/observer/内存无持续增长。
 */
async function dispatchOpenModule(page: Page, moduleId: string): Promise<void> {
  await page.evaluate((target: string) => {
    window.dispatchEvent(
      new CustomEvent("svn-workbench:mock-action", {
        detail: {
          protocolVersion: 2,
          type: "workbench/action",
          moduleId: target,
          taskId: `${target}/overview`,
          sessionId: "mock-session-id",
          repositoryUuid: "mock-repository-uuid",
          scopeHash: "mock-scope-hash",
          payload: { action: "open-module", data: { moduleId: target } },
        },
      }),
    );
  }, moduleId);
}

test("V018-G1：Diff/Conflicts 连续 100 次整树切换无持续增长", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  await page.goto("/?module=diff", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("BASE ↔ 工作副本 · typescript")).toBeVisible({
    timeout: 30_000,
  });

  const samples: LifecycleSample[] = [
    { step: 0, ...(await sampleLifecycle(page)) },
  ];
  for (let index = 1; index <= 100; index += 1) {
    if (index % 2 === 1) {
      await dispatchOpenModule(page, "conflicts");
      await expect(
        page.getByRole("heading", { name: "待处理冲突" }),
      ).toBeVisible({ timeout: 15_000 });
    } else {
      await dispatchOpenDiff(page, "src/extension.ts");
      await expect(page.getByText("BASE ↔ 工作副本 · typescript")).toBeVisible({
        timeout: 15_000,
      });
    }
    if (index % 10 === 0 || index === 100) {
      samples.push({ step: index, ...(await sampleLifecycle(page)) });
    }
  }

  logSamples("V018G-DIFF-CONFLICTS-100-SWITCH", samples);
  assertNoSustainedGrowth(samples, "Diff/Conflicts 连续 100 次整树切换");
  expect(pageErrors).toEqual([]);
});

const LIFECYCLE_THEMES = [
  {
    id: "light",
    bodyClass: "vscode-light",
    foreground: "#242424",
    background: "#ffffff",
  },
  {
    id: "dark",
    bodyClass: "vscode-dark",
    foreground: "#cccccc",
    background: "#1e1e1e",
  },
  {
    id: "highContrast",
    bodyClass: "vscode-high-contrast",
    foreground: "#ffffff",
    background: "#000000",
  },
] as const;

async function applyLifecycleTheme(
  page: Page,
  theme: (typeof LIFECYCLE_THEMES)[number],
): Promise<void> {
  await page.evaluate((entry) => {
    document.documentElement.style.setProperty(
      "--vscode-foreground",
      entry.foreground,
    );
    document.documentElement.style.setProperty(
      "--vscode-editor-foreground",
      entry.foreground,
    );
    document.documentElement.style.setProperty(
      "--vscode-editor-background",
      entry.background,
    );
    document.body.classList.remove(
      "vscode-light",
      "vscode-dark",
      "vscode-high-contrast",
    );
    document.body.classList.add(entry.bodyClass);
  }, theme);
}

test("V018-G1：三主题快速切换后 Diff/Conflicts 无泄漏", async ({ page }) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  // Diff 页：三主题 × 三轮快速切换。
  await page.goto("/?module=diff", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("BASE ↔ 工作副本 · typescript")).toBeVisible({
    timeout: 30_000,
  });
  const diffBaseline = await sampleLifecycle(page);
  for (let round = 0; round < 3; round += 1) {
    for (const theme of LIFECYCLE_THEMES) {
      await applyLifecycleTheme(page, theme);
      await expect(page.getByText("BASE ↔ 工作副本 · typescript")).toBeVisible({
        timeout: 15_000,
      });
    }
  }
  const diffAfter = await sampleLifecycle(page);
  const diffSamples: LifecycleSample[] = [
    { step: 0, ...diffBaseline },
    { step: 9, ...diffAfter },
  ];
  logSamples("V018G-DIFF-THEME", diffSamples);
  assertNoSustainedGrowth(diffSamples, "Diff 三主题切换");

  // Conflicts 页：同样三轮快速切换。
  await page.goto("/?module=conflicts", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "待处理冲突" })).toBeVisible({
    timeout: 30_000,
  });
  const conflictsBaseline = await sampleLifecycle(page);
  for (let round = 0; round < 3; round += 1) {
    for (const theme of LIFECYCLE_THEMES) {
      await applyLifecycleTheme(page, theme);
      await expect(
        page.getByRole("heading", { name: "待处理冲突" }),
      ).toBeVisible({ timeout: 15_000 });
    }
  }
  const conflictsAfter = await sampleLifecycle(page);
  const conflictsSamples: LifecycleSample[] = [
    { step: 0, ...conflictsBaseline },
    { step: 9, ...conflictsAfter },
  ];
  logSamples("V018G-CONFLICTS-THEME", conflictsSamples);
  assertNoSustainedGrowth(conflictsSamples, "Conflicts 三主题切换");

  expect(pageErrors).toEqual([]);
});

interface CapturedMockAction {
  payload?: {
    action?: unknown;
    data?: { content?: unknown };
  };
}

async function setupLifecycleCapture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (
      window as unknown as { __capturedActions?: CapturedMockAction[] }
    ).__capturedActions = [];
    window.addEventListener("svn-workbench:mock-action", (event: Event) => {
      const detail = (event as CustomEvent).detail as CapturedMockAction;
      (
        window as unknown as { __capturedActions?: CapturedMockAction[] }
      ).__capturedActions?.push(detail);
    });
  });
}

async function getLifecycleActions(page: Page): Promise<CapturedMockAction[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __capturedActions?: CapturedMockAction[] })
        .__capturedActions ?? [],
  );
}

async function clearLifecycleActions(page: Page): Promise<void> {
  await page.evaluate(() => {
    (
      window as unknown as { __capturedActions?: CapturedMockAction[] }
    ).__capturedActions = [];
  });
}

/** 捕获到的指定动作中是否出现携带标记文本的草稿/保存内容。 */
function actionCarriesMarker(
  actions: CapturedMockAction[],
  actionName: string,
  marker: string,
): boolean {
  return actions.some((item) => {
    if (item.payload?.action !== actionName) return false;
    const content = item.payload?.data?.content;
    return typeof content === "string" && content.includes(marker);
  });
}

test("V018-G1：500 块降级→简化编辑→恢复完整视图→保存", async ({ page }) => {
  test.setTimeout(240_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  await setupLifecycleCapture(page);

  await page.goto("/?module=conflicts&conflictBlocks=500&conflictLines=12000", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("heading", { name: "待处理冲突" })).toBeVisible({
    timeout: 60_000,
  });
  // 简化档：降级摘要可见，当前模式为简化编辑器。
  await expect(page.getByTestId("conflict-perf-summary")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId("conflict-perf-mode")).toContainText(
    "简化编辑器",
  );

  // 简化编辑：切换到简化编辑器并真实输入，草稿同步不断。
  await page.getByTestId("use-simplified-perf").click();
  await expect(page.getByTestId("simplified-fallback-notice")).toBeVisible({
    timeout: 30_000,
  });
  const simplifiedContent = page
    .locator(".conflict-codemirror-host .cm-content")
    .first();
  await expect(simplifiedContent).toBeVisible({ timeout: 30_000 });
  // V018-G 实测发现：简化编辑器每次草稿回环后焦点回到 BODY（见遗留），
  // 连续键入会被吞键；此处经剪贴板单次粘贴原子落稿，仍为真实编辑链路
  //（一次 docChanged→draft-update），且与平台无关（ControlOrMeta 按平台解析）。
  const editMarker = "v018g-ok";
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate((marker: string) => {
    void navigator.clipboard.writeText(`// ${marker}`);
  }, editMarker);
  await simplifiedContent.click({ position: { x: 20, y: 20 } });
  await expect(simplifiedContent).toBeFocused({ timeout: 15_000 });
  await page.keyboard.press("ControlOrMeta+v");
  await expect(page.getByText("Host 内存草稿已同步")).toBeVisible({
    timeout: 30_000,
  });

  // CodeMirror 只渲染视口行，DOM 文本断言不可靠：以捕获到的 draft-update
  // 动作内容携带标记文本为准（编辑器→mergeDraft→草稿链路真实走通）。
  await expect
    .poll(
      async () =>
        actionCarriesMarker(
          await getLifecycleActions(page),
          "conflict/draft-update",
          "v018g-ok",
        ),
      { timeout: 30_000 },
    )
    .toBe(true);

  // 恢复完整视图：降级可逆，草稿保留（强制完整视图横幅可见）。
  await page.getByTestId("restore-full-perf").click();
  await expect(page.getByTestId("conflict-perf-forced")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("restore-perf-perf")).toBeVisible({
    timeout: 30_000,
  });

  // 保存：合并结果落盘成功，且保存内容携带简化编辑器输入（恢复未丢稿）。
  const saveButton = page.getByRole("button", {
    name: "保存工作副本合并结果",
  });
  await expect(saveButton).toBeEnabled({ timeout: 30_000 });
  await clearLifecycleActions(page);
  await saveButton.click();
  await expect
    .poll(
      async () =>
        actionCarriesMarker(
          await getLifecycleActions(page),
          "conflict/save-working",
          "v018g-ok",
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
  await expect(
    page.getByText("工作副本合并结果已保存；请生成解决预览。"),
  ).toBeVisible({ timeout: 30_000 });

  expect(pageErrors).toEqual([]);
});
