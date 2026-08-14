/** Minimal runtime facade for Vitest. Extension Host behavior is covered by @vscode/test-electron. */
import * as fs from "node:fs/promises";
import * as path from "node:path";

const testWorkspacePath = process.env.SVN_WORKBENCH_TEST_WORKSPACE;
export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
} as const;

export const FileType = {
  Unknown: 0,
  File: 1,
  Directory: 2,
  SymbolicLink: 64,
} as const;

export const Uri = {
  file: (fsPath: string) => ({ fsPath }),
  from: (parts: { scheme: string; path: string }) => ({
    ...parts,
    toString: () => `${parts.scheme}:${parts.path}`,
  }),
  joinPath: (base: { fsPath: string }, ...parts: string[]) => ({
    fsPath: path.join(base.fsPath, ...parts),
  }),
};

export const extensions = {
  getExtension: () => undefined,
};

export const commands = {
  getCommands: async () => [],
  executeCommand: async () => undefined,
};

export const ViewColumn = {
  One: 1,
  Active: 2,
  Beside: 3,
} as const;

export class Disposable {
  dispose(): void {
    /* no-op */
  }
}

export const env = {
  clipboard: { writeText: async () => undefined },
};

export interface MockWebviewPanel {
  title: string;
  webview: {
    postMessage: (message: unknown) => Promise<void>;
    onDidReceiveMessage: (callback: (message: unknown) => void) => Disposable;
    html: string;
  };
  /** 测试驱动：Webview 消息处理器（Host 注册后被捕获）。 */
  __onMessage?: (message: unknown) => unknown;
  reveal: () => void;
  dispose: () => void;
  onDidDispose: (callback: () => void) => Disposable;
  /** 测试触发面板关闭时调用。 */
  triggerDispose: () => void;
  disposed: boolean;
}

/** 已创建的 WebviewPanel 列表（按创建顺序），供控制器生命周期测试驱动关闭事件。 */
export const __webviewPanels: MockWebviewPanel[] = [];

export function __resetWebviewPanels(): void {
  __webviewPanels.length = 0;
}

export const window = {
  createOutputChannel: () => ({
    appendLine: () => undefined,
    show: () => undefined,
    dispose: () => undefined,
    clear: () => undefined,
    replace: () => undefined,
    append: () => undefined,
    name: "SVN 工作台",
  }),
  createWebviewPanel: (type: string, title: string): MockWebviewPanel => {
    const panel: MockWebviewPanel = {
      title,
      webview: {
        postMessage: async () => undefined,
        onDidReceiveMessage: (callback: (message: unknown) => void) => {
          panel.__onMessage = callback;
          return new Disposable();
        },
        html: "",
      },
      reveal: () => undefined,
      dispose: () => {
        panel.disposed = true;
        panel.triggerDispose();
      },
      onDidDispose: () => new Disposable(),
      triggerDispose: () => {
        /* 由 onDidDispose 覆写 */
      },
      disposed: false,
    };
    panel.onDidDispose = (callback: () => void) => {
      panel.triggerDispose = callback;
      return new Disposable();
    };
    __webviewPanels.push(panel);
    return panel;
  },
  showWarningMessage: async () => undefined,
  showInputBox: async () => undefined,
  showQuickPick: async () => undefined,
  showErrorMessage: async () => undefined,
  showInformationMessage: async () => undefined,
};

/** 供控制器测试向 workspace.registerTextDocumentContentProvider 注册的内容提供者。 */
export const __registeredContentProviders: Array<{
  scheme: string;
  provider: unknown;
}> = [];

export function __resetRegisteredContentProviders(): void {
  __registeredContentProviders.length = 0;
}

export const workspace = {
  workspaceFolders: testWorkspacePath
    ? [
        {
          uri: { fsPath: path.resolve(testWorkspacePath) },
          name: path.basename(testWorkspacePath),
          index: 0,
        },
      ]
    : undefined,
  getConfiguration: () => ({
    get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
    update: async () => undefined,
    inspect: () => undefined,
  }),
  registerTextDocumentContentProvider: (scheme: string, provider: unknown) => {
    __registeredContentProviders.push({ scheme, provider });
    return new Disposable();
  },
  /** SCM 管理器单测可注入的 findFiles 结果（默认无嵌套工作副本）。 */
  findFiles: async () => __findFilesResults.shift() ?? [],
  onDidChangeWorkspaceFolders: () => new Disposable(),
  onDidSaveTextDocument: () => new Disposable(),
  onDidCreateFiles: () => new Disposable(),
  onDidDeleteFiles: () => new Disposable(),
  onDidRenameFiles: () => new Disposable(),
  fs: {
    stat: async (uri: { fsPath: string }) => {
      const value = await fs.stat(uri.fsPath);
      return { type: value.isDirectory() ? FileType.Directory : FileType.File };
    },
  },
};

/** findFiles 的队列式返回（每个元素对应一次调用）。 */
export const __findFilesResults: Array<Array<{ fsPath: string }>> = [];

export class RelativePattern {
  constructor(
    public readonly base: unknown,
    public readonly pattern: string,
  ) {}
}

export interface MockSourceControl {
  id: string;
  label: string;
  rootUri?: { fsPath: string };
  count: number;
  acceptInputCommand?: unknown;
  statusBarCommands?: unknown;
  groups: Map<string, { resourceStates: unknown[]; label: string }>;
  createResourceGroup: (
    id: string,
    label: string,
  ) => { resourceStates: unknown[]; label: string };
  dispose: () => void;
  disposed: boolean;
}

/** 已创建的 SCM provider（按创建顺序），供 SCM 管理器单测断言。 */
export const __sourceControls: MockSourceControl[] = [];

export function __resetSourceControls(): void {
  __sourceControls.length = 0;
  __findFilesResults.length = 0;
}

export const scm = {
  createSourceControl: (
    id: string,
    label: string,
    rootUri?: { fsPath: string },
  ): MockSourceControl => {
    const control: MockSourceControl = {
      id,
      label,
      rootUri,
      count: 0,
      groups: new Map(),
      createResourceGroup: (groupId: string, groupLabel: string) => {
        const group = { resourceStates: [] as unknown[], label: groupLabel };
        control.groups.set(groupId, group);
        return group;
      },
      dispose: () => {
        control.disposed = true;
      },
      disposed: false,
    };
    __sourceControls.push(control);
    return control;
  },
};
