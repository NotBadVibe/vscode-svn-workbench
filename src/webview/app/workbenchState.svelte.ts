import {
  WORKBENCH_PROTOCOL_VERSION,
  createRequestId,
  defaultWorkbenchTask,
  type HostToWebviewMessage,
  type WebviewAction,
  type WorkbenchModuleId,
  type WorkbenchModuleSnapshot,
  type WorkbenchScopeView,
  type WorkbenchTaskId
} from '@protocol/workbenchProtocol';
import { workbenchBridge } from '../bridge/vscodeBridge';

export class WorkbenchState {
  connected = $state(false);
  loading = $state(true);
  moduleId = $state<WorkbenchModuleId>('changes');
  taskId = $state<WorkbenchTaskId>(defaultWorkbenchTask('changes'));
  scope = $state<WorkbenchScopeView | undefined>();
  snapshot = $state<WorkbenchModuleSnapshot | undefined>();
  error = $state<Extract<HostToWebviewMessage, { type: 'operation/error' }>['payload'] | undefined>();
  progress = $state<{ title: string; message?: string; stage?: string; scope?: string; percent?: number; cancellable?: boolean; outputAvailable?: boolean; startedAt: number } | undefined>();
  notification = $state<{ tone: 'success' | 'warning'; title: string; message: string } | undefined>();
  repositoryUuid = $state<string | undefined>();
  scopeHash = $state<string | undefined>();

  readonly dispose: () => void;

  constructor() {
    this.dispose = workbenchBridge.subscribe((message) => this.handle(message));
  }

  ready(): void {
    workbenchBridge.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: 'webview/ready',
      moduleId: this.moduleId,
      taskId: this.taskId,
      repositoryUuid: this.repositoryUuid,
      scopeHash: this.scopeHash,
      payload: {}
    });
  }

  action(action: WebviewAction, data?: Record<string, unknown>): void {
    workbenchBridge.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: 'workbench/action',
      requestId: createRequestId(action),
      moduleId: this.moduleId,
      taskId: this.taskId,
      repositoryUuid: this.repositoryUuid,
      scopeHash: this.scopeHash,
      payload: { action, data }
    });
  }

  openModule(moduleId: WorkbenchModuleId, taskId: WorkbenchTaskId = defaultWorkbenchTask(moduleId)): void {
    if (moduleId === this.moduleId && taskId === this.taskId) {
      return;
    }
    this.loading = true;
    this.error = undefined;
    this.action('open-module', { moduleId, taskId });
  }

  private handle(message: HostToWebviewMessage): void {
    if (message.protocolVersion !== WORKBENCH_PROTOCOL_VERSION) {
      this.error = {
        title: '协议版本不兼容',
        message: `工作台协议版本 ${message.protocolVersion} 无法处理。`,
        recoverable: false
      };
      return;
    }

    this.connected = true;
    this.repositoryUuid = message.repositoryUuid ?? this.repositoryUuid;
    this.scopeHash = message.scopeHash ?? this.scopeHash;
    this.moduleId = message.moduleId;
    this.taskId = message.taskId ?? defaultWorkbenchTask(message.moduleId);

    switch (message.type) {
      case 'app/initialize':
        this.scope = message.payload.scope;
        this.snapshot = message.payload.snapshot;
        this.loading = !message.payload.snapshot;
        this.error = undefined;
        break;
      case 'module/loading':
        this.loading = true;
        this.progress = undefined;
        this.notification = undefined;
        this.error = undefined;
        break;
      case 'module/snapshot':
        this.snapshot = message.payload.snapshot;
        this.loading = false;
        this.progress = undefined;
        this.error = undefined;
        break;
      case 'operation/error':
        this.loading = false;
        this.progress = undefined;
        this.error = message.payload;
        break;
      case 'operation/progress':
        this.progress = { ...message.payload, outputAvailable: message.payload.outputAvailable ?? true, startedAt: this.progress?.startedAt ?? Date.now() };
        break;
      case 'operation/result':
        message.payload.message = `${message.payload.message}${this.elapsedSuffix()}`;
        this.progress = undefined;
        this.notification = { tone: 'success', ...message.payload };
        break;
      case 'operation/cancelled':
        message.payload.message = `${message.payload.message}${this.elapsedSuffix()}`;
        this.progress = undefined;
        this.notification = { tone: 'warning', ...message.payload };
        break;
      case 'scope/changed':
        this.scope = message.payload.scope;
        break;
    }
  }

  private elapsedSuffix(): string {
    if (!this.progress) return '';
    return ` · 用时 ${Math.max(0, Math.round((Date.now() - this.progress.startedAt) / 1000))} 秒`;
  }
}
