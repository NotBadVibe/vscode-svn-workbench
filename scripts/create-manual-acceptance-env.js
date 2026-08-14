const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");

/*
 * v0.0.8 人工验收环境生成器（可重复、安全、低成本）。
 *
 * 覆盖：两个独立 SVN 仓库/工作副本、多根 .code-workspace、
 * svn:externals 归属场景、7 个 modified 批量选择、长中文/空格/# 路径、
 * 同名文件、blocked/conflicted、隐藏选择与刷新失效素材。
 *
 * 安全约束：validationRoot 必须精确匹配固定临时根（ensureSafeValidationPath），
 * 拒绝删除任何未知路径；只对脚本创建的本地 file:// 仓库做初始化提交。
 *
 * 顶层副作用仅在直接执行时发生（require.main === module 守卫）：
 * 纯函数（校验/清单构建/workspace 构建/fixture 数据）可被测试 require。
 */

const repoRoot = path.resolve(__dirname, "..");
/** 固定验收根：统一 os.tmpdir() 下固定目录名（Windows 额外兼容既有盘根默认）。 */
const validationRoot = path.resolve(
  process.env.SVN_WORKBENCH_MANUAL_ENV ||
    path.join(os.tmpdir(), "svn-workbench-manual-ui-acceptance-v2"),
);

/** 第二个独立仓库（多仓库/多工作副本与 externals 场景）。 */
const svnRepo = path.join(validationRoot, "repo");
const svnRepo2 = path.join(validationRoot, "repo2");
const seedDir = path.join(validationRoot, "seed");
const seedDir2 = path.join(validationRoot, "seed2");
const localWc = path.join(validationRoot, "wc");
const remoteWc = path.join(validationRoot, "remote-wc");
const localWc2 = path.join(validationRoot, "wc2");
const remoteWc2 = path.join(validationRoot, "remote-wc2");
const repoUrl = `${pathToFileURL(svnRepo).href}/trunk`;
const repoUrl2 = `${pathToFileURL(svnRepo2).href}/trunk`;
const workspaceFile = path.join(
  validationRoot,
  "svn-workbench-manual-acceptance.code-workspace",
);
const readmeFile = path.join(validationRoot, "README-manual-acceptance.md");

/**
 * 7 个 modified 的相对路径（与 UX08-FLOW-01 批量选择语义对应）。
 * 生成完成时 WC1 第一列文本状态 M 必须恰好等于本集合（脚本自检强制）。
 */
const sevenModifiedFiles = [
  "src/pages/order/OrderList.vue",
  "特殊 路径/订单(#1).ts",
  "docs/empty-target.txt",
  "data/large.txt",
  "assets/sample.bin",
  "src/modules/a/README.md",
  "src/modules/b/README.md",
];

/** 同名文件（不同目录，验证父目录辨识；两者都在 7 个 M 内）。 */
const sameNameFiles = ["src/modules/a/README.md", "src/modules/b/README.md"];

/** externals 归属场景：wc1/vendor/external-lib 指向第二仓库 trunk。 */
const externalDir = "vendor";
const externalName = "external-lib";

function main() {
  ensureSafeValidationPath(validationRoot);
  fs.rmSync(validationRoot, { recursive: true, force: true });
  fs.mkdirSync(validationRoot, { recursive: true });

  // 仓库 1：主工作副本 + 远端模拟。
  run("svnadmin", ["create", svnRepo]);
  createSeedProject(seedDir);
  run("svn", [
    "import",
    seedDir,
    repoUrl,
    "-m",
    "初始化 SVN Workbench 手工验收项目",
    "--encoding",
    "utf-8",
  ]);
  run("svn", ["checkout", repoUrl, localWc]);
  run("svn", ["checkout", repoUrl, remoteWc]);

  // 仓库 2：独立仓库/工作副本 + externals 来源。
  run("svnadmin", ["create", svnRepo2]);
  createSecondRepositorySeed(seedDir2);
  run("svn", [
    "import",
    seedDir2,
    repoUrl2,
    "-m",
    "初始化第二独立仓库（multi-repo 验收）",
    "--encoding",
    "utf-8",
  ]);
  run("svn", ["checkout", repoUrl2, localWc2]);
  run("svn", ["checkout", repoUrl2, remoteWc2]);

  // wc1 设置 svn:externals 指向 repo2/trunk（external 归属场景）。
  setupExternals(localWc);

  prepareLocalChanges(localWc);
  prepareRemoteChanges(remoteWc);
  prepareTextConflict(localWc);
  prepareSecondRepositoryChanges(localWc2, remoteWc2);

  const localStatus = run("svn", ["status", localWc]).stdout.trim();
  const remoteStatus = run("svn", ["status", "--show-updates", localWc], {
    allowFailure: true,
  }).stdout.trim();
  // 生成后自检：任何一项不满足直接抛错，禁止输出可用清单。
  verifyGeneratedEnvironment(localWc, localWc2);
  const readme = buildReadme({ localStatus, remoteStatus });
  fs.writeFileSync(readmeFile, readme, "utf8");
  fs.writeFileSync(
    workspaceFile,
    `${JSON.stringify(buildWorkspaceFile(), null, 2)}\n`,
    "utf8",
  );

  console.log(readme);
  console.log(`\n工作区文件：${workspaceFile}`);
}

