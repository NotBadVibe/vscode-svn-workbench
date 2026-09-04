import {
  defaultWorkbenchTask,
  isWorkbenchModuleId,
  isWorkbenchTaskForModule,
  WORKBENCH_PROTOCOL_VERSION,
  type CommitMessageSuggestion,
  type CommitSelectionPreviewItem,
  type CommitSelectionSettingsLayerView,
  type CommitSelectionSettingsSection,
  type ContinuityRestoreView,
  type FilterPresetView,
  type HostToWebviewMessage,
  type WorkbenchModuleId,
  type WorkbenchModuleSnapshot,
  type WorkbenchTaskId,
} from "@protocol/workbenchProtocol";
import { toDisplayPath } from "../../scope/pathBrands";
import type { PathIdentityKey } from "../../scope/pathBrands";
import {
  COMMIT_SELECTION_CONFIG_VERSION,
  validateCommitSelectionLayerConfig,
} from "../../commit/commitSelectionRules";
import {
  resolveCommitSelectionRules,
  type CommitSelectionLayerResolution,
  type ResolvedCommitSelectionRules,
} from "../../commit/commitSelectionRuleResolver";
import { createCommitSelectionEvaluator } from "../../commit/commitSelectionRuleEvaluator";
import type { SvnStatus } from "../../svn/svnTypes";
import { workbenchBridge } from "../bridge/vscodeBridge";
import { onboarding } from "../app/onboarding.svelte";
import {
  generateDiffFixture,
  parseDiffFixtureId,
  type DiffFixtureContent,
  type DiffFixtureLanguage,
} from "./diffFixtures";

/*
 * Diff 模块 mock 数据：内容包含一段足够长的未变更代码，用于在
 * @pierre/diffs 渲染下触发"折叠未变更"分隔行与折叠控件（v0.0.4 阶段 1）。
 */
const mockDiffOriginal = `import { SvnCommandRunner } from "../svn/runner";

export interface OrderLine {
  sku: string;
  quantity: number;
  price: number;
}

export class OrderService {
  private readonly runner: SvnCommandRunner;

  constructor(runner: SvnCommandRunner) {
    this.runner = runner;
  }

  async submit(order: OrderLine[]): Promise<void> {
    const total = order.reduce((sum, line) => sum + line.price, 0);
    console.log("提交订单，总额", total);
    await this.runner.run(["commit", "-m", "order"]);
  }

  // 以下为一段足够长的未变更代码，用于触发折叠分隔行
  private pad00(): number { return 0; }
  private pad01(): number { return 1; }
  private pad02(): number { return 2; }
  private pad03(): number { return 3; }
  private pad04(): number { return 4; }
  private pad05(): number { return 5; }
  private pad06(): number { return 6; }
  private pad07(): number { return 7; }
  private pad08(): number { return 8; }
  private pad09(): number { return 9; }

  discount(order: OrderLine[]): number {
    return order.length > 3 ? 0.9 : 1;
  }
}
`;

const mockDiffModified = `import { SvnCommandRunner } from "../svn/runner";

export interface OrderLine {
  sku: string;
  quantity: number;
  price: number;
}

export class OrderService {
  private readonly runner: SvnCommandRunner;
  private static readonly MAX_QUANTITY = 999;

  constructor(runner: SvnCommandRunner) {
    this.runner = runner;
  }

  async submit(order: OrderLine[]): Promise<void> {
    const total = order.reduce(
      (sum, line) => sum + line.price * line.quantity,
      0,
    );
    console.log("提交订单，总额", total, "共", order.length, "行");
    await this.runner.run(["commit", "-m", "order"]);
  }

  // 以下为一段足够长的未变更代码，用于触发折叠分隔行
  private pad00(): number { return 0; }
  private pad01(): number { return 1; }
  private pad02(): number { return 2; }
  private pad03(): number { return 3; }
  private pad04(): number { return 4; }
  private pad05(): number { return 5; }
  private pad06(): number { return 6; }
  private pad07(): number { return 7; }
  private pad08(): number { return 8; }
  private pad09(): number { return 9; }

  discount(order: OrderLine[]): number {
    if (order.some((line) => line.quantity > OrderService.MAX_QUANTITY)) {
      throw new Error("超出单SKU最大数量");
    }
    return order.length > 3 ? 0.85 : 1;
  }
}
`;

/* 修订比较 mock：svn 风格 unified diff（Index:/---/+++ 头），供 patch 直渲。 */
const mockRevisionPatch = `Index: src/extension.ts
===================================================================
--- src/extension.ts\t(revision 41)
+++ src/extension.ts\t(revision 42)
@@ -14,9 +14,12 @@
${" "}
 export class OrderService {
   private readonly runner: SvnCommandRunner;
+  private static readonly MAX_QUANTITY = 999;
${" "}
   async submit(order: OrderLine[]): Promise<void> {
-    const total = order.reduce((sum, line) => sum + line.price, 0);
+    const total = order.reduce(
+      (sum, line) => sum + line.price * line.quantity,
+      0,
+    );
     console.log("提交订单，总额", total);
     await this.runner.run(["commit", "-m", "order"]);
   }
Index: src/webview/App.svelte
===================================================================
--- src/webview/App.svelte\t(revision 41)
+++ src/webview/App.svelte\t(revision 42)
@@ -1,6 +1,7 @@
 <script lang="ts">
-  const mode = "legacy";
+  const mode = "svelte";
+  const version = 3;
 </script>
${" "}
-<main class={mode}>旧工作台</main>
+<main class={mode}>统一 Svelte 工作台（v{version}）</main>
`;

const files = [
  {
    relativePath: "src/extension.ts",
    status: "modified" as const,
    selection: "selected" as const,
    fileType: "TypeScript",
    repositoryName: "vscode-svn",
    ownership: "current" as const,
  },
  {
    relativePath: "src/webview/App.svelte",
    status: "added" as const,
    selection: "selected" as const,
    fileType: "Svelte",
    repositoryName: "vscode-svn",
    ownership: "current" as const,
  },
  {
    relativePath: "dist/debug.log",
    status: "unversioned" as const,
    selection: "needsReview" as const,
    fileType: "Log",
    repositoryName: "vscode-svn",
    ownership: "current" as const,
  },
  {
    relativePath: "vendor/external-lib",
    status: "external" as const,
    selection: "blocked" as const,
    fileType: "Folder",
    repositoryName: "external-lib",
    ownership: "external" as const,
  },
  {
    relativePath: "src/conflict/example.ts",
    status: "conflicted" as const,
    selection: "blocked" as const,
    fileType: "TypeScript",
    repositoryName: "vscode-svn",
    ownership: "current" as const,
  },
].map((item) => ({
  ...item,
  selectionKey: mockSelectionKey(item.relativePath),
}));

/** v0.0.8：mock 选择身份（与 Host 复合键同形，仅供 mock 快照使用）。 */
function mockSelectionKey(relativePath: string): PathIdentityKey {
  return `mock-wc::${relativePath}` as PathIdentityKey;
}

/** UX08-FLOW-01：Changes 与 Commit 共用同一组 7+3 候选。 */
function sevenDatasetFiles() {
  return Array.from({ length: 10 }, (_, index) => ({
    relativePath: `src/module-${index}.ts`,
    selectionKey: mockSelectionKey(`src/module-${index}.ts`),
    status:
      index < 7
        ? ("modified" as const)
        : index === 7
          ? ("unversioned" as const)
          : index === 8
            ? ("conflicted" as const)
            : ("normal" as const),
    selection:
      index < 7
        ? ("selected" as const)
        : index === 7
          ? ("needsReview" as const)
          : index === 8
            ? ("blocked" as const)
            : ("excluded" as const),
    fileType: "TypeScript",
  }));
}

let activeMockModuleId: WorkbenchModuleId = "changes";
let activeMockTaskId: WorkbenchTaskId = defaultWorkbenchTask("changes");
/** 当前 mock Diff 目标（open-edit/save 的 targetId 与快照一致）。 */
let activeMockDiffPath = "src/extension.ts";
/** 持有草稿的 mock 路径（dirty 与 Host cleanContent 语义一致）。 */
const mockDrafts = new Map<string, { dirty: boolean }>();
/** v0.0.13：mock 的冲突合并草稿脏状态（按相对路径跟踪，模拟 Host 内存草稿）。V012：补内容与 revision 供重开恢复 */
const mockConflictDrafts = new Map<
  string,
  { dirty: boolean; content?: string; revision?: number; updatedAt?: number }
>();
/** v0.1.3 V013-E：可配置多冲突列表（resolve 后重采模拟）；为空时使用默认单文件 */
let mockConflictsOverride:
  | Array<{
      relativePath: string;
      operation?: string;
      type?: string;
      sourceLeftRevision?: string;
      sourceRightRevision?: string;
    }>
  | undefined;
/** v0.0.13：mock 待确认的冲突文件切换（脏草稿三选一）。 */
let mockPendingConflictSwitch:
  { currentRelativePath: string; nextRelativePath: string } | undefined;
/** 等待三选一决定的 mock 切换目标。 */
let pendingMockSwitch: string | undefined;
/** mock Host 的编辑基准（保存轮换；用于校验第二次保存负载）。 */
let mockEditRawHash = "mock-raw-hash";
let mockEditToken = "mock-edit-token";
let mockEditRevision = 1;
/** 目标切换后的 mock 会话序号（模拟 Host 会话替换）。 */
let mockSessionCounter = 0;
/**
 * v0.1.0：当前 mock 会话 ID。目标切换（injectDiffTargetSwitch）后递增，
 * 后续 injectHostMessage/injectSnapshot 必须使用当前会话，否则新会话的
 * Webview 会按协议守卫丢弃旧会话消息。
 */
let currentMockSessionId = "mock-session-id";
/** v0.0.17 批次 E：会话共享筛选预设（mock 内存，与 Host 会话状态总线语义一致）。 */
let mockFilterPresets: FilterPresetView[] = [];

/** 重建当前模块快照（预设存取后回发，模拟 Host 下发新快照）。 */
function currentModuleSnapshot(): WorkbenchModuleSnapshot {
  return createInitialMockSnapshot(activeMockModuleId);
}

/** 模拟 Host 的目标切换：新会话 app/initialize + 新快照。 */
function injectDiffTargetSwitch(relativePath: string): void {
  activeMockDiffPath = relativePath;
  mockSessionCounter += 1;
  currentMockSessionId = `mock-session-${mockSessionCounter}`;
  workbenchBridge.injectMock({
    protocolVersion: WORKBENCH_PROTOCOL_VERSION,
    type: "app/initialize",
    moduleId: "diff",
    taskId: "diff/working",
    sessionId: `mock-session-${mockSessionCounter}`,
    repositoryUuid: "mock-repository-uuid",
    scopeHash: "mock-scope-hash",
    payload: {
      moduleId: "diff",
      scope: {
        repositoryName: "vscode-svn",
        projectName: "vscode-svn",
        roots: [{ kind: "folder", relativePath: toDisplayPath(".") }],
        source: "internal",
      },
      snapshot: mockDiffSnapshot(relativePath),
    },
  } as never);
}

/**
 * 读取 `?module=<moduleId>`：0.0.5 每个功能模块一个独立窗口，
 * mock 通过该查询参数模拟 Host 打开指定模块窗口（等同右键/命令入口）。
 * 缺省或非法值回落 changes。
 */
function initialMockModule(): WorkbenchModuleId {
  const requested = new URLSearchParams(window.location.search).get("module");
  return isWorkbenchModuleId(requested) ? requested : "changes";
}

/** 初始快照工厂：diff 需要固定目标文件与原文/修改文。 */
function createInitialMockSnapshot(
  moduleId: WorkbenchModuleId,
): WorkbenchModuleSnapshot {
  if (moduleId === "diff") {
    return mockDiffSnapshot("src/extension.ts");
  }
  const factories: Record<
    Exclude<WorkbenchModuleId, "diff">,
    () => WorkbenchModuleSnapshot
  > = {
    changes: changesSnapshot,
    commit: commitSnapshot,
    update: updateSnapshot,
    history: historySnapshot,
    conflicts: conflictSnapshot,
    repository: repositorySnapshot,
    changelists: changelistsSnapshot,
    understanding: understandingSnapshot,
    settings: settingsSnapshot,
    diagnostics: diagnosticsSnapshot,
    projects: projectsSnapshot,
    activity: activitySnapshot,
  };
  return factories[moduleId]();
}

/**
 * v0.0.17 批次 A/B：update 独立模块 Mock 快照（含常驻冲突 CTA 演示数据）。
 */
function updateSnapshot(
  overrides: Record<string, unknown> = {},
): WorkbenchModuleSnapshot {
  return {
    kind: "update",
    info: {
      name: "vscode-svn",
      url: "https://svn.example.test/repos/workbench/trunk",
      repositoryRoot: "https://svn.example.test/repos/workbench",
      revision: "42",
    },
    conflicts: {
      count: 2,
      paths: ["src/conflict/OrderList.tsx", "src/conflict/README.md"],
    },
    ...overrides,
  } as WorkbenchModuleSnapshot;
}

/** v0.1.0（V010-A）：?diffFixture=<id> 指定的确定性性能 fixture（memoized）。 */
let cachedDiffFixture: DiffFixtureContent | undefined;
let diffFixtureResolved = false;
function activeDiffFixture(): DiffFixtureContent | undefined {
  if (diffFixtureResolved) return cachedDiffFixture;
  diffFixtureResolved = true;
  const id = new URLSearchParams(window.location.search).get("diffFixture");
  if (id) {
    const spec = parseDiffFixtureId(id);
    if (spec) cachedDiffFixture = generateDiffFixture(spec);
  }
  return cachedDiffFixture;
}

const DIFF_FIXTURE_LANGUAGES: Record<DiffFixtureLanguage, string> = {
  ts: "typescript",
  json: "json",
  xml: "xml",
  text: "text",
};

/**
 * mock 的 diff 快照（v0.0.6 编辑能力）：默认支持页内编辑并签发 mock targetId。
 */
function mockDiffSnapshot(
  relativePath: string,
  overrides: {
    draft?: { revision: number; updatedAt: number };
    original?: string;
    modified?: string;
    supported?: boolean;
  } = {},
): WorkbenchModuleSnapshot {
  const supported = overrides.supported ?? true;
  const fixture = activeDiffFixture();
  const fixtureSpec = new URLSearchParams(window.location.search).get(
    "diffFixture",
  );
  const parsedSpec = fixtureSpec ? parseDiffFixtureId(fixtureSpec) : undefined;
  return {
    kind: "diff",
    relativePath,
    original: overrides.original ?? fixture?.original ?? mockDiffOriginal,
    modified: overrides.modified ?? fixture?.modified ?? mockDiffModified,
    language: parsedSpec
      ? DIFF_FIXTURE_LANGUAGES[parsedSpec.language]
      : "typescript",
    truncated: false,
    binary: false,
    edit: supported
      ? { supported: true, targetId: `mock-diff-${relativePath}` }
      : {
          supported: false,
          reason: "mock：该文件不支持页内编辑。",
        },
    draft: overrides.draft ?? mockDiffDraft(relativePath),
  };
}

/** 与 Host 行为一致：只有脏草稿才在快照中携带 draft 摘要。 */
function mockDiffDraft(
  relativePath: string,
): { revision: number; updatedAt: number } | undefined {
  return mockDrafts.get(relativePath)?.dirty === true
    ? { revision: 1, updatedAt: Date.now() }
    : undefined;
}

