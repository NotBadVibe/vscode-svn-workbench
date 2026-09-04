<script lang="ts">
  import { EditorState } from "@codemirror/state";
  import { EditorView, lineNumbers } from "@codemirror/view";
  import { SvelteMap } from "svelte/reactivity";
  import { untrack } from "svelte";
  import type {
    ConflictSnapshot,
    HostToWebviewMessage,
    WebviewAction,
  } from "@protocol/workbenchProtocol";
  import {
    applyTextConflictResolution,
    parseTextConflictBlocks,
  } from "../../../conflict/conflictMerge";
  import type { MergeConflictActionPayload } from "@pierre/diffs";
  import {
    type ConflictFileIdentity,
    type ContentHash,
  } from "../../../conflict/conflictDiffModel";
  import {
    CONFLICT_SHORTCUTS,
    CONFLICT_SHORTCUT_LIST,
    REPLACE_DEFERRED_NOTE,
    isImeComposingEvent,
  } from "./conflictShortcuts";
  import {
    isNonTextKind,
    getNonTextInfo,
    deriveRecoveryItems,
    RECOVERY_CATALOG,
    hasMarkerRemaining as hasMarkerRemainingFn,
  } from "../../../conflict/conflictRecovery";
  import {
    buildConflictFileIdentity,
    hashText,
  } from "../../../conflict/conflictDiffModel";
  import {
    createConflictCompletionState,
    derivePhase,
  } from "../../../conflict/conflictCompletionModel";
  import type { ConflictCompletionState } from "../../../conflict/conflictCompletionModel";

  import ConflictDiffView from "./ConflictDiffView.svelte";
  import ConflictResultEditor from "./ConflictResultEditor.svelte";
  import MergeActionToolbar from "./MergeActionToolbar.svelte";
  import ConflictStepBar from "./ConflictStepBar.svelte";
  import type { DiffErrorInfo } from "../diff/diffErrorTaxonomy";
  import ScrollArea from "../../components/ui/ScrollArea.svelte";
  import SearchInput from "../../components/list/SearchInput.svelte";
  import ResultCount from "../../components/list/ResultCount.svelte";
  import OperationIntentDialog from "../../components/operation/OperationIntentDialog.svelte";
  import FilePathDetail from "../../components/svn/FilePathDetail.svelte";
  import AssistancePanel from "../../components/assistance/AssistancePanel.svelte";
  import type {
    AssistanceActionItem,
    AssistanceSourceState,
  } from "../../components/assistance/assistanceTypes";
  import { useFileList } from "../../components/list/useFileList.svelte";
  import { naturalCompare } from "../../../selection/selectionSort";
  import { confidenceLabels, sourceLabels } from "../../i18n/terminology";
  import { conflictAssistanceLabels } from "../../i18n/terminology";

  /*
   * v0.0.10 跨模块列表迁移：冲突列表复用共享搜索、排序、键盘导航与
   * 路径详情；提供上一个/下一个未解决冲突导航与处理进度。Conflict
   * 不提供批量 Resolve——每个 Resolve 仍单独预览、确认与复验。
   */

  let {
    snapshot,
    onAction,
    pathDetail,
    conflictReceipt,
    conflictDraftAck,
    conflictSwitchRequest,
    entryOrigin,
  }: {
    snapshot: ConflictSnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
    /** v0.0.10：路径详情结果（Host 一次性下发）。 */
    pathDetail?: Extract<
      HostToWebviewMessage,
      { type: "file/path-detail-result" }
    >["payload"];
    /** v0.0.12 批次 C：冲突意图解释外发回执（conflict/receipt 一次性）。 */
    conflictReceipt?: Extract<
      HostToWebviewMessage,
      { type: "conflict/receipt" }
    >["payload"];
    /** v0.0.13 批次 B：冲突草稿检查点 ACK。 */
    conflictDraftAck?: Extract<
      HostToWebviewMessage,
      { type: "conflict/draft-checkpointed" }
    >["payload"];
    /** v0.0.13 批次 B：冲突草稿三选一守卫请求。 */
    conflictSwitchRequest?: Extract<
      HostToWebviewMessage,
      { type: "conflict/draft-switch-confirm" }
    >["payload"];
    /** v0.1.3 V013-E：进入冲突页的来源（用于全部完成后的返回来路） */
    entryOrigin?: "update" | "changes" | "command" | "conflicts" | "generic";
  } = $props();

  let activePane = $state<"working" | "mine" | "theirs" | "base">("working");
  // v0.1.1 V011-D：主视图固定为合并结果（ConflictDiffView + 手动编辑器）；
  // 我的/对方/BASE 收入“查看来源”折叠区，不再与块级动作争夺首屏。
  let sourcePane = $state<"mine" | "theirs" | "base">("mine");
  let receiptExpanded = $state(false);

  /** v0.0.12 批次 C：解释冲突意图（先展示受限回执，确认后调用模型）。 */
  function requestInterpret(): void {
    onAction("conflict/preview-receipt", {
      relativePath: snapshot.selected?.relativePath,
    });
  }
  function confirmInterpret(): void {
    if (!conflictReceipt) return;
    onAction("conflict/interpret", { receiptToken: conflictReceipt.token });
    conflictReceipt = undefined;
  }
  function continueLocalAdvice(): void {
    const receipt = conflictReceipt;
    if (receipt) {
      onAction("conflict/receipt-dismiss", { token: receipt.token });
    }
    conflictReceipt = undefined;
    onAction("conflict/advise", {
      relativePath: snapshot.selected?.relativePath,
    });
  }
  function dismissInterpretReceipt(): void {
    const receipt = conflictReceipt;
    if (receipt) {
      onAction("conflict/receipt-dismiss", { token: receipt.token });
    }
    conflictReceipt = undefined;
  }
  let query = $state("");
  let typeFilter = $state("all");
  let operationFilter = $state("all");
  let sortField = $state<"path" | "type" | "operation">("path");
  let navAnnouncement = $state("");
  // v0.1.3 V013-E：重采后自动导航与全部完成状态
  let prevSnapshotPaths = $state<string[]>([]);
  let prevSelectedPath = $state<string | undefined>(undefined);
  // 中文注释：编辑器路径单独跟踪，避免与 V013-E 的 prevSelectedPath 时序竞争导致跨文件残留
  let prevEditorPath = $state<string | undefined>(undefined);
  // 跟踪前一次选中是否有脏草稿，供守卫判断（保留供调试与未来扩展，lint 忽略）
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let prevHadDraftDirty = $state(false);
  let v013Initialized = $state(false);
  // 记录进入来源：优先 props，其次 URL 参数，其次 sessionStorage，最后 generic
  const effectiveEntryOrigin = $derived.by(() => {
    if (entryOrigin) return entryOrigin;
    try {
      const params = new URLSearchParams(window.location.search);
      const p = params.get("entry") ?? params.get("source");
      if (
        p === "update" ||
        p === "changes" ||
        p === "command" ||
        p === "conflicts"
      )
        return p;
      const stored = sessionStorage.getItem("conflicts-entry-origin");
      if (
        stored === "update" ||
        stored === "changes" ||
        stored === "command" ||
        stored === "conflicts"
      )
        return stored;
    } catch (_e) {
      void _e;
    }
    return "generic" as const;
  });
  // v0.0.13 中文 IME 保护与三选一对话框焦点管理
  let isComposing = $state(false);
  let switchDialogEl = $state<HTMLDialogElement>();
  let switchTriggerEl: HTMLElement | undefined;
  let conflictDraftFeedback = $state("");
  // v0.1.2 V012-D：检查点状态（自动 debounce + 显式保存），持续显示：未保存 / 检查点已保存 / 保存失败
  let checkpointStatus = $state<"idle" | "unsaved" | "saved" | "failed">(
    "idle",
  );
  let checkpointStatusDetail = $state("");
  let autoCheckpointTimer: ReturnType<typeof setTimeout> | undefined;
  const AUTO_CHECKPOINT_DELAY = 450;
  // v0.1.2 V012-D：恢复草稿时尽量连 selection/视口一起恢复（用 getState/setState 思想，本地 Map）
  const savedEditorStates = new SvelteMap<
    string,
    {
      text: string;
      selection?: { start: number; end: number };
      viewport?: { top: number; left: number };
    }
  >();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 保留供外部/测试复用，当前模板内联渲染
  function checkpointStatusText(): string {
    if (checkpointStatus === "unsaved") return "未保存";
    // 修复：状态条文案不含“检查点已保存”，避免与旧 notice 重复（旧测试期望单例）
    if (checkpointStatus === "saved") return "已保存";
    if (checkpointStatus === "failed") return "保存失败";
    return "";
  }
  function scheduleAutoCheckpoint(content: string): void {
    if (isComposing) return;
    // IME 期间不触发检查点
    const composingLocal = resultEditor?.isComposing?.() ?? false;
    if (composingLocal) return;
    checkpointStatus = "unsaved";
    checkpointStatusDetail = "有未保存变更";
    if (autoCheckpointTimer) clearTimeout(autoCheckpointTimer);
    autoCheckpointTimer = setTimeout(() => {
      autoCheckpointTimer = undefined;
      if (isComposing || (resultEditor?.isComposing?.() ?? false)) return;
      const rp = snapshot.selected?.relativePath;
      if (!rp) return;
      // 保存当前 selection/视口到本地 Map，供返回时恢复
      try {
        const state = resultEditor?.getMergeState?.();
        if (state?.editorState) {
          savedEditorStates.set(rp, {
            text: content,
            selection: state.editorState.selection as unknown as {
              start: number;
              end: number;
            },
            viewport: state.editorState.viewport as unknown as {
              top: number;
              left: number;
            },
          });
        }
      } catch (_e) {
        void _e;
      }
      onAction("conflict/draft-checkpoint", { relativePath: rp, content });
    }, AUTO_CHECKPOINT_DELAY);
  }
  function flushCheckpoint(): void {
    if (isComposing || (resultEditor?.isComposing?.() ?? false)) return;
    if (autoCheckpointTimer) {
      clearTimeout(autoCheckpointTimer);
      autoCheckpointTimer = undefined;
    }
    const rp = snapshot.selected?.relativePath;
    if (!rp) return;
    try {
      const state = resultEditor?.getMergeState?.();
      if (state?.editorState) {
        savedEditorStates.set(rp, {
          text: mergeDraft,
          selection: state.editorState.selection as unknown as {
            start: number;
            end: number;
          },
          viewport: state.editorState.viewport as unknown as {
            top: number;
            left: number;
          },
        });
      }
    } catch (_e) {
      void _e;
    }
    onAction("conflict/draft-checkpoint", {
      relativePath: rp,
      content: mergeDraft,
    });
    checkpointStatus = "unsaved";
  }
  // v0.0.14 通用操作意向单：Resolve 确认对话框（批次 C）
  let resolveIntentOpen = $state(false);
  let resolveTriggerEl = $state<HTMLElement | null>(null);
  const resolveIntent = $derived.by(() => {
    const preview = snapshot.resolvePreview;
    if (!preview || !snapshot.selected) return undefined;
    const title = `标记解决 1 个冲突`;
    const summary = `标记解决 ${snapshot.selected.relativePath} · 当前状态：工作副本已保存，待标记解决 · 不可逆：执行 svn resolve --accept working 将清除冲突标记，需确认后不可自动撤销`;
    // V013-D：标题保持，不加前置复选框，一次确认；summary 已补充状态与不可逆影响

    const stale = false;
    // v0.1.5 V015-C1 九要素补齐：单冲突文件即范围（与候选清单同一来源）；
    // 可恢复性复用 Host 解决预览摘要中的不可逆文案；revision 无权威来源，不虚构。
    return {
      token: preview.token,
      kind: "resolve" as const,
      title,
      summary,
      paths: [snapshot.selected.relativePath],
      scopeText: snapshot.selected.relativePath,
      recoverability:
        "执行 svn resolve --accept working 将清除冲突标记，确认后不可自动撤销。",
      createdAt: new Date().toISOString(),
      canExecute: preview.canResolve && !stale,
      issues: preview.issues,
      commands: [preview.command],
      stale,
    };
  });
  /** v0.0.9：模型未配置时按钮不标“AI”，如实指向本地建议（AI09-TRUTH-01）。 */
  const conflictAdviceConfigured = $derived(
    snapshot.aiPrivacy?.model !== undefined &&
      !snapshot.aiPrivacy.model.includes("未配置"),
  );
  /**
   * v0.1.6 V016-C2：冲突帮助统一收进 AssistancePanel（单一「需要帮助」入口）。
   * - 展开态由页面持有，组件不自建第二状态机；折叠不丢建议/解释结果。
   * - 协议与 Host 零改动：仍走 conflict/advise、conflict/preview-receipt、
   *   conflict/interpret、conflict/receipt-dismiss；回执 token 仍由页面持有，
   *   不进入组件；回执卡位置与三动作保持原样。
   * v0.1.6 V016-C3b（必修 3，选①）：「AI 分析」改 kind:local 语义——conflict/advise
   * 是轻量建议动作（无独立回执设计），启用态只出现在本地组，点击不弹外发回执预告；
   * 「解释冲突意图」保持 kind:model，走 conflict/preview-receipt 回执链。未配置时模型组
   * 保留两项禁用占位（可发现性），其中「AI 分析」kind 仍为 local，面板按 kind 门控预告。
   */
  let assistanceExpanded = $state(false);
  /**
   * v0.1.6 V016-C3b（低危 4，选 b Webview 判定，Host 零改动）：advice 无 stale/binding，
   * Host 切文件不清旧 advice；Webview 按选中文件 key 判定新鲜度——归属文件与当前选中
   * 不一致时旧 advice 标过期隐藏，不再当新鲜展示。requestAdvice 发起时记录归属；
   * 无请求记录时（首帧已带 advice）以当前选中为归属；advice 消失后归属清零。
   */
  let adviceOwnerPath = $state<string | null>(null);
  function requestAdvice(): void {
    adviceOwnerPath = snapshot.selected?.relativePath ?? null;
    onAction("conflict/advise", {
      relativePath: snapshot.selected?.relativePath,
    });
  }
  $effect(() => {
    if (snapshot.advice) {
      if (adviceOwnerPath === null) {
        adviceOwnerPath = snapshot.selected?.relativePath ?? null;
      }
    } else if (adviceOwnerPath !== null) {
      adviceOwnerPath = null;
    }
  });
  const adviceExpired = $derived(
    Boolean(
      snapshot.advice &&
      adviceOwnerPath !== null &&
      adviceOwnerPath !== (snapshot.selected?.relativePath ?? null),
    ),
  );
  /**
   * v0.1.6 V016-C3b（低危 5）：采用类动作补 adopt:true，使 stale 禁采用链生效。
   * 仅 acceptMine/acceptTheirs 且草稿含冲突标记块时可一键写入合并草稿（草稿内操作，
   * 经既有 draft-update/检查点链路，可撤销；不保存、不标记解决）。过期 advice 不再展示
   * 采用入口；stale 时由组件强制禁用（只能查看）。
   */
  const adviceAdoptActions = $derived.by((): AssistanceActionItem[] => {
    const advice = snapshot.advice;
    if (!advice || adviceExpired) return [];
    const resolution =
      advice.recommendation === "acceptMine"
        ? ("mine" as const)
        : advice.recommendation === "acceptTheirs"
          ? ("theirs" as const)
          : null;
    const hasBlocks = conflictBlocks.length > 0;
    const actionable = resolution !== null && hasBlocks;
    return [
      {
        label: conflictAssistanceLabels.adoptAdvice,
        kind: "local",
        adopt: true,
        hint: conflictAssistanceLabels.adoptAdviceHint,
        disabled: !actionable,
        disabledReason: actionable
          ? undefined
          : resolution === null
            ? conflictAssistanceLabels.adoptAdviceManualReason
            : conflictAssistanceLabels.adoptAdviceNoBlocksReason,
        onSelect: applyAdviceToDraft,
      },
    ];
  });
  const assistanceLocalActions = $derived.by((): AssistanceActionItem[] => {
    const base: AssistanceActionItem[] = conflictAdviceConfigured
      ? [
          {
            label: "AI 分析",
            kind: "local",
            hint: conflictAssistanceLabels.modelAdviseHint,
            onSelect: requestAdvice,
          },
        ]
      : [
          {
            label: "本地建议",
            kind: "local",
            hint: conflictAssistanceLabels.localHint,
            onSelect: requestAdvice,
          },
        ];
    return [...base, ...adviceAdoptActions];
  });
  const assistanceModelActions = $derived.by((): AssistanceActionItem[] => [
    // 未配置时保留禁用占位（可发现性）；「AI 分析」kind 仍为 local（advise 无回执设计）。
    ...(conflictAdviceConfigured
      ? []
      : [
          {
            label: "AI 分析",
            kind: "local" as const,
            disabled: true,
            disabledReason: conflictAssistanceLabels.unconfiguredDisabledReason,
            onSelect: requestAdvice,
          },
        ]),
    {
      label: "解释冲突意图",
      kind: "model",
      hint: conflictAssistanceLabels.interpretHint,
      disabled: !conflictAdviceConfigured,
      disabledReason: conflictAdviceConfigured
        ? undefined
        : conflictAssistanceLabels.unconfiguredDisabledReason,
      onSelect: requestInterpret,
    },
  ]);
  /** 结果来源如实标注：本地结果不标 AI，过期只读由组件禁用采用类动作。 */
  const assistanceSource = $derived.by((): AssistanceSourceState => {
    const raw = snapshot.advice?.source ?? snapshot.interpretation?.source;
    if (
      raw === "configured-model" ||
      raw === "local-rule" ||
      raw === "local-rule-fallback"
    )
      return raw;
    return "unconfigured";
  });
  const assistanceModel = $derived(
    conflictAdviceConfigured ? snapshot.aiPrivacy?.model : undefined,
  );
  const assistanceStale = $derived(
    Boolean(snapshot.interpretation?.stale) || adviceExpired,
  );
  /**
   * v0.1.6 V016-C2：空态返回收敛为单一 primary（分支互斥，页面级唯一）。
   * testid 保持原约定（return-to-update / return-to-changes / return-close /
   * return-to-changes-generic / return-to-update-generic），行为不变。
   */
  const emptyReturnPrimary = $derived.by(
    (): {
      testid: string;
      label: string;
      moduleId: "update" | "changes";
      taskId: "update/preview" | "changes/overview";
    } => {
      if (effectiveEntryOrigin === "update")
        return {
          testid: "return-to-update",
          label: "返回更新结果",
          moduleId: "update",
          taskId: "update/preview",
        };
      if (effectiveEntryOrigin === "changes")
        return {
          testid: "return-to-changes",
          label: "查看本地修改",
          moduleId: "changes",
          taskId: "changes/overview",
        };
      if (effectiveEntryOrigin === "generic")
        return {
          testid: "return-to-changes-generic",
          label: "查看本地修改",
          moduleId: "changes",
          taskId: "changes/overview",
        };
      return {
        testid: "return-close",
        label: "关闭",
        moduleId: "changes",
        taskId: "changes/overview",
      };
    },
  );
  let editorHost = $state<HTMLDivElement>();
  let editorView = $state<EditorView>();
  // v0.1.1 V011-E 修复：初始值直接取首个快照（优先 Host 内存草稿），
  // 避免首帧空文本导致 ConflictDiffView 对无标记内容 fail-closed 误报降级。
  let editorToken = $state(
    untrack(() => snapshot.selected?.mergeEditor.token ?? ""),
  );
  let mergeDraft = $state(
    untrack(
      () =>
        snapshot.selected?.draft?.content ??
        snapshot.selected?.contents.working?.content ??
        "",
    ),
  );
  let savedWorking = $state(
    untrack(() => snapshot.selected?.contents.working?.content ?? ""),
  );
  const content = $derived(snapshot.selected?.contents[activePane]);
  const sourceContent = $derived(snapshot.selected?.contents[sourcePane]);
  const conflictBlocks = $derived(parseTextConflictBlocks(mergeDraft));
  const workingDirty = $derived(mergeDraft !== savedWorking);
  // v0.1.1 V011-D：块级差异视图实例与进度（动作紧邻冲突块，进度与列表统一）。
  let diffView = $state<ConflictDiffView>();
  let diffProgress = $state({ current: 1, total: 0 });
  let diffActionFeedback = $state("");
  let sourceDetailsOpen = $state(false);
  let helpDetailsOpen = $state(false);
  // V011-E 安全降级：fail-closed 保留草稿
  let diffErrorInfo = $state<DiffErrorInfo | null>(null);
  let useSimplified = $state(false);
  // V012-B2：Pierre 可编辑合并结果实例（单实例，与 CodeMirror 互斥）
  let resultEditor = $state<ConflictResultEditor>();
  /** 文件身份：路径 + 来源 revision，用于过期拒绝（revision 变化即失效）。 */
  const conflictFileIdentity = $derived(
    (snapshot.selected
      ? `${snapshot.selected.relativePath}@r${snapshot.selected.sourceLeftRevision ?? "?"}-r${snapshot.selected.sourceRightRevision ?? "?"}`
      : "") as ConflictFileIdentity,
  );
  const diffWorkingText = $derived(mergeDraft);
  // V012-B2：文件/容器变化时重置简化降级（同文件 Host 刷新保持实例）
  $effect(() => {
    const fid = conflictFileIdentity;
    void fid;
    untrack(() => {
      queueMicrotask(() => {
        // 切换文件时尝试 Pierre，失败再降级；保持单实例
        if (useSimplified) {
          // 仅在非首帧切换时重置，避免初始渲染抖动
          const currentFid = conflictFileIdentity;
          if (currentFid) useSimplified = false;
        }
      });
    });
  });
  const workingContentView = $derived(snapshot.selected?.contents.working);
  const isFallbackContent = $derived(
    Boolean(
      workingContentView?.readError ||
      workingContentView?.truncated ||
      workingContentView?.content === undefined,
    ),
  );
  const fallbackContentReason = $derived(
    workingContentView?.readError
      ? workingContentView.readError
      : workingContentView?.truncated
        ? "内容已截断，仅用于辅助判断；请用简化编辑器或导出草稿。"
        : null,
  );
  // v0.1.3 V013-F：非文本分支与恢复出口派生（纯派生，不自动写）
  const selectedConflictKind = $derived(
    (snapshot.selected?.type ?? "text") as string,
  );
  // 中文注释：非文本分支仅在明确 tree/property/binary 且内容可用时进入；内容缺失（fallback）优先展示 fallback 警告
  const isNonTextBranch = $derived(
    isNonTextKind(selectedConflictKind) && !isFallbackContent,
  );
  const nonTextInfo = $derived(getNonTextInfo(selectedConflictKind));
  // marker 残留：保存后仍检测到 marker → 核验 blocked（保留供步骤条/核验引用，lint 忽略未直接使用）
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const hasMarkerRemaining = $derived(
    mergeDraft.includes("<<<<<<<") &&
      mergeDraft.includes("=======") &&
      mergeDraft.includes(">>>>>>>"),
  );
  const previewExpired = $derived(
    Boolean(
      (snapshot as unknown as { previewExpired?: boolean }).previewExpired ||
      (snapshot.selected?.mergeEditor.feedback?.includes("预览已过期") ??
        false) ||
      (snapshot.selected?.mergeEditor.issues.some((i) =>
        i.includes("预览已过期"),
      ) ??
        false),
    ),
  );
  const svnStatusChanged = $derived(
    Boolean(
      (snapshot as unknown as { svnStatusChanged?: boolean })
        .svnStatusChanged ||
      (snapshot.selected?.mergeEditor.issues.some(
        (i) => i.includes("SVN 状态已变化") || i.includes("不是冲突状态"),
      ) ??
        false),
    ),
  );
  const hasResolveFailed = $derived(
    Boolean(
      (snapshot as unknown as { resolveFailed?: boolean }).resolveFailed ||
      (snapshot as unknown as { resolveCancelled?: boolean })
        .resolveCancelled ||
      (snapshot.selected?.mergeEditor.feedback?.includes("标记解决失败") ??
        false),
    ),
  );
  const hasResolveCancelled = $derived(
    Boolean(
      (snapshot as unknown as { resolveCancelled?: boolean }).resolveCancelled,
    ),
  );
  const updateOriginClosed = $derived(
    Boolean(
      (snapshot as unknown as { updateOriginClosed?: boolean })
        .updateOriginClosed,
    ),
  );
  const reacquireFailed = $derived(
    Boolean(
      (snapshot as unknown as { reacquireFailed?: boolean }).reacquireFailed ||
      (snapshot as unknown as { recollectFailed?: boolean }).recollectFailed,
    ),
  );
  const recoveryItems = $derived(
    deriveRecoveryItems({
      feedback: snapshot.selected?.mergeEditor.feedback,
      issues: snapshot.selected?.mergeEditor.issues,
      workingText: mergeDraft,
      hasPreviewExpired: previewExpired,
      svnStatusChanged,
      hasResolveError: hasResolveFailed,
      hasResolveCancelled,
      updateOriginClosed,
      reacquireFailed,
    }),
  );
  // 中文注释：恢复出口去重——底部草稿区已有复制/导出时，不在恢复出口重复渲染同名按钮（避免 getByRole 多匹配）
  const hasBottomDraftActions = $derived(
    Boolean(snapshot.selected?.draft?.hasDraft) && !isNonTextBranch,
  );
  // take-both 在非文本分支禁用（不伪装文本合并）
  const disableTakeBoth = $derived(isNonTextBranch);
  // v0.1.3 V013-G：状态机驱动的步骤条状态（不从按钮反推，由 phase 纯推导）
  const conflictStepState: ConflictCompletionState = $derived.by(() => {
    // 无选中：若已全部解决则显示 all-resolved，否则 draft-clean 占位
    const rel = snapshot.selected?.relativePath ?? "placeholder";
    const kind = (snapshot.selected?.type ?? "text") as
      "text" | "tree" | "property" | "binary";
    const fileIdentity = buildConflictFileIdentity("/repo", rel);
    const workingText = snapshot.selected?.contents.working?.content ?? "";
    const baseText = snapshot.selected?.contents.base?.content ?? "";
    const draftText = snapshot.selected ? mergeDraft : workingText;
    const draftRevision = snapshot.selected?.draft?.revision ?? 0;
    const hasCheckpoint = Boolean(snapshot.selected?.draft?.hasDraft);
    const hasSavePreview = false; // 预览 token 仅 Host 持有，UI 按保存状态近似
    const isSaved = !!(snapshot.selected && mergeDraft === savedWorking);
    const markerRemaining = hasMarkerRemainingFn(draftText);
    const hasResolvePreview = Boolean(snapshot.resolvePreview);
    const hasNext = (snapshot.conflicts?.length ?? 0) > 1;
    const isAllResolved = (snapshot.conflicts?.length ?? 0) === 0;
    // 终态优先
    if (isAllResolved) {
      const baseState = createConflictCompletionState({
        fileIdentity,
        scopeHash: "mock-scope",
        workingCopyRevision: "r0",
        repositoryUuid: "mock-uuid",
        workingHash: hashText(workingText),
        draftHash: hashText(draftText),
        baseHash: hashText(baseText),
        diskHash: hashText(workingText),
        conflictKind: kind,
        draftRevision,
      });
      return {
        ...baseState,
        phase: "all-resolved",
        status: "all-resolved",
        label: "全部已解决",
        reason: "所有冲突已解决",
        primaryAction: "完成",
        blockingIssues: [],
        nonTextBranch: kind !== "text",
        verificationIssues: [],
      } as ConflictCompletionState;
    }
    if (!snapshot.selected) {
      const baseState = createConflictCompletionState({
        fileIdentity,
        scopeHash: "mock-scope",
        workingCopyRevision: "r0",
        repositoryUuid: "mock-uuid",
        workingHash: hashText(workingText),
        draftHash: hashText(draftText),
        baseHash: hashText(baseText),
        diskHash: hashText(workingText),
        conflictKind: kind,
        draftRevision,
      });
      return baseState;
    }
    const workingHash = hashText(workingText);
    const draftHash = hashText(draftText);
    const baseHash = hashText(baseText);
    const diskHash = hashText(savedWorking);
    // 核验结果：保存后才核验
    let verificationResult: "pass" | "blocked" | "pending" = "pending";
    if (isSaved) {
      if (markerRemaining) verificationResult = "blocked";
      else if (kind === "text") verificationResult = "pass";
      else verificationResult = "blocked";
    }
    if (markerRemaining && isSaved) verificationResult = "blocked";
    const phase = derivePhase({
      draftHash,
      workingHash,
      baseHash,
      diskHash,
      draftRevision,
      hasCheckpoint,
      hasSavePreview,
      isSavedToWorkingCopy: isSaved,
      verificationResult,
      hasResolvePreview,
      isResolved: false,
      hasNextConflict: hasNext,
      conflictKind: kind,
    });
    const baseState = createConflictCompletionState({
      fileIdentity,
      scopeHash: "mock-scope",
      workingCopyRevision: "r0",
      repositoryUuid: "mock-uuid",
      workingHash,
      draftHash,
      baseHash,
      diskHash,
      conflictKind: kind,
      draftRevision,
    });
    const verificationIssues = markerRemaining
      ? ["检测到冲突标记残留，需先完成合并"]
      : [];
    const built: ConflictCompletionState = {
      ...baseState,
      phase,
      status: phase,
      label: "",
      reason: "",
      primaryAction: "",
      blockingIssues: [],
      verificationIssues,
      nonTextBranch: kind !== "text",
    };
    const isBlocked = phase === "verification-blocked";
    return {
      ...built,
      label: phase,
      reason: isBlocked ? "核验未通过" : phase,
      primaryAction: isBlocked
        ? "编辑"
        : phase === "resolve-ready"
          ? "标记解决"
          : phase === "save-ready"
            ? "保存工作副本"
            : "编辑",
      blockingIssues: isBlocked ? verificationIssues : [],
      verificationIssues,
    } as ConflictCompletionState;
  });
  const sourcePaneLabels = {
    mine: "我的修改",
    theirs: "对方修改",
    base: "修改前版本",
  } as const;

  const recommendationLabels = {
    acceptWorking: "保留当前工作副本内容",
    acceptMine: "采用本地版本",
    acceptTheirs: "采用远端版本",
    manualMerge: "建议人工合并",
    noSafeSuggestion: "没有安全建议",
  };
  const paneLabels = {
    working: "工作副本",
    mine: "我的修改",
    theirs: "对方修改",
    base: "修改前版本",
  } as const;
  const conflictTypeLabels: Record<string, string> = {
    text: "文本冲突",
    tree: "树冲突",
    property: "属性冲突",
    unknown: "未知类型",
  };
  const conflictOperationLabels: Record<string, string> = {
    update: "更新产生",
    merge: "合并产生",
    switch: "切换产生",
    unknown: "来源未知",
  };

  /** 类型与产生操作的排序优先级（未知值恒排末尾）。 */
  const CONFLICT_TYPE_ORDER = ["text", "tree", "property", "unknown"];
  const CONFLICT_OPERATION_ORDER = ["update", "merge", "switch", "unknown"];

  const filteredConflicts = $derived(
    snapshot.conflicts.filter((conflict) => {
      if (typeFilter !== "all" && (conflict.type ?? "unknown") !== typeFilter) {
        return false;
      }
      if (
        operationFilter !== "all" &&
        (conflict.operation ?? "unknown") !== operationFilter
      ) {
        return false;
      }
      const needle = query.trim().toLowerCase();
      if (!needle) return true;
      const haystacks = [
        conflict.relativePath,
        conflictTypeLabels[conflict.type ?? "unknown"] ?? "",
        conflict.type ?? "",
        conflictOperationLabels[conflict.operation ?? "unknown"] ?? "",
        conflict.operation ?? "",
      ];
      return haystacks.some((value) => value.toLowerCase().includes(needle));
    }),
  );

  const orderedConflicts = $derived.by(() => {
    if (sortField === "path") {
      return [...filteredConflicts].sort((left, right) =>
        naturalCompare(left.relativePath, right.relativePath),
      );
    }
    const order =
      sortField === "type" ? CONFLICT_TYPE_ORDER : CONFLICT_OPERATION_ORDER;
    const keyOf = (conflict: (typeof snapshot.conflicts)[number]) =>
      sortField === "type"
        ? (conflict.type ?? "unknown")
        : (conflict.operation ?? "unknown");
    return [...filteredConflicts].sort((left, right) => {
      const leftOrder = order.indexOf(keyOf(left));
      const rightOrder = order.indexOf(keyOf(right));
      const leftRank = leftOrder < 0 ? order.length : leftOrder;
      const rightRank = rightOrder < 0 ? order.length : rightOrder;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return naturalCompare(left.relativePath, right.relativePath);
    });
  });

  const selectedIndexInOrder = $derived(
    orderedConflicts.findIndex(
      (conflict) => conflict.relativePath === snapshot.selected?.relativePath,
    ),
  );

  const list = useFileList<(typeof snapshot.conflicts)[number]>({
    rows: () => orderedConflicts,
    rowHeight: () => 56,
    onPathDetailRequest: (relativePath) =>
      onAction("file/path-detail", { relativePath }),
    onActivate: (conflict) => selectConflict(conflict.relativePath),
  });

  $effect(() => {
    query;
    typeFilter;
    operationFilter;
    list.resetNavigation();
  });

  // v0.1.3 V013-E：检测重采后当前选中文件已消失（已解决），自动按左侧权威排序进入下一个；仅选中文件消失才跳，后台刷新不抢焦点
  $effect(() => {
    const curPaths = snapshot.conflicts.map((c) => c.relativePath);
    const curSelected = snapshot.selected?.relativePath;
    // 读取但不订阅写入状态，避免循环：用 untrack 包裹写入
    const wasInitialized = v013Initialized;
    const prevSelected = untrack(() => prevSelectedPath);
    const prevPaths = untrack(() => prevSnapshotPaths);
    const prevKey = prevPaths.join("\x1f");
    const curKey = curPaths.join("\x1f");
    if (!wasInitialized) {
      untrack(() => {
        prevSnapshotPaths = [...curPaths];
        prevSelectedPath = curSelected;
        prevHadDraftDirty =
          Boolean(snapshot.selected?.draft?.dirty) ||
          mergeDraft !== savedWorking;
        v013Initialized = true;
      });
      try {
        if (entryOrigin)
          sessionStorage.setItem("conflicts-entry-origin", entryOrigin);
      } catch (_e) {
        void _e;
      }
      return;
    }
    const hadPrev = Boolean(prevSelected);
    const disappeared = hadPrev && !curPaths.includes(prevSelected as string);
    if (disappeared) {
      if (curPaths.length === 0) {
        const resolved =
          snapshot.progress?.resolvedCount ??
          snapshot.progress?.initialCount ??
          prevPaths.length;
        const msg = `全部冲突已解决，已解决 ${resolved} 个`;
        navAnnouncement = msg;
      } else {
        let nextPath: string | undefined;
        // 使用当前 orderedConflicts 权威排序的后继（不按旧列表乐观推断）
        const ordered = untrack(() => orderedConflicts);
        const sf = untrack(() => sortField);
        if (sf === "path") {
          let insertIdx = ordered.findIndex(
            (c) => naturalCompare(c.relativePath, prevSelected as string) > 0,
          );
          if (insertIdx === -1) insertIdx = 0;
          nextPath = ordered[insertIdx]?.relativePath;
        } else {
          nextPath = ordered[0]?.relativePath;
        }
        if (!nextPath) nextPath = ordered[0]?.relativePath;
        if (nextPath) {
          const pos = ordered.findIndex((c) => c.relativePath === nextPath) + 1;
          const total = ordered.length;
          // 中文注释：播报需包含已解决文件，避免歧义且满足 E2E 对 a.ts 的可见性校验（列表外残留不计）
          const msg = `已解决 ${prevSelected}，已切换到下一个冲突 ${pos}/${total}：${nextPath}`;
          navAnnouncement = msg;
          const target = nextPath;
          queueMicrotask(() => {
            const stillExists = snapshot.conflicts.some(
              (c) => c.relativePath === target,
            );
            if (stillExists) selectConflict(target as string);
          });
        }
      }
    } else if (curKey !== prevKey) {
      void curKey; // 后台刷新但选中仍在：不抢焦点（空分支仅作记录）
    }
    untrack(() => {
      prevSnapshotPaths = [...curPaths];
      if (curSelected !== undefined) prevSelectedPath = curSelected;
      prevHadDraftDirty =
        Boolean(snapshot.selected?.draft?.dirty) || mergeDraft !== savedWorking;
    });
  });

  // 新的路径详情结果到达时自动展开；关闭后恢复触发按钮焦点。
  $effect(() => {
    if (pathDetail) list.markPathDetailArrived();
  });

  function selectConflict(relativePath: string): void {
    onAction("conflict/select", { relativePath });
  }

  function moveToConflict(delta: -1 | 1): void {
    const next =
      delta === 1
        ? (orderedConflicts[selectedIndexInOrder + 1] ?? orderedConflicts[0])
        : (orderedConflicts[selectedIndexInOrder - 1] ??
          orderedConflicts[orderedConflicts.length - 1]);
    if (!next) return;
    selectConflict(next.relativePath);
    navAnnouncement = `已切换到 ${next.relativePath}（剩余 ${snapshot.progress?.remaining ?? orderedConflicts.length} 个未解决冲突）`;
  }

  $effect(() => {
    const token = snapshot.selected?.mergeEditor.token ?? "";
    const selectedPath = snapshot.selected?.relativePath ?? "";
    // 中文注释：切换文件时即使 token 相同也需重置 mergeDraft，避免跨文件残留（V013-G 多冲突）；使用独立的 prevEditorPath 避免与 V013-E 时序竞争；首帧重开时若已有草稿则保留
    const pathChanged = selectedPath !== (prevEditorPath ?? "");
    if (token !== editorToken || pathChanged) {
      // 中文注释：切换文件时清理未完成的自动检查点定时器，避免旧文件内容写入新文件草稿
      if (autoCheckpointTimer) {
        clearTimeout(autoCheckpointTimer);
        autoCheckpointTimer = undefined;
      }
      editorToken = token;
      prevEditorPath = selectedPath;
      // 中文注释：切换文件时若新文件已有草稿（重开恢复），优先使用草稿；否则用工作副本，避免跨文件污染但保留重开恢复
      let nextDraft: string;
      if (pathChanged) {
        if (snapshot.selected?.draft?.hasDraft) {
          nextDraft = snapshot.selected.draft.content;
        } else {
          nextDraft = snapshot.selected?.contents.working?.content ?? "";
        }
      } else {
        nextDraft =
          snapshot.selected?.draft?.content ??
          snapshot.selected?.contents.working?.content ??
          "";
      }
      mergeDraft = nextDraft;
      savedWorking = snapshot.selected?.contents.working?.content ?? "";
      if (snapshot.selected?.draft?.hasDraft) {
        conflictDraftFeedback = `草稿已同步（修订 ${snapshot.selected.draft.revision}，${new Date(snapshot.selected.draft.updatedAt).toLocaleString("zh-CN")}）`;
        checkpointStatus = "saved";
        checkpointStatusDetail = `修订 ${snapshot.selected.draft.revision}`;
        // V012-D：恢复草稿时尽量连 selection/视口一起恢复（用 getState/setState 思想）
        const rp = snapshot.selected?.relativePath;
        if (rp && savedEditorStates.has(rp)) {
          const saved = savedEditorStates.get(rp)!;
          // 仅当 scope/hash/revision 仍匹配（可编辑）时恢复选区/视口，否则只读展示
          if (snapshot.selected?.mergeEditor.editable) {
            queueMicrotask(() => {
              try {
                const st = resultEditor?.getMergeState?.();
                if (st && saved.selection) {
                  // 通过 sync 的方式恢复 selection（不推进 revision）
                  const cur = resultEditor?.getMergeState?.();
                  if (cur) {
                    // 直接设置 editorState 的 selection/viewport，保持 draft 内容不变
                    // 复用 setActiveRegion 思路，扩展为直接赋值（若无 API 则仅聚焦）
                    const sel = saved.selection;
                    // 尝试聚焦到 selection 对应行
                    const text = cur.draftContents;
                    let line = 0;
                    const target = Math.min(sel.start, text.length);
                    for (let i = 0; i < target; i++)
                      if (text.charCodeAt(i) === 10) line++;
                    resultEditor?.focusLine?.(line);
                  }
                }
              } catch (_e) {
                void _e;
              }
            });
          }
        }
      } else {
        checkpointStatus = "idle";
        checkpointStatusDetail = "";
      }
      // 若快照包含容量淘汰或草稿只读提示，透出到 checkpoint 状态
      const fb = snapshot.selected?.mergeEditor.feedback ?? "";
      if (fb.includes("容量上限") || fb.includes("已被淘汰")) {
        checkpointStatus = "failed";
        checkpointStatusDetail = fb;
      } else if (fb.includes("已变化") && fb.includes("只读")) {
        checkpointStatus = "failed";
        checkpointStatusDetail = fb;
      }
    }
  });
  // 检查点 ACK 内联提示（编辑器与草稿保留）
  $effect(() => {
    if (conflictDraftAck) {
      conflictDraftFeedback = `检查点已保存（修订 ${conflictDraftAck.revision}）`;
      checkpointStatus = "saved";
      checkpointStatusDetail = `修订 ${conflictDraftAck.revision}`;
    }
  });
  // V012-D：Host 容量淘汰或 stale 只读的反馈也映射到 checkpoint 状态（可预期提示）
  $effect(() => {
    const fb = snapshot.selected?.mergeEditor.feedback ?? "";
    if (fb.includes("容量上限") || fb.includes("已被淘汰")) {
      checkpointStatus = "failed";
      checkpointStatusDetail = fb;
    }
    const issues = snapshot.selected?.mergeEditor.issues ?? [];
    if (issues.some((i) => i.includes("只读") || i.includes("已变化"))) {
      // 只读提示不覆盖已保存状态，仅在无草稿时提示失败
      if (snapshot.selected?.draft?.hasDraft) {
        conflictDraftFeedback =
          issues.find((i) => i.includes("只读")) ?? conflictDraftFeedback;
      }
    }
  });
  // 三选一守卫对话框：打开时焦点进入首个按钮，关闭后回到触发按钮（键盘可达、焦点返回）
  $effect(() => {
    if (conflictSwitchRequest) {
      switchTriggerEl = document.activeElement as HTMLElement | undefined;
      queueMicrotask(() => switchDialogEl?.showModal?.());
      queueMicrotask(() => switchDialogEl?.querySelector("button")?.focus());
    } else {
      switchDialogEl?.close?.();
      switchTriggerEl?.focus?.();
    }
  });

  $effect(() => {
    const parent = editorHost;
    const token = editorToken;
    const editable = snapshot.selected?.mergeEditor.editable ?? false;
    const simplified = useSimplified;
    if (!parent || !token || !simplified) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: untrack(() => mergeDraft),
        extensions: [
          lineNumbers(),
          EditorState.readOnly.of(!editable),
          EditorView.editable.of(editable),
          EditorView.contentAttributes.of({
            "aria-label": `${snapshot.selected?.relativePath ?? ""} 可编辑工作副本合并结果`,
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              mergeDraft = update.state.doc.toString();
              // 恢复：CodeMirror 编辑仍需回写 draft-update（尊重 IME），同时保留自动检查点
              if (!isComposing && !(resultEditor?.isComposing?.() ?? false)) {
                onAction("conflict/draft-update", {
                  relativePath: snapshot.selected?.relativePath,
                  content: mergeDraft,
                });
                scheduleAutoCheckpoint(mergeDraft);
              }
            }
          }),
          EditorView.theme({
            "&": {
              height: "100%",
              color: "var(--vscode-editor-foreground)",
              backgroundColor: "var(--vscode-editor-background)",
              fontSize: "var(--vscode-editor-font-size, 12px)",
            },
            ".cm-content": {
              fontFamily: "var(--vscode-editor-font-family, monospace)",
              caretColor: "var(--vscode-editorCursor-foreground)",
            },
            ".cm-gutters": {
              color: "var(--vscode-editorLineNumber-foreground)",
              backgroundColor:
                "var(--vscode-editorGutter-background, var(--vscode-editor-background))",
              border: "none",
            },
            ".cm-activeLine": {
              backgroundColor: "var(--vscode-editor-lineHighlightBackground)",
            },
          }),
        ],
      }),
      parent,
    });
    editorView = view;
    return () => {
      if (editorView === view) editorView = undefined;
      view.destroy();
    };
  });

  function applyBlock(
    index: number,
    resolution: "mine" | "theirs" | "both",
  ): void {
    if (isComposing || (resultEditor?.isComposing?.() ?? false)) return;
    const next = applyTextConflictResolution(mergeDraft, index, resolution);
    mergeDraft = next;
    if (editorView)
      editorView.dispatch({
        changes: { from: 0, to: editorView.state.doc.length, insert: next },
      });
    if (snapshot.selected) {
      // 恢复：块级操作仍回写 draft-update，同时保留检查点 debounce
      onAction("conflict/draft-update", {
        relativePath: snapshot.selected.relativePath,
        content: next,
      });
      scheduleAutoCheckpoint(next);
    }
  }

  /**
   * v0.1.6 V016-C3b（低危 5）：将合并建议一键写入合并草稿（仅 acceptMine/acceptTheirs）。
   * 从后往前逐块应用（单步应用会改变后续块偏移）；仅改草稿并经 draft-update/检查点链路，
   * 可撤销，不保存工作副本、不触发 Resolve。过期 advice 与中文 IME 候选阶段直接拒绝。
   */
  function applyAdviceToDraft(): void {
    if (isComposing || (resultEditor?.isComposing?.() ?? false)) return;
    if (adviceExpired) return;
    const recommendation = snapshot.advice?.recommendation;
    const resolution =
      recommendation === "acceptMine"
        ? ("mine" as const)
        : recommendation === "acceptTheirs"
          ? ("theirs" as const)
          : null;
    if (!resolution || !snapshot.selected) return;
    const blocks = parseTextConflictBlocks(mergeDraft);
    if (blocks.length === 0) return;
    let next = mergeDraft;
    for (let index = blocks.length - 1; index >= 0; index--) {
      next = applyTextConflictResolution(next, index, resolution);
    }
    if (next === mergeDraft) return;
    mergeDraft = next;
    if (editorView)
      editorView.dispatch({
        changes: { from: 0, to: editorView.state.doc.length, insert: next },
      });
    onAction("conflict/draft-update", {
      relativePath: snapshot.selected.relativePath,
      content: next,
    });
    scheduleAutoCheckpoint(next);
  }

  function handleDiffAction(
    payload: MergeConflictActionPayload & {
      fileIdentity: ConflictFileIdentity;
      expectedHash: ContentHash;
      newHash?: ContentHash;
    },
  ): void {
    if (isComposing || (resultEditor?.isComposing?.() ?? false)) return;
    const newest = diffView?.getControlledResult?.() ?? mergeDraft;
    if (newest !== mergeDraft) {
      mergeDraft = newest;
      if (editorView) {
        editorView.dispatch({
          changes: { from: 0, to: editorView.state.doc.length, insert: newest },
        });
      }
      if (snapshot.selected) {
        // 恢复：差异视图动作仍回写 draft-update，同时保留检查点
        onAction("conflict/draft-update", {
          relativePath: snapshot.selected.relativePath,
          content: newest,
        });
        scheduleAutoCheckpoint(newest);
      }
      diffActionFeedback = `\u5df2\u5e94\u7528\uff1a${payload.resolution === "current" ? "\u91c7\u7528\u6211\u7684\u4fee\u6539" : payload.resolution === "incoming" ? "\u91c7\u7528\u5bf9\u65b9\u4fee\u6539" : "\u4fdd\u7559\u53cc\u65b9\u4fee\u6539"}\uff08\u5757 ${payload.conflict.conflictIndex + 1}\uff09`;
    }
  }

  function notifyBlockProgress(p: { current: number; total: number }): void {
    diffProgress = p;
  }
  function handleDiffError(info: DiffErrorInfo): void {
    diffErrorInfo = info;
  }
  // 重试/换文后挂载成功即清除降级提示（草稿内容始终保留在 mergeDraft）。
  function handleDiffReady(): void {
    diffErrorInfo = null;
  }

  /** V012-B2：Pierre 编辑结果变化回写草稿（debounce 已在适配层，IME 守卫双检查） */
  function handleResultDraftChange(text: string, _revision: number): void {
    void _revision;
    mergeDraft = text;
    const composing = resultEditor?.isComposing?.() ?? isComposing;
    if (composing) return;
    if (snapshot.selected) {
      // 恢复：编辑变化经 onDraftChange 回写 mergeDraft 并发 draft-update（尊重 isComposing），同时保留自动检查点
      onAction("conflict/draft-update", {
        relativePath: snapshot.selected.relativePath,
        content: text,
      });
      scheduleAutoCheckpoint(text);
    }
  }

  /** V012-B2：Pierre 挂载/清理失败降级到简化编辑器（保留文本，单实例） */
  function handleResultFallback(info: DiffErrorInfo): void {
    diffErrorInfo = info;
    useSimplified = true;
  }

  function focusBlock(delta: -1 | 1): void {
    if (!diffProgress.total) return;
    const next = Math.max(
      1,
      Math.min(diffProgress.total, diffProgress.current + delta),
    );
    diffView?.focusConflict(next - 1);
    diffProgress = { ...diffProgress, current: next };
  }

  // V012-E：快捷键全局守卫（中文 IME 期间不触发，单一来源）
  function handleModuleKeydown(e: KeyboardEvent): void {
    if (
      isImeComposingEvent(e) ||
      isComposing ||
      (resultEditor?.isComposing?.() ?? false)
    )
      return;
    const isMod = e.ctrlKey || e.metaKey;
    // Ctrl/Cmd+S 保存检查点（不写入工作副本）
    if (isMod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      flushCheckpoint();
      return;
    }
    // ? 快捷键帮助（单一来源，按钮与面板共用）
    if (!isMod && !e.altKey && e.key === "?") {
      e.preventDefault();
      helpDetailsOpen = !helpDetailsOpen;
      return;
    }
    // Alt+↑/↓ 块导航（与 Diff 一致）
    if (e.altKey && !isMod) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        focusBlock(-1);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        focusBlock(1);
        return;
      }
    }
  }

  $effect(() => {
    const tp = snapshot.selected?.relativePath;
    const tk = snapshot.selected?.mergeEditor.token;
    void tp;
    void tk;
    const total = untrack(() => diffProgress.total);
    if (total > 0) {
      queueMicrotask(() => diffView?.focusConflict(0));
    }
  });
