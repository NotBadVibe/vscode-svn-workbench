<script lang="ts">
  import { onMount } from "svelte";
  import type {
    DiffSnapshot,
    HostToWebviewMessage,
    WebviewAction,
  } from "../../../src/protocol/workbenchProtocol";
  import DiffModule from "../../../src/webview/features/diff/DiffModule.svelte";

  type EditSessionPayload = Extract<
    HostToWebviewMessage,
    { type: "diff/edit-opened" }
  >["payload"];
  type SaveResultPayload = Extract<
    HostToWebviewMessage,
    { type: "diff/save-result" }
  >["payload"];
  type DraftAckPayload = Extract<
    HostToWebviewMessage,
    { type: "diff/draft-checkpointed" }
  >["payload"];
  type ActionHandler = (
    action: WebviewAction,
    data?: Record<string, unknown>,
  ) => void;

  /**
   * DiffModule 测试 harness：把快照/会话/保存结果等作为内部状态持有，通过
   * controller 对象暴露 setter，使测试能原地更新 DiffModule 的 props（不
   * 重挂载组件），用于验证快照刷新时编辑实例不被重建等回归语义。
   * 初值仅取 props 一次：controller 的 setter 在 onMount 闭包内绑定，
   * 避免 Svelte state_referenced_locally 警告。
   */
  export interface DiffModuleHarnessController {
    setSnapshot: (value: DiffSnapshot) => void;
    setEditSession: (value: EditSessionPayload) => void;
    setDiffSaveResult: (value: SaveResultPayload) => void;
  }

  let {
    initialSnapshot,
    initialAction,
    initialEditSession,
    initialDiffSaveResult,
    initialDraftAck,
    controller,
  }: {
    initialSnapshot: DiffSnapshot;
    initialAction: ActionHandler;
    initialEditSession?: EditSessionPayload;
    initialDiffSaveResult?: SaveResultPayload;
    initialDraftAck?: DraftAckPayload;
    controller: DiffModuleHarnessController;
  } = $props();

  // 内部状态整体替换（不做深代理），初值仅捕获一次：通过闭包读取 props，
  // 避免 state_referenced_locally 警告，且不随 props 后续变化响应式更新。
  const initSnapshot = (): DiffSnapshot => initialSnapshot;
  const initAction = (): ActionHandler => initialAction;
  const initEditSession = (): EditSessionPayload | undefined =>
    initialEditSession;
  const initDiffSaveResult = (): SaveResultPayload | undefined =>
    initialDiffSaveResult;
  const initDraftAck = (): DraftAckPayload | undefined => initialDraftAck;
  let snapshot = $state(initSnapshot());
  let onAction = $state(initAction());
  let editSession = $state(initEditSession());
  let diffSaveResult = $state(initDiffSaveResult());
  let draftAck = $state(initDraftAck());

  onMount(() => {
    controller.setSnapshot = (value: DiffSnapshot) => {
      snapshot = value;
    };
    controller.setEditSession = (value: EditSessionPayload) => {
      editSession = value;
    };
    controller.setDiffSaveResult = (value: SaveResultPayload) => {
      diffSaveResult = value;
    };
  });
</script>

<DiffModule {snapshot} {onAction} {editSession} {diffSaveResult} {draftAck} />