/** 向 Webview 注入一条 Host 消息（编辑会话/保存结果等）。 */
function injectHostMessage(
  type: HostToWebviewMessage["type"],
  payload: Record<string, unknown>,
): void {
  workbenchBridge.injectMock({
    protocolVersion: WORKBENCH_PROTOCOL_VERSION,
    type,
    moduleId: activeMockModuleId,
    taskId: activeMockTaskId,
    sessionId: currentMockSessionId,
    repositoryUuid: "mock-repository-uuid",
    scopeHash: "mock-scope-hash",
    payload,
  } as never);
}

export function startMockWorkbench(): void {
  const initialModuleId = initialMockModule();
  activeMockModuleId = initialModuleId;
  activeMockTaskId = defaultWorkbenchTask(initialModuleId);
  // v0.0.18 批次 A：mock/测试环境默认关闭新手引导（真实 Host 首次进入
  // 才展示）；引导专项测试与演示用 ?guide=1 开启。
  if (new URLSearchParams(window.location.search).get("guide") !== "1") {
    onboarding.skip();
  }
  const initial: HostToWebviewMessage = {
    protocolVersion: WORKBENCH_PROTOCOL_VERSION,
    type: "app/initialize",
    moduleId: initialModuleId,
    taskId: activeMockTaskId,
    sessionId: currentMockSessionId,
    repositoryUuid: "mock-repository-uuid",
    scopeHash: "mock-scope-hash",
    payload: {
      moduleId: initialModuleId,
      scope: {
        repositoryName: "vscode-svn",
        projectName: "vscode-svn",
        roots: [{ kind: "folder", relativePath: toDisplayPath(".") }],
        source: "internal",
        // v0.0.18 批次 E：范围栏快捷事实演示（候选数/revision）。
        candidateCount: 4,
        workingCopyRevision: "42",
        // v0.0.17 批次 C：mock 推荐带演示（与 Host 推导规则一致的示例）。
        recommendation:
          initialModuleId === "conflicts"
            ? undefined
            : {
                key: "commit:3",
                title: "检查建议的 3 个文件",
                reason: "当前范围有 3 个本地修改，建议逐项检查后提交。",
                actionLabel: "前往检查并提交",
                target: { moduleId: "commit", taskId: "commit/compose" },
                count: 3,
              },
      },
      snapshot: createInitialMockSnapshot(initialModuleId),
    },
  };

  window.setTimeout(() => {
    workbenchBridge.injectMock(initial);
    const errorScenario = new URLSearchParams(window.location.search).get(
      "error",
    );
    if (errorScenario === "authentication") {
      injectMockError({
        title: "读取仓库失败",
        message: "SVN 服务器拒绝了当前认证信息。",
        recoverable: true,
        category: "authentication",
        categoryLabel: "认证失败",
        guidance: [
          "使用“配置认证”通过 VS Code 安全输入凭据后重试。",
          "密码只通过标准输入交给 SVN，不进入命令参数、settings、Webview 快照或日志。",
        ],
      });
    }
    if (errorScenario === "certificate") {
      injectMockError({
        title: "读取仓库失败",
        message: "SVN 服务器证书校验失败。",
        recoverable: true,
        category: "certificate",
        categoryLabel: "证书校验失败",
        guidance: ["请通过仓库管理员提供的可信渠道核对 SHA-256 指纹。"],
        certificate: {
          host: "svn.example.test:8443",
          fingerprint: "AA:BB:CC:DD:EE:FF:00:11",
          issuer: "Example Internal CA",
          validFrom: "2026-07-01",
          validUntil: "2027-07-01",
          failures: ["unknown-ca"],
          canTrust: true,
        },
      });
    }
    if (errorScenario === "proxy") {
      injectMockError({
        title: "连接 SVN 仓库失败",
        message: "代理服务器拒绝连接，尚未执行任何写操作。",
        recoverable: true,
        category: "network",
        categoryLabel: "代理连接失败",
        network: { kind: "proxy" },
        guidance: [
          "检查 VS Code http.proxy 与系统代理是否一致。",
          "确认代理允许访问 SVN 仓库主机后再重试。",
        ],
      });
    }
  }, 0);
  window.addEventListener("svn-workbench:mock-action", (event) => {
    const message = (event as CustomEvent).detail;
    if (message?.type !== "workbench/action") {
      return;
    }
    const action = message.payload?.action;
    const data = message.payload?.data ?? {};
    if (action === "open-module" && typeof data.moduleId === "string") {
      const moduleId = data.moduleId as WorkbenchModuleId;
      const snapshots: Partial<
        Record<WorkbenchModuleId, () => WorkbenchModuleSnapshot>
      > = {
        changes: changesSnapshot,
        commit: commitSnapshot,
        update: updateSnapshot,
        history: historySnapshot,
        conflicts: conflictSnapshot,
        repository: repositorySnapshot,
        changelists: changelistsSnapshot,
        settings: settingsSnapshot,
        diagnostics: diagnosticsSnapshot,
        projects: projectsSnapshot,
        activity: activitySnapshot,
      };
      const createSnapshot = snapshots[moduleId];
      const taskId = isWorkbenchTaskForModule(data.taskId, moduleId)
        ? data.taskId
        : defaultWorkbenchTask(moduleId);
      // v0.0.8：携带明确选择进入 Commit 时保持数量一致（FLOW-02）。
      if (
        moduleId === "commit" &&
        createSnapshot &&
        Array.isArray(data.selectedPaths)
      ) {
        const selectedPaths = data.selectedPaths as string[];
        injectSnapshot(moduleId, commitSnapshot({ selectedPaths }), taskId);
      } else if (
        moduleId === "changelists" &&
        createSnapshot &&
        Array.isArray(data.selectedPaths)
      ) {
        const selectedPaths = data.selectedPaths as string[];
        injectSnapshot(
          moduleId,
          changelistsSnapshot({
            preselected: { count: selectedPaths.length, paths: selectedPaths },
          }),
          taskId,
        );
      } else if (createSnapshot) {
        injectSnapshot(moduleId, createSnapshot(), taskId);
      }
    }
    if (action === "list/save-filter-preset") {
      // v0.0.17 批次 E：会话共享预设的 Mock 存取（同名覆盖，与 Host 一致）。
      const name = typeof data.name === "string" ? data.name.trim() : "";
      const patterns = Array.isArray(data.patterns)
        ? (data.patterns as unknown[]).filter(
            (item): item is string =>
              typeof item === "string" && item.trim().length > 0,
          )
        : [];
      if (name && patterns.length > 0) {
        const rest = mockFilterPresets.filter((preset) => preset.name !== name);
        mockFilterPresets = [
          ...rest,
          { id: `mock-preset-${name}`, name, patterns },
        ];
      }
      injectSnapshot(activeMockModuleId, currentModuleSnapshot());
    }
    if (action === "list/delete-filter-preset") {
      const id = typeof data.id === "string" ? data.id : undefined;
      if (id) {
        mockFilterPresets = mockFilterPresets.filter(
          (preset) => preset.id !== id,
        );
      }
      injectSnapshot(activeMockModuleId, currentModuleSnapshot());
    }
    if (
      action === "file/path-detail" &&
      typeof data.relativePath === "string"
    ) {
      const relativePath = data.relativePath as string;
      injectHostMessage("file/path-detail-result", {
        relativePath,
        detail: {
          projectRelativePath: relativePath.startsWith("src/")
            ? toDisplayPath(relativePath)
            : undefined,
          workingCopyRelativePath: toDisplayPath(relativePath),
          repositoryRelativePath: toDisplayPath(relativePath),
          svnUrl: `https://svn.example.internal/svn/vscode-svn/${relativePath}`,
          absolutePath: toDisplayPath(`/mock/vscode-svn/${relativePath}`),
        },
      });
    }
    if (action === "file/copy-path" && typeof data.relativePath === "string") {
      injectHostMessage("operation/result", {
        title: "已复制完整路径",
        message: `/mock/vscode-svn/${data.relativePath as string}`,
      });
    }
    if (action === "projects/open-task" && typeof data.task === "string") {
      const taskSnapshots: Record<
        string,
        [WorkbenchModuleId, () => WorkbenchModuleSnapshot]
      > = {
        changes: ["changes", changesSnapshot],
        commit: ["commit", commitSnapshot],
        update: ["update", updateSnapshot],
      };
      const entry = taskSnapshots[data.task];
      if (entry) injectSnapshot(entry[0], entry[1]());
    }
    if (action === "open-diff" && typeof data.relativePath === "string") {
      // 当前目标有草稿时模拟 Host 的三选一拦截：先确认，不直接切换。
      if (
        mockDrafts.has(activeMockDiffPath) &&
        data.relativePath !== activeMockDiffPath
      ) {
        pendingMockSwitch = data.relativePath;
        injectHostMessage("diff/target-switch-confirm", {
          currentTargetId: `mock-diff-${activeMockDiffPath}`,
          nextRelativePath: data.relativePath,
        });
        return;
      }
      if (data.relativePath !== activeMockDiffPath) {
        injectDiffTargetSwitch(data.relativePath);
      } else {
        injectSnapshot("diff", mockDiffSnapshot(data.relativePath));
      }
    }
    if (action === "diff/target-switch-decision") {
      const pending = pendingMockSwitch;
      pendingMockSwitch = undefined;
      if (!pending) return;
      if (data.decision === "stay") {
        injectHostMessage("operation/result", {
          title: "已留在当前文件",
          message: "已取消打开新目标；当前草稿保留，可继续编辑或放弃。",
        });
        return;
      }
      if (data.decision === "save") {
        injectHostMessage("diff/save-result", {
          targetId: data.targetId,
          result: {
            ok: true,
            acceptedRevision: 9,
            newContentHash: "mock-saved-hash",
            newEditToken: "",
            snapshotVersion: Date.now(),
          },
          snapshotVersion: Date.now(),
        });
        mockDrafts.delete(activeMockDiffPath);
      }
      // stash：草稿保留在 mock“Host”；save：草稿已落盘清除。
      injectDiffTargetSwitch(pending);
    }
    if (action === "diff/open-edit") {
      // 干净草稿：内容即 Working Copy 当前内容，不在快照展示恢复入口。
      mockDrafts.set(activeMockDiffPath, { dirty: false });
      mockEditRawHash = "mock-raw-hash";
      mockEditToken = "mock-edit-token";
      mockEditRevision = 1;
      injectHostMessage("diff/edit-opened", {
        targetId: `mock-diff-${activeMockDiffPath}`,
        editToken: mockEditToken,
        draftRevision: 1,
        baseHash: "mock-base-hash",
        baseRevision: "BASE",
        rawHash: mockEditRawHash,
        baseContents: mockDiffOriginal,
        message: "已进入页内编辑；保存将写入工作副本当前范围。",
      });
      injectSnapshot("diff", mockDiffSnapshot(activeMockDiffPath));
    }
    if (action === "diff/save-working") {
      // 与生产 Host 一致：校验单次 token 与 expectedContentHash（旧基准拒绝）。
      const ok =
        typeof data.content === "string" &&
        data.content.length > 0 &&
        data.editToken === mockEditToken &&
        data.expectedContentHash === mockEditRawHash;
      if (ok) {
        mockEditRevision += 1;
        mockEditRawHash = `mock-hash-${mockEditRevision}`;
        mockEditToken = `mock-token-${mockEditRevision}`;
      }
      injectHostMessage("diff/save-result", {
        targetId: data.targetId,
        result: ok
          ? {
              ok: true,
              acceptedRevision: mockEditRevision,
              newContentHash: mockEditRawHash,
              newEditToken: mockEditToken,
              snapshotVersion: Date.now(),
            }
          : {
              ok: false,
              reason: "diskChanged",
              message:
                "编辑基准已变化（模拟 Host 复验失败）；草稿已保留，请刷新后重试。",
              recoverable: true,
              draftRevision: mockEditRevision,
            },
        snapshotVersion: Date.now(),
      });
      if (ok) {
        // 保存成功：草稿保留但回到干净状态（内容已落盘）。
        mockDrafts.set(activeMockDiffPath, { dirty: false });
        // 模拟生产 loadModule：先 module/loading，快照在下一个事件循环到达
        // （真实 Host 需要重新读取 SVN）。编辑器重建由 DiffView 编辑态
        // 挂载键保持（手动生命周期：编辑态同键快照刷新不重建实例）避免；
        // App 保持模块挂载。
        injectHostMessage("module/loading", { moduleId: "diff" });
        const savedContent = data.content as string;
        window.setTimeout(() => {
          injectSnapshot(
            "diff",
            mockDiffSnapshot(activeMockDiffPath, {
              modified: savedContent,
            }),
          );
        }, 50);
      }
    }
    if (action === "diff/draft-checkpoint") {
      mockDrafts.set(activeMockDiffPath, { dirty: true });
      injectHostMessage("diff/draft-checkpointed", {
        targetId: data.targetId,
        draftRevision: (Number(data.draftRevision) || 1) + 1,
      });
    }
    if (action === "diff/draft-abandon") {
      mockDrafts.delete(activeMockDiffPath);
      injectHostMessage("operation/result", {
        title: "草稿已放弃",
        message: "页内编辑草稿已清除，回到只读差异视图。",
      });
      injectSnapshot("diff", mockDiffSnapshot(activeMockDiffPath));
    }
    if (action === "diff/draft-export") {
      injectHostMessage("operation/result", {
        title: "草稿补丁已导出",
        message: "补丁已复制到剪贴板，可在外部审阅或人工应用。",
      });
    }
    if (action === "refresh") {
      const snapshots: Record<
        Exclude<WorkbenchModuleId, "diff">,
        () => WorkbenchModuleSnapshot
      > = {
        changes: changesSnapshot,
        commit: commitSnapshot,
        update: updateSnapshot,
        history: historySnapshot,
        conflicts: conflictSnapshot,
        repository: repositorySnapshot,
        changelists: changelistsSnapshot,
        understanding: understandingSnapshot,
        settings: settingsSnapshot,
        diagnostics: diagnosticsSnapshot,
        projects: projectsSnapshot,
        activity: activitySnapshot,
      };
      if (activeMockModuleId === "diff") {
        injectSnapshot("diff", mockDiffSnapshot(activeMockDiffPath));
      } else {
        injectSnapshot(activeMockModuleId, snapshots[activeMockModuleId]());
      }
    }
    if (action === "commit/apply-template") {
      mockCommitDraftMessage = "需求: \n\n范围: \n影响: ";
      injectSnapshot(
        "commit",
        commitSnapshot({ message: "需求: \n\n范围: \n影响: " }),
      );
    }
    // v0.1.6 V016-F2：记忆用户草稿（只记录不下发快照；旧用例无此动作，行为不变）。
    if (action === "commit/update-draft" && typeof data.message === "string") {
      mockCommitDraftMessage = data.message;
    }
    if (action === "commit/generate-message") {
      // v0.0.9 §4：生成建议草稿，不覆盖当前提交说明（message 保持不变）。
      const commitMessageScenario = new URLSearchParams(
        window.location.search,
      ).get("commitMessage");
      const isPartial = commitMessageScenario === "partial";
      const diffMode = (data && data.diffMode) || "metadata-only";
      const evidence =
        diffMode === "limited-diff"
          ? [
              {
                reference: {
                  candidateId: "mock-candidate-a",
                  hunkId: "mock-hunk-1",
                  projectRelativePath: "src/webview/app/FeatureRouter.svelte",
                },
                valid: true,
              },
            ]
          : undefined;
      const suggestion: CommitMessageSuggestion = {
        token: "mock-suggestion-token",
        message:
          "feat(workbench): 迁移统一 Svelte UI\n\n范围：当前提交范围\n影响：涉及工作台模块，提交前请确认",
        source: "configured-model" as const,
        model: "deepseek-v4-flash",
        metadataOnly: diffMode === "metadata-only",
        diffMode: diffMode as "metadata-only" | "limited-diff",
        userConfirmations: ["确认 src/extension.ts 仅影响命令注册。"],
        ...(evidence ? { evidence } : {}),
        ...(diffMode === "limited-diff"
          ? {
              claims: [
                {
                  text: "src/webview/app/FeatureRouter.svelte：修改了 2 处差异块，具体行为见证据。",
                  status: "confirmed" as const,
                  downgraded: false,
                  evidence: [
                    {
                      candidateId: "mock-candidate-a",
                      hunkId: "mock-hunk-1",
                      projectRelativePath:
                        "src/webview/app/FeatureRouter.svelte",
                    },
                  ],
                  invalidEvidence: [],
                },
                ...(isPartial
                  ? [
                      {
                        text: "src/data/db.ts 的改动无法判断具体行为。",
                        status: "toConfirm" as const,
                        downgraded: false,
                        evidence: [],
                        invalidEvidence: [],
                      },
                    ]
                  : []),
              ],
              coverage: {
                total: isPartial ? 3 : 2,
                analyzed: 1,
                truncated: 1,
                binary: 0,
                readFailed: isPartial ? 1 : 0,
                budgetExcluded: 0,
              },
              coverageFiles: [
                {
                  candidateId: "mock-candidate-a",
                  projectRelativePath:
                    "src/webview/app/FeatureRouter.svelte" as never,
                  status: "modified",
                  state: "analyzed",
                  diffHash: "deadbeef",
                  charCount: 320,
                  hunkCount: 2,
                },
                {
                  candidateId: "mock-candidate-b",
                  projectRelativePath: "dist/out.js" as never,
                  status: "modified",
                  state: "truncated",
                  diffHash: "deadbeef",
                  charCount: 6000,
                  hunkCount: 1,
                  reason: "差异超过单文件预算，已截断",
                },
                ...(isPartial
                  ? [
                      {
                        candidateId: "mock-candidate-c",
                        projectRelativePath: "src/data/db.ts" as never,
                        status: "modified",
                        state: "readFailed" as const,
                        diffHash: "",
                        charCount: 0,
                        hunkCount: 0,
                        reason: "svn diff 读取失败",
                      },
                    ]
                  : []),
              ],
              receipt: {
                task: "commit-draft",
                projectId: "mock-project",
                model: "deepseek-v4-flash",
                dataTypes: ["项目内相对路径、SVN 状态、脱敏差异片段"],
                files: 1,
                totalBudget: 40000,
                perFileBudget: 6000,
                historyIncluded: false,
              },
            }
          : {}),
        warnings: mockRetryNote ? [mockRetryNote] : [],
        stale: commitMessageScenario === "stale" ? true : undefined,
        binding: {
          repositoryUuid: "mock-repository-uuid",
          scopeHash: "mock-scope-hash",
          candidateHash: "mock-candidate-hash",
          revision: "42",
          generatedAt: "2026-08-04T09:30:00.000Z",
          model: "deepseek-v4-flash",
        },
      };
      // 跨 action 保持：生成后 preview/adopt/undo 快照仍携带建议区。
      mockCommitSuggestion = suggestion;
      mockRetryNote = undefined;
      injectSnapshot(
        "commit",
        commitSnapshot({
          messageSuggestion: suggestion,
          feedback:
            commitMessageScenario === "stale"
              ? undefined
              : {
                  tone: "success" as const,
                  message: "已生成建议草稿；当前提交说明保持不变。",
                },
        }),
      );
    }
    if (action === "commit/preview-receipt") {
      // v0.0.11 §3：仅下发外发回执，不调用模型。
      injectMockCommitReceipt();
    }
    if (action === "commit/retry-failed-diff") {
      // v0.0.11 §6：只重试失败项——同样先展示回执（本次覆盖失败项）。
      mockRetryNote = "本次重试仅覆盖上次读取失败或预算外的文件。";
      injectMockCommitReceipt(mockRetryNote);
    }
    if (action === "commit/open-evidence") {
      // v0.0.11 §4：打开证据对应文件的差异（模拟 Host 校验后路由到 Diff）。
      const referencePath =
        typeof data.projectRelativePath === "string"
          ? data.projectRelativePath
          : activeMockDiffPath;
      injectSnapshot("diff", mockDiffSnapshot(referencePath));
    }
    if (action === "commit/receipt-dismiss") {
      // v0.0.11 §3：放弃回执，不外发、不调用模型；草稿保持不变。
      injectSnapshot(
        "commit",
        commitSnapshot({
          feedback: {
            tone: "warning",
            message: "已放弃受限差异回执；未发送任何差异内容。",
          },
        }),
      );
    }
    if (action === "understanding/run-local") {
      // v0.0.12：只运行本地检查（来源 local-rule，声明标记推断）。
      const base = understandingSnapshot() as {
        changes: Array<{ status: string }>;
      };
      injectSnapshot(
        "understanding",
        understandingSnapshot({
          state: "ready",
          source: "local-rule",
          changes: base.changes.map((item) => ({
            ...item,
            status: "inferred",
          })),
          findings: [],
          verification: [],
        }),
      );
    }
    if (action === "understanding/preview-receipt") {
      injectMockUnderstandingReceipt();
    }
    if (action === "understanding/retry-failed") {
      injectMockUnderstandingReceipt(
        "本次重试仅覆盖上次读取失败或预算外的文件。",
      );
    }
    if (action === "understanding/receipt-dismiss") {
      injectSnapshot(
        "understanding",
        understandingSnapshot({
          feedback: {
            tone: "warning",
            message:
              "已放弃变更解读回执；未发送任何差异内容，本地结果保持不变。",
          },
        }),
      );
    }
    if (action === "understanding/run-model") {
      injectSnapshot(
        "understanding",
        understandingSnapshot({
          state: "ready",
          source: "mixed",
          userConfirmations: [
            {
              id: "mock-confirm-1",
              statement: "确认 src/extension.ts 的修改仅影响命令注册。",
              confirmedAt: "2026-08-18T10:01:00.000Z",
              candidateHash: "mock-candidate-hash",
              needsReview: false,
            },
          ],
        }),
      );
    }
    if (action === "understanding/confirm-fact") {
      const statement =
        typeof data.statement === "string" ? data.statement : "确认内容";
      injectSnapshot(
        "understanding",
        understandingSnapshot({
          userConfirmations: [
            {
              id: `mock-confirm-${Date.now()}`,
              statement,
              confirmedAt: "2026-08-18T10:02:00.000Z",
              candidateHash: "mock-candidate-hash",
              needsReview: false,
            },
          ],
          feedback: {
            tone: "success",
            message:
              "已记录确认（仅当前会话有效）；切换项目或工作副本变化后需复核。",
          },
        }),
      );
    }
    if (action === "understanding/clear-confirmations") {
      injectSnapshot(
        "understanding",
        understandingSnapshot({
          userConfirmations: [],
          feedback: { tone: "success", message: "已清除会话内的用户确认。" },
        }),
      );
    }
    if (action === "understanding/open-evidence") {
      const referencePath =
        typeof data.projectRelativePath === "string"
          ? data.projectRelativePath
          : activeMockDiffPath;
      injectSnapshot("diff", mockDiffSnapshot(referencePath));
    }
    if (action === "commit/adopt-suggestion") {
      const mode = (data && data.mode) || "replace";
      const suggestion = commitMessageMockSuggestion();
      injectSnapshot(
        "commit",
        commitSnapshot(
          mode === "replace"
            ? {
                message: suggestion.message,
                feedback: {
                  tone: "success",
                  message: "已用建议替换提交说明；可撤销替换恢复原内容。",
                },
              }
            : {
                message: "需求: \n\n范围: \n影响: ",
                feedback: {
                  tone: "success",
                  message: "已插入 3 个空白字段，用户已填内容保持不变。",
                },
              },
        ),
      );
    }
    if (action === "commit/undo-suggestion-replace") {
      injectSnapshot(
        "commit",
        commitSnapshot({
          message: "",
          messageSuggestion: commitMessageMockSuggestion(),
          feedback: {
            tone: "success",
            message: "已撤销建议替换，已恢复原提交说明。",
          },
        }),
      );
    }
    if (action === "commit/discard-suggestion") {
      // 与真实 Host 一致：放弃后清除建议草稿（含跨 action 状态）。
      mockCommitSuggestion = undefined;
      injectSnapshot(
        "commit",
        commitSnapshot({
          feedback: {
            tone: "success",
            message: "已放弃建议草稿；当前提交说明保持不变。",
          },
        }),
      );
    }
    if (action === "commit/apply-local-rules") {
      injectSnapshot(
        "commit",
        commitSnapshot({
          selectedPaths: ["src/extension.ts", "src/webview/App.svelte"],
          feedback: {
            tone: "success",
            message:
              "已按本地规则应用推荐选择 2 个文件；1 个文件待确认，可手动勾选。",
          },
        }),
      );
    }
    if (action === "commit/ai-select") {
      const commitAiScenario = new URLSearchParams(window.location.search).get(
        "commitAi",
      );
      if (commitAiScenario === "fail") {
        // AI 失败：保留当前选择，展示失败原因与“应用本地规则”恢复动作。
        injectSnapshot(
          "commit",
          commitSnapshot({
            ai: {
              source: "local-rule-fallback",
              summary: "AI 建议获取失败，已保留当前选择。",
              warnings: [],
              fallbackReason: "模拟失败：AI 服务连接超时。",
              failed: true,
            },
          }),
        );
      } else {
        const aiResult = {
          source: "configured-model",
          summary: "建议选择 1 个文件；1 个需要人工确认，1 个建议排除。",
          warnings: [],
          stale: commitAiScenario === "stale" ? true : undefined,
          binding: {
            repositoryUuid: "mock-repository-uuid",
            scopeHash: "mock-scope-hash",
            candidateHash: "mock-candidate-hash",
            generatedAt: "2026-08-04T09:30:00.000Z",
            model: "deepseek-v4-flash",
          },
        };
        injectSnapshot(
          "commit",
          commitSnapshot({
            selectedPaths: ["src/extension.ts"],
            ai: aiResult,
          }),
        );
      }
    }
    if (action === "commit/preview") {
      injectSnapshot(
        "commit",
        commitSnapshot({
          message:
            typeof data.message === "string"
              ? data.message
              : "feat(workbench): 迁移统一 Svelte UI",
          preview: {
            token: "mock-preview",
            canExecute: true,
            selectedPaths: ["src/extension.ts", "src/webview/App.svelte"],
            addPaths: ["src/webview/App.svelte"],
            removePaths: [],
            commands: [
              'svn add "src/webview/App.svelte"',
              'svn commit "src/extension.ts" "src/webview/App.svelte" -F <message-file> --encoding utf-8',
            ],
            issues: [],
            remoteRevision: "42",
            outOfDatePaths: [],
            createdAt: new Date().toISOString(),
          },
        }),
      );
    }
    if (action === "history/select" && typeof data.revision === "string") {
      injectSnapshot(
        "history",
        historySnapshot({ selectedRevision: data.revision }),
      );
    }
    if (action === "history/compare") {
      injectSnapshot("diff", {
        kind: "diff",
        relativePath: ". · r41 → r42",
        original: "",
        modified: mockRevisionPatch,
        language: "diff",
        truncated: false,
        binary: false,
        message: "修订比较 r41 → r42",
      });
    }
    if (action === "history/load-more") {
      // v0.0.18 批次 C：模拟加载更早修订（追加更早编号，limit 增大）。
      const base = historySnapshot() as { revisions: unknown[] };
      const query = Object.fromEntries(
        ["revisionFrom", "revisionTo", "author", "dateFrom", "dateTo"]
          .map((key) => [key, data[key]])
          .filter(([, value]) => typeof value === "string" && value.trim()),
      );
      injectSnapshot(
        "history",
        historySnapshot({
          revisions: [
            ...base.revisions,
            {
              revision: "3",
              author: "早期作者",
              date: "2026-01-05T10:00:00.000Z",
              message: "更早期的修订（加载更早演示）",
              changedPaths: [{ action: "A", path: "/trunk/README.md" }],
            },
          ],
          limit: 300,
          hasMore: false,
          query,
          feedback:
            Object.keys(query).length > 0
              ? "已按条件加载更早修订；更早历史已全部加载。"
              : "已加载更早修订；更早历史已全部加载。",
        }),
      );
    }
    if (action === "history/blame") {
      const blame = isScrollDataset()
        ? Array.from({ length: 80 }, (_, index) => ({
            line: index + 1,
            revision: String(120 - (index % 10)),
            author: index % 2 === 0 ? "杨楠" : "研发团队",
            content: `第 ${index + 1} 行中文代码说明`,
          }))
        : [
            {
              line: 1,
              revision: "42",
              author: "yangnan",
              content: "export const mode = 'svelte';",
            },
          ];
      injectSnapshot(
        "history",
        historySnapshot({
          blame,
          feedback: `已读取 ${blame.length} 行逐行责任信息。`,
        }),
      );
    }
    // v0.1.5 V015-C1：?historyRestore=blocked 演示不可执行的恢复预览
    // （issues 非空 → 意向单确认禁用 + “重新检查”），默认保持旧语义。
    if (action === "history/preview-restore") {
      const blocked =
        new URLSearchParams(window.location.search).get("historyRestore") ===
        "blocked";
      injectSnapshot(
        "history",
        historySnapshot({
          restorePreview: {
            token: "mock-restore",
            revision: typeof data.revision === "string" ? data.revision : "42",
            relativePath: "src/extension.ts",
            command: 'svn cat -r 42 "src/extension.ts" > <working-file>',
            canExecute: !blocked,
            issues: blocked ? ["工作副本文件已变化，请重新检查后恢复。"] : [],
          },
        }),
      );
    }
    if (action === "history/execute-restore")
      injectSnapshot(
        "history",
        historySnapshot({
          feedback: "src/extension.ts 已恢复为 r42 内容；尚未提交。",
        }),
      );
    if (action === "conflict/select" && typeof data.relativePath === "string") {
      // v0.0.13：与 Host 行为一致——当前文件有脏草稿时不直接切换，下发三选一确认
      const currentRelativePath = "src/conflict/example.ts";
      if (
        data.relativePath !== currentRelativePath &&
        mockConflictDrafts.get(currentRelativePath)?.dirty === true
      ) {
        mockPendingConflictSwitch = {
          currentRelativePath,
          nextRelativePath: data.relativePath,
        };
        injectHostMessage("conflict/draft-switch-confirm", {
          currentRelativePath,
          nextRelativePath: data.relativePath,
        });
      } else {
        injectSnapshot("conflicts", conflictSnapshot());
      }
    }
    if (action === "conflict/advise") {
      injectSnapshot(
        "conflicts",
        conflictSnapshot({
          advice: mockConflictAdvice(),
        }),
      );
    }
    if (action === "conflict/preview-receipt") {
      injectMockConflictReceipt();
    }
    if (action === "conflict/receipt-dismiss") {
      injectSnapshot(
        "conflicts",
        conflictSnapshot({
          feedback: "已放弃冲突意图解释回执；未发送任何内容。",
        }),
      );
    }
    if (action === "conflict/interpret") {
      injectSnapshot(
        "conflicts",
        conflictSnapshot({
          interpretation: mockConflictInterpretation(),
        }),
      );
    }
    if (action === "conflict/save-working") {
      // 模拟保存失败场景（通过 ?conflictSave=fail）
      const saveScenario = new URLSearchParams(window.location.search).get(
        "conflictSave",
      );
      if (saveScenario === "fail") {
        injectHostMessage("operation/error", {
          title: "保存失败",
          message: "模拟保存失败：磁盘写入失败；草稿已保留在 Host 内存。",
          recoverable: true,
        });
        // 保留草稿的快照（编辑器与草稿保留）
        injectSnapshot(
          "conflicts",
          conflictSnapshot({
            selected: {
              ...(
                conflictSnapshot() as Extract<
                  WorkbenchModuleSnapshot,
                  { kind: "conflicts" }
                >
              ).selected!,
              draft: {
                content:
                  typeof data.content === "string" ? data.content : "draft",
                revision: 2,
                updatedAt: Date.now(),
                hasDraft: true,
                dirty: true,
              },
              mergeEditor: {
                token: "mock-edit",
                editable: true,
                issues: [],
                feedback:
                  "保存失败：模拟磁盘写入失败；草稿已保留，可重试或复制/导出。",
              },
            },
          }),
        );
        return;
      }
      // 保存成功：草稿落盘，清除 mock 脏状态
      mockConflictDrafts.delete("src/conflict/example.ts");
      injectSnapshot(
        "conflicts",
        conflictSnapshot({
          selected: {
            ...(
              conflictSnapshot() as Extract<
                WorkbenchModuleSnapshot,
                { kind: "conflicts" }
              >
            ).selected!,
            contents: {
              base: {
                content: "export const mode = 'legacy';\n",
                truncated: false,
              },
              mine: {
                content: "export const mode = 'local';\n",
                truncated: false,
              },
              theirs: {
                content: "export const mode = 'svelte';\n",
                truncated: false,
              },
              working: {
                content:
                  typeof data.content === "string"
                    ? data.content
                    : "export const mode = 'merged';\n",
                truncated: false,
              },
            },
            mergeEditor: {
              token: "mock-edit-saved",
              editable: true,
              issues: [],
              feedback: "工作副本合并结果已保存；请生成解决预览。",
            },
          },
        }),
      );
    }
    if (
      action === "conflict/draft-update" ||
      action === "conflict/draft-checkpoint"
    ) {
      const content =
        typeof data.content === "string" ? data.content : "draft content";
      const draftPath =
        (data.relativePath as string) ?? "src/conflict/example.ts";
      mockConflictDrafts.set(draftPath, {
        dirty: true,
        content,
        revision: 2,
        updatedAt: Date.now(),
      });
      injectHostMessage("conflict/draft-checkpointed", {
        relativePath: draftPath,
        revision: 2,
        updatedAt: Date.now(),
      });
      injectSnapshot(
        "conflicts",
        conflictSnapshot({
          selected: {
            ...(
              conflictSnapshot() as Extract<
                WorkbenchModuleSnapshot,
                { kind: "conflicts" }
              >
            ).selected!,
            draft: {
              content,
              revision: 2,
              updatedAt: Date.now(),
              hasDraft: true,
              dirty: content !== "export const mode = 'local';\n",
            },
          },
        }),
      );
    }
    if (action === "conflict/draft-abandon") {
      const abandonPath =
        (data.relativePath as string) ?? "src/conflict/example.ts";
      mockConflictDrafts.delete(abandonPath);
      injectHostMessage("operation/result", {
        title: "草稿已放弃",
        message: "草稿已清除。",
      });
      injectSnapshot("conflicts", conflictSnapshot());
    }
    if (
      action === "conflict/draft-copy" ||
      action === "conflict/draft-export"
    ) {
      injectHostMessage("operation/result", {
        title: action === "conflict/draft-copy" ? "草稿已复制" : "草稿已导出",
        message: "草稿内容已复制到剪贴板（模拟）。",
      });
    }
    if (action === "conflict/draft-switch-decision") {
      const pending = mockPendingConflictSwitch;
      mockPendingConflictSwitch = undefined;
      if (data.decision === "stay") {
        injectHostMessage("operation/result", {
          title: "已留在当前文件",
          message: "已取消切换；草稿保留。",
        });
      } else if (data.decision === "discard") {
        // 放弃草稿：清除 mock 脏状态后切换
        if (pending) mockConflictDrafts.delete(pending.currentRelativePath);
        injectSnapshot("conflicts", conflictSnapshot());
      } else {
        // save：草稿已保留在 mock 内存，直接切换
        injectSnapshot("conflicts", conflictSnapshot());
      }
    }
    if (action === "conflict/preview-resolve") {
      // 中文注释：支持多冲突场景，预览路径取当前选中或首个剩余
      const previewPath =
        (typeof data.relativePath === "string" && data.relativePath) ||
        (mockConflictsOverride?.[0]?.relativePath ?? "src/conflict/example.ts");
      injectSnapshot(
        "conflicts",
        conflictSnapshot({
          advice: mockConflictAdvice(),
          resolvePreview: {
            token: "mock-resolve",
            relativePath: previewPath,
            command: `svn resolve --accept working "${previewPath}"`,
            canResolve: true,
            issues: [],
          },
        }),
      );
    }
    if (action === "conflict/resolve") {
      // v0.1.3 V013-E：模拟 Host 成功 resolve 后的重采——从列表移除目标并重发快照（按权威重采语义）
      // 中文注释：支持多冲突，优先按 previewToken 对应首个剩余，其次 relativePath
      const fallbackTarget =
        mockConflictsOverride?.[0]?.relativePath ?? "src/conflict/example.ts";
      const target =
        (typeof data.relativePath === "string" && data.relativePath) ||
        (data.previewToken ? fallbackTarget : fallbackTarget);
      // 若存在多冲突覆盖，则从覆盖中移除
      const current = mockConflictsOverride ?? [
        { relativePath: "src/conflict/example.ts" },
      ];
      mockConflictsOverride = current.filter((c) => c.relativePath !== target);
      // 清理该文件草稿
      mockConflictDrafts.delete(target);
      // 若覆盖为空，保留空数组表示全部完成；否则保持剩余
      injectHostMessage("operation/result", {
        title: "冲突已标记解决",
        message: target,
      });
      // 下发重采后的快照：conflicts 已更新，selected 自动指向首个剩余（由 conflictSnapshot 逻辑决定）
      const remaining = mockConflictsOverride;
      if (remaining.length === 0) {
        injectSnapshot(
          "conflicts",
          conflictSnapshot({
            conflicts: [],
            progress: {
              initialCount: current.length + 1,
              remaining: 0,
              resolvedCount: current.length + 1,
            },
            selected: undefined,
          } as unknown as Record<string, unknown>),
        );
      } else {
        injectSnapshot("conflicts", conflictSnapshot());
      }
    }
    if (action === "settings/test-ai") {
      injectSnapshot(
        "settings",
        settingsSnapshot({
          ai: {
            ...settingsSnapshotValue.ai,
            feedback: {
              tone: "success",
              message: "连接成功，模型返回了有效响应。",
            },
          },
        }),
      );
    }
    if (action === "settings/list-models") {
      injectSnapshot(
        "settings",
        settingsSnapshot({
          ai: {
            ...settingsSnapshotValue.ai,
            models: [{ id: "deepseek-v4-flash", owner: "deepseek" }],
            feedback: { tone: "success", message: "读取到 1 个可用模型。" },
          },
        }),
      );
    }
    if (action === "settings/preview-team-migration") {
      injectSnapshot(
        "settings",
        settingsSnapshot({
          team: {
            ...settingsSnapshotValue.team,
            configSource: "workingCopy",
            inheritedFromWorkingCopy: true,
            migrationPreview: {
              token: "mock-migration-token",
              sourcePath: "/mock/code/.svn-workbench.json",
              targetPath: "/mock/code/EmApi/.svn-workbench.json",
              keys: ["commitConvention", "commitSelection"],
              targetContent: '{\n  "commitConvention": { "enabled": true }\n}',
              sourceContentAfter: "{}",
              issues: [],
            },
          },
        }),
      );
    }
    if (action === "settings/execute-team-migration") {
      injectSnapshot(
        "settings",
        settingsSnapshot({
          team: {
            ...settingsSnapshotValue.team,
            configSource: "project",
            feedback: {
              tone: "success",
              message:
                "已把 commitConvention、commitSelection 迁移到项目根配置。",
            },
          },
        }),
      );
    }
    if (action === "settings/recommend-team") {
      injectSnapshot(
        "settings",
        settingsSnapshot({
          team: {
            ...settingsSnapshotValue.team,
            recommendation: {
              summary: "已根据仓库目录生成团队规则建议。",
              reasons: ["模块来自 src/webview 与 src/extension。"],
              warnings: ["保存前请确认模块名。"],
              confidence: "high",
              source: "local-rule",
            },
          },
        }),
      );
    }
    if (action === "settings/save-selection") {
      // 与 Host 相同的保存前校验（领域纯函数）；save-error 场景模拟写入失败。
      const candidate: Record<string, unknown> = {
        version: COMMIT_SELECTION_CONFIG_VERSION,
      };
      if (data.statusRules !== undefined) {
        candidate.statusRules = data.statusRules;
      }
      if (data.pathRules !== undefined) {
        candidate.pathRules = data.pathRules;
      }
      const validation = validateCommitSelectionLayerConfig(
        candidate,
        "当前仓库",
      );
      if (mockSelectionScenario() === "save-error") {
        mockSelectionState = {
          ...mockSelectionState,
          feedback: {
            tone: "error",
            message:
              "保存提交选择规则失败：模拟写入错误，.svn-workbench.json 不可写。",
          },
          saveErrors: ["模拟保存失败：无法写入 .svn-workbench.json。"],
        };
      } else if (!validation.config) {
        mockSelectionState = {
          ...mockSelectionState,
          feedback: {
            tone: "error",
            message:
              "保存被拒绝：提交选择规则校验失败，未写入任何内容。请修正下列错误后重试。",
          },
          saveErrors: validation.errors,
        };
      } else {
        const resolved = resolveCommitSelectionRules({
          repository: validation.config,
        });
        mockSelectionState = {
          repository: validation.config,
          saveErrors: undefined,
          feedback:
            resolved.warnings.length > 0
              ? {
                  tone: "warning",
                  message: `提交选择规则已保存到 .svn-workbench.json；存在 ${resolved.warnings.length} 条警告（含遮蔽规则），请检查规则列表。`,
                }
              : {
                  tone: "success",
                  message:
                    "提交选择规则已保存到 .svn-workbench.json，文件其他配置与未知字段保持不变。",
                },
        };
      }
      injectSnapshot("settings", settingsSnapshot());
    }
    if (action === "settings/restore-selection-defaults") {
      mockSelectionState = {
        repository: undefined,
        feedback: {
          tone: "success",
          message:
            "已删除 .svn-workbench.json 中的 commitSelection 配置，恢复为用户/工作区配置与内置默认；文件其他内容未改动。",
        },
      };
      injectSnapshot("settings", settingsSnapshot());
    }
    if (action === "settings/open-selection-file") {
      // Mock 不打开真实文件（与 settings/open-team-file 惯例一致），重新下发快照表示动作已被接收。
      injectSnapshot("settings", settingsSnapshot());
    }
    if (action === "settings/refresh-selection-preview") {
      mockSelectionState = {
        ...mockSelectionState,
        feedback: undefined,
        saveErrors: undefined,
      };
      injectSnapshot("settings", settingsSnapshot());
    }
    if (action === "settings/open-selection-vscode-settings") {
      // 与 security/open-proxy-settings 惯例一致：Mock 环境不打开 VS Code 设置页，无响应。
    }
    if (action === "diagnostics/run") {
      injectSnapshot("diagnostics", diagnosticsSnapshot());
    }
    if (
      action === "diagnostics/select-svn-executable" ||
      action === "diagnostics/open-settings" ||
      action === "diagnostics/open-folder" ||
      action === "diagnostics/copy-diagnostics" ||
      action === "diagnostics/open-url"
    ) {
      // Mock 原地重检：选择可执行文件后重新检测
      injectSnapshot("diagnostics", diagnosticsSnapshot());
    }
    if (action === "update/preview") {
      injectSnapshot(
        "update",
        updateSnapshot({
          preview: {
            token: "mock-update",
            canExecute: true,
            localCount: 4,
            remoteCount: 2,
            checkedRevision: "42",
            risk: "medium",
            overlapPaths: ["src/extension.ts"],
            messages: ["远端与本地存在 1 个同路径重叠，请确认后再更新。"],
            commands: ['svn update --accept postpone "."'],
          },
        }),
      );
    }
    if (action === "update/execute") {
      injectSnapshot(
        "update",
        updateSnapshot({
          preview: undefined,
          result: {
            ok: true,
            revision: "43",
            hasConflicts: true,
            message: "已更新到 r43",
          },
        }),
      );
    }
    if (action === "repository/preview-property") {
      const name = typeof data.name === "string" ? data.name : "";
      const value = typeof data.value === "string" ? data.value : "";
      const remove = data.remove === true;
      injectSnapshot(
        "repository",
        repositorySnapshot({
          properties: {
            available: true,
            target: ".",
            items: [{ name: "svn:ignore", value: "dist\nobj" }],
            preview: {
              token: "mock-property",
              name,
              value: remove ? undefined : value,
              remove,
              command: remove
                ? `svn propdel "${name}" "."`
                : `svn propset "${name}" <value> "."`,
              canExecute: Boolean(name),
              issues: [],
            },
          },
        }),
      );
    }
    if (action === "repository/execute-property") {
      injectSnapshot(
        "repository",
        repositorySnapshot({
          properties: {
            available: true,
            target: ".",
            items: [{ name: "svn:ignore", value: "dist\nobj" }],
            feedback: "已设置属性 svn:ignore；变更尚未提交。",
          },
        }),
      );
    }
    if (action === "repository/preview-cleanup") {
      injectSnapshot(
        "repository",
        repositorySnapshot({
          cleanup: {
            available: true,
            target: ".",
            preview: {
              token: "mock-cleanup",
              command: 'svn cleanup "."',
              canExecute: true,
              issues: [],
            },
          },
        }),
      );
    }
    if (action === "repository/execute-cleanup") {
      injectSnapshot(
        "repository",
        repositorySnapshot({
          cleanup: {
            available: true,
            target: ".",
            feedback: "清理已完成；未删除未版本化文件，请重新检查状态。",
          },
        }),
      );
    }
    if (action === "repository/browse") {
      const url =
        typeof data.url === "string" && data.url
          ? data.url
          : "https://svn.example.test/repos/workbench/trunk";
      injectSnapshot(
        "repository",
        repositorySnapshot({
          advanced: {
            browser: {
              url,
              parentUrl: url.endsWith("/trunk")
                ? "https://svn.example.test/repos/workbench"
                : "https://svn.example.test/repos/workbench/trunk",
              entries: [
                {
                  name: "src",
                  kind: "dir",
                  revision: "42",
                  author: "yangnan",
                  date: "2026-07-30T08:00:00.000Z",
                },
                {
                  name: "docs",
                  kind: "dir",
                  revision: "40",
                  author: "team",
                  date: "2026-07-29T06:00:00.000Z",
                },
                {
                  name: "README.md",
                  kind: "file",
                  size: 4280,
                  revision: "41",
                  author: "yangnan",
                  date: "2026-07-30T07:00:00.000Z",
                },
              ],
            },
          },
        }),
      );
    }
    if (
      action === "repository/preview-advanced" ||
      action === "repository/select-patch"
    ) {
      const operation =
        action === "repository/select-patch"
          ? "apply-patch"
          : typeof data.operation === "string"
            ? data.operation
            : "branch";
      const destructive = [
        "switch",
        "relocate",
        "merge",
        "apply-patch",
        "shelf",
      ].includes(operation);
      const titleByOperation: Record<string, string> = {
        branch: "创建分支",
        tag: "创建标签",
        switch: "切换工作副本",
        relocate: "重定位仓库根地址",
        merge: "合并到当前工作副本",
        shelf: "创建本地搁置（补丁 + 还原）",
        "apply-patch": "应用补丁",
      };
      const title = titleByOperation[operation] ?? "仓库操作";
      injectSnapshot(
        "repository",
        repositorySnapshot({
          advanced: {
            preview: {
              token: "mock-advanced",
              operation,
              title,
              destructive,
              canExecute: true,
              issues: [],
              commands:
                operation === "shelf"
                  ? [
                      "svn diff <current-scope> > wip.patch",
                      "svn revert --depth empty <exact-files>",
                    ]
                  : operation === "apply-patch"
                    ? ['svn patch "feature.patch" "."']
                    : [
                        `svn ${operation} <validated-source> <validated-target>`,
                      ],
              details: destructive
                ? operation === "relocate"
                  ? [
                      "旧根：https://svn.example.test/repos/workbench",
                      `新根：${typeof data.targetUrl === "string" && data.targetUrl.trim().length > 0 ? data.targetUrl.trim() : "https://svn.example.test/repos/workbench-new"}`,
                    ]
                  : [
                      "只修改当前工作副本；不会自动提交。",
                      "执行后重新采集状态。",
                    ]
                : ["仓库端操作，不包含本地未提交修改。"],
            },
          },
        }),
      );
    }
    if (action === "repository/execute-advanced") {
      injectSnapshot(
        "repository",
        repositorySnapshot({
          advanced: { feedback: "高级仓库操作已完成；状态已经重新采集。" },
        }),
      );
    }
    if (action === "repository/export-patch") {
      injectSnapshot(
        "repository",
        repositorySnapshot({
          advanced: { feedback: "补丁已导出：/tmp/svn-workbench.patch" },
        }),
      );
    }
    if (action === "repository/generate-release-notes") {
      injectSnapshot(
        "repository",
        repositorySnapshot({
          advanced: {
            feedback: "已从 42 条历史中生成 3 条发布记录。",
            releaseNotes: {
              count: 3,
              fromRevision: "40",
              toRevision: "42",
              markdown:
                "# SVN 发布说明\n\n修订范围：r40 → r42\n\n## r42 · yangnan\n\n完成统一 Svelte 工作台与安全预检。",
            },
          },
        }),
      );
    }
    if (action === "changelist/suggest")
      injectSnapshot(
        "changelists",
        changelistsSnapshot({ suggestions: changelistSuggestions() }),
      );
    if (
      action === "changelist/preview-receipt" ||
      (action === "changelist/suggest" && data?.mode === "semantic")
    )
      injectMockChangelistReceipt();
    if (action === "changelist/receipt-dismiss") {
      injectSnapshot(
        "changelists",
        changelistsSnapshot({
          feedback: "已放弃语义拆分回执；未发送任何差异内容。",
        }),
      );
    }
    if (action === "changelist/run-semantic") {
      injectSnapshot(
        "changelists",
        changelistsSnapshot({
          suggestions: changelistSemanticSuggestions(),
          feedback: "已按改动意图完成语义拆分；确认后仍经预览与确认写入 SVN。",
        }),
      );
    }
    if (action === "changelist/preview-apply") {
      const paths = Array.isArray(data.paths)
        ? data.paths.filter(
            (item: unknown): item is string => typeof item === "string",
          )
        : [];
      const remove = data.remove === true;
      injectSnapshot(
        "changelists",
        changelistsSnapshot({
          suggestions: changelistSuggestions(),
          preview: {
            token: "mock-changelist",
            name: typeof data.name === "string" ? data.name : undefined,
            remove,
            paths,
            command: remove
              ? "svn changelist --remove …"
              : `svn changelist "${data.name}" …`,
            canExecute: paths.length > 0,
            issues: [],
          },
        }),
      );
    }
    if (action === "changelist/execute-apply")
      injectSnapshot(
        "changelists",
        changelistsSnapshot({
          groups: [
            {
              name: "webview",
              files: [
                {
                  relativePath: "src/webview/App.svelte",
                  selectionKey: mockSelectionKey("src/webview/App.svelte"),
                  status: "modified" as const,
                  selection: "selected" as const,
                },
              ],
            },
          ],
          suggestions: changelistSuggestions(),
          feedback: "文件已加入 webview。",
        }),
      );
    if (action === "changes/preview-operation") {
      const paths = Array.isArray(data.paths)
        ? data.paths.filter(
            (item: unknown): item is string => typeof item === "string",
          )
        : [];
      const operation =
        typeof data.operation === "string" ? data.operation : "add";
      const ignoreMode =
        data.ignoreMode === "repository" ? "repository" : "directory";
      injectSnapshot(
        "changes",
        changesSnapshot({
          operationPreview: {
            token: "mock-file-op",
            operation,
            ignoreMode,
            paths,
            command:
              operation === "ignore"
                ? `svn propset ${ignoreMode === "repository" ? "svn:global-ignores" : "svn:ignore"} …`
                : `svn ${operation} "${paths[0] ?? ""}"`,
            consequences: ["操作只影响当前明确选择的文件，不会自动提交。"],
            destructive: operation === "revert" || operation === "remove",
            recoverability:
              operation === "revert"
                ? "未提交内容无法从 SVN 恢复。"
                : "提交前可 Revert。",
            canExecute: paths.length > 0,
            issues: [],
          },
        }),
      );
    }
    if (action === "changes/execute-operation")
      injectSnapshot(
        "changes",
        changesSnapshot({
          feedback: "1 个文件已加入版本控制。请刷新并确认最新 SVN 状态。",
        }),
      );
  });
}