function createSeedProject(root) {
  writeFile(
    root,
    "src/pages/order/OrderList.vue",
    [
      "<template>",
      '  <section class="order-list">订单列表</section>',
      "</template>",
      "",
      '<script setup lang="ts">',
      'const moduleName = "order";',
      "</script>",
      "",
    ].join("\n"),
  );
  writeFile(
    root,
    "src/pages/user/UserList.vue",
    [
      "<template>",
      '  <section class="user-list">用户列表</section>',
      "</template>",
      "",
    ].join("\n"),
  );
  writeFile(
    root,
    "src/api/order.ts",
    ["export function fetchOrders() {", "  return [];", "}", ""].join("\n"),
  );
  writeFile(
    root,
    "src/pages/order/DeletedByLocal.ts",
    ["export const deprecatedOrderPage = true;", ""].join("\n"),
  );
  writeFile(
    root,
    "src/pages/conflict/ConflictDemo.vue",
    [
      "<template>",
      '  <section class="conflict-demo">base conflict content</section>',
      "</template>",
      "",
      '<script setup lang="ts">',
      'const owner = "base";',
      "</script>",
      "",
    ].join("\n"),
  );
  writeFile(
    root,
    "config/app.json",
    `${JSON.stringify({ name: "svn-workbench-manual-test", env: "test" }, null, 2)}\n`,
  );
  writeFile(
    root,
    "docs/readme.md",
    "# SVN Workbench 手工验收项目\n\n这是初始文档。\n",
  );
  writeFile(root, "特殊 路径/订单(#1).ts", "export const price = 100;\n");
  writeFile(root, "docs/empty-target.txt", "该内容将在本地被清空。\n");
  writeFile(root, "data/large.txt", `${"large-line\n".repeat(530000)}`);
  writeBuffer(root, "assets/sample.bin", Buffer.from([0x00, 0x01, 0x02, 0xff]));
  // 7 modified 批量选择的其余文件（本地会各追加一行）。
  writeFile(
    root,
    "src/pages/order/PriceCalc.ts",
    "export function calcPrice(item) { return item.price; }\n",
  );
  writeFile(
    root,
    "src/shared/constants.ts",
    "export const APP_NAME = 'workbench';\n",
  );
  // 同名文件：不同目录下的同名 README（父目录辨识）。
  for (const relativePath of sameNameFiles) {
    writeFile(root, relativePath, `# ${relativePath.split("/")[1]} 模块\n`);
  }
  writeFile(
    root,
    ".svn-workbench.json",
    `${JSON.stringify(
      {
        commitConvention: {
          enabled: true,
          requiredPrefix: true,
          allowedPrefixes: ["feat", "fix", "docs", "config", "chore"],
          requiredModule: true,
          allowedModules: ["order", "user", "config", "docs"],
        },
        commitCandidateFilterPresets: [
          {
            id: "frontend-order",
            label: "前端订单模块",
            filters: {
              search: "src/pages/order",
              fileType: "all",
              templateGroup: "frontend",
              hideGenerated: true,
            },
          },
          {
            id: "config-only",
            label: "只看配置文件",
            filters: {
              search: "config",
              fileType: "json",
              templateGroup: "config",
              hideGenerated: true,
            },
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
}

function createSecondRepositorySeed(root) {
  writeFile(
    root,
    "docs/guide.md",
    "# 第二独立仓库\n\n用于多仓库与 svn:externals 归属验收。\n",
  );
  writeFile(
    root,
    "src/lib/util.ts",
    "export function join(a: string, b: string) { return a + b; }\n",
  );
  writeFile(
    root,
    "src/lib/logger.ts",
    "export const log = (v: unknown) => v;\n",
  );
  // 刷新失效素材：本地将修改、远端将删除。
  writeFile(root, "src/lib/stale.ts", "export const stale = true;\n");
}

function setupExternals(wc) {
  const vendorDir = path.join(wc, externalDir);
  fs.mkdirSync(vendorDir, { recursive: true });
  run("svn", ["add", vendorDir]);
  // externals 目标为第二仓库 trunk：vendor/external-lib 归属第二仓库。
  run("svn", [
    "propset",
    "svn:externals",
    `${externalName} ${repoUrl2}`,
    vendorDir,
  ]);
  run("svn", [
    "commit",
    wc,
    "-m",
    "添加 vendor svn:externals（指向第二独立仓库）",
    "--encoding",
    "utf-8",
  ]);
  run("svn", ["update", wc]);
}

function prepareLocalChanges(wc) {
  fs.appendFileSync(
    path.join(wc, "src/pages/order/OrderList.vue"),
    "\n<!-- local: 手工验收本地改动 -->\n",
    "utf8",
  );
  writeFile(
    wc,
    "src/pages/conflict/ConflictDemo.vue",
    [
      "<template>",
      '  <section class="conflict-demo">local conflict content</section>',
      "</template>",
      "",
      '<script setup lang="ts">',
      'const owner = "local";',
      "</script>",
      "",
    ].join("\n"),
  );
  writeFile(
    wc,
    "src/pages/user/UserProfile.vue",
    "<template><section>用户详情</section></template>\n",
  );
  run("svn", ["add", path.join(wc, "src/pages/user/UserProfile.vue")]);
  run("svn", ["delete", path.join(wc, "src/pages/order/DeletedByLocal.ts")]);
  fs.rmSync(path.join(wc, "docs/readme.md"), { force: true });
  writeFile(wc, "src/pages/order/debug.log", "debug log should be excluded\n");
  writeFile(
    wc,
    "src/pages/order/NewFeature.ts",
    "export const enabled = true;\n",
  );
  writeFile(wc, "dist/bundle.js", 'console.log("generated bundle");\n');
  writeFile(wc, "obj/cache.tmp", "generated object cache\n");
  writeFile(wc, "bin/Debug/app.exe", "fake binary placeholder\n");
  writeFile(
    wc,
    "config/local.dev.json",
    `${JSON.stringify({ local: true }, null, 2)}\n`,
  );
  fs.appendFileSync(
    path.join(wc, "特殊 路径/订单(#1).ts"),
    "// 中文、空格、括号与 # 路径验收\n",
    "utf8",
  );
  fs.writeFileSync(path.join(wc, "docs/empty-target.txt"), "", "utf8");
  fs.appendFileSync(
    path.join(wc, "data/large.txt"),
    "local large diff\n",
    "utf8",
  );
  fs.appendFileSync(
    path.join(wc, "assets/sample.bin"),
    Buffer.from([0x00, 0x03]),
  );
  // 同名文件：a 与 b 模块的 README 都修改（均在 7 个 M 内，验证父目录辨识）。
  fs.appendFileSync(
    path.join(wc, "src/modules/a/README.md"),
    "\n<!-- local: a 模块 README 本地改动 -->\n",
    "utf8",
  );
  fs.appendFileSync(
    path.join(wc, "src/modules/b/README.md"),
    "\n<!-- local: b 模块 README 本地改动 -->\n",
    "utf8",
  );
}

function prepareRemoteChanges(wc) {
  fs.appendFileSync(
    path.join(wc, "src/pages/order/OrderList.vue"),
    "\n<!-- remote: 远端同路径改动 -->\n",
    "utf8",
  );
  writeFile(
    wc,
    "src/pages/conflict/ConflictDemo.vue",
    [
      "<template>",
      '  <section class="conflict-demo">remote conflict content</section>',
      "</template>",
      "",
      '<script setup lang="ts">',
      'const owner = "remote";',
      "</script>",
      "",
    ].join("\n"),
  );
  writeFile(
    wc,
    "src/pages/order/RemoteOnly.vue",
    "<template><section>远端新增页面</section></template>\n",
  );
  run("svn", ["add", path.join(wc, "src/pages/order/RemoteOnly.vue")]);
  run("svn", [
    "commit",
    wc,
    "-m",
    "远端制造订单模块更新",
    "--encoding",
    "utf-8",
  ]);
}

/**
 * 第二仓库刷新失效素材：seed 含 stale.ts；localWc2 本地修改它，remoteWc2
 * 删除并提交。WC2 `svn update` 前 stale.ts 为本地 M 且远端有更新标记；
 * update 后成为 tree-conflict（本地修改 + 远端删除），刷新后旧选择被移除
 * 并播报——真实失效，不是“远端新增”冒充。
 */
function prepareSecondRepositoryChanges(wc, remoteWc2Path) {
  fs.appendFileSync(
    path.join(wc, "src/lib/stale.ts"),
    "\n// local: stale.ts 本地修改（将随远端删除成为 tree-conflict）\n",
    "utf8",
  );
  run("svn", ["delete", path.join(remoteWc2Path, "src/lib/stale.ts")]);
  run("svn", [
    "commit",
    remoteWc2Path,
    "-m",
    "第二仓库远端删除 stale.ts（制造刷新失效）",
    "--encoding",
    "utf-8",
  ]);
}

function prepareTextConflict(wc) {
  const conflictPath = path.join(wc, "src/pages/conflict/ConflictDemo.vue");
  run("svn", ["update", conflictPath, "--accept", "postpone"], {
    allowFailure: true,
  });

  const conflictStatus = run("svn", ["status", conflictPath]).stdout;
  if (!/^C\s+/m.test(conflictStatus)) {
    throw new Error(
      `Failed to create expected text conflict for ${conflictPath}.\n${conflictStatus}`,
    );
  }
}

/** 多根 .code-workspace：两个独立工作副本作为 folder。 */
function buildWorkspaceFile() {
  return {
    folders: [
      { path: "wc", name: "WC1-主工作副本（含 externals）" },
      { path: "wc2", name: "WC2-第二独立仓库" },
    ],
    settings: {
      "svnWorkbench.svn.path": "",
    },
  };
}

/**
 * 一页式人工验收清单：明确真人操作步骤与通过/失败记录位；
 * 不得把模拟或 axe 写成真人通过。
 */
function buildReadme({ localStatus, remoteStatus }) {
  return [
    "# SVN Workbench 手工验收环境",
    "",
    `创建时间：${new Date().toISOString()}`,
    "",
    "## 路径",
    "",
    `- 仓库 1：${svnRepo}`,
    `- 工作副本 1：${localWc}`,
    `- 工作副本 1 远端模拟：${remoteWc}`,
    `- 仓库 2：${svnRepo2}`,
    `- 工作副本 2：${localWc2}`,
    `- 工作副本 2 远端模拟：${remoteWc2}`,
    `- externals：${path.join(localWc, externalDir, externalName)}（归属仓库 2）`,
    `- 多根工作区：${workspaceFile}`,
    "",
    "## 打开方式（多根）",
    "",
    "```powershell",
    `code "${workspaceFile}"`,
    "```",
    "",
    "## 预置验收点",
    "",
    "- `src/pages/conflict/ConflictDemo.vue`：真实 SVN 文本冲突（blocked/conflicted）。",
    "- 7 个 modified（批量选择与 UX08-FLOW-01 对应）：",
    ...sevenModifiedFiles.map((item) => `  - \`${item}\``),
    "- `src/pages/user/UserProfile.vue`：已 `svn add`（新增）。",
    "- `src/pages/order/DeletedByLocal.ts`：已 `svn delete`（计划删除）。",
    "- `docs/readme.md`：本地缺失（missing）。",
    "- `src/pages/order/debug.log`、`dist/bundle.js`、`obj/cache.tmp`、`bin/Debug/app.exe`：未版本化生成物（默认排除）。",
    "- `src/pages/order/NewFeature.ts`、`config/local.dev.json`：未版本化普通文件。",
    "- `.svn-workbench.json`：团队提交规范与筛选预设。",
    "- `特殊 路径/订单(#1).ts`：中文、空格、括号与 `#` 路径。",
    "- `docs/empty-target.txt`、`assets/sample.bin`、`data/large.txt`：空文本、二进制、超 5 MB Diff 降级。",
    "- 同名文件：`src/modules/a/README.md` 与 `src/modules/b/README.md`（均已本地修改）。",
    "- externals：`vendor/external-lib` 归属仓库 2；环境诊断应显示“外部引用”。",
    "- 刷新失效素材（真实）：WC2 的 `src/lib/stale.ts` 本地已修改（M）且远端已删除（`svn status --show-updates` 带 `*`）；`svn update` 后成为 tree-conflict，刷新后旧选择被移除并播报。",
    "",
    "## 当前本地状态",
    "",
    "```text",
    localStatus || "(empty)",
    "```",
    "",
    "## 当前远端更新状态",
    "",
    "```text",
    remoteStatus || "(empty)",
    "```",
    "",
    "## 人工验收清单（真人执行，不得用模拟/axe 代替）",
    "",
    "> 每项完成后在“通过”或“失败”列填写日期与签名；失败项附现象与恢复动作。",
    "",
    "| # | 步骤 | 通过 | 失败 | 备注 |",
    "| - | ---------------------------------------------- | ---- | ---- | ---- |",
    "| 1 | 多根工作区：两个 folder 分别进入 Changes，范围与仓库名正确 | | | |",
    "| 2 | 7 个 modified：筛选“已修改 7”→ 表头全选 7 → 进入 Commit → 预览数量 7 | | | |",
    "| 3 | 隐藏选择：筛选后选择保留，切换筛选可见“隐藏 N”并可单独清除 | | | |",
    "| 4 | 刷新失效：在 WC2 选择 `src/lib/stale.ts`，执行 `svn update`，刷新后该选择被移除（tree-conflict）并播报原因 | | | |",
    "| 5 | 同名文件：a/b 目录 README 的父目录辨识与路径详情正确 | | | |",
    "| 6 | externals：环境诊断显示 external-lib 为“外部引用”，归属仓库 2 | | | |",
    "| 7 | 多仓库/混合仓库：跨 WC1+WC2 多选提交被阻止或按仓库拆分 | | | |",
    "| 8 | 长中文/空格/# 路径：Diff、历史、提交、复制路径全链路正常 | | | |",
    "| 9 | blocked/conflicted：ConflictDemo 阻止批量、冲突中心可处理 | | | |",
    "| 10 | 键盘：纯键盘完成 Ctrl+A、PageUp/PageDown、Shift+F10 行菜单、Escape 关闭详情 | | | |",
    "| 11 | 真实读屏：VoiceOver（macOS）或 NVDA（Windows）完成列表导航、选择与批量操作 | | | |",
    "| 12 | 真实触屏/触控笔：查看/复制路径、行菜单、批量操作 | | | |",
    "| 13 | 200% 缩放目视：720×480@200% 下列表主操作可达、无永久裁切 | | | |",
    "| 14 | 路径详情：关闭后滚动位置保持、触发按钮焦点恢复 | | | |",
    "| 15 | 中文 IME：候选阶段 Enter 不触发提交/确认/搜索 | | | |",
    "| 16 | 空结果：无匹配搜索显示原因与恢复动作 | | | |",
    "| 17 | Sticky 底栏：滚动到末项后底栏不遮挡最后一行与焦点 | | | |",
    "",
    "> 清单记录位全部填写通过前，本环境不代表任何人工验收结论。",
    "",
  ].join("\n");
}

