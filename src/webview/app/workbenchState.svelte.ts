import {
  WORKBENCH_PROTOCOL_VERSION,
  createRequestId,
  defaultWorkbenchTask,
  type HostToWebviewMessage,
  type WebviewAction,
  type WorkbenchModuleId,
  type WorkbenchModuleSnapshot,
  type WorkbenchScopeView,
  type WorkbenchTaskId,
} from "@protocol/workbenchProtocol";
import { workbenchBridge } from "../bridge/vscodeBridge";

export class WorkbenchState {
  connected = $state(false);
  loading = $state(true);
  moduleId = $state<WorkbenchModuleId>("changes");
  taskId = $state<WorkbenchTaskId>(defaultWorkbenchTask("changes"));
  scope = $state<WorkbenchScopeView | undefined>();
  snapshot = $state<WorkbenchModuleSnapshot | undefined>();
  error = $state<
    | Extract<HostToWebviewMessage, { type: "operation/error" }>["payload"]
    | undefined
  >();
  progress = $state<
    | {
        title: string;
        message?: string;
        stage?: string;
        scope?: string;
        percent?: number;
        cancellable?: boolean;
        outputAvailable?: boolean;
        startedAt: number;
      }
    | undefined
  >();
  notification = $state<
    { tone: "success" | "warning"; title: string; message: string } | undefined
  >();
  sessionId = $state<string | undefined>();
  repositoryUuid = $state<string | undefined>();
  scopeHash = $state<string | undefined>();
  /** v0.0.6 页内编辑会话（diff/edit-opened 下发）。 */
  editSession = $state<
    | Extract<HostToWebviewMessage, { type: "diff/edit-opened" }>["payload"]
    | undefined
  >();
  /** diff/save-result 一次性结果（消费后清除）。 */
  diffSaveResult = $state<
    | Extract<HostToWebviewMessage, { type: "diff/save-result" }>["payload"]
    | undefined
  >();
  /** 草稿检查点 ACK。 */
  draftAck = $state<
    | Extract<
        HostToWebviewMessage,
        { type: "diff/draft-checkpointed" }
      >["payload"]
    | undefined
  >();
  /** 单例窗口目标切换的脏草稿确认请求（三选一）。 */
  targetSwitchRequest = $state<
    | Extract<
        HostToWebviewMessage,
        { type: "diff/target-switch-confirm" }
      >["payload"]
    | undefined
  >();
  /** v0.0.7 文件路径详情（file/path-detail-result 一次性结果）。 */
  pathDetail = $state<
    | Extract<
        HostToWebviewMessage,
        { type: "file/path-detail-result" }
      >["payload"]
    | undefined
  >();
  /** v0.0.11 受限差异外发回执（commit/receipt，模型调用前展示与确认）。 */
  commitReceipt = $state<
    | Extract<HostToWebviewMessage, { type: "commit/receipt" }>["payload"]
    | undefined
  >();
  /** v0.0.12 变更解读外发回执（understanding/receipt，独立于 commit/receipt）。 */
  understandingReceipt = $state<
    | Extract<
        HostToWebviewMessage,
        { type: "understanding/receipt" }
      >["payload"]
    | undefined
  >();
  /** v0.0.12 批次 B 语义拆分外发回执（changelist/receipt）。 */
  changelistReceipt = $state<
    | Extract<HostToWebviewMessage, { type: "changelist/receipt" }>["payload"]
    | undefined
  >();
  /** v0.0.12 批次 C 冲突意图解释外发回执（conflict/receipt）。 */
  conflictReceipt = $state<
    | Extract<HostToWebviewMessage, { type: "conflict/receipt" }>["payload"]
    | undefined
  >();

  readonly dispose: () => void;

  constructor() {
    this.dispose = workbenchBridge.subscribe((message) => this.handle(message));
  }