/**
 * v0.1.4 V014-C1：Changes ↔ Diff 往返恢复演示载荷（`?continuity=restore`）。
 * 与 Host 下发形状一致，供 C2 消费联调；默认不携带（保持现状）。
 */
function mockContinuityRestore(): ContinuityRestoreView {
  return {
    contextVersion: 1,
    originModule: "changes",
    changesView: {
      query: "",
      sort: "status:asc",
      density: "comfortable",
      onlySelected: false,
    },
    selectedKeys: [
      mockSelectionKey("src/extension.ts"),
      mockSelectionKey("src/webview/App.svelte"),
    ],
    activeFileKey: mockSelectionKey("src/extension.ts"),
    scrollAnchorKey: mockSelectionKey("src/extension.ts"),
    commitDraft: "feat(workbench): 完善统一 Svelte 工作台",
    removedEntries: [
      {
        key: mockSelectionKey("src/removed.ts"),
        path: "/mock/vscode-svn/src/removed.ts",
        reason: "disappeared",
        message:
          "文件已不在最新快照中，可能已被删除、移走或状态变化，已从选择中移除。",
      },
    ],
    notices: ["已按最新快照保留 2 个选择，移除 1 个失效项。"],
    restoredAt: new Date().toISOString(),
  };
}

/**
 * v0.1.4 V014-F2：5000 文件恢复演示载荷（`?continuity=restore-large`）。
 * key 全部指向 large 数据集文件（`src/generated/deep/path/file-NNNN.ts`，
 * 2500/2501 均为 modified 可选项）；默认 `?continuity=restore` 语义不变。
 */