function writeFile(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeBuffer(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      [
        `${command} ${args.join(" ")} failed with exit code ${result.status}`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return result;
}

/**
 * 删除保护（fail-closed）：只允许固定验收根的 exact match。
 * POSIX 只允许 path.resolve(os.tmpdir(), 固定目录名)；Windows 允许
 * os.tmpdir() 下固定目录名与既有默认盘根固定路径（均 exact match）。
 * 不得允许 HOME、工作区或任意父目录下仅靠同名 basename 通过。
 */
function ensureSafeValidationPath(target) {
  const resolved = path.resolve(target);
  const fixedName = "svn-workbench-manual-ui-acceptance-v2";
  const allowed =
    process.platform === "win32"
      ? [
          path.resolve(os.tmpdir(), fixedName).toLowerCase(),
          `c:${path.sep}${fixedName}`.toLowerCase(),
        ].includes(resolved.toLowerCase())
      : resolved === path.resolve(os.tmpdir(), fixedName);
  if (!allowed) {
    throw new Error(
      `Refusing to recreate unexpected manual acceptance path: ${resolved}`,
    );
  }
}

/** 从 `svn status --xml` 解析第一列 item 状态为 modified 的 wc 相对路径。 */
function parseStatusXmlModifiedPaths(xml) {
  const paths = [];
  // XML 属性可换行缩进：属性间允许空白。
  const entryRe = /<entry\s+path="([^"]*)">([\s\S]*?)<\/entry>/g;
  const targetMatch = /<target\s+path="([^"]*)">/.exec(xml);
  const target = targetMatch?.[1];
  for (const match of xml.matchAll(entryRe)) {
    const entryBody = match[2];
    const statusMatch = /<wc-status[^>]*item="([^"]+)"/.exec(entryBody);
    if (statusMatch && statusMatch[1] === "modified") {
      const raw = match[1];
      const slashPrefix = target ? `${target}/` : "";
      const backslashPrefix = target ? `${target}\\` : "";
      paths.push(
        slashPrefix && raw.startsWith(slashPrefix)
          ? raw.slice(slashPrefix.length)
          : backslashPrefix && raw.startsWith(backslashPrefix)
            ? raw.slice(backslashPrefix.length)
            : raw,
      );
    }
  }
  return paths.sort();
}

