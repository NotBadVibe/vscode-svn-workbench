<script lang="ts">
  import type {
    DiffSnapshot,
    HostToWebviewMessage,
    WebviewAction,
  } from "../../../src/protocol/workbenchProtocol";
  import DiffModule from "../../../src/webview/features/diff/DiffModule.svelte";

  /**
   * DiffModule 测试 harness：把快照/会话/保存结果等作为内部 $state 持有，
   * 通过 controller 对象暴露 setter，使测试能原地更新 DiffModule 的 props
   * （不重挂载组件），用于验证快照刷新时编辑实例不被重建等回归语义。
   */
  export interface DiffModuleHarnessController {
    setSnapshot: (value: DiffSnapshot) => void;
    setEditSession: (
      value: Extract<HostToWebviewMessage, { type: "diff/edit-opened" }>["payload"],
    ) => void;
    setDiffSaveResult: (
      value: Extract<HostToWebviewMessage, { type: "diff/save-result" }>["payload"],
    ) => void;
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
    initialAction: (
      action: WebviewAction,
      data?: Record<string, unknown>,
    ) => void;
    initialEditSession?: Extract<
      HostToWebviewMessage,
      { type: "diff/edit-opened" }
    >["payload"];
    initialDiffSaveResult?: Extract<
      HostToWebviewMessage,
      { type: "diff/save-result" }
    >["payload"];
    initialDraftAck?: Extract<
      HostToWebviewMessage,
      { type: "diff/draft-checkpointed" }
    >["payload"];
    controller: DiffModuleHarnessController;
  } = $props();

  let snapshot = $state(initialSnapshot);
  let onAction = $state(initialAction);
  let editSession = $state(initialEditSession);
  let diffSaveResult = $state(initialDiffSaveResult);
  let draftAck = $state(initialDraftAck);

  controller.setSnapshot = (value: DiffSnapshot) => {
    snapshot = value;
  };
  controller.setEditSession = (
    value: Extract<
      HostToWebviewMessage,
      { type: "diff/edit-opened" }
    >["payload"],
  ) => {
    editSession = value;
  };
  controller.setDiffSaveResult = (
    value: Extract<
      HostToWebviewMessage,
      { type: "diff/save-result" }
    >["payload"],
  ) => {
    diffSaveResult = value;
  };
</script>

<DiffModule {snapshot} {onAction} {editSession} {diffSaveResult} {draftAck} />