function mockContinuityRestoreLarge(): ContinuityRestoreView {
  return {
    contextVersion: 1,
    originModule: "changes",
    changesView: {
      query: "",
      sort: "path:asc",
      density: "comfortable",
      onlySelected: false,
    },
    selectedKeys: [
      mockSelectionKey("src/generated/deep/path/file-2500.ts"),
      mockSelectionKey("src/generated/deep/path/file-2501.ts"),
    ],
    activeFileKey: mockSelectionKey("src/generated/deep/path/file-2500.ts"),
    scrollAnchorKey: mockSelectionKey("src/generated/deep/path/file-2500.ts"),
    commitDraft: "feat(workbench): 完善统一 Svelte 工作台",
    removedEntries: [
      {
        key: mockSelectionKey("src/generated/deep/path/file-9999.ts"),
        path: "/mock/vscode-svn/src/generated/deep/path/file-9999.ts",
        reason: "disappeared",
        message:
          "文件已不在最新快照中，可能已被删除、移走或状态变化，已从选择中移除。",
      },
    ],
    notices: ["已按最新快照保留 2 个选择，移除 1 个失效项。"],
    restoredAt: new Date().toISOString(),
  };
}

function changesSnapshot(
  overrides: Record<string, unknown> = {},
): WorkbenchModuleSnapshot {
  const dataset =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("dataset")
      : undefined;
  // v0.1.4 V014-C1：`?continuity=restore` 演示往返恢复载荷（C2 联调用）。
  // v0.1.4 V014-F2：`?continuity=restore-large` 指向 large 数据集的恢复载荷。
  const withContinuityRestore =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("continuity") === "restore";
  const withContinuityRestoreLarge =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("continuity") ===
      "restore-large";
  const snapshotFiles =
    dataset === "large" || dataset === "scroll"
      ? Array.from(
          { length: dataset === "large" ? 5000 : 120 },
          (_, index) => ({
            relativePath: `src/generated/deep/path/file-${String(index).padStart(4, "0")}.ts`,
            selectionKey: mockSelectionKey(
              `src/generated/deep/path/file-${String(index).padStart(4, "0")}.ts`,
            ),
            status:
              index % 17 === 0
                ? ("unversioned" as const)
                : ("modified" as const),
            selection:
              index % 17 === 0
                ? ("needsReview" as const)
                : ("selected" as const),
            fileType: "TypeScript",
          }),
        )
      : dataset === "seven"
        ? sevenDatasetFiles()
        : files;
  return {
    kind: "changes",
    commitDraft: "feat(workbench): 完善统一 Svelte 工作台",
    files: snapshotFiles,
    filterPresets: mockFilterPresets,
    summary:
      snapshotFiles === files
        ? { modified: 1, added: 1, unversioned: 1, conflicted: 1 }
        : {
            modified: snapshotFiles.filter((item) => item.status === "modified")
              .length,
            unversioned: snapshotFiles.filter(
              (item) => item.status === "unversioned",
            ).length,
            ...(dataset === "seven"
              ? {
                  conflicted: snapshotFiles.filter(
                    (item) => item.status === "conflicted",
                  ).length,
                }
              : {}),
          },
    refreshedAt: new Date().toISOString(),
    ...(withContinuityRestore
      ? { continuityRestore: mockContinuityRestore() }
      : {}),
    ...(withContinuityRestoreLarge
      ? { continuityRestore: mockContinuityRestoreLarge() }
      : {}),
    ...overrides,
  } as WorkbenchModuleSnapshot;
}

