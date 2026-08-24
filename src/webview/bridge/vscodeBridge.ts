import type {
  HostToWebviewMessage,
  WebviewToHostMessage,
} from "@protocol/workbenchProtocol";

interface VsCodeApi<State = unknown> {
  postMessage(message: WebviewToHostMessage): void;
  getState(): State | undefined;
  setState(next: State): void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: <State = unknown>() => VsCodeApi<State>;
    __SVN_WORKBENCH_MOCK__?: boolean;
  }
}

type MessageListener = (message: HostToWebviewMessage) => void;

const listeners = new Set<MessageListener>();
const vscodeApi = window.acquireVsCodeApi?.<Record<string, unknown>>();

/*
 * v0.1.0（V010-E）：window message 通道的最小结构过滤。
 * @pierre/diffs 编辑器的后台 tokenizer 用 globalThis.postMessage 自调度
 * （{type:"tokenize",...}），若不拦截会被误当成 Host 消息触发
 * “协议版本不兼容”而终止整个会话。只放行具备工作台信封结构
 * （字符串 type + 数值 protocolVersion 字段）的消息；真正的版本不匹配
 * （带 protocolVersion 但值不同）仍走既有的“协议版本不兼容”错误页。
 */
function isWorkbenchEnvelope(value: unknown): value is HostToWebviewMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string" &&
    typeof (value as { protocolVersion?: unknown }).protocolVersion === "number"
  );
}

window.addEventListener(
  "message",
  (event: MessageEvent<HostToWebviewMessage>) => {
    if (!isWorkbenchEnvelope(event.data)) return;
    for (const listener of listeners) {
      listener(event.data);
    }
  },
);

export const workbenchBridge = {
  isMock: !vscodeApi,
  post(message: WebviewToHostMessage): void {
    if (vscodeApi) {
      vscodeApi.postMessage(message);
      return;
    }
    window.dispatchEvent(
      new CustomEvent("svn-workbench:mock-action", { detail: message }),
    );
  },
  subscribe(listener: MessageListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getState(): Record<string, unknown> | undefined {
    return vscodeApi?.getState();
  },
  setState(next: Record<string, unknown>): void {
    vscodeApi?.setState(next);
  },
  injectMock(message: HostToWebviewMessage): void {
    for (const listener of listeners) {
      listener(message);
    }
  },
};
