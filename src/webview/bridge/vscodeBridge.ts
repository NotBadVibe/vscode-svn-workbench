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

window.addEventListener(
  "message",
  (event: MessageEvent<HostToWebviewMessage>) => {
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