/** 提交说明建议草稿 Mock（v0.0.9 §4）。 */
function commitMessageMockSuggestion() {
  return {
    token: "mock-suggestion-token",
    message:
      "feat(workbench): 迁移统一 Svelte UI\n\n范围：当前提交范围\n影响：涉及工作台模块，提交前请确认",
    source: "configured-model" as const,
    model: "deepseek-v4-flash",
    metadataOnly: false,
    diffMode: "metadata-only" as const,
    warnings: [],
    binding: {
      repositoryUuid: "mock-repository-uuid",
      scopeHash: "mock-scope-hash",
      candidateHash: "mock-candidate-hash",
      generatedAt: "2026-08-04T09:30:00.000Z",
      model: "deepseek-v4-flash",
    },
  };
}

function commitSnapshot(
  overrides: Record<string, unknown> = {},
): WorkbenchModuleSnapshot {
  const commitAiScenario = new URLSearchParams(window.location.search).get(
    "commitAi",
  );
  const commitRulesScenario = new URLSearchParams(window.location.search).get(
    "commitRules",
  );
  const commitDataset =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("dataset")
      : undefined;
  // v0.1.6 V016-F2：`?ai=disabled` 为 AI 关闭人工路径验收新增（只加分支，不改旧语义）。
  // 与 conflicts 快照的 aiDisabled 口径一致；commitAi=none 旧分支保持不变。
  const commitAiDisabled =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("ai") === "disabled";
  const commitMessageModel = commitAiDisabled
    ? "本地规则（未配置外部模型）"
    : "deepseek-v4-flash";
  const snapshotFiles = (
    isScrollDataset()
      ? Array.from({ length: 80 }, (_, index) => ({
          relativePath: `项目资料/提交候选/第-${String(index + 1).padStart(2, "0")}-个文件.ts`,
          selectionKey: mockSelectionKey(
            `项目资料/提交候选/第-${String(index + 1).padStart(2, "0")}-个文件.ts`,
          ),
          status:
            index % 7 === 0 ? ("unversioned" as const) : ("modified" as const),
          selection: "selected" as const,
        }))
      : commitDataset === "seven"
        ? sevenDatasetFiles()
        : files.slice(0, 3)
  ).map((item) => ({ ...item, evaluation: mockCommitEvaluation(item.status) }));
  return {
    kind: "commit",
    files: snapshotFiles,
    filterPresets: mockFilterPresets,
    summary: {
      total: snapshotFiles.length,
      selected: snapshotFiles.length,
      needsReview: 0,
      excluded: 0,
      blocked: 0,
    },
    selectedPaths: snapshotFiles.map((item) => item.relativePath),
    message: mockCommitDraftMessage ?? "",
    messageIssues: ["提交说明不能为空。"],
    conventionHint: "前缀：feat, fix；模块：workbench",
    selectionAi:
      commitAiScenario === "none" || commitAiDisabled
        ? { configured: false }
        : { configured: true, model: "deepseek-v4-flash" },
    feedback:
      commitRulesScenario === "updated"
        ? {
            tone: "warning",
            message:
              "提交选择规则已更新，候选分类已按新规则刷新；可点击“应用本地规则”重新计算推荐选择。",
          }
        : undefined,
    aiPrivacy: [
      {
        scenario: "selection",
        model: "deepseek-v4-flash",
        fileLimit: 200,
        data: "文件相对路径、SVN 状态、文件类型和规则判断；不发送文件正文",
        historyIncluded: false,
      },
      {
        scenario: "message",
        model: commitMessageModel,
        fileLimit: 80,
        data: "已选文件元数据与增删行统计；不发送文件正文",
        historyIncluded: false,
      },
    ],
    templates: [
      { id: "feature", label: "需求开发", body: "需求: \n\n范围: \n影响: " },
      { id: "bugfix", label: "问题修复", body: "修复: \n\n原因: \n影响: " },
    ],
    // v0.0.9 §4：跨 action 保持建议草稿——生成后预览等后续快照仍展示建议区，
    // 与真实 Host（快照构建始终携带 messageSuggestion）一致。
    messageSuggestion: mockCommitSuggestion,
    // v0.1.4 V014-E2：`?commitHandoff=basic|shrunk|conflict` 演示交接载荷
    // （与真实 Host 的 applyCommitHandoffSelection 下发口径一致；默认不携带）。
    ...mockCommitHandoffPayload(),
    ...overrides,
  } as WorkbenchModuleSnapshot;
}

/**
 * v0.1.4 V014-E2 交接演示载荷：e2e 经 `?commitHandoff=` 构造。
 * - basic：全合法交接（请求 3 个、带入 3 个，无移除项）；
 * - shrunk：部分收缩（请求 3 个、带入 2 个，逐条中文移除原因）；
 * - conflict：冲突收缩（带入 1 个 + 冲突移除项，feedback 含处理冲突指引，
 *   preview 置空，与 Host“旧 preview 已置空”一致，禁止渲染旧预览主操作）。
 * 缺省返回空对象（非交接进入，保持现状）。
 */
