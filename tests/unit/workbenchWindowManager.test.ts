import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { WorkbenchModuleId } from "../../src/protocol/workbenchProtocol";
import type { OpenWorkbenchRequest } from "../../src/extension/workbench/workbenchSession";
import {
  WorkbenchWindowManager,
  type ModuleWindow,
} from "../../src/extension/workbench/workbenchWindowManager";

const repositoryRoot = path.resolve("/repo");
const scope = {
  id: "scope",
  repositoryRoot,
  source: "editorFile" as const,
  roots: [
    {
      absolutePath: path.join(repositoryRoot, "src"),
      relativePath: "src",
      kind: "folder" as const,
    },
  ],
  allowExpandScope: false,
  includeExternals: false,
  includeNestedWorkingCopies: false,
  createdAt: 0,
};

function openRequest(
  moduleId: WorkbenchModuleId,
  overrides: Partial<OpenWorkbenchRequest> = {},
): OpenWorkbenchRequest {
  return {
    moduleId,
    svnPath: "svn",
    scope,
    ...overrides,
  };
}

class FakeWindow implements ModuleWindow {
  isDisposed = false;
  disposeCount = 0;
  readonly openCalls: OpenWorkbenchRequest[] = [];
  readonly routeToOther: (request: OpenWorkbenchRequest) => Promise<void>;
  readonly handleSecurityInvalidated = vi.fn();
  readonly openNativeDiffInEditor = vi.fn(async () => undefined);

  constructor(
    public readonly moduleId: WorkbenchModuleId,
    routing: {
      onOpenInOtherWindow: (request: OpenWorkbenchRequest) => Promise<void>;
    },
  ) {
    this.routeToOther = routing.onOpenInOtherWindow;
  }

  async open(request: OpenWorkbenchRequest): Promise<void> {
    this.openCalls.push(request);
    // 模拟控制器行为：非本模块请求转发给窗口管理器（跨模块路由）。
    if (request.moduleId !== this.moduleId) {
      await this.routeToOther(request);
    }
  }

  dispose(): void {
    this.isDisposed = true;
    this.disposeCount += 1;
  }
}

function createManager(): {
  manager: WorkbenchWindowManager;
  created: FakeWindow[];
} {
  const created: FakeWindow[] = [];
  const manager = new WorkbenchWindowManager({} as never, {} as never, {
    createWindow: (moduleId, routing) => {
      const window = new FakeWindow(moduleId, routing);
      created.push(window);
      return window;
    },
  });
  return { manager, created };
}

describe("WorkbenchWindowManager（0.0.5 按模块窗口管理）", () => {
  it("按模块惰性创建独立窗口", async () => {
    const { manager, created } = createManager();
    expect(manager.hasController("changes")).toBe(false);
    await manager.open(openRequest("changes"));
    expect(manager.hasController("changes")).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0].moduleId).toBe("changes");
  });

  it("同模块单例复用：重复打开不重建窗口，仅传入新目标", async () => {
    const { manager, created } = createManager();
    await manager.open(openRequest("commit", { taskId: "commit/compose" }));
    await manager.open(openRequest("commit", { taskId: "commit/compose" }));
    expect(created).toHaveLength(1);
    expect(created[0].openCalls).toHaveLength(2);
  });

  it("不同模块互不顶替：各自持有独立窗口", async () => {
    const { manager, created } = createManager();
    await manager.open(openRequest("changes"));
    await manager.open(openRequest("commit"));
    await manager.open(openRequest("diff"));
    expect(created).toHaveLength(3);
    expect(new Set(created.map((window) => window.moduleId))).toEqual(
      new Set(["changes", "commit", "diff"]),
    );
  });

  it("窗口关闭（已释放）后按需重建", async () => {
    const { manager, created } = createManager();
    await manager.open(openRequest("changes"));
    created[0].dispose();
    await manager.open(openRequest("changes"));
    expect(created).toHaveLength(2);
    expect(manager.hasController("changes")).toBe(true);
  });

  it("跨模块打开经窗口管理器路由到目标模块窗口", async () => {
    const { manager, created } = createManager();
    // Changes 窗口内发起跨模块动作 → 路由到 commit 窗口。
    await manager.open(openRequest("changes"));
    await created[0].open(openRequest("commit", { taskId: "commit/compose" }));
    expect(created).toHaveLength(2);
    expect(created[1].moduleId).toBe("commit");
    expect(created[1].openCalls[0].moduleId).toBe("commit");
  });

  it("openNativeDiffInEditor 转发给独立 Diff 窗口；无 Diff 会话时明确报错", async () => {
    const { manager } = createManager();
    await expect(manager.openNativeDiffInEditor()).rejects.toThrow(
      /没有可用的 SVN Diff 会话/,
    );
    await manager.open(openRequest("diff"));
    await expect(manager.openNativeDiffInEditor("request-id")).resolves.toBe(
      undefined,
    );
  });

  it("dispose 统一释放全部窗口且可重复调用", async () => {
    const { manager, created } = createManager();
    await manager.open(openRequest("changes"));
    await manager.open(openRequest("commit"));
    manager.dispose();
    expect(created.every((window) => window.isDisposed)).toBe(true);
    expect(created.reduce((sum, window) => sum + window.disposeCount, 0)).toBe(
      2,
    );
    manager.dispose();
    expect(created.reduce((sum, window) => sum + window.disposeCount, 0)).toBe(
      2,
    );
  });
});
