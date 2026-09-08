import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { WorkbenchController } from "../../src/extension/workbench/WorkbenchController";
import type { WorkbenchSession } from "../../src/extension/workbench/workbenchSession";
import { __resetWebviewPanels } from "../mocks/vscode";

/*
 * V024-R39/R40：项目总览 Host 动作。
 * - projects/retry-stats 非法目标（不在工作区/非 SVN）必须被 Host 拒绝，
 *   且错误可理解（中文原因 + 下一步）；
 * - projects/open-task 的 conflicts 直达该项目冲突任务，且每次只建单项目
 *   scope（不混合仓库 revision）；
 * - 未知任务类型同样拒绝，不静默吞掉。
 */

vi.mock("../../src/extension/workbench/WebviewAssetManifest", () => ({
  readWebviewAssets: async () => ({
    scriptUri: { toString: () => "mock-script" },
    styleUris: [],
    localResourceRoot: { fsPath: "/ext/dist/webview" },
  }),
}));

vi.mock("../../src/extension/workbench/renderWebviewShell", () => ({
  renderWebviewShell: () => "<html/>",
  renderWebviewBuildError: () => "<html/>",
}));

function makeContext() {
  return {
    secrets: { get: async () => undefined },
    extensionUri: { fsPath: "/ext" },
    subscriptions: [] as Array<{ dispose: () => void }>,
    workspaceState: {
      get: () => undefined,
      update: async () => undefined,
    },
  };
}

function createController(options?: {
  servedModule?: "changes" | "projects";
  onOpenInOtherWindow?: (request: unknown) => void | Promise<void>;
}) {
  const ruleService = {
    onDidInvalidate: () => ({ dispose: () => undefined }),
    getEffectiveRules: async () => undefined,
  };
  return new WorkbenchController(makeContext() as never, ruleService as never, {
    servedModule: options?.servedModule ?? "changes",
    onOpenInOtherWindow: options?.onOpenInOtherWindow,
  });
}

function fakeSession(): WorkbenchSession {
  return { moduleId: "projects", svnPath: "svn" } as WorkbenchSession;
}

type MutableWorkspace = {
  workspaceFolders: unknown;
};

function setWorkspaceFolders(folders: Array<{ name: string; fsPath: string }>) {
  (vscode.workspace as unknown as MutableWorkspace).workspaceFolders =
    folders.map((folder, index) => ({
      uri: { fsPath: folder.fsPath },
      name: folder.name,
      index,
    }));
}

function sendErrorSpy(controller: WorkbenchController) {
  return vi.spyOn(
    controller as unknown as {
      sendError: (
        moduleId: unknown,
        title: string,
        message: string,
        recoverable: boolean,
        requestId?: string,
      ) => Promise<void>;
    },
    "sendError",
  );
}

beforeEach(() => {
  __resetWebviewPanels();
  setWorkspaceFolders([]);
});

describe("项目统计重试守卫（V024-R39）", () => {
  it("目标不在工作区时拒绝并给出可理解的原因", async () => {
    setWorkspaceFolders([{ name: "a", fsPath: "/ws/a" }]);
    const controller = createController();
    const sendError = sendErrorSpy(controller);
    await (
      controller as unknown as {
        retryProjectStats: (
          session: WorkbenchSession,
          projectRoot: string | undefined,
          requestId?: string,
        ) => Promise<void>;
      }
    ).retryProjectStats(fakeSession(), "/ws/unknown", "req-1");
    expect(sendError).toHaveBeenCalledTimes(1);
    const [, title, message] = sendError.mock.calls[0];
    expect(title).toBe("无法重试项目统计");
    expect(message).toContain("不在当前工作区");
    sendError.mockRestore();
  });

  it("非 SVN 项目拒绝重试并指引打开文件夹或环境诊断", async () => {
    setWorkspaceFolders([{ name: "notes", fsPath: "/ws/notes" }]);
    const controller = createController();
    vi.spyOn(
      controller as unknown as {
        classifyFolderWorkingCopyBinding: (
          folderPath: string,
          svnPath: string | undefined,
        ) => Promise<string>;
      },
      "classifyFolderWorkingCopyBinding",
    ).mockResolvedValue("notSvn");
    const sendError = sendErrorSpy(controller);
    await (
      controller as unknown as {
        retryProjectStats: (
          session: WorkbenchSession,
          projectRoot: string | undefined,
          requestId?: string,
        ) => Promise<void>;
      }
    ).retryProjectStats(fakeSession(), "/ws/notes", "req-2");
    expect(sendError).toHaveBeenCalledTimes(1);
    const [, , message] = sendError.mock.calls[0];
    expect(message).toContain("不属于 SVN 工作副本");
    sendError.mockRestore();
  });
});

describe("项目任务直达（V024-R40）", () => {
  it("冲突数直达该项目冲突任务，且 scope 为单项目（不混合仓库）", async () => {
    setWorkspaceFolders([{ name: "app", fsPath: "/ws/app" }]);
    const seen: unknown[] = [];
    const controller = createController({
      onOpenInOtherWindow: (request: unknown) => {
        seen.push(request);
      },
    });
    const projectScope = {
      id: "scope-app",
      repositoryRoot: "/ws/app",
      roots: [],
    };
    vi.spyOn(
      controller as unknown as {
        buildProjectScope: (
          svnPath: string,
          folderPath: string,
        ) => Promise<unknown>;
      },
      "buildProjectScope",
    ).mockResolvedValue(projectScope);
    await (
      controller as unknown as {
        openProjectTask: (
          session: WorkbenchSession,
          projectRoot: string | undefined,
          task: string | undefined,
          requestId?: string,
        ) => Promise<void>;
      }
    ).openProjectTask(fakeSession(), "/ws/app", "conflicts", "req-3");
    expect(seen).toHaveLength(1);
    const request = seen[0] as {
      moduleId: string;
      taskId: string;
      scope: unknown;
    };
    expect(request.moduleId).toBe("conflicts");
    expect(request.taskId).toBe("conflicts/resolve");
    // 直达携带的 scope 就是该项目独立构建的 scope，不混入其他仓库。
    expect(request.scope).toBe(projectScope);
  });

  it("未知任务类型被拒绝且错误可理解", async () => {
    setWorkspaceFolders([{ name: "app", fsPath: "/ws/app" }]);
    const controller = createController();
    const sendError = sendErrorSpy(controller);
    await (
      controller as unknown as {
        openProjectTask: (
          session: WorkbenchSession,
          projectRoot: string | undefined,
          task: string | undefined,
          requestId?: string,
        ) => Promise<void>;
      }
    ).openProjectTask(fakeSession(), "/ws/app", "explode", "req-4");
    expect(sendError).toHaveBeenCalledTimes(1);
    const [, title, message] = sendError.mock.calls[0];
    expect(title).toBe("无法打开项目任务");
    expect(message).toContain("不受支持");
    sendError.mockRestore();
  });
});