function mockCommitHandoffPayload(): Record<string, unknown> {
  const scenario =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("commitHandoff")
      : undefined;
  if (scenario === "basic") {
    return {
      handoff: {
        source: "changes",
        selectionVersion: 1,
        requestedCount: 3,
        keptCount: 3,
        removedEntries: [],
        receivedAt: "2026-09-03T10:00:00.000Z",
      },
    };
  }
  if (scenario === "shrunk") {
    return {
      handoff: {
        source: "changes",
        selectionVersion: 1,
        requestedCount: 3,
        keptCount: 2,
        removedEntries: [
          {
            path: "dist/out.js",
            reason: "excluded",
            message: "“dist/out.js”已变为排除项",
          },
        ],
        receivedAt: "2026-09-03T10:00:00.000Z",
      },
    };
  }
  if (scenario === "conflict") {
    return {
      handoff: {
        source: "changes",
        selectionVersion: 1,
        requestedCount: 2,
        keptCount: 1,
        removedEntries: [
          {
            path: "src/conflicted.ts",
            reason: "blocked",
            message: "“src/conflicted.ts”为阻止项，暂不能提交",
          },
        ],
        receivedAt: "2026-09-03T10:00:00.000Z",
      },
      feedback: {
        tone: "warning",
        message:
          "选择已变化，旧提交预览已失效（“src/conflicted.ts”为阻止项，暂不能提交）。请先到冲突模块处理冲突，再重新预检；提交说明草稿已保留，请确认当前选择后重新预览。",
      },
      preview: undefined,
    };
  }
  return {};
}

/** 提交页 Mock 候选的本地规则决策解释（与内置默认策略一致的最小集合）。 */
function mockCommitEvaluation(status: string) {
  if (status === "modified" || status === "added") {
    return {
      decision: "recommended" as const,
      reasonKey: "statusPolicy" as const,
      statusPolicyKey: status as "modified" | "added",
      safetyLocked: false,
    };
  }
  if (status === "unversioned") {
    return {
      decision: "needsReview" as const,
      reasonKey: "statusPolicy" as const,
      statusPolicyKey: "unversioned" as const,
      safetyLocked: false,
    };
  }
  return undefined;
}

function historySnapshot(
  overrides: Record<string, unknown> = {},
): WorkbenchModuleSnapshot {
  const revisions = isScrollDataset()
    ? Array.from({ length: 48 }, (_, index) => ({
        revision: String(120 - index),
        author: index % 2 === 0 ? "杨楠" : "研发团队",
        date: new Date(Date.UTC(2026, 6, 30 - index, 8, 30)).toISOString(),
        message: `第 ${index + 1} 条中文修订说明`,
        changedPaths: Array.from({ length: 36 }, (_, pathIndex) => ({
          action: "M",
          path: `/trunk/项目资料/模块-${pathIndex + 1}/文件.ts`,
        })),
      }))
    : [
        {
          revision: "42",
          author: "yangnan",
          date: "2026-07-30T08:30:00.000Z",
          message: "迁移统一 Svelte 工作台",
          changedPaths: [{ action: "M", path: "/trunk/src/extension.ts" }],
        },
        {
          revision: "41",
          author: "team",
          date: "2026-07-29T09:00:00.000Z",
          message: "补充提交范围校验",
          changedPaths: [
            { action: "M", path: "/trunk/src/scope/operationScope.ts" },
          ],
        },
      ];
  return {
    kind: "history",
    revisions,
    selectedRevision: revisions[0]?.revision,
    compareRevisions: [],
    limit: 100,
    // v0.0.18 批次 C：mock 演示“可能还有更早修订”与加载更早交互。
    hasMore: true,
    fileActionsAvailable: true,
    ...overrides,
  } as WorkbenchModuleSnapshot;
}

function conflictSnapshot(
  overrides: Record<string, unknown> = {},
): WorkbenchModuleSnapshot {
  // v0.1.3 V013-E：优先使用 override 注入的 conflicts（如测试或 resolve 后重采），否则按默认/滚动数据集生成
  // 中文注释：支持 ?conflicts=multi 多冲突主路径 E2E（a.ts/b.ts 两个文本冲突）
  if (
    !isScrollDataset() &&
    mockConflictsOverride === undefined &&
    new URLSearchParams(window.location.search).get("conflicts") === "multi"
  ) {
    mockConflictsOverride = [
      {
        relativePath: "src/conflict/a.ts",
        operation: "update" as const,
        type: "text" as const,
        sourceLeftRevision: "41",
        sourceRightRevision: "42",
      },
      {
        relativePath: "src/conflict/b.ts",
        operation: "update" as const,
        type: "text" as const,
        sourceLeftRevision: "41",
        sourceRightRevision: "42",
      },
    ];
  }
  const baseConflicts = isScrollDataset()
    ? Array.from({ length: 36 }, (_, index) => ({
        relativePath: `项目资料/冲突/文件-${index + 1}.ts`,
        operation: "update" as const,
        type: "text" as const,
        sourceLeftRevision: "119",
        sourceRightRevision: "120",
      }))
    : (mockConflictsOverride ?? [
        {
          relativePath: "src/conflict/example.ts",
          operation: "update" as const,
          type: "text" as const,
          sourceLeftRevision: "41",
          sourceRightRevision: "42",
        },
      ]);
  // overrides.conflicts 可覆盖基础列表（用于测试多冲突场景）
  const conflicts =
    (overrides.conflicts as typeof baseConflicts | undefined) ?? baseConflicts;
  const scenario = new URLSearchParams(window.location.search).get(
    "conflictScenario",
  );
  const aiParam =
    new URLSearchParams(window.location.search).get("ai") ??
    new URLSearchParams(window.location.search).get("conflictAi");
  const aiDisabled = aiParam === "disabled";
  const conflictBlocksParam = new URLSearchParams(window.location.search).get(
    "conflictBlocks",
  );
  const conflictBlocksCount = conflictBlocksParam
    ? Number.parseInt(conflictBlocksParam, 10)
    : 0;
  // V018-C 大冲突实测：conflictBlocks 上限放宽到 600，conflictLines 追加填充行，
  // conflictLongLine=1 注入超长行（确定性 seed，不破坏既有 10 块契约）。
  const conflictLinesParam = new URLSearchParams(window.location.search).get(
    "conflictLines",
  );
  const conflictLinesTarget = conflictLinesParam
    ? Number.parseInt(conflictLinesParam, 10)
    : 0;
  const conflictLongLine =
    new URLSearchParams(window.location.search).get("conflictLongLine") === "1";
  let workingContent: string | undefined = isScrollDataset()
    ? Array.from(
        { length: 80 },
        (_, index) => `第 ${index + 1} 行工作副本内容`,
      ).join("\n")
    : "<<<<<<< .mine\nexport const mode = 'local';\n=======\nexport const mode = 'svelte';\n>>>>>>> .r42\n";
  let workingExtra: Record<string, unknown> = {};
  if (
    Number.isFinite(conflictBlocksCount) &&
    conflictBlocksCount > 1 &&
    conflictBlocksCount <= 600 &&
    !isScrollDataset() &&
    !scenario
  ) {
    const blocks = Array.from({ length: conflictBlocksCount }, (_, index) => {
      const n = index + 1;
      return `<<<<<<< .mine\nmy-block-${n}-local\n||||||| .r100\nbase-block-${n}\n=======\ntheir-block-${n}-remote\n>>>>>>> .r101`;
    });
    const separators = Array.from(
      { length: conflictBlocksCount - 1 },
      (_, index) =>
        `\n// ---- separator ${index + 1} unique-${index + 1 * 7} ----\n// filler line distinct ${index + 1}\n`,
    );
    let combined = "// header-do-not-merge\n";
    for (let i = 0; i < blocks.length; i++) {
      combined += blocks[i] + "\n";
      if (i < separators.length) combined += separators[i];
    }
    combined += "// footer-end\n";
    // V018-C：conflictLines 追加确定性填充行到目标总行数；conflictLongLine 注入超长行。
    if (
      Number.isFinite(conflictLinesTarget) &&
      conflictLinesTarget > 0 &&
      combined.split("\n").length < conflictLinesTarget
    ) {
      const missing = conflictLinesTarget - combined.split("\n").length;
      const filler = Array.from(
        { length: missing },
        (_, index) =>
          `// v018c filler ${index + 1} 中文占位 distinct-${index + 1}`,
      ).join("\n");
      combined = combined.replace(
        "// footer-end\n",
        `${filler}\n// footer-end\n`,
      );
    }
    if (conflictLongLine) {
      combined = combined.replace(
        "// header-do-not-merge\n",
        `// header-do-not-merge\n// longline-${"x".repeat(5000)}\n`,
      );
    }
    workingContent = combined;
  } else {
    if (scenario === "damaged")
      workingContent = "<<<<<<< .mine\nlocal\n>>>>>>> .r42\n";
    if (scenario === "binary")
      workingExtra = { truncated: true, readError: "二进制文件不支持内嵌合并" };
    if (scenario === "truncated") workingExtra = { truncated: true };
    if (scenario === "missing") workingContent = undefined;
    // 中文注释：V013-F 非文本仅显式 conflictType 驱动；binary 仅靠 readError 的 fallback 场景不视为非文本，优先 fallback
    const typeParam = new URLSearchParams(window.location.search).get(
      "conflictType",
    );
    const nonTextScenario =
      typeParam ??
      (scenario === "tree" || scenario === "property" ? scenario : undefined);
    if (
      nonTextScenario === "tree" ||
      nonTextScenario === "property" ||
      nonTextScenario === "binary"
    ) {
      // 通过 overrides 保持一致，此处仅标记；实际类型通过 URL 参数透传给 conflictSnapshot 的 selected.type
      // 为兼容无 selected 覆盖的默认快照，工作内容设为空（非文本不展示文本合并）
      workingContent = "";
      workingExtra = {};
    }
  }
  // 中文注释：非文本类型覆盖仅 tree/property 走 scenario；binary 靠 readError 的场景保持 text + fallback
  const typeOverride = (() => {
    const p = new URLSearchParams(window.location.search).get("conflictType");
    if (p === "tree" || p === "property" || p === "binary" || p === "text")
      return p;
    if (scenario === "tree" || scenario === "property") return scenario;
    return undefined;
  })();

  // 若调用方通过 overrides 显式指定 progress/selected，则尊重；否则按当前 conflicts 推导
  const defaultProgress = {
    initialCount: conflicts.length + 1,
    remaining: conflicts.length,
    resolvedCount: 1,
  };
  // v0.1.3 V013-F：若 URL 指定非文本类型且调用方未覆盖 conflicts，则同步覆盖列表类型
  const effectiveConflicts =
    typeOverride && !overrides.conflicts
      ? ((conflicts as Array<Record<string, unknown>>).map((c) => ({
          ...c,
          type: typeOverride,
        })) as typeof conflicts)
      : conflicts;
  const firstPath =
    effectiveConflicts[0]?.relativePath ?? "src/conflict/example.ts";
  return {
    kind: "conflicts",
    conflicts: effectiveConflicts,
    progress:
      (overrides.progress as typeof defaultProgress | undefined) ??
      defaultProgress,
    selected:
      (overrides.selected as unknown) !== undefined
        ? (overrides.selected as never)
        : conflicts.length === 0
          ? undefined
          : {
              relativePath: firstPath,
              operation: "update",
              type: typeOverride ?? "text",
              sourceLeftRevision: "41",
              sourceRightRevision: "42",
              contents: {
                base: {
                  content: "export const mode = 'legacy';\n",
                  truncated: false,
                },
                mine: {
                  content: "export const mode = 'local';\n",
                  truncated: false,
                },
                theirs: {
                  content: "export const mode = 'svelte';\n",
                  truncated: false,
                },
                working: {
                  content: workingContent,
                  truncated: false,
                  ...workingExtra,
                },
              },
              mergeEditor: { token: "mock-edit", editable: true, issues: [] },
              // V012：若 mock 内存已有草稿且调用方未通过 overrides 覆盖，则注入草稿供重开恢复
              ...(() => {
                const entry = mockConflictDrafts.get("src/conflict/example.ts");
                if (entry?.dirty && entry.content) {
                  return {
                    draft: {
                      content: entry.content,
                      revision: entry.revision ?? 2,
                      updatedAt: entry.updatedAt ?? Date.now(),
                      hasDraft: true,
                      dirty: true,
                    },
                  };
                }
                return {};
              })(),
            },
    aiPrivacy: {
      model: aiDisabled ? "本地规则（未配置外部模型）" : "deepseek-v4-flash",
      characters: 86,
      maxCharacters: 32000,
      data: "基础版本、我的版本、对方版本、工作副本的截断文本与修订元数据",
      historyIncluded: false,
    },
    ...overrides,
  } as WorkbenchModuleSnapshot;
}

function mockConflictAdvice() {
  return {
    recommendation: "manualMerge" as const,
    confidence: "medium" as const,
    summary:
      "两侧都修改了同一处行为，建议保留新的 Svelte 入口并人工核对初始化顺序。",
    risks: ["直接接受任一侧都会丢失另一侧逻辑。"],
    steps: ["完成工作副本合并", "运行类型检查和真实 SVN 测试"],
    source: "local-rule" as const,
  };
}

function mockConflictInterpretation() {
  return {
    myIntent: "我的版本调整了工作台入口的初始化顺序。",
    theirIntent: "对方版本修改了同一文件的 Svelte 挂载逻辑。",
    commonPoints: ["两侧均在入口文件同一区域修改。"],
    conflictPoints: [
      "初始化顺序与挂载逻辑相互影响，直接接受任一侧会丢失另一侧修改。",
    ],
    recommendedHandling: {
      summary: "建议人工合并，保留两侧意图后核对初始化顺序。",
      recommendation: "manualMerge" as const,
      evidence: ["我的版本：初始化顺序调整", "对方版本：Svelte 挂载逻辑"],
    },
    businessUnknowns: ["哪个初始化顺序符合当前业务需求（需人工或业务确认）。"],
    postSaveVerification: [
      { title: "完成工作副本合并" },
      { title: "运行类型检查", command: "npm run check" },
    ],
    warnings: [],
    source: "configured-model" as const,
    binding: {
      scopeHash: "mock-scope-hash",
      conflictHash: "mock-conflict-hash",
      revision: "42",
      generatedAt: "2026-08-18T12:00:00.000Z",
    },
  };
}

function injectMockConflictReceipt(): void {
  workbenchBridge.injectMock({
    protocolVersion: WORKBENCH_PROTOCOL_VERSION,
    type: "conflict/receipt",
    moduleId: "conflicts",
    taskId: "conflicts/resolve",
    sessionId: currentMockSessionId,
    repositoryUuid: "mock-repository-uuid",
    scopeHash: "mock-scope-hash",
    payload: {
      token: "mock-conflict-receipt-token",
      receipt: {
        task: "conflict-interpret",
        projectId: "mock-project",
        model: "deepseek-v4-flash",
        dataTypes: ["冲突文件受限正文（base/mine/theirs/working）"],
        files: 4,
        totalBudget: 32000,
        perFileBudget: 8000,
        historyIncluded: false,
      },
      files: [
        {
          name: "base",
          characters: 1200,
          maxCharacters: 8000,
          truncated: false,
        },
        {
          name: "mine",
          characters: 1500,
          maxCharacters: 8000,
          truncated: false,
        },
        {
          name: "theirs",
          characters: 1500,
          maxCharacters: 8000,
          truncated: false,
        },
        {
          name: "working",
          characters: 3200,
          maxCharacters: 8000,
          truncated: false,
        },
      ],
      notSent: ["本地绝对路径（只发送项目内相对路径）", "范围外文件内容"],
      retentionNote:
        "数据保留策略由模型服务商策略决定，本插件无法证明其保留期限。",
    },
  });
}

/**
 * 提交选择规则设置的 Mock 状态与构建器（v0.0.3 阶段 3 设置页）。
 *
 * 合并、校验与预览评估直接复用领域纯函数（与 Host 同一套逻辑），
 * 仅把 IO 与反馈编排替换为内存态。场景通过 URL 参数切换：
 * ?selection=no-repo（无仓库）/ no-candidates（无候选）/ corrupt（配置损坏）/
 * save-error（保存失败）/ shadowed（遮蔽警告）。
 */

