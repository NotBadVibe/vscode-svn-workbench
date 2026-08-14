import {
  defaultWorkbenchTask,
  isWorkbenchModuleId,
  isWorkbenchTaskForModule,
  WORKBENCH_PROTOCOL_VERSION,
  type CommitSelectionPreviewItem,
  type CommitSelectionSettingsLayerView,
  type CommitSelectionSettingsSection,
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
/** 等待三选一决定的 mock 切换目标。 */
let pendingMockSwitch: string | undefined;
/** mock Host 的编辑基准（保存轮换；用于校验第二次保存负载）。 */
let mockEditRawHash = "mock-raw-hash";
let mockEditToken = "mock-edit-token";
let mockEditRevision = 1;
/** 目标切换后的 mock 会话序号（模拟 Host 会话替换）。 */
let mockSessionCounter = 0;

/** 模拟 Host 的目标切换：新会话 app/initialize + 新快照。 */
function injectDiffTargetSwitch(relativePath: string): void {
  activeMockDiffPath = relativePath;
  mockSessionCounter += 1;
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
    history: historySnapshot,
    conflicts: conflictSnapshot,
    repository: repositorySnapshot,
    "ai-review": aiReviewSnapshot,
    impact: impactSnapshot,
    changelists: changelistsSnapshot,
    agent: agentSnapshot,
    settings: settingsSnapshot,
    diagnostics: diagnosticsSnapshot,
    projects: projectsSnapshot,
  };
  return factories[moduleId]();
}

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
  return {
    kind: "diff",
    relativePath,
    original: overrides.original ?? mockDiffOriginal,
    modified: overrides.modified ?? mockDiffModified,
    language: "typescript",
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
  type:
    | "diff/edit-opened"
    | "diff/save-result"
    | "diff/draft-checkpointed"
    | "diff/target-switch-confirm"
    | "module/loading"
    | "file/path-detail-result"
    | "operation/result",
  payload: Record<string, unknown>,
): void {
  workbenchBridge.injectMock({
    protocolVersion: WORKBENCH_PROTOCOL_VERSION,
    type,
    moduleId: activeMockModuleId,
    taskId: activeMockTaskId,
    sessionId: "mock-session-id",
    repositoryUuid: "mock-repository-uuid",
    scopeHash: "mock-scope-hash",
    payload,
  } as never);
}