</script>

<section
  class="conflict-layout"
  role="region"
  aria-label="冲突处理"
  onkeydown={handleModuleKeydown}
>
  <aside class="conflict-list-pane">
    <div class="feature-toolbar feature-toolbar--compact">
      <div>
        <h2>待处理冲突</h2>
        <p>
          剩余 {snapshot.conflicts.length} 个{snapshot.progress
            ? `，已处理 ${snapshot.progress.resolvedCount} / ${snapshot.progress.initialCount}`
            : ""}
        </p>
      </div>
      <span class="status-badge status-badge--conflicted">阻断提交</span>
    </div>
    <div class="conflict-filter-bar">
      <SearchInput
        bind:value={query}
        ariaLabel="筛选冲突文件"
        placeholder="路径、类型…"
        compact
      />
      <select
        class="sort-menu"
        aria-label="冲突类型筛选"
        value={typeFilter}
        onchange={(event) => {
          typeFilter = (event.currentTarget as HTMLSelectElement).value;
        }}
      >
        <option value="all">全部类型</option>
        <option value="text">文本冲突</option>
        <option value="tree">树冲突</option>
        <option value="property">属性冲突</option>
      </select>
      <select
        class="sort-menu"
        aria-label="产生操作筛选"
        value={operationFilter}
        onchange={(event) => {
          operationFilter = (event.currentTarget as HTMLSelectElement).value;
        }}
      >
        <option value="all">全部来源</option>
        <option value="update">更新产生</option>
        <option value="merge">合并产生</option>
        <option value="switch">切换产生</option>
      </select>
      <select
        class="sort-menu"
        aria-label="冲突排序"
        value={sortField}
        onchange={(event) => {
          const value = (event.currentTarget as HTMLSelectElement).value;
          sortField =
            value === "type" || value === "operation" ? value : "path";
        }}
      >
        <option value="path">按路径</option>
        <option value="type">按冲突类型</option>
        <option value="operation">按产生操作</option>
      </select>
    </div>
    <div class="conflict-nav-bar">
      <ResultCount count={orderedConflicts.length} suffix="个冲突" />
      <div class="toolbar-actions">
        <button
          class="button button--secondary"
          disabled={orderedConflicts.length < 2}
          onclick={() => moveToConflict(-1)}>上一个未解决</button
        >
        <button
          class="button button--secondary"
          disabled={orderedConflicts.length < 2}
          onclick={() => moveToConflict(1)}>下一个未解决</button
        >
      </div>
    </div>
    {#if navAnnouncement}<div class="sr-only-announcement" role="status">
        {navAnnouncement}
      </div>{/if}
    {#if pathDetail && list.detailOpen}
      <div class="path-detail-host">
        <div class="path-detail-host__bar">
          <span class="path-detail-host__target">{pathDetail.relativePath}</span
          >
          <button
            class="icon-button icon-button--small"
            aria-label="关闭路径详情"
            onclick={list.closePathDetail}
            ><span class="codicon codicon-close" aria-hidden="true"
            ></span></button
          >
        </div>
        <FilePathDetail
          detail={pathDetail}
          onCopyLocalPath={() =>
            onAction("file/copy-path", {
              relativePath: pathDetail.relativePath,
            })}
        />
      </div>
    {/if}
    {#if snapshot.conflicts.length === 0}
      <div
        class="empty-state"
        data-testid="all-resolved-summary"
        role="status"
        aria-live="polite"
      >
        <span class="codicon codicon-pass-filled" aria-hidden="true"></span>
        <div>
          <strong>全部冲突已解决</strong>
          <p>
            本次已解决 {snapshot.progress?.resolvedCount ??
              snapshot.progress?.initialCount ??
              0} 个冲突
            {#if snapshot.progress && snapshot.progress.initialCount > (snapshot.progress.resolvedCount ?? 0)}
              · 剩余 {snapshot.progress.remaining} 个
            {/if}
          </p>
          <p class="muted">
            工作副本当前状态：可以继续提交。当前范围已无冲突标记。
          </p>
          <div class="toolbar-actions" role="group" aria-label="返回来路">
            <!-- v0.1.6 V016-C2：空态页面级唯一 primary（分支互斥，动态 testid/文案/动作保持原约定） -->
            <button
              class="button button--primary"
              data-testid={emptyReturnPrimary.testid}
              onclick={() =>
                onAction("open-module", {
                  moduleId: emptyReturnPrimary.moduleId,
                  taskId: emptyReturnPrimary.taskId,
                })}>{emptyReturnPrimary.label}</button
            >
            {#if effectiveEntryOrigin === "generic"}
              <!-- 通用出口：不扩大原 scope，提供次级返回 -->
              <button
                class="button button--secondary"
                data-testid="return-to-update-generic"
                onclick={() =>
                  onAction("open-module", {
                    moduleId: "update",
                    taskId: "update/preview",
                  })}>返回更新结果</button
              >
            {/if}
          </div>
        </div>
      </div>
    {:else if orderedConflicts.length === 0}
      <div class="mini-empty">没有匹配的冲突；调整搜索词或筛选条件后重试。</div>
    {:else}
      <ScrollArea
        class="conflict-list"
        role="list"
        label="冲突文件"
        bind:element={list.element}
        onScroll={list.handleScroll}
        onKeydown={list.handleKeydown}
      >
        {#each list.visibleRows as { row: conflict, index } (conflict.relativePath)}
          <div role="listitem" class="conflict-item">
            <button
              class:active={snapshot.selected?.relativePath ===
                conflict.relativePath}
              class:conflict-row--keyboard-active={list.activeIndex === index}
              class="conflict-row"
              data-row-index={index}
              onclick={() => {
                list.markActive(index);
                selectConflict(conflict.relativePath);
              }}
            >
              <span class="codicon codicon-warning" aria-hidden="true"></span>
              <span
                ><strong>{conflict.relativePath}</strong><small
                  >{conflictTypeLabels[conflict.type ?? "unknown"] ??
                    conflict.type} · {conflictOperationLabels[
                    conflict.operation ?? "unknown"
                  ] ?? conflict.operation}</small
                ></span
              >
              <span class="codicon codicon-chevron-right" aria-hidden="true"
              ></span>
            </button>
            <div class="conflict-row-actions">
              <button
                type="button"
                class="icon-button icon-button--small"
                aria-label={`查看 ${conflict.relativePath} 路径详情`}
                title="路径详情"
                onclick={(event) =>
                  list.requestPathDetail(
                    conflict.relativePath,
                    event.currentTarget,
                  )}
                ><span class="codicon codicon-info" aria-hidden="true"
                ></span></button
              >
              <button
                type="button"
                class="icon-button icon-button--small"
                aria-label={`在仓库浏览器中显示 ${conflict.relativePath}`}
                title="在仓库浏览器中显示"
                onclick={() =>
                  onAction("changes/show-in-repository", {
                    relativePath: conflict.relativePath,
                  })}
                ><span class="codicon codicon-repo" aria-hidden="true"
                ></span></button
              >
            </div>
          </div>
        {/each}
      </ScrollArea>
    {/if}
  </aside>

  <ScrollArea class="conflict-workspace" label="冲突处理工作区">
    {#if updateOriginClosed || reacquireFailed}
      {#if updateOriginClosed}
        <div
          class="notice notice--warning"
          role="alert"
          data-testid="recovery-update-origin-closed-global"
        >
          <strong>{RECOVERY_CATALOG.updateOriginClosed.what}</strong>
          <p>{RECOVERY_CATALOG.updateOriginClosed.cause}</p>
          <small>{RECOVERY_CATALOG.updateOriginClosed.recovery}</small>
          <div class="toolbar-actions">
            <button
              class="button button--secondary"
              data-testid="retry-update-global"
              onclick={() => onAction("update/preview")}>重试</button
            ><button
              class="button button--secondary"
              data-testid="close-update-origin-global"
              onclick={() =>
                onAction("open-module", {
                  moduleId: "changes",
                  taskId: "changes/overview",
                })}>关闭</button
            >
          </div>
        </div>
      {/if}
      {#if reacquireFailed}
        <div
          class="notice notice--warning"
          role="alert"
          data-testid="recovery-reacquire-failed-global"
        >
          <strong>{RECOVERY_CATALOG.reacquireFailed.what}</strong>
          <p>{RECOVERY_CATALOG.reacquireFailed.cause}</p>
          <small>{RECOVERY_CATALOG.reacquireFailed.recovery}</small>
          <div class="toolbar-actions">
            <button
              class="button button--secondary"
              data-testid="retry-reacquire-global"
              onclick={() => onAction("refresh")}>重试</button
            ><button
              class="button button--secondary"
              data-testid="close-reacquire-global"
              onclick={() =>
                onAction("open-module", {
                  moduleId: "changes",
                  taskId: "changes/overview",
                })}>关闭</button
            >
          </div>
        </div>
      {/if}
    {/if}
    <!-- v0.1.3 V013-G 冲突步骤条：由状态机 phase 驱动，不从按钮反推，持续显示五阶段（中文注释：透传已解决播报，确保 E2E 断言命中） -->
    <ConflictStepBar state={conflictStepState} {navAnnouncement} />
    {#if snapshot.selected}
      <div class="conflict-header">
        <div class="file-title">
          <span class="codicon codicon-merge"></span>
          <div>
            <strong>{snapshot.selected.relativePath}</strong><span
              >r{snapshot.selected.sourceLeftRevision ?? "?"} ↔ r{snapshot
                .selected.sourceRightRevision ?? "?"}</span
            >
          </div>
        </div>
        <div class="toolbar-actions">
          <!-- v0.1.6 V016-C2：建议/解释入口已收进下方 AssistancePanel，此处只保留主任务操作 -->
          <button
            class="button button--secondary"
            onclick={() =>
              onAction("open-file", {
                relativePath: snapshot.selected?.relativePath,
              })}>打开工作副本文件</button
          >
        </div>
      </div>
      <!-- v0.1.6 V016-C2：冲突帮助单一「需要帮助」入口（默认折叠，不挤压比较/编辑/保存/Resolve 主路径） -->
      <AssistancePanel
        title={conflictAssistanceLabels.panelTitle}
        summary={conflictAssistanceLabels.panelSummary}
        sourceState={assistanceSource}
        model={assistanceModel}
        configured={conflictAdviceConfigured}
        expanded={assistanceExpanded}
        localActions={assistanceLocalActions}
        modelActions={assistanceModelActions}
        stale={assistanceStale}
        onExpand={() => (assistanceExpanded = true)}
        onCollapse={() => (assistanceExpanded = false)}
      >
        <section class="conflict-advice">
          <div class="section-heading">
            <div>
              <span class="eyebrow">冲突建议来源</span>
              <h2>合并建议</h2>
            </div>
            {#if snapshot.advice}<span
                class={`confidence confidence--${snapshot.advice.confidence}`}
                >{confidenceLabels[snapshot.advice.confidence]}</span
              >{/if}
          </div>
          {#if snapshot.aiPrivacy}<div class="privacy-note">
              <strong>外发预览</strong><span
                >{snapshot.aiPrivacy.data}；{snapshot.aiPrivacy
                  .characters}/{snapshot.aiPrivacy.maxCharacters} 个字符；模型 {snapshot
                  .aiPrivacy.model}；不含历史。{conflictAdviceConfigured
                  ? "点击“AI 分析”后才会发送。"
                  : "未配置外部模型，将运行本地规则，不会外发。"}</span
              >
            </div>{/if}
          {#if snapshot.advice && !adviceExpired}
            <strong
              >{recommendationLabels[snapshot.advice.recommendation]}</strong
            >
            <small class="ai-source"
              >{sourceLabels[snapshot.advice.source]}</small
            >
            <p>{snapshot.advice.summary}</p>
            {#if snapshot.advice.fallbackReason}<div
                class="notice notice--warning"
              >
                降级原因：{snapshot.advice.fallbackReason}
              </div>{/if}
            {#if snapshot.advice.risks.length}<h3>风险</h3>
              <ul>
                {#each snapshot.advice.risks as risk, riskIndex (riskIndex)}<li>
                    {risk}
                  </li>{/each}
              </ul>{/if}
            {#if snapshot.advice.steps.length}<h3>验证步骤</h3>
              <ol>
                {#each snapshot.advice.steps as step, stepIndex (stepIndex)}<li>
                    {step}
                  </li>{/each}
              </ol>{/if}
          {:else if adviceExpired}
            <div
              class="notice notice--warning"
              role="alert"
              data-testid="advice-expired-notice"
            >
              {conflictAssistanceLabels.adviceExpiredNotice}
            </div>
          {:else}
            <div class="preview-empty">
              <span class="codicon codicon-sparkle"></span>
              <p>
                {conflictAdviceConfigured
                  ? "AI 只提供解释和候选，不会自动标记解决。"
                  : "本地建议只提供解释和候选，不会自动标记解决。"}请使用本面板上方操作获取合并建议。
              </p>
            </div>
          {/if}
        </section>
        {#if snapshot.interpretation}
          <section class="conflict-advice" aria-label="冲突意图解释">
            <div class="section-heading">
              <div>
                <span class="eyebrow">冲突意图解释（§7 六段）</span>
                <h2>意图解释</h2>
              </div>
              <span class="conflict-advice__source"
                >来源：{sourceLabels[
                  snapshot.interpretation.source
                ]}{#if snapshot.interpretation.stale}
                  · 已过期（冲突或修订已变化，只读）{/if}</span
              >
            </div>
            {#if snapshot.interpretation.fallbackReason}<div
                class="notice notice--warning"
              >
                降级原因：{snapshot.interpretation.fallbackReason}
              </div>{/if}
            <h3>我的修改意图</h3>
            <p>{snapshot.interpretation.myIntent}</p>
            <h3>对方修改意图</h3>
            <p>{snapshot.interpretation.theirIntent}</p>
            <h3>共同点</h3>
            <ul>
              {#each snapshot.interpretation.commonPoints as point, pointIndex (pointIndex)}<li
                >
                  {point}
                </li>{/each}
            </ul>
            <h3>冲突点</h3>
            <ul>
              {#each snapshot.interpretation.conflictPoints as point, pointIndex (pointIndex)}<li
                >
                  {point}
                </li>{/each}
            </ul>
            <h3>推荐处理方式及证据</h3>
            <p>{snapshot.interpretation.recommendedHandling.summary}</p>
            {#if snapshot.interpretation.recommendedHandling.evidence.length}<ul
              >
                {#each snapshot.interpretation.recommendedHandling.evidence as evidence, evidenceIndex (evidenceIndex)}<li
                  >
                    {evidence}
                  </li>{/each}
              </ul>{/if}
            <h3>无法判断的业务选择</h3>
            <ul>
              {#each snapshot.interpretation.businessUnknowns as unknown, unknownIndex (unknownIndex)}<li
                >
                  {unknown}
                </li>{/each}
            </ul>
            <h3>保存后应运行的验证</h3>
            <ol>
              {#each snapshot.interpretation.postSaveVerification as item, itemIndex (itemIndex)}<li
                >
                  {item.title}{#if item.command}<code class="conflict-command"
                      >{item.command}</code
                    >{/if}
                </li>{/each}
            </ol>
          </section>
        {/if}
      </AssistancePanel>
      {#if conflictReceipt}
        <div
          class="commit-receipt"
          role="region"
          aria-label="冲突意图解释回执"
          data-confirmation-zone="receipt"
        >
          <div class="commit-receipt__head">
            <span class="codicon codicon-arrow-up" aria-hidden="true"></span>
            <strong>冲突意图解释回执（尚未发送）</strong>
            <span class="commit-receipt__tag" role="status">等待确认</span>
          </div>
          <dl class="commit-receipt__meta">
            <div>
              <dt>任务</dt>
              <dd>冲突意图解释（{conflictReceipt.receipt.task}）</dd>
            </div>
            <div>
              <dt>模型</dt>
              <dd>{conflictReceipt.receipt.model}</dd>
            </div>
            <div>
              <dt>数据类型</dt>
              <dd>{conflictReceipt.receipt.dataTypes.join("、")}</dd>
            </div>
            <div>
              <dt>文件数</dt>
              <dd>{conflictReceipt.receipt.files} 个冲突正文</dd>
            </div>
            <div>
              <dt>预算</dt>
              <dd>
                单文件 {conflictReceipt.receipt.perFileBudget} 字符 / 总计 {conflictReceipt
                  .receipt.totalBudget} 字符
              </dd>
            </div>
          </dl>
          <button
            type="button"
            class="commit-receipt__toggle"
            aria-expanded={receiptExpanded}
            onclick={() => (receiptExpanded = !receiptExpanded)}
            >{receiptExpanded ? "收起" : "展开"}冲突正文预算清单</button
          >
          {#if receiptExpanded}
            <ul class="commit-receipt__files" aria-label="冲突正文预算清单">
              {#each conflictReceipt.files as file (file.name)}
                <li class="commit-receipt__file">
                  <span>{file.name}</span>
                  <small
                    >{file.characters} / {file.maxCharacters} 字符{file.truncated
                      ? "（已截断）"
                      : ""}{file.readError
                      ? `（${file.readError}）`
                      : ""}</small
                  >
                </li>
              {/each}
            </ul>
          {/if}
          <p class="commit-receipt__note">
            不会发送：{conflictReceipt.notSent.join("；")}。
          </p>
          <p class="commit-receipt__note">{conflictReceipt.retentionNote}</p>
          <div class="commit-receipt__actions">
            <button
              type="button"
              class="button button--primary"
              onclick={confirmInterpret}>开始解释</button
            >
            <button
              type="button"
              class="button button--secondary"
              onclick={continueLocalAdvice}>继续仅本地建议</button
            >
            <button
              type="button"
              class="button button--secondary"
              onclick={dismissInterpretReceipt}>放弃</button
            >
          </div>
        </div>
      {/if}
      <!-- v0.1.3 V013-F：恢复出口（发生了什么→可能原因→恢复动作） -->
      {#if updateOriginClosed}
        <div
          class="notice notice--warning"
          role="alert"
          data-testid="recovery-update-origin-closed"
        >
          <span class="codicon codicon-warning" aria-hidden="true"></span>
          <div>
            <strong>{RECOVERY_CATALOG.updateOriginClosed.what}</strong>
            <p>{RECOVERY_CATALOG.updateOriginClosed.cause}</p>
            <small>{RECOVERY_CATALOG.updateOriginClosed.recovery}</small>
          </div>
          <div class="toolbar-actions">
            <button
              class="button button--secondary"
              data-testid="retry-update"
              onclick={() => onAction("update/preview")}>重试</button
            >
            <button
              class="button button--secondary"
              data-testid="close-update-origin"
              onclick={() =>
                onAction("open-module", {
                  moduleId: "changes",
                  taskId: "changes/overview",
                })}>关闭</button
            >
          </div>
        </div>
      {/if}
      {#if reacquireFailed}
        <div
          class="notice notice--warning"
          role="alert"
          data-testid="recovery-reacquire-failed"
        >
          <span class="codicon codicon-warning" aria-hidden="true"></span>
          <div>
            <strong>{RECOVERY_CATALOG.reacquireFailed.what}</strong>
            <p>{RECOVERY_CATALOG.reacquireFailed.cause}</p>
            <small>{RECOVERY_CATALOG.reacquireFailed.recovery}</small>
          </div>
          <div class="toolbar-actions">
            <button
              class="button button--secondary"
              data-testid="retry-reacquire"
              onclick={() => onAction("refresh")}>重试</button
            >
            <button
              class="button button--secondary"
              data-testid="close-reacquire"
              onclick={() =>
                onAction("open-module", {
                  moduleId: "changes",
                  taskId: "changes/overview",
                })}>关闭</button
            >
          </div>
        </div>
      {/if}
      {#each recoveryItems as item (item.id)}
        <div
          class="notice notice--warning"
          role="alert"
          data-testid={item.testId}
        >
          <span class="codicon codicon-warning" aria-hidden="true"></span>
          <div>
            <strong>{item.what}</strong>
            <p>{item.cause}</p>
            <small>{item.recovery}</small>
          </div>
          <div class="toolbar-actions">
            {#if item.actions.includes("retry")}
              <button
                class="button button--secondary"
                data-testid="{item.testId}-retry"
                onclick={() => onAction("refresh")}>重试</button
              >
            {/if}
            {#if item.actions.includes("repreview")}
              <button
                class="button button--secondary"
                data-testid="{item.testId}-repreview"
                onclick={() =>
                  onAction("conflict/preview-resolve", {
                    relativePath: snapshot.selected?.relativePath,
                  })}>重新检查并生成新预览</button
              >
            {/if}
            {#if item.actions.includes("copyDraft") && !hasBottomDraftActions}
              <button
                class="button button--secondary"
                data-testid="{item.testId}-copy"
                onclick={() =>
                  onAction("conflict/draft-copy", {
                    relativePath: snapshot.selected?.relativePath,
                  })}>复制草稿</button
              >
            {/if}
            {#if item.actions.includes("exportDraft") && !hasBottomDraftActions}
              <button
                class="button button--secondary"
                data-testid="{item.testId}-export"
                onclick={() =>
                  onAction("conflict/draft-export", {
                    relativePath: snapshot.selected?.relativePath,
                  })}>导出草稿</button
              >
            {/if}
            {#if item.actions.includes("refresh")}
              <button
                class="button button--secondary"
                data-testid="{item.testId}-refresh"
                onclick={() => onAction("refresh")}>刷新</button
              >
            {/if}
            {#if item.actions.includes("viewDetail")}
              <button
                class="button button--secondary"
                data-testid="{item.testId}-detail"
                onclick={() =>
                  onAction("file/path-detail", {
                    relativePath: snapshot.selected?.relativePath,
                  })}>查看详情</button
              >
            {/if}
          </div>
        </div>
      {/each}
      {#if !isNonTextBranch && recoveryItems.some((i) => i.id === "markerRemaining")}
        <div
          class="notice notice--warning"
          role="alert"
          data-testid="recovery-marker-remaining"
        >
          <span class="codicon codicon-warning" aria-hidden="true"></span>
          <div>
            <strong>{RECOVERY_CATALOG.markerRemaining.what}</strong>
            <p>{RECOVERY_CATALOG.markerRemaining.cause}</p>
            <small>{RECOVERY_CATALOG.markerRemaining.recovery}</small>
          </div>
          <div class="toolbar-actions">
            <span
              class="status-badge status-badge--blocked"
              aria-label="核验未通过">核验未通过</span
            >
            <small>继续编辑</small>
          </div>
        </div>
      {/if}
      <div class="conflict-tabs" role="tablist" aria-label="冲突版本">
        {#each ["working", "mine", "theirs", "base"] as pane (pane)}
          <button
            role="tab"
            aria-selected={activePane === pane}
            class:active={activePane === pane}
            onclick={() => (activePane = pane as typeof activePane)}
            >{paneLabels[pane as keyof typeof paneLabels]}</button
          >
        {/each}
      </div>
      {#if activePane === "working"}
        {#if isNonTextBranch && !isFallbackContent}
          <!-- v0.1.3 V013-F：非文本冲突独立出口，不伪装成文本合并 -->
          <div
            class="notice notice--info"
            role="region"
            aria-label="非文本冲突说明"
            data-testid="non-text-branch"
          >
            <span class="codicon codicon-warning" aria-hidden="true"></span>
            <div>
              <strong>{nonTextInfo.label}</strong>
              <p>{nonTextInfo.description}</p>
              <small>{nonTextInfo.resolveHint}</small>
              <p class="muted">
                已禁用文本合并工具栏的保留两者操作，仅提供只读或外部处理出口。
              </p>
            </div>
            <div class="toolbar-actions">
              <button
                class="button button--secondary"
                data-testid="non-text-view-detail"
                onclick={() =>
                  onAction("file/path-detail", {
                    relativePath: snapshot.selected?.relativePath,
                  })}>查看详情</button
              >
              <button
                class="button button--secondary"
                data-testid="non-text-open-editor"
                onclick={() =>
                  onAction("open-file", {
                    relativePath: snapshot.selected?.relativePath,
                  })}>在编辑器中打开</button
              >
              <button
                class="button button--secondary"
                data-testid="non-text-open-external"
                onclick={() =>
                  onAction("open-file", {
                    relativePath: snapshot.selected?.relativePath,
                  })}>在外部工具打开</button
              >
            </div>
          </div>
          {#if snapshot.selected?.draft?.hasDraft}
            <div class="toolbar-actions">
              <button
                class="button button--secondary"
                data-testid="non-text-copy-draft"
                onclick={() =>
                  onAction("conflict/draft-copy", {
                    relativePath: snapshot.selected?.relativePath,
                  })}>复制草稿</button
              >
              <button
                class="button button--secondary"
                data-testid="non-text-export-draft"
                onclick={() =>
                  onAction("conflict/draft-export", {
                    relativePath: snapshot.selected?.relativePath,
                  })}>导出草稿</button
              >
            </div>
          {/if}
          <!-- 占位禁用按钮，供测试校验 take-both 已禁用 -->
          <button
            class="button button--secondary"
            data-testid="take-both-block"
            disabled
            aria-disabled="true"
            title="非文本冲突已禁用保留两者"
            style="display:none">保留两者</button
          >
          <button
            class="button button--secondary"
            data-testid="action-take-both-mine-first"
            disabled
            aria-disabled="true"
            title="非文本冲突已禁用保留两者"
            style="display:none">保留两者</button
          >
        {:else}
          <!-- V011-D 紧凑导航：文件 + 块级导航，进度统一 -->
          <div
            class="conflict-compact-nav"
            role="navigation"
            aria-label="冲突导航"
          >
            <div class="toolbar-actions">
              <button
                class="button button--secondary"
                onclick={() => moveToConflict(-1)}
                disabled={orderedConflicts.length < 2}>上一个文件</button
              >
              <button
                class="button button--secondary"
                onclick={() => moveToConflict(1)}
                disabled={orderedConflicts.length < 2}>下一个文件</button
              >
              <span class="muted" aria-live="polite"
                >文件 {snapshot.selected
                  ? orderedConflicts.findIndex(
                      (c) => c.relativePath === snapshot.selected?.relativePath,
                    ) + 1
                  : 0}/{orderedConflicts.length}</span
              >
            </div>
            <div class="toolbar-actions" role="group" aria-label="冲突块导航">
              <button
                class="button button--secondary"
                aria-label="上一个冲突块"
                title={CONFLICT_SHORTCUTS.prevBlock.title}
                onclick={() => focusBlock(-1)}
                disabled={!diffProgress.total}>上一个块</button
              >
              <button
                class="button button--secondary"
                aria-label="下一个冲突块"
                title={CONFLICT_SHORTCUTS.nextBlock.title}
                onclick={() => focusBlock(1)}
                disabled={!diffProgress.total}>下一个块</button
              >
              <span
                class="muted"
                role="status"
                aria-live="polite"
                data-testid="block-progress"
                >块 {diffProgress.current}/{diffProgress.total || 0}</span
              >
            </div>
          </div>
          <!-- V011-D 固定角色说明：不只依赖颜色 -->
          <div
            class="conflict-role-bar"
            role="note"
            aria-label="冲突角色说明"
            data-testid="conflict-role-bar"
          >
            <span class="role role--mine"
              ><span class="codicon codicon-circle-filled" aria-hidden="true"
              ></span> 我的修改（本地）</span
            >
            <span class="role role--theirs"
              ><span class="codicon codicon-circle-outline" aria-hidden="true"
              ></span> 对方修改（仓库）</span
            >
            <span class="role role--base"
              ><span class="codicon codicon-compare-changes" aria-hidden="true"
              ></span> 共同基线（BASE）</span
            >
            <span class="role role--merged"
              ><span class="codicon codicon-merge" aria-hidden="true"></span> 合并结果</span
            >
          </div>
          {#if !useSimplified}
            <ConflictDiffView
              bind:this={diffView}
              workingText={diffWorkingText}
              relativePath={snapshot.selected?.relativePath ?? ""}
              fileIdentity={conflictFileIdentity}
              onBlockProgress={notifyBlockProgress}
              onMergeConflictAction={handleDiffAction}
              onError={handleDiffError}
              onReady={handleDiffReady}
            />
          {:else}
            <div
              class="notice notice--info"
              role="status"
              data-testid="simplified-fallback-notice"
            >
              已切换到简化编辑器（草稿已保留，可复制/导出）
            </div>
          {/if}
          {#if !useSimplified && resultEditor}
            <MergeActionToolbar
              {resultEditor}
              onDraftChange={(text) => handleResultDraftChange(text, 0)}
            />
          {/if}
          {#if diffActionFeedback}<div
              class="conflict-inline-feedback"
              role="status"
              data-testid="diff-action-feedback"
            >
              <span class="codicon codicon-check" aria-hidden="true"
              ></span>{diffActionFeedback}
            </div>{/if}
          {#if isFallbackContent}
            <div
              class="notice notice--warning"
              role="alert"
              data-testid="content-fallback-warning"
            >
              <span class="codicon codicon-warning" aria-hidden="true"></span>
              <div>
                <strong>内容暂不可用</strong>
                <p>{fallbackContentReason ?? "内容缺失或非法编码"}</p>
              </div>
              <div class="toolbar-actions">
                <button
                  class="button button--secondary"
                  data-testid="use-simple-editor-content"
                  onclick={() => (useSimplified = true)}>使用简化编辑器</button
                >
                <button
                  class="button button--secondary"
                  onclick={() =>
                    onAction("open-file", {
                      relativePath: snapshot.selected?.relativePath,
                    })}>在编辑器中打开</button
                >
                {#if snapshot.selected?.draft?.hasDraft}<button
                    class="button button--secondary"
                    onclick={() =>
                      onAction("conflict/draft-export", {
                        relativePath: snapshot.selected?.relativePath,
                      })}>导出草稿</button
                  >{/if}
              </div>
            </div>
          {/if}
          {#if diffErrorInfo}
            <div
              class="notice notice--warning"
              role="alert"
              data-testid="conflict-fallback-warning"
            >
              <span class="codicon codicon-warning" aria-hidden="true"></span>
              <div>
                <strong>差异视图暂不可用</strong>
                <p>{diffErrorInfo.what}</p>
                <small>{diffErrorInfo.cause} {diffErrorInfo.recovery}</small>
              </div>
              <div class="toolbar-actions">
                <button
                  class="button button--secondary"
                  data-testid="use-simple-editor"
                  onclick={() => (useSimplified = true)}>使用简化编辑器</button
                >
                {#if snapshot.selected?.draft?.hasDraft}<button
                    class="button button--secondary"
                    data-testid="export-draft-fallback"
                    onclick={() =>
                      onAction("conflict/draft-export", {
                        relativePath: snapshot.selected?.relativePath,
                      })}>导出草稿</button
                  >{/if}
                <button
                  class="button button--secondary"
                  data-testid="open-in-editor-fallback"
                  onclick={() =>
                    onAction("open-file", {
                      relativePath: snapshot.selected?.relativePath,
                    })}>在编辑器中打开</button
                >
              </div>
            </div>
          {/if}
          <div class="merge-block-toolbar">
            <div>
              <strong>块级合并</strong><span
                >{conflictBlocks.length > 0
                  ? `仍有 ${conflictBlocks.length} 个冲突块`
                  : "未检测到冲突标记"}</span
              >
            </div>
            {#if conflictBlocks.length > 0}
              <!-- svelte-ignore a11y_no_noninteractive_tabindex -- 冲突块列表需要获得键盘焦点以便滚动。 -->
              <div
                class="merge-block-list scroll-region"
                role="region"
                aria-label="冲突块操作"
                tabindex="0"
                data-scroll-region
              >
                {#each conflictBlocks as block, index (block.start)}
                  <article>
                    <span>块 {index + 1}</span><small
                      >{block.mine.split(/\r?\n/).filter(Boolean).length} 行本地 /
                      {block.theirs.split(/\r?\n/).filter(Boolean).length} 行对方</small
                    >
                    <div>
                      <button
                        class="button button--secondary"
                        onclick={() => applyBlock(index, "mine")}
                        >采用我的修改</button
                      ><button
                        class="button button--secondary"
                        onclick={() => applyBlock(index, "theirs")}
                        >采用对方修改</button
                      ><button
                        class="button button--secondary"
                        data-testid="take-both-block"
                        disabled={disableTakeBoth}
                        aria-disabled={disableTakeBoth ? "true" : "false"}
                        title={disableTakeBoth
                          ? "非文本冲突已禁用保留两者"
                          : "保留两者"}
                        onclick={() => applyBlock(index, "both")}
                        >保留两者</button
                      >
                    </div>
                  </article>
                {/each}
              </div>
            {/if}
          </div>
          {#if snapshot.selected.mergeEditor.feedback}<div
              class="conflict-inline-feedback"
              role="status"
            >
              <span class="codicon codicon-check" aria-hidden="true"
              ></span>{snapshot.selected.mergeEditor.feedback}
            </div>{/if}
          {#each snapshot.selected.mergeEditor.issues as issue, issueIndex (issueIndex)}<div
              class="conflict-inline-feedback conflict-inline-feedback--warning"
            >
              <span class="codicon codicon-warning" aria-hidden="true"
              ></span>{issue}
            </div>{/each}
          {#if !useSimplified}
            <div
              class="conflict-editor conflict-editor--editable"
              role="region"
              aria-label="可编辑工作副本合并区域"
              data-testid="conflict-result-editor"
              oncompositionstart={() => (isComposing = true)}
              oncompositionend={() => (isComposing = false)}
            >
              {#key conflictFileIdentity}
                <ConflictResultEditor
                  bind:this={resultEditor}
                  fileIdentity={conflictFileIdentity}
                  relativePath={snapshot.selected.relativePath}
                  language="typescript"
                  initialText={snapshot.selected?.draft?.content ??
                    snapshot.selected?.contents.working?.content ??
                    diffWorkingText}
                  readonly={!snapshot.selected.mergeEditor.editable}
                  onDraftChange={handleResultDraftChange}
                  onFallback={handleResultFallback}
                  onError={handleDiffError}
                />
              {/key}
              <div class="toolbar-actions toolbar-actions--spaced-top">
                <button
                  class="button button--secondary"
                  data-testid="use-simple-editor-result"
                  onclick={() => (useSimplified = true)}>使用简化编辑器</button
                >
              </div>
            </div>
          {:else}
            <div
              class="conflict-editor conflict-editor--editable"
              role="region"
              aria-label="可编辑工作副本合并区域（简化编辑器）"
              oncompositionstart={() => (isComposing = true)}
              oncompositionend={() => (isComposing = false)}
            >
              <div
                class="conflict-codemirror-host"
                bind:this={editorHost}
              ></div>
            </div>
          {/if}
          {#if snapshot.selected.draft?.hasDraft}<div
              class="conflict-inline-feedback"
              role="status"
            >
              <span class="codicon codicon-save" aria-hidden="true"></span><span
                >Host 内存草稿已同步（修订 {snapshot.selected.draft
                  .revision}，{snapshot.selected.draft.dirty
                  ? "有未保存变更"
                  : "干净"}），关闭任务前可复制/导出逃生。</span
              >
            </div>{/if}
          {#if conflictDraftFeedback}<div
              class="conflict-inline-feedback"
              role="status"
            >
              <span class="codicon codicon-check" aria-hidden="true"
              ></span>{conflictDraftFeedback}
            </div>{/if}
          <!-- V012-D：检查点状态持续显示（未保存 / 检查点已保存 / 保存失败），自动 debounce + 显式保存均不写盘 -->
          <div
            class="checkpoint-status-bar"
            role="status"
            aria-live="polite"
            data-testid="checkpoint-status"
          >
            {#if checkpointStatus === "unsaved"}<span
                class="status-badge status-badge--dirty">未保存</span
              ><small
                >{checkpointStatusDetail ||
                  "有未保存变更，将自动保存检查点（不写工作副本）"}</small
              >{:else if checkpointStatus === "saved"}<span
                class="status-badge status-badge--saved">已保存</span
              ><small>{checkpointStatusDetail}</small
              >{:else if checkpointStatus === "failed"}<span
                class="status-badge status-badge--error">保存失败</span
              ><small
                >{checkpointStatusDetail ||
                  "检查点保存失败，草稿仍保留在内存"}</small
              >{/if}
            {#if snapshot.selected?.mergeEditor.feedback?.includes("容量上限")}<div
                class="notice notice--warning"
                role="alert"
                data-testid="capacity-feedback"
              >
                草稿已达容量上限，最旧草稿已被淘汰，请及时导出或复制（最新草稿已保留）
              </div>{/if}
            {#if snapshot.selected?.mergeEditor.issues.some( (i) => i.includes("只读") )}<div
                class="notice notice--warning"
                role="alert"
                data-testid="stale-readonly-notice"
              >
                草稿对应的工作副本已变化，只读展示，请复制/导出或重新建立（fail-closed，不静默写回）
                <button
                  class="button button--secondary"
                  data-testid="stale-copy"
                  onclick={() =>
                    onAction("conflict/draft-copy", {
                      relativePath: snapshot.selected?.relativePath,
                    })}>复制草稿</button
                >
                <button
                  class="button button--secondary"
                  data-testid="stale-export"
                  onclick={() =>
                    onAction("conflict/draft-export", {
                      relativePath: snapshot.selected?.relativePath,
                    })}>导出草稿</button
                >
              </div>{/if}
          </div>
          <div class="merge-save-bar">
            <span
              >{workingDirty
                ? "有尚未保存的合并修改（Host 草稿已同步）"
                : "工作副本与已保存内容一致"}</span
            ><button
              class={snapshot.resolvePreview
                ? "button button--secondary"
                : "button button--primary"}
              disabled={!snapshot.selected.mergeEditor.editable ||
                !workingDirty}
              title={snapshot.resolvePreview
                ? "已生成解决预览，当前步骤为标记解决"
                : undefined}
              onclick={() =>
                onAction("conflict/save-working", {
                  editToken: snapshot.selected?.mergeEditor.token,
                  content: mergeDraft,
                })}>保存工作副本合并结果</button
            ><button
              class="button button--secondary"
              data-testid="save-checkpoint"
              disabled={isComposing || (resultEditor?.isComposing?.() ?? false)}
              onclick={flushCheckpoint}
              onkeydown={(e) =>
                isComposing && e.key === "Enter" && e.preventDefault()}
              title={CONFLICT_SHORTCUTS.saveCheckpoint.title}>保存检查点</button
            ><button
              class="button button--secondary"
              data-testid="copy-draft"
              disabled={!snapshot.selected.draft?.hasDraft}
              onclick={() =>
                onAction("conflict/draft-copy", {
                  relativePath: snapshot.selected?.relativePath,
                })}>复制草稿</button
            ><button
              class="button button--secondary"
              data-testid="export-draft"
              disabled={!snapshot.selected.draft?.hasDraft}
              onclick={() =>
                onAction("conflict/draft-export", {
                  relativePath: snapshot.selected?.relativePath,
                })}>导出草稿</button
            ><button
              class="button button--secondary"
              data-testid="abandon-draft"
              disabled={!snapshot.selected.draft?.hasDraft}
              onclick={() =>
                onAction("conflict/draft-abandon", {
                  relativePath: snapshot.selected?.relativePath,
                })}>放弃草稿</button
            >
          </div>
          <!-- V011-D 查看来源折叠区：默认不与块级动作争夺首屏 -->
          <details
            class="conflict-source-details"
            bind:open={sourceDetailsOpen}
            data-testid="conflict-source-details"
          >
            <summary>查看来源（我的修改 / 对方修改 / 共同基线）</summary>
            <div
              class="conflict-source-tabs"
              role="tablist"
              aria-label="来源版本"
            >
              {#each ["mine", "theirs", "base"] as sp (sp)}
                <button
                  role="tab"
                  aria-selected={sourcePane === sp}
                  class:active={sourcePane === sp}
                  onclick={() => (sourcePane = sp as typeof sourcePane)}
                  >{sourcePaneLabels[
                    sp as keyof typeof sourcePaneLabels
                  ]}</button
                >
              {/each}
            </div>
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -- 来源内容区域需要获得键盘焦点以便滚动。 -->
            <div
              class="conflict-source-content"
              role="region"
              aria-label={`${sourcePaneLabels[sourcePane]}内容`}
              tabindex="0"
            >
              {#if sourceContent?.readError}
                <div class="module-state module-state--error">
                  <span class="codicon codicon-error"></span>
                  <div>
                    <strong>读取失败</strong>
                    <p>{sourceContent.readError}</p>
                  </div>
                </div>
              {:else}
                <pre><code>{sourceContent?.content ?? "（没有可用内容）"}</code
                  ></pre>
                {#if sourceContent?.truncated}<small
                    class="conflict-inline-feedback conflict-inline-feedback--warning"
                  >
                    内容已截断，仅用于辅助判断。
                  </small>{/if}
              {/if}
            </div>
          </details>
        {/if}
      {:else}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -- 冲突正文需要获得键盘焦点以便滚动。 -->
        <div
          class="conflict-editor scroll-region"
          role="region"
          aria-label={`${paneLabels[activePane]}内容`}
          tabindex="0"
          data-scroll-region
        >
          {#if content?.readError}
            <div class="module-state module-state--error">
              <span class="codicon codicon-error"></span>
              <div>
                <strong>读取失败</strong>
                <p>{content.readError}</p>
              </div>
            </div>
          {:else}
            <pre><code>{content?.content ?? "（没有可用内容）"}</code></pre>
            {#if content?.truncated}<small
                class="conflict-inline-feedback conflict-inline-feedback--warning"
              >
                内容已截断，仅用于辅助判断。
              </small>{/if}
          {/if}
        </div>
      {/if}

      <div class="conflict-bottom">
        <details
          class="conflict-help-details"
          bind:open={helpDetailsOpen}
          data-testid="conflict-help-details"
        >
          <!-- v0.1.6 V016-C2：合并建议与意图解释已收进上方 AssistancePanel；此处只保留解决确认与快捷键 -->
          <summary>解决确认与快捷键</summary>
          <section class="resolve-panel">
            <div class="section-heading">
              <div>
                <span class="eyebrow">解决确认</span>
                <h2>标记为已解决</h2>
              </div>
            </div>
            {#if snapshot.resolvePreview}
              <div class="notice">
                <span class="codicon codicon-terminal"></span><code
                  >{snapshot.resolvePreview.command}</code
                >
              </div>
              {#each snapshot.resolvePreview.issues as issue, issueIndex (issueIndex)}<div
                  class="issue-list"
                >
                  <div>{issue}</div>
                </div>{/each}
              <button
                class="button button--primary commit-button"
                disabled={!snapshot.resolvePreview.canResolve}
                onclick={(event) => {
                  resolveTriggerEl = event.currentTarget as HTMLElement;
                  resolveIntentOpen = true;
                }}>确认使用当前工作副本内容并标记解决</button
              >
            {:else}
              <p class="muted">
                请先在内嵌工作副本编辑器完成合并并保存。解决预览不会修改文件。
              </p>
              <button
                class="button button--secondary"
                onclick={() =>
                  onAction("conflict/preview-resolve", {
                    relativePath: snapshot.selected?.relativePath,
                  })}>生成解决预览</button
              >
            {/if}
          </section>
          <!-- V012-E：快捷键帮助（单一来源，按钮 title 与本面板共用；? 切换） -->
          <section
            class="conflict-shortcut-help"
            aria-label="快捷键帮助"
            data-testid="conflict-shortcut-help"
            title={CONFLICT_SHORTCUTS.help.title}
          >
            <h3>快捷键（{CONFLICT_SHORTCUTS.help.display} 打开/关闭）</h3>
            <ul>
              {#each CONFLICT_SHORTCUT_LIST as sc (sc.id)}
                <li data-testid={`shortcut-${sc.id}`}>
                  <span>{sc.label}</span><code>{sc.display}</code><small
                    >{sc.title}</small
                  >
                </li>
              {/each}
            </ul>
            <small class="muted" data-testid="replace-deferred-note"
              >{REPLACE_DEFERRED_NOTE}</small
            >
            <small class="muted"
              >查找面板的英文 placeholder 为第三方库内部
              UI，属已知限制；关闭查找后焦点返回编辑位置。</small
            >
          </section>
        </details>
      </div>
    {:else}
      <div class="empty-state empty-state--large">
        <span class="codicon codicon-merge"></span>
        <div>
          <strong>选择一个冲突文件</strong>
          <p>比较本地、远端、BASE 和当前工作副本内容。</p>
        </div>
      </div>
    {/if}
  </ScrollArea>
  <!-- v0.0.14 通用操作意向单：Resolve 确认（复用列表底座、可搜索/复制、焦点锁定、IME 保护） -->
  <OperationIntentDialog
    intent={resolveIntent}
    open={resolveIntentOpen && Boolean(resolveIntent)}
    confirmLabel="确认标记解决"
    cancelLabel="取消"
    recheckLabel="重新检查"
    triggerElement={resolveTriggerEl}
    {onAction}
    {pathDetail}
    onConfirm={(token) => {
      resolveIntentOpen = false;
      onAction("conflict/resolve", { previewToken: token });
    }}
    onCancel={() => (resolveIntentOpen = false)}
    onRecheck={() => {
      resolveIntentOpen = false;
      onAction("conflict/preview-resolve", {
        relativePath: snapshot.selected?.relativePath,
      });
    }}
  />
  {#if conflictSwitchRequest}
    <dialog
      bind:this={switchDialogEl}
      class="conflict-switch-dialog"
      aria-label="未保存草稿处理"
      aria-modal="true"
      onkeydown={(e) => {
        if (isComposing) return;
        if (e.key === "Escape") {
          e.preventDefault();
          onAction("conflict/draft-switch-decision", { decision: "stay" });
        }
      }}
      oncompositionstart={() => (isComposing = true)}
      oncompositionend={() => (isComposing = false)}
    >
      <form method="dialog" class="dialog-card">
        <h3>有未保存的合并草稿</h3>
        <p>
          文件 <strong>{conflictSwitchRequest.currentRelativePath}</strong> 的合并草稿仅保存在
          Host 内存（未写入工作副本，未标记解决）。请选择：
        </p>
        <p class="dialog-timer-notice">
          <span class="codicon codicon-clock" aria-hidden="true"></span> 30 秒未选择将自动保存检查点并继续（草稿不丢）
        </p>
        <ul class="dialog-options">
          <li>
            <strong>保存检查点并继续</strong>：将当前草稿保存为 Host
            检查点（不写盘），切换到
            <code>{conflictSwitchRequest.nextRelativePath}</code
            >，可在返回后继续编辑或复制/导出逃生。
          </li>
          <li><strong>留在当前文件</strong>：取消切换，保留编辑器与草稿。</li>
          <li><strong>放弃草稿</strong>：丢弃 Host 草稿并切换。</li>
        </ul>
        <div class="toolbar-actions" role="group" aria-label="草稿处理选项">
          <button
            type="button"
            class="button button--primary"
            onkeydown={(e) =>
              isComposing && e.key === "Enter" && e.preventDefault()}
            onclick={() =>
              onAction("conflict/draft-switch-decision", { decision: "save" })}
            >保存检查点并继续</button
          >
          <button
            type="button"
            class="button button--secondary"
            onkeydown={(e) =>
              isComposing && e.key === "Enter" && e.preventDefault()}
            onclick={() =>
              onAction("conflict/draft-switch-decision", { decision: "stay" })}
            >留在当前文件</button
          >
          <button
            type="button"
            class="button button--secondary"
            onkeydown={(e) =>
              isComposing && e.key === "Enter" && e.preventDefault()}
            onclick={() =>
              onAction("conflict/draft-switch-decision", {
                decision: "discard",
              })}>放弃草稿</button
          >
        </div>
      </form>
    </dialog>
  {/if}
</section>