type MockSelectionScenario =
  | "default"
  | "no-repo"
  | "no-candidates"
  | "corrupt"
  | "save-error"
  | "shadowed";

function mockSelectionScenario(): MockSelectionScenario {
  if (typeof window === "undefined") {
    return "default";
  }
  const value = new URLSearchParams(window.location.search).get("selection");
  return value === "no-repo" ||
    value === "no-candidates" ||
    value === "corrupt" ||
    value === "save-error" ||
    value === "shadowed"
    ? value
    : "default";
}

interface MockSelectionState {
  /** 仓库层原始配置（未知结构，模拟手工编辑后的文件内容）。 */
  repository?: unknown;
  feedback?: { tone: "success" | "warning" | "error"; message: string };
  saveErrors?: string[];
}

function defaultMockSelectionRepository(): unknown {
  if (isScrollDataset()) {
    return {
      version: 1,
      statusRules: { unversioned: "recommended" },
      pathRules: Array.from({ length: 24 }, (_, index) => ({
        id: `team-rule-${index + 1}`,
        enabled: true,
        pattern: `generated/batch-${index + 1}/**`,
        decision: index % 3 === 0 ? "needsReview" : "excluded",
        reason: `第 ${index + 1} 条团队生成物目录规则`,
      })),
    };
  }
  return {
    version: 1,
    statusRules: { unversioned: "recommended" },
    pathRules: [
      {
        id: "team-fixtures",
        enabled: true,
        pattern: "tests/fixtures/**",
        decision: "needsReview",
        reason: "测试夹具需要人工确认",
      },
    ],
  };
}

function initialMockSelectionState(): MockSelectionState {
  const scenario = mockSelectionScenario();
  if (scenario === "shadowed") {
    return {
      repository: {
        version: 1,
        pathRules: [
          {
            id: "team-dist",
            enabled: true,
            pattern: "**/dist/**",
            decision: "needsReview",
            reason: "团队构建目录需要复核",
          },
          {
            id: "team-dist-report",
            enabled: true,
            pattern: "**/dist/report/**",
            decision: "recommended",
            reason: "报告目录建议提交",
          },
        ],
      },
    };
  }
  if (scenario === "corrupt") {
    return { repository: { version: 99, pathRules: "not-an-array" } };
  }
  if (scenario === "no-repo") {
    return {};
  }
  return { repository: defaultMockSelectionRepository() };
}

let mockSelectionState: MockSelectionState = initialMockSelectionState();
/** v0.0.9 §4：Mock 跨 action 保持提交说明建议草稿，与真实 Host 一致
 * （生成后经 preview/adopt/undo 等快照重建仍保留，discard/commit 后清除）。 */
let mockCommitSuggestion: CommitMessageSuggestion | undefined;
/** v0.0.11 §6：重试失败项后生成建议时并入的说明（一次性）。 */
let mockRetryNote: string | undefined;
/** v0.1.6 V016-F2：Mock 记忆用户提交说明草稿（只加不改旧语义）：
 * 真实 Host 持有草稿并随快照下发；此前 mock 快照恒为 ""，放弃回执等后续快照会误清空已填草稿。
 * 未收到过 update-draft/apply-template 时仍为 ""，旧用例行为不变；显式 overrides 优先。 */
let mockCommitDraftMessage: string | undefined;

function mockSelectionCandidateInputs(): Array<{
  relativePath: string;
  status: SvnStatus;
  propStatus?: SvnStatus;
}> {
  if (isScrollDataset()) {
    const statuses: SvnStatus[] = [
      "modified",
      "added",
      "unversioned",
      "deleted",
      "missing",
    ];
    return Array.from({ length: 40 }, (_, index) => ({
      relativePath: `src/批量模块/module-${index + 1}/文件-${index + 1}.ts`,
      status: statuses[index % statuses.length],
    }));
  }
  return [
    { relativePath: "src/extension.ts", status: "modified" },
    { relativePath: "dist/debug.log", status: "unversioned" },
    { relativePath: "src/conflict/example.ts", status: "conflicted" },
    {
      relativePath: "assets/icon.svg",
      status: "normal",
      propStatus: "modified",
    },
    { relativePath: "tests/fixtures/case.ts", status: "added" },
  ];
}

function mockSelectionPreviewItems(
  resolved: ResolvedCommitSelectionRules,
): CommitSelectionPreviewItem[] {
  const evaluator = createCommitSelectionEvaluator({
    statusRules: resolved.statusRules,
    pathRules: resolved.pathRules,
  });
  return mockSelectionCandidateInputs().map((input) => {
    const evaluation = evaluator.evaluate(input);
    return {
      relativePath: input.relativePath,
      status: input.status,
      propStatus: input.propStatus,
      decision: evaluation.decision,
      reasonKey: evaluation.reasonKey,
      statusPolicyKey: evaluation.statusPolicyKey,
      matchedRuleId: evaluation.matchedRuleId,
      ruleSource: evaluation.ruleSource,
      safetyLocked: evaluation.safetyLocked,
    };
  });
}

function toMockSelectionLayerView(
  resolution: CommitSelectionLayerResolution,
  editable: boolean,
): CommitSelectionSettingsLayerView {
  return {
    editable,
    state: resolution.state,
    config: resolution.config,
    errors: [...resolution.errors],
    warnings: [...resolution.warnings],
  };
}

function buildMockSelectionSection(): CommitSelectionSettingsSection {
  const scenario = mockSelectionScenario();
  const resolved = resolveCommitSelectionRules({
    repository: mockSelectionState.repository,
  });
  const previewError =
    scenario === "no-repo"
      ? "当前没有可用的 SVN 工作副本。请打开包含 .svn 的文件夹后重试。"
      : undefined;
  const items =
    scenario === "no-candidates" || previewError
      ? []
      : mockSelectionPreviewItems(resolved);
  return {
    editingScope: "repository",
    configPath: ".svn-workbench.json",
    layers: {
      user: toMockSelectionLayerView(resolved.layers.user, false),
      workspace: toMockSelectionLayerView(resolved.layers.workspace, false),
      repository: toMockSelectionLayerView(resolved.layers.repository, true),
    },
    effective: {
      statusRules: { ...resolved.statusRules },
      pathRules: resolved.pathRules.map((rule) => ({ ...rule })),
    },
    errors: [...resolved.errors],
    warnings: [...resolved.warnings],
    preview: previewError
      ? { state: "error", error: previewError, items: [] }
      : { state: items.length > 0 ? "ready" : "empty", items },
    feedback: mockSelectionState.feedback,
    saveErrors:
      mockSelectionState.saveErrors && mockSelectionState.saveErrors.length > 0
        ? [...mockSelectionState.saveErrors]
        : undefined,
  };
}

const settingsSnapshotValue = {
  kind: "settings" as const,
  svnSecurity: {
    authenticationActive: true,
    hasStoredAuthentication: true,
    passwordTransport: "stdin" as const,
    certificateTrust: "explicit-svn-cache" as const,
  },
  ai: {
    presets: [
      {
        id: "deepseek",
        label: "DeepSeek",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-flash",
        description: "OpenAI 兼容接口。",
      },
      {
        id: "custom",
        label: "自定义 OpenAI 兼容服务",
        baseUrl: "",
        model: "",
        description: "自定义接口。",
      },
    ],
    scenarios: [
      {
        id: "commitSelection",
        label: "提交文件筛选",
        description: "筛选提交范围。",
      },
      {
        id: "conflictAdvice",
        label: "冲突处理建议",
        description: "分析冲突证据。",
      },
    ],
    providerPreset: "deepseek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    scenarioModels: {},
    hasApiKey: true,
    includeCommitHistory: true,
    historyLimit: 10,
    models: [],
  },
  team: {
    configPath: ".svn-workbench.json",
    configSource: "project" as const,
    enabled: true,
    requiredIssueId: true,
    issueIdPattern: "[A-Z]+-\\d+",
    requiredModule: true,
    allowedModulesText: "workbench, extension",
    requiredPrefix: true,
    allowedPrefixesText: "feat, fix, refactor",
    warnings: [],
    memory: {
      source: "当前仓库成功提交" as const,
      count: 2,
      maxEntries: 50,
      externallyShared: false as const,
      recent: [
        {
          revision: "42",
          summary: "feat(workbench): 完善统一 Svelte 工作台",
          recordedAt: "2026-07-30T08:30:00.000Z",
        },
        {
          revision: "41",
          summary: "test(svn): 补充真实冲突验收",
          recordedAt: "2026-07-29T09:00:00.000Z",
        },
      ],
    },
  },
  // 提交选择规则段由 buildMockSelectionSection 动态构建（合并/评估复用领域纯函数）。
  selection: buildMockSelectionSection(),
};

function settingsSnapshot(
  overrides: Record<string, unknown> = {},
): WorkbenchModuleSnapshot {
  const snapshot = isScrollDataset()
    ? {
        ...settingsSnapshotValue,
        ai: {
          ...settingsSnapshotValue.ai,
          scenarios: Array.from({ length: 32 }, (_, index) => ({
            id: `scenario-${index}`,
            label: `模型场景 ${index + 1}`,
            description: `第 ${index + 1} 个场景的中文用途说明。`,
          })),
        },
        team: {
          ...settingsSnapshotValue.team,
          memory: {
            ...settingsSnapshotValue.team.memory,
            count: 40,
            recent: Array.from({ length: 40 }, (_, index) => ({
              revision: String(120 - index),
              summary: `第 ${index + 1} 条已脱敏中文提交摘要`,
              recordedAt: new Date(
                Date.UTC(2026, 6, 30 - index, 8),
              ).toISOString(),
            })),
          },
        },
      }
    : settingsSnapshotValue;
  // selection 段每次重新构建，让保存/恢复/刷新等 Mock 动作后的状态变化生效。
  return {
    ...snapshot,
    selection: buildMockSelectionSection(),
    ...overrides,
  } as WorkbenchModuleSnapshot;
}

function projectsSnapshot(): WorkbenchModuleSnapshot {
  return {
    kind: "projects",
    projects: [
      {
        name: "vscode-svn",
        absolutePath: "/mock/vscode-svn",
        exists: true,
        binding: "workingCopyRoot",
        bindingLabel: "独立工作副本根",
        workingCopyRoot: "/mock/vscode-svn",
        counts: { changes: 2, conflicts: 0, unversioned: 1 },
        current: true,
      },
      {
        name: "EmApi",
        absolutePath: "/mock/code/EmApi",
        exists: true,
        binding: "parentWorkingCopy",
        bindingLabel: "位于上层工作副本",
        workingCopyRoot: "/mock/code",
        counts: { changes: 1, conflicts: 1, unversioned: 0 },
        current: false,
      },
      {
        name: "notes",
        absolutePath: "/mock/notes",
        exists: true,
        binding: "notSvn",
        bindingLabel: "非 SVN 目录",
        current: false,
      },
    ],
    generatedAt: new Date().toISOString(),
  };
}

function diagnosticsSnapshot(): WorkbenchModuleSnapshot {
  const checks = isScrollDataset()
    ? Array.from({ length: 42 }, (_, index) => ({
        id: `check-${index}`,
        label: `环境检查 ${index + 1}`,
        status: index % 9 === 0 ? ("warn" as const) : ("pass" as const),
        detail: `第 ${index + 1} 项中文检查结果`,
        action: index % 9 === 0 ? "打开对应设置并修复。" : undefined,
        actions:
          index % 9 === 0
            ? [
                { id: "openSettings" as const, label: "打开设置" },
                { id: "rerunDiagnostics" as const, label: "重新检测" },
                { id: "copyDiagnostics" as const, label: "复制诊断信息" },
              ]
            : undefined,
      }))
    : [
        {
          id: "platform",
          label: "操作系统",
          status: "pass" as const,
          detail: "macOS",
        },
        {
          id: "svn-cli",
          label: "SVN CLI",
          status: "fail" as const,
          detail: "未找到 svn 可执行文件",
          action:
            "安装 SVN CLI，或配置 svnWorkbench.svn.path 指向 svn 可执行文件。",
          actions: [
            {
              id: "selectSvnExecutable" as const,
              label: "选择 SVN 可执行文件",
            },
            {
              id: "openSettings" as const,
              label: "打开设置",
              params: { query: "svnWorkbench.svn.path" },
            },
            { id: "copyDiagnostics" as const, label: "复制诊断信息" },
            { id: "rerunDiagnostics" as const, label: "重新检测" },
          ],
        },
        {
          id: "workspace",
          label: "工作区",
          status: "warn" as const,
          detail: "1 个工作区均未检测到 SVN 工作副本",
          action:
            "确认打开的是 SVN 工作副本内的目录；位于上层工作副本的项目会被自动识别，非 SVN 目录请先检出（Checkout）。",
          actions: [
            { id: "openFolder" as const, label: "打开文件夹" },
            { id: "copyDiagnostics" as const, label: "复制诊断信息" },
            { id: "rerunDiagnostics" as const, label: "重新检测" },
          ],
        },
        {
          id: "ai-config",
          label: "AI 配置",
          status: "warn" as const,
          detail: "尚未设置 API 密钥",
          action: "在设置模块中配置。",
          actions: [
            {
              id: "openSettings" as const,
              label: "打开 AI 设置",
              params: { query: "svnWorkbench.ai" },
            },
            { id: "copyDiagnostics" as const, label: "复制诊断信息" },
            { id: "rerunDiagnostics" as const, label: "重新检测" },
          ],
        },
      ];
  const acceptanceSections = isScrollDataset()
    ? Array.from({ length: 24 }, (_, index) => ({
        id: `section-${index}`,
        title: `验收分组 ${index + 1}`,
        items: [
          {
            id: `item-${index}`,
            title: `第 ${index + 1} 个验收项目`,
            description: "确认小区域内容与底部操作均可到达。",
            steps: ["聚焦滚动区域", "滚动到最后一项"],
            expected: ["内容完整可见且焦点未被遮挡"],
          },
        ],
      }))
    : [
        {
          id: "core",
          title: "核心流程",
          items: [
            {
              id: "commit",
              title: "提交预检",
              description: "确认安全提交链路。",
              steps: ["打开提交模块", "生成预览"],
              expected: ["只有通过预检才允许提交"],
            },
          ],
        },
      ];
  return {
    kind: "diagnostics",
    status: "warn",
    checks,
    acceptance: {
      summary: {
        sections: acceptanceSections.length,
        items: acceptanceSections.length,
        steps: acceptanceSections.length * 2,
        expectedResults: acceptanceSections.length,
      },
      sections: acceptanceSections,
    },
    generatedAt: new Date().toISOString(),
    reportText: "SVN 工作台环境诊断：提醒",
  };
}

function activitySnapshot(): WorkbenchModuleSnapshot {
  return {
    kind: "activity",
    records: [
      {
        id: "mock-activity-1",
        capturedAt: new Date(Date.now() - 2 * 60000).toISOString(),
        kind: "operation-execution",
        moduleId: "commit",
        taskId: "commit/compose",
        scopeHash: "mock-scope-hash",
        repositoryUuid: "mock-repository-uuid",
        scopeLabel: "提交 3 个文件",
        impactedCount: 3,
        previewSummary: "svn commit 3 个文件",
        result: "failed",
        errorReason: "提交失败：远端已更新",
        nextActions: [
          { id: "retry", label: "重试" },
          { id: "open-output", label: "打开日志" },
          { id: "copy-diagnostics", label: "复制诊断信息" },
        ],
        nonRecoverable: true,
        nonRecoverableReason: "此操作不能在工作台中一键撤销",
      },
      {
        id: "mock-activity-2",
        capturedAt: new Date(Date.now() - 10 * 60000).toISOString(),
        kind: "draft-checkpoint",
        moduleId: "conflicts",
        taskId: "conflicts/resolve",
        scopeHash: "mock-scope-hash",
        repositoryUuid: "mock-repository-uuid",
        scopeLabel: "冲突草稿 src/conflict/example.ts",
        impactedCount: 1,
        previewSummary: "已保存冲突合并草稿（仅内存）",
        nextActions: [{ id: "open-output", label: "打开日志" }],
      },
    ],
    generatedAt: new Date().toISOString(),
  } as unknown as WorkbenchModuleSnapshot;
}