  ready(): void {
    workbenchBridge.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "webview/ready",
      moduleId: this.moduleId,
      taskId: this.taskId,
      sessionId: this.sessionId,
      repositoryUuid: this.repositoryUuid,
      scopeHash: this.scopeHash,
      payload: {},
    });
  }

  action(action: WebviewAction, data?: Record<string, unknown>): void {
    // 三选一决定已发出：本地确认请求立即关闭（Host 会按决定推进或回发错误）。
    if (action === "diff/target-switch-decision") {
      this.targetSwitchRequest = undefined;
    }
    workbenchBridge.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "workbench/action",
      requestId: createRequestId(action),
      moduleId: this.moduleId,
      taskId: this.taskId,
      sessionId: this.sessionId,
      repositoryUuid: this.repositoryUuid,
      scopeHash: this.scopeHash,
      payload: { action, data },
    });
  }

  openModule(
    moduleId: WorkbenchModuleId,
    taskId: WorkbenchTaskId = defaultWorkbenchTask(moduleId),
  ): void {
    if (moduleId === this.moduleId && taskId === this.taskId) {
      return;
    }
    this.loading = true;
    this.error = undefined;
    this.action("open-module", { moduleId, taskId });
  }

  private handle(message: HostToWebviewMessage): void {
    if (message.protocolVersion !== WORKBENCH_PROTOCOL_VERSION) {
      this.error = {
        title: "协议版本不兼容",
        message: `工作台协议版本 ${message.protocolVersion} 无法处理。`,
        recoverable: false,
      };
      return;
    }

    if (
      message.type !== "app/initialize" &&
      this.sessionId !== undefined &&
      message.sessionId !== this.sessionId
    ) {
      return;
    }

    this.connected = true;
    if (message.type === "app/initialize") {
      this.sessionId = message.sessionId;
    }
    this.repositoryUuid = message.repositoryUuid ?? this.repositoryUuid;
    this.scopeHash = message.scopeHash ?? this.scopeHash;
    this.moduleId = message.moduleId;
    this.taskId = message.taskId ?? defaultWorkbenchTask(message.moduleId);

    switch (message.type) {
      case "app/initialize":
        this.scope = message.payload.scope;
        this.snapshot = message.payload.snapshot;
        this.loading = !message.payload.snapshot;
        this.error = undefined;
        // 会话替换：旧会话的编辑态一次性消息不得带入新会话。
        this.editSession = undefined;
        this.diffSaveResult = undefined;
        this.draftAck = undefined;
        this.targetSwitchRequest = undefined;
        this.pathDetail = undefined;
        this.commitReceipt = undefined;
        this.understandingReceipt = undefined;
        this.changelistReceipt = undefined;
        this.conflictReceipt = undefined;
        break;
      case "module/loading":
        this.loading = true;
        this.progress = undefined;
        this.notification = undefined;
        this.error = undefined;
        this.pathDetail = undefined;
        this.commitReceipt = undefined;
        this.understandingReceipt = undefined;
        this.changelistReceipt = undefined;
        this.conflictReceipt = undefined;
        break;
      case "module/snapshot":
        this.snapshot = message.payload.snapshot;
        this.loading = false;
        this.progress = undefined;
        this.error = undefined;
        // v0.0.11：回执是等待确认的一次性状态；任何快照（生成/放弃/降级）
        // 到达后即清除，避免生成完成后回执面板残留。
        this.commitReceipt = undefined;
        this.understandingReceipt = undefined;
        this.changelistReceipt = undefined;
        this.conflictReceipt = undefined;
        break;
      case "operation/error":
        this.loading = false;
        this.progress = undefined;
        this.error = message.payload;
        this.commitReceipt = undefined;
        this.understandingReceipt = undefined;
        this.changelistReceipt = undefined;
        this.conflictReceipt = undefined;
        break;
      case "operation/progress":
        this.progress = {
          ...message.payload,
          outputAvailable: message.payload.outputAvailable ?? true,
          startedAt: this.progress?.startedAt ?? Date.now(),
        };
        break;
      case "operation/result":
        message.payload.message = `${message.payload.message}${this.elapsedSuffix()}`;
        this.progress = undefined;
        this.notification = { tone: "success", ...message.payload };
        break;
      case "operation/cancelled":
        message.payload.message = `${message.payload.message}${this.elapsedSuffix()}`;
        this.progress = undefined;
        this.notification = { tone: "warning", ...message.payload };
        break;
      case "scope/changed":
        this.scope = message.payload.scope;
        break;
      case "diff/edit-opened":
        this.editSession = message.payload;
        break;
      case "diff/save-result": {
        this.diffSaveResult = message.payload;
        // 保存成功即轮换编辑会话基准：组件因 module/loading 重挂载后只从
        // editSession 恢复本地状态，这里必须同步新 token/hash/草稿版本。
        const result = message.payload.result;
        if (
          result.ok &&
          result.newEditToken !== "" &&
          this.editSession?.targetId === message.payload.targetId
        ) {
          this.editSession = {
            ...this.editSession,
            editToken: result.newEditToken,
            rawHash: result.newContentHash,
            draftRevision: result.acceptedRevision,
          };
        }
        break;
      }
      case "diff/draft-checkpointed":
        this.draftAck = message.payload;
        break;
      case "diff/target-switch-confirm":
        this.targetSwitchRequest = message.payload;
        break;
      case "file/path-detail-result":
        this.pathDetail = message.payload;
        break;
      case "commit/receipt":
        this.commitReceipt = message.payload;
        break;
      case "understanding/receipt":
        this.understandingReceipt = message.payload;
        break;
      case "changelist/receipt":
        this.changelistReceipt = message.payload;
        break;
      case "conflict/receipt":
        this.conflictReceipt = message.payload;
        break;
    }
  }

  private elapsedSuffix(): string {
    if (!this.progress) return "";
    return ` · 用时 ${Math.max(0, Math.round((Date.now() - this.progress.startedAt) / 1000))} 秒`;
  }
}