export function startMockWorkbench(): void {
  const initialModuleId = initialMockModule();
  activeMockModuleId = initialModuleId;
  activeMockTaskId = defaultWorkbenchTask(initialModuleId);
  let mockAgentCompleted = 0;
  const initial: HostToWebviewMessage = {
    protocolVersion: WORKBENCH_PROTOCOL_VERSION,
    type: "app/initialize",
    moduleId: initialModuleId,
    taskId: activeMockTaskId,
    sessionId: "mock-session-id",
    repositoryUuid: "mock-repository-uuid",
    scopeHash: "mock-scope-hash",
    payload: {
      moduleId: initialModuleId,
      scope: {
        repositoryName: "vscode-svn",
        projectName: "vscode-svn",
        roots: [{ kind: "folder", relativePath: toDisplayPath(".") }],
        source: "internal",
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
        history: historySnapshot,
        conflicts: conflictSnapshot,
        repository: repositorySnapshot,
        "ai-review": aiReviewSnapshot,
        impact: impactSnapshot,
        changelists: changelistsSnapshot,
        agent: agentSnapshot,
        settings: settingsSnapshot,
        diagnostics: diagnosticsSnapshot,
        projects: projectsSnapshot,
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
      } else if (createSnapshot) {
        injectSnapshot(moduleId, createSnapshot(), taskId);
      }
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
        update: ["repository", repositorySnapshot],
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
        history: historySnapshot,
        conflicts: conflictSnapshot,
        repository: repositorySnapshot,
        "ai-review": aiReviewSnapshot,
        impact: impactSnapshot,
        changelists: changelistsSnapshot,
        agent: agentSnapshot,
        settings: settingsSnapshot,
        diagnostics: diagnosticsSnapshot,
        projects: projectsSnapshot,
      };
      if (activeMockModuleId === "diff") {
        injectSnapshot("diff", mockDiffSnapshot(activeMockDiffPath));
      } else {
        injectSnapshot(activeMockModuleId, snapshots[activeMockModuleId]());
      }
    }
    if (action === "commit/apply-template") {
      injectSnapshot(
        "commit",
        commitSnapshot({ message: "需求: \n\n范围: \n影响: " }),
      );
    }
    if (action === "commit/generate-message") {
      injectSnapshot(
        "commit",
        commitSnapshot({
          message: "feat(workbench): 迁移统一 Svelte UI",
          ai: {
            source: "local-rule",
            summary: "已基于 2 个文件生成提交说明。",
            warnings: [],
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
    if (action === "history/preview-restore")
      injectSnapshot(
        "history",
        historySnapshot({
          restorePreview: {
            token: "mock-restore",
            revision: typeof data.revision === "string" ? data.revision : "42",
            relativePath: "src/extension.ts",
            command: 'svn cat -r 42 "src/extension.ts" > <working-file>',
            canExecute: true,
            issues: [],
          },
        }),
      );
    if (action === "history/execute-restore")
      injectSnapshot(
        "history",
        historySnapshot({
          feedback: "src/extension.ts 已恢复为 r42 内容；尚未提交。",
        }),
      );
    if (action === "conflict/select" && typeof data.relativePath === "string") {
      injectSnapshot("conflicts", conflictSnapshot());
    }
    if (action === "conflict/advise") {
      injectSnapshot(
        "conflicts",
        conflictSnapshot({
          advice: mockConflictAdvice(),
        }),
      );
    }
    if (action === "conflict/save-working") {
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
    if (action === "conflict/preview-resolve") {
      injectSnapshot(
        "conflicts",
        conflictSnapshot({
          advice: mockConflictAdvice(),
          resolvePreview: {
            token: "mock-resolve",
            relativePath: "src/conflict/example.ts",
            command: 'svn resolve --accept working "src/conflict/example.ts"',
            canResolve: true,
            issues: [],
          },
        }),
      );
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
    if (action === "repository/preview-update") {
      injectSnapshot(
        "repository",
        repositorySnapshot({
          update: {
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
    if (action === "repository/execute-update") {
      injectSnapshot(
        "repository",
        repositorySnapshot({
          lastResult: {
            ok: true,
            revision: "43",
            hasConflicts: false,
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
                ? ["只修改当前工作副本；不会自动提交。", "执行后重新采集状态。"]
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
    if (action === "ai-review/run")
      injectSnapshot("ai-review", aiReviewSnapshot());
    if (action === "impact/run") injectSnapshot("impact", impactSnapshot());
    if (action === "changelist/suggest")
      injectSnapshot(
        "changelists",
        changelistsSnapshot({ suggestions: changelistSuggestions() }),
      );
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
          groups: [{ name: "webview", paths: ["src/webview/App.svelte"] }],
          suggestions: changelistSuggestions(),
          feedback: "文件已加入 webview。",
        }),
      );
    if (action === "agent/create-plan") {
      mockAgentCompleted = 0;
      injectSnapshot(
        "agent",
        agentSnapshot(
          0,
          typeof data.objective === "string" ? data.objective : "检查当前范围",
        ),
      );
    }
    if (action === "agent/approve-step") {
      mockAgentCompleted += 1;
      injectSnapshot(
        "agent",
        agentSnapshot(mockAgentCompleted, "检查当前范围并形成测试建议"),
      );
    }
    if (action === "agent/cancel")
      injectSnapshot("agent", agentSnapshot(-1, "检查当前范围"));
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

function changesSnapshot(
  overrides: Record<string, unknown> = {},
): WorkbenchModuleSnapshot {
  const dataset =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("dataset")
      : undefined;
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
    ...overrides,
  } as WorkbenchModuleSnapshot;
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
    summary: {
      total: snapshotFiles.length,
      selected: snapshotFiles.length,
      needsReview: 0,
      excluded: 0,
      blocked: 0,
    },
    selectedPaths: snapshotFiles.map((item) => item.relativePath),
    message: "",
    messageIssues: ["提交说明不能为空。"],
    conventionHint: "前缀：feat, fix；模块：workbench",
    selectionAi:
      commitAiScenario === "none"
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
        model: "deepseek-v4-flash",
        fileLimit: 80,
        data: "已选文件元数据与增删行统计；不发送文件正文",
        historyIncluded: false,
      },
    ],
    templates: [
      { id: "feature", label: "需求开发", body: "需求: \n\n范围: \n影响: " },
      { id: "bugfix", label: "问题修复", body: "修复: \n\n原因: \n影响: " },
    ],
    ...overrides,
  } as WorkbenchModuleSnapshot;
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
    fileActionsAvailable: true,
    ...overrides,
  } as WorkbenchModuleSnapshot;
}

function conflictSnapshot(
  overrides: Record<string, unknown> = {},
): WorkbenchModuleSnapshot {
  const conflicts = isScrollDataset()
    ? Array.from({ length: 36 }, (_, index) => ({
        relativePath: `项目资料/冲突/文件-${index + 1}.ts`,
        operation: "update" as const,
        type: "text" as const,
        sourceLeftRevision: "119",
        sourceRightRevision: "120",
      }))
    : [
        {
          relativePath: "src/conflict/example.ts",
          operation: "update" as const,
          type: "text" as const,
          sourceLeftRevision: "41",
          sourceRightRevision: "42",
        },
      ];
  const workingContent = isScrollDataset()
    ? Array.from(
        { length: 80 },
        (_, index) => `第 ${index + 1} 行工作副本内容`,
      ).join("\n")
    : "<<<<<<< .mine\nexport const mode = 'local';\n=======\nexport const mode = 'svelte';\n>>>>>>> .r42\n";
  return {
    kind: "conflicts",
    conflicts,
    selected: {
      relativePath: "src/conflict/example.ts",
      operation: "update",
      type: "text",
      sourceLeftRevision: "41",
      sourceRightRevision: "42",
      contents: {
        base: { content: "export const mode = 'legacy';\n", truncated: false },
        mine: { content: "export const mode = 'local';\n", truncated: false },
        theirs: {
          content: "export const mode = 'svelte';\n",
          truncated: false,
        },
        working: { content: workingContent, truncated: false },
      },
      mergeEditor: { token: "mock-edit", editable: true, issues: [] },
    },
    aiPrivacy: {
      model: "deepseek-v4-flash",
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
            label: `AI 场景 ${index + 1}`,
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
      }))
    : [
        {
          id: "platform",
          label: "操作系统",
          status: "pass" as const,
          detail: "macOS",
        },
        {
          id: "ai-config",
          label: "AI 配置",
          status: "warn" as const,
          detail: "尚未设置 API 密钥",
          action: "在设置模块中配置。",
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

function aiReviewSnapshot(): WorkbenchModuleSnapshot {
  const baseFindings = [
    {
      id: "security:env",
      severity: "critical" as const,
      category: "security" as const,
      relativePath: "src/config.ts",
      line: 8,
      title: "疑似敏感信息",
      evidence: "检测到疑似凭据，具体值已隐藏。",
      recommendation: "移除并轮换凭据。",
      confidence: "high" as const,
    },
    {
      id: "debug:extension",
      severity: "warning" as const,
      category: "debug" as const,
      relativePath: "src/extension.ts",
      line: 12,
      title: "检测到调试代码",
      evidence: "console.log(result)",
      recommendation: "确认调试输出是否应保留。",
      confidence: "high" as const,
    },
    {
      id: "testing",
      severity: "note" as const,
      category: "testing" as const,
      title: "未检测到测试文件变更",
      evidence: "2 个源文件发生变化。",
      recommendation: "执行回归测试。",
      confidence: "medium" as const,
    },
  ];
  const findings = isScrollDataset()
    ? Array.from({ length: 36 }, (_, index) => ({
        ...baseFindings[index % baseFindings.length],
        id: `finding-${index}`,
        title: `第 ${index + 1} 条审查发现`,
        relativePath: `项目资料/模块-${index + 1}.ts`,
      }))
    : baseFindings;
  return {
    kind: "ai-review",
    state: "ready",
    source: "local-rule",
    generatedAt: new Date().toISOString(),
    privacy: {
      files: 3,
      characters: 4280,
      maxCharacters: 2000000,
      historyIncluded: false,
      model: "本地规则引擎",
    },
    summary: { critical: 1, warning: 1, note: 1 },
    findings,
    warnings: [],
  };
}

function impactSnapshot(): WorkbenchModuleSnapshot {
  return {
    kind: "impact",
    generatedAt: new Date().toISOString(),
    source: "local-rule",
    changedFiles: 4,
    areas: [
      {
        id: "src/webview",
        title: "Svelte Webview",
        detail: "2 个变更文件",
        paths: ["src/webview/App.svelte", "src/webview/styles/global.css"],
        risk: "medium",
      },
    ],
    tests: [
      {
        title: "Webview 浏览器验收",
        reason: "UI 和样式发生变化。",
        command: "npm run test:webview",
      },
    ],
    observations: ["抽查 Light、Dark 和 High Contrast。"],
    warnings: [],
  };
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
    reason: "按业务模块聚合。",
    risks: [],
  };
  return isScrollDataset()
    ? Array.from({ length: 24 }, (_, index) => ({
        ...base,
        id: `split-${index + 1}`,
        title: `拆分建议 ${index + 1}：工作台模块`,
      }))
    : [{ ...base, id: "split-1", title: "拆分 1：webview" }];
}

function changelistsSnapshot(
  overrides: Record<string, unknown> = {},
): WorkbenchModuleSnapshot {
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
        paths: [`项目资料/已分组-${index + 1}.ts`],
      }))
    : [];
  return {
    kind: "changelists",
    source: "local-rule",
    aiPrivacy: {
      model: "deepseek-v4-flash",
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

function agentSnapshot(
  completed = -2,
  objective = "",
): WorkbenchModuleSnapshot {
  if (completed === -2)
    return {
      kind: "agent",
      status: "idle",
      objective: "",
      steps: [],
      guardrails: [
        "只访问当前右键范围",
        "每一步都需要显式批准",
        "不自动修改文件、不自动提交",
      ],
    };
  const definitions = [
    [
      "status",
      "重新采集 SVN 状态",
      "svn-read",
      "已采集 4 个候选，其中 1 个阻止项。",
    ],
    [
      "review",
      "执行证据审查",
      "local-analysis",
      "发现 1 个高风险、1 个提醒、1 个建议。",
    ],
    [
      "impact",
      "生成影响与测试计划",
      "local-analysis",
      "识别 2 个影响区域，生成 3 条测试建议。",
    ],
  ] as const;
  const cancelled = completed === -1;
  const steps = definitions.map(([id, title, capability, output], index) => ({
    id,
    title,
    detail: `${title}的受控步骤。`,
    capability,
    command: id === "status" ? "svn status --xml <current-scope>" : undefined,
    scope: "当前右键范围",
    risk: "低 · 只读或本地分析",
    reversibility: "不产生工作副本修改",
    status: cancelled
      ? ("cancelled" as const)
      : index < completed
        ? ("completed" as const)
        : ("pending" as const),
    output: index < completed ? output : undefined,
    requiresApproval: true,
  }));
  return {
    kind: "agent",
    status: cancelled
      ? "cancelled"
      : completed >= steps.length
        ? "completed"
        : "planned",
    objective,
    guardrails: [
      "只访问当前右键范围",
      "每一步都需要显式批准",
      "不自动修改文件、不自动提交",
    ],
    steps,
    nextStepId:
      cancelled || completed >= steps.length ? undefined : steps[completed].id,
    message:
      completed >= steps.length
        ? "受控分析计划已完成，可以进入审查、影响或提交模块继续操作。"
        : undefined,
  };
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
    sessionId: "mock-session-id",
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
    sessionId: "mock-session-id",
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