function repositorySnapshot(
  overrides: Record<string, unknown> = {},
): WorkbenchModuleSnapshot {
  const propertyItems = isScrollDataset()
    ? Array.from({ length: 36 }, (_, index) => ({
        name: `svn:custom-property-${index + 1}`,
        value: `第 ${index + 1} 个属性值`,
      }))
    : [{ name: "svn:ignore", value: "dist\nobj" }];
  const browserEntries = isScrollDataset()
    ? Array.from({ length: 48 }, (_, index) => ({
        name: `中文目录-${String(index + 1).padStart(2, "0")}`,
        kind: index % 4 === 0 ? ("file" as const) : ("dir" as const),
        revision: String(120 - index),
        author: "研发团队",
      }))
    : [
        {
          name: "src",
          kind: "dir" as const,
          revision: "42",
          author: "yangnan",
        },
        { name: "docs", kind: "dir" as const, revision: "40", author: "team" },
        {
          name: "README.md",
          kind: "file" as const,
          size: 4280,
          revision: "41",
          author: "yangnan",
        },
      ];
  return {
    kind: "repository",
    recovery: {
      category: "working-copy-locked",
      title: "工作副本被锁定",
      detectedAt: "2026-07-30T08:30:00.000Z",
      steps: [
        "确认没有其他 SVN 进程正在操作该工作副本。",
        "检查范围后执行安全清理。",
      ],
      requiresFreshPreview: true,
    },
    info: {
      name: "vscode-svn",
      url: "https://svn.example.test/repos/workbench/trunk",
      repositoryRoot: "https://svn.example.test/repos/workbench",
      revision: "42",
    },
    properties: { available: true, target: ".", items: propertyItems },
    cleanup: { available: true, target: "." },
    advanced: {
      browser: {
        url: "https://svn.example.test/repos/workbench/trunk",
        parentUrl: "https://svn.example.test/repos/workbench",
        entries: browserEntries,
      },
    },
    ...overrides,
  } as WorkbenchModuleSnapshot;
}

function changelistSuggestions() {
  const paths = isScrollDataset()
    ? Array.from(
        { length: 36 },
        (_, index) => `项目资料/待分组-${index + 1}.ts`,
      )
    : ["src/webview/App.svelte", "src/webview/styles/global.css"];
  const base = {
    summary: `${paths.length} 个界面文件`,
    message: "feat(workbench): 更新界面",
    paths,
    reason: "按目录聚合。",
    risks: [],
  };
  return isScrollDataset()
    ? Array.from({ length: 24 }, (_, index) => ({
        ...base,
        id: `split-${index + 1}`,
        title: `分组建议 ${index + 1}：工作台模块`,
      }))
    : [{ ...base, id: "split-1", title: "分组 1：webview" }];
}

function changelistSemanticSuggestions() {
  return [
    {
      id: "split-1",
      title: "拆分 1：命令注册",
      summary: "1 个文件，状态：modified",
      message:
        "feat: 调整命令注册\n\n已确认事实：\n- 确认 src/webview/App.svelte 仅影响路由。",
      paths: ["src/webview/App.svelte"],
      reason: "基于受限差异与已确认事实推断提交意图。",
      risks: [],
      purpose: "基于受限差异与已确认事实推断提交意图。",
      dependencies: ["依赖 1 条已确认事实"],
    },
  ];
}

function injectMockChangelistReceipt(): void {
  workbenchBridge.injectMock({
    protocolVersion: WORKBENCH_PROTOCOL_VERSION,
    type: "changelist/receipt",
    moduleId: "changelists",
    taskId: "changelists/manage",
    sessionId: currentMockSessionId,
    repositoryUuid: "mock-repository-uuid",
    scopeHash: "mock-scope-hash",
    payload: {
      token: "mock-changelist-receipt-token",
      receipt: {
        task: "changelist-split",
        projectId: "mock-project",
        model: "deepseek-v4-flash",
        dataTypes: ["项目内相对路径、SVN 状态、脱敏差异片段"],
        files: 1,
        totalBudget: 40000,
        perFileBudget: 6000,
        historyIncluded: false,
      },
      coverage: {
        total: 1,
        analyzed: 1,
        truncated: 0,
        binary: 0,
        readFailed: 0,
        budgetExcluded: 0,
      },
      files: [
        {
          candidateId: "mock-candidate-a",
          projectRelativePath: "src/webview/App.svelte" as never,
          status: "modified",
          state: "analyzed",
          diffHash: "deadbeef",
          charCount: 120,
          hunkCount: 1,
        },
      ],
      excludedCount: 0,
      historyIncluded: false,
      notSent: ["本地绝对路径（只发送项目内相对路径）"],
      retentionNote:
        "数据保留策略由模型服务商策略决定，本插件无法证明其保留期限。",
    },
  });
}

function changelistsSnapshot(
  overrides: Record<string, unknown> = {},
): WorkbenchModuleSnapshot {
  // v0.1.6 V016-F2：`?ai=disabled` 新增 AI 关闭分支（只加不改旧语义）。
  const changelistAiDisabled =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("ai") === "disabled";
  const scrollFiles = isScrollDataset()
    ? Array.from({ length: 40 }, (_, index) => ({
        relativePath: `项目资料/未分组-${index + 1}.ts`,
        selectionKey: mockSelectionKey(`项目资料/未分组-${index + 1}.ts`),
        status: "modified" as const,
        selection: "selected" as const,
        fileType: "TypeScript",
      }))
    : files.slice(0, 3);
  const groups = isScrollDataset()
    ? Array.from({ length: 16 }, (_, index) => ({
        name: `变更集-${index + 1}`,
        files: [
          {
            relativePath: `项目资料/已分组-${index + 1}.ts`,
            selectionKey: mockSelectionKey(`项目资料/已分组-${index + 1}.ts`),
            status: "modified" as const,
            selection: "selected" as const,
            fileType: "TypeScript",
          },
        ],
      }))
    : [];
  return {
    kind: "changelists",
    source: "local-rule",
    aiPrivacy: {
      model: changelistAiDisabled
        ? "本地规则（未配置外部模型）"
        : "deepseek-v4-flash",
      fileLimit: 120,
      data: "文件相对路径、状态、类型和模块分组；不发送文件正文",
      historyIncluded: false,
    },
    groups,
    unassigned: scrollFiles,
    suggestions: [],
    warnings: [],
    ...overrides,
  } as WorkbenchModuleSnapshot;
}

function understandingSnapshot(
  overrides: Record<string, unknown> = {},
): WorkbenchModuleSnapshot {
  // v0.1.6 V016-F2：`?ai=disabled` 新增 AI 关闭分支（只加不改旧语义）：
  // 本地检查为主路径（source local-rule），receipt.model 含「未配置」使面板进入未配置态。
  const understandingAiDisabled =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("ai") === "disabled";
  return {
    kind: "change-understanding",
    state: "ready",
    source: understandingAiDisabled ? "local-rule" : "mixed",
    binding: {
      repositoryUuid: "mock-repository-uuid",
      scopeHash: "mock-scope-hash",
      candidateHash: "mock-candidate-hash",
      revision: "42",
      generatedAt: "2026-08-18T10:00:00.000Z",
      model: "deepseek-v4-flash",
    },
    receipt: {
      task: "understand-changes",
      projectId: "mock-project",
      model: understandingAiDisabled
        ? "本地规则（未配置外部模型）"
        : "deepseek-v4-flash",
      dataTypes: ["项目内相对路径、SVN 状态、脱敏差异片段"],
      files: 1,
      totalBudget: 40000,
      perFileBudget: 6000,
      historyIncluded: false,
    },
    coverage: {
      total: 2,
      analyzed: 1,
      truncated: 1,
      binary: 0,
      readFailed: 0,
      budgetExcluded: 0,
    },
    coverageFiles: [
      {
        candidateId: "mock-candidate-a",
        projectRelativePath: "src/extension.ts" as never,
        status: "modified",
        state: "analyzed",
        diffHash: "deadbeef",
        charCount: 320,
        hunkCount: 2,
      },
      {
        candidateId: "mock-candidate-b",
        projectRelativePath: "dist/out.js" as never,
        status: "modified",
        state: "truncated",
        diffHash: "deadbeef",
        charCount: 6000,
        hunkCount: 1,
        reason: "差异超过单文件预算，已截断",
      },
    ],
    changes: [
      {
        id: "local-modified",
        statement: "修改了 2 个文件：src/extension.ts、dist/out.js。",
        source: "local-rule",
        status: "confirmed",
        confidenceReason: "差异正文已本地核对，证据为逐文件差异块。",
        evidence: [
          {
            candidateId: "mock-candidate-a",
            hunkId: "mock-hunk-1",
            projectRelativePath: "src/extension.ts",
          },
        ],
        invalidEvidence: [],
        limitations: [],
        nextAction: "打开证据核对具体改动。",
      },
    ],
    findings: [
      {
        id: "model-finding-0",
        category: "evidence-gap",
        statement: "dist/out.js 差异被截断，具体行为无法判断。",
        source: "configured-model",
        severity: "warning",
        consequence: "提交说明可能遗漏该文件的行为变化。",
        evidence: [],
        invalidEvidence: [],
        limitations: ["差异超过预算已截断。"],
        nextAction: "重试失败项或人工查看该文件差异。",
      },
    ],
    verification: [
      {
        id: "verify-类型与组件回归",
        title: "类型与组件回归",
        reason: "检测到 TypeScript / Svelte 变更。",
        command: "npm run check && npm run test:unit",
        gate: "general",
      },
    ],
    userConfirmations: [],
    limitations: [],
    warnings: [],
    // v0.1.6 V016-F2：AI 关闭分支初始即纯本地（不带模型发现；只加分支）。
    ...(understandingAiDisabled ? { findings: [], userConfirmations: [] } : {}),
    ...overrides,
  } as WorkbenchModuleSnapshot;
}

function injectMockCommitReceipt(retryNote?: string): void {
  // v0.0.11 §3/§6：受限差异外发回执（模型调用前展示与确认）。
  workbenchBridge.injectMock({
    protocolVersion: WORKBENCH_PROTOCOL_VERSION,
    type: "commit/receipt",
    moduleId: "commit",
    taskId: "commit/compose",
    sessionId: currentMockSessionId,
    repositoryUuid: "mock-repository-uuid",
    scopeHash: "mock-scope-hash",
    payload: {
      token: "mock-receipt-token",
      receipt: {
        task: "commit-draft",
        projectId: "mock-project",
        model: "deepseek-v4-flash",
        dataTypes: ["项目内相对路径、SVN 状态、脱敏差异片段"],
        files: 1,
        totalBudget: 40000,
        perFileBudget: 6000,
        historyIncluded: false,
      },
      coverage: {
        total: 2,
        analyzed: 1,
        truncated: 1,
        binary: 0,
        readFailed: 0,
        budgetExcluded: 0,
      },
      files: [
        {
          candidateId: "mock-candidate-a",
          projectRelativePath: "src/webview/app/FeatureRouter.svelte" as never,
          status: "modified",
          state: "analyzed",
          diffHash: "deadbeef",
          charCount: 320,
          hunkCount: 2,
        },
        {
          candidateId: "mock-candidate-b",
          projectRelativePath: "dist/out.js" as never,
          status: "modified",
          state: "truncated",
          diffHash: "deadbeef",
          charCount: 6000,
          hunkCount: 1,
          reason: "差异超过单文件预算，已截断",
        },
      ],
      excludedCount: 1,
      historyIncluded: false,
      ...(retryNote
        ? {
            retryNote,
          }
        : {}),
      notSent: [
        "本地绝对路径（只发送项目内相对路径）",
        "范围外文件内容",
        "API 密钥、SVN 凭据与证书私密材料",
      ],
      retentionNote:
        "数据保留策略由模型服务商策略决定，本插件无法证明其保留期限。",
    },
  });
}

function injectMockUnderstandingReceipt(retryNote?: string): void {
  // v0.0.12：变更解读外发回执（任务 understand-changes；独立消息）。
  workbenchBridge.injectMock({
    protocolVersion: WORKBENCH_PROTOCOL_VERSION,
    type: "understanding/receipt",
    moduleId: "understanding",
    taskId: "understanding/analyze",
    sessionId: currentMockSessionId,
    repositoryUuid: "mock-repository-uuid",
    scopeHash: "mock-scope-hash",
    payload: {
      token: "mock-understanding-receipt-token",
      receipt: {
        task: "understand-changes",
        projectId: "mock-project",
        model: "deepseek-v4-flash",
        dataTypes: ["项目内相对路径、SVN 状态、脱敏差异片段"],
        files: 1,
        totalBudget: 40000,
        perFileBudget: 6000,
        historyIncluded: false,
      },
      coverage: {
        total: 2,
        analyzed: 1,
        truncated: 1,
        binary: 0,
        readFailed: 0,
        budgetExcluded: 0,
      },
      files: [
        {
          candidateId: "mock-candidate-a",
          projectRelativePath: "src/extension.ts" as never,
          status: "modified",
          state: "analyzed",
          diffHash: "deadbeef",
          charCount: 320,
          hunkCount: 2,
        },
        {
          candidateId: "mock-candidate-b",
          projectRelativePath: "dist/out.js" as never,
          status: "modified",
          state: "truncated",
          diffHash: "deadbeef",
          charCount: 6000,
          hunkCount: 1,
          reason: "差异超过单文件预算，已截断",
        },
      ],
      excludedCount: 1,
      historyIncluded: false,
      ...(retryNote ? { retryNote } : {}),
      notSent: [
        "本地绝对路径（只发送项目内相对路径）",
        "范围外文件内容",
        "API 密钥、SVN 凭据与证书私密材料",
      ],
      retentionNote:
        "数据保留策略由模型服务商策略决定，本插件无法证明其保留期限。",
    },
  });
}

function injectSnapshot(
  moduleId: WorkbenchModuleId,
  snapshot: WorkbenchModuleSnapshot,
  taskId?: WorkbenchTaskId,
): void {
  const resolvedTaskId =
    taskId ??
    (moduleId === activeMockModuleId
      ? activeMockTaskId
      : defaultWorkbenchTask(moduleId));
  activeMockModuleId = moduleId;
  activeMockTaskId = resolvedTaskId;
  workbenchBridge.injectMock({
    protocolVersion: WORKBENCH_PROTOCOL_VERSION,
    type: "module/snapshot",
    moduleId,
    taskId: resolvedTaskId,
    sessionId: currentMockSessionId,
    repositoryUuid: "mock-repository-uuid",
    scopeHash: "mock-scope-hash",
    payload: { snapshot },
  });
}

function injectMockError(
  payload: Extract<
    HostToWebviewMessage,
    { type: "operation/error" }
  >["payload"],
): void {
  workbenchBridge.injectMock({
    protocolVersion: WORKBENCH_PROTOCOL_VERSION,
    type: "operation/error",
    moduleId: "changes",
    taskId: "changes/overview",
    sessionId: currentMockSessionId,
    repositoryUuid: "mock-repository-uuid",
    scopeHash: "mock-scope-hash",
    payload,
  });
}

function isScrollDataset(): boolean {
  return (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("dataset") === "scroll"
  );
}