/**
 * 生成后自检：
 * 1. WC1 第一列 M 的路径集合必须与 sevenModifiedFiles 完全一致；
 * 2. externals 的 svn info URL 必须指向第二仓库 trunk；
 * 3. WC2 stale.ts 更新前：本地为 M 且 `svn status --show-updates` 含远端
 *    更新标记（*），否则 update 后不会产生 tree-conflict 语义。
 * 任一不满足直接抛错，禁止输出可用清单。
 */
function verifyGeneratedEnvironment(wc1, wc2) {
  const statusXml = run("svn", ["status", "--xml", wc1]).stdout;
  const actualModified = parseStatusXmlModifiedPaths(statusXml);
  const expected = [...sevenModifiedFiles].sort();
  if (JSON.stringify(actualModified) !== JSON.stringify(expected)) {
    throw new Error(
      `WC1 第一列 M 集合与 sevenModifiedFiles 不一致。\n期望：${expected.join(", ")}\n实际：${actualModified.join(", ")}`,
    );
  }
  const externalUrl = run("svn", [
    "info",
    "--show-item",
    "url",
    path.join(wc1, externalDir, externalName),
  ]).stdout.trim();
  if (externalUrl !== repoUrl2) {
    throw new Error(
      `externals ${externalName} 的 URL 未精确指向第二仓库 trunk。\n期望：${repoUrl2}\n实际：${externalUrl}`,
    );
  }
  const stalePath = path.join(wc2, "src/lib/stale.ts");
  const staleStatus = run("svn", ["status", stalePath]).stdout;
  if (!/^M\s/m.test(staleStatus)) {
    throw new Error(`WC2 stale.ts 更新前必须是本地 M：${staleStatus}`);
  }
  const staleRemote = run("svn", [
    "status",
    "--show-updates",
    stalePath,
  ]).stdout;
  if (!staleRemote.includes("*")) {
    throw new Error(
      `WC2 stale.ts 更新前必须带远端更新标记（*）：${staleRemote}`,
    );
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  ensureSafeValidationPath,
  parseStatusXmlModifiedPaths,
  buildReadme,
  buildWorkspaceFile,
  sevenModifiedFiles,
  sameNameFiles,
  externalDir,
  externalName,
  validationRoot,
  svnRepo,
  svnRepo2,
  localWc,
  localWc2,
};
