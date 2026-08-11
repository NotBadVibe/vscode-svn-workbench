import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchController } from "../../src/extension/workbench/WorkbenchController";
import { SvnSecurityContextRegistry } from "../../src/security/svnSecurityContextRegistry";
import {
  normalizeSvnRepositoryRoot,
  resetSvnSecurityContextForTesting,
  resolveSvnSecurityContext,
} from "../../src/security/svnSecurityContext";
import type { WorkbenchModuleId } from "../../src/protocol/workbenchProtocol";
import type { OperationScope } from "../../src/scope/operationScope";
import {
  __resetRegisteredContentProviders,
  __resetWebviewPanels,
  __webviewPanels,
} from "../mocks/vscode";

/**
 * 凭据读取闸门：在 refreshSessionSecurity 的 `await readStoredSvnCredential`
 * 处挂起，用于验证异步读取期间会话切换/关闭时，陈旧会话不会回写安全上下文。
 *
 * 三个相互独立、互不清空的操作：
 * - `setIntercept`：控制“未来读取”是否被拦截挂起（不触碰当前已挂起的读取）；
 * - `hangRead`：登记一次挂起读取，返回可被测试 await 的 Promise；
 * - `release`：真实放行当前已挂起的读取（resolve 其 Promise）并记录 settled。
 * `reset` 仅在 beforeEach 清理：停止拦截，若仍有未决挂起则放行，避免遗留未决 Promise。
 */
const credentialGate = vi.hoisted(() => {
  let intercept = false;
  let current:
    | { promise: Promise<unknown>; resolve: (value: unknown) => void }
    | undefined;
  let settledCount = 0;
  return {
    setIntercept: (value: boolean) => {
      intercept = value;
    },
    shouldIntercept: () => intercept,
    /** 登记一次挂起读取并返回其 Promise（同时暴露给测试）。 */
    hangRead: () => {
      let resolve!: (value: unknown) => void;
      const promise = new Promise<unknown>((res) => {
        resolve = res;
      });
      current = { promise, resolve };
      return promise;
    },
    /** 当前是否已有挂起的读取。 */
    hasPending: () => current !== undefined,
    /** 当前挂起读取的 Promise；测试 await 它以确认真实放行完成。 */
    currentPromise: () => current?.promise,
    /**
     * 真实放行当前挂起读取并 resolve 为陈旧凭据；返回是否确实放行了。
     * 放行后 refreshSessionSecurity 的续延微任务会先于测试的 await 排队执行。
     */
    release: (value?: unknown) => {
      if (!current) {
        return false;
      }
      const pending = current;
      current = undefined;
      settledCount += 1;
      pending.resolve(
        value ?? {
          username: "stale-user",
          password: "stale-password",
        },
      );
      return true;
    },
    /** 已真实放行的次数（证明 Promise 确实被 resolve）。 */
    settledCount: () => settledCount,
    /** beforeEach 清理：停止拦截、归零计数；若有未决挂起则放行，不留遗留未决 Promise。 */
    reset: () => {
      intercept = false;
      settledCount = 0;
      if (current) {
        current.resolve(undefined);
        current = undefined;
      }
    },
  };
});

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

vi.mock(
  "../../src/extension/workbench/workbenchSupport",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../src/extension/workbench/workbenchSupport")
      >();
    return {
      ...actual,
      resolveRepositoryUuid: async () => "test-repository-uuid",
    };
  },
);

vi.mock("../../src/security/svnCredentialStore", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/security/svnCredentialStore")
    >();
  return {
    ...actual,
    // 注意：不能声明为 async，否则返回值会被再包一层 Promise，导致测试 await
    // hangRead 的原始 Promise 时 refreshSessionSecurity 的续延尚未执行，产生假阳性。
    readStoredSvnCredential: (secrets: unknown, repositoryIdentity: string) => {
      if (credentialGate.shouldIntercept()) {
        // 挂起读取：Promise 由 gate.release() 真实 resolve（返回“陈旧”凭据）。
        return credentialGate.hangRead();
      }
      return actual.readStoredSvnCredential(secrets, repositoryIdentity);
    },
  };
});

function makeScope(repositoryRoot: string): OperationScope {
  return {
    id: "scope",
    repositoryRoot,
    source: "editorFile",
    roots: [
      {
        absolutePath: path.join(repositoryRoot, "src"),
        relativePath: "src",
        kind: "folder",
      },
    ],
    allowExpandScope: false,
    includeExternals: false,
    includeNestedWorkingCopies: false,
    createdAt: 0,
  };
}

function makeContext(): {
  secrets: { get: (key: string) => Promise<string | undefined> };
  extensionUri: { fsPath: string };
  subscriptions: Array<{ dispose: () => void }>;
} {
  return {
    secrets: { get: async () => undefined },
    extensionUri: { fsPath: "/ext" },
    subscriptions: [],
  };
}

function createController(
  moduleId: WorkbenchModuleId,
  registry: SvnSecurityContextRegistry,
): WorkbenchController {
  const ruleService = {
    onDidInvalidate: () => ({ dispose: () => undefined }),
  };
  return new WorkbenchController(makeContext() as never, ruleService as never, {
    servedModule: moduleId,
    securityRegistry: registry,
  });
}

function openRequest(moduleId: WorkbenchModuleId, scope: OperationScope) {
  return { moduleId, svnPath: "svn", scope };
}

/**
 * repository identity 归一化键（与注册表/管理器广播一致）。
 * 生产路径中窗口管理器把注册表的归一化失效事件原样转发给控制器；
 * 测试直接调用 handleSecurityInvalidated 时必须使用同一归一化键，
 * 否则 Windows 下盘符大小写差异会导致事件不命中（POSIX 恰好相等）。
 */
function repoKey(repositoryRoot: string): string {
  return normalizeSvnRepositoryRoot(repositoryRoot);
}

describe("WorkbenchController 安全上下文生命周期（0.0.5 修复）", () => {
  beforeEach(() => {
    resetSvnSecurityContextForTesting();
    __resetWebviewPanels();
    __resetRegisteredContentProviders();
    credentialGate.reset();
    vi.restoreAllMocks();
  });

  it("同窗口同仓库重复 open 只 acquire 一次，关闭后引用归零且上下文清除", async () => {
    const registry = new SvnSecurityContextRegistry();
    const acquire = vi.spyOn(registry, "acquire");
    const release = vi.spyOn(registry, "release");
    const controller = createController("changes", registry);
    const scope = makeScope("/repo/a");

    for (let index = 0; index < 3; index += 1) {
      await controller.open(openRequest("changes", scope));
    }
    // 一控制器最多持有一个引用：同仓库重开不重复 acquire。
    expect(acquire).toHaveBeenCalledTimes(1);

    registry.sync("/repo/a", {
      authentication: { username: "alice", password: "secret" },
    });
    expect(resolveSvnSecurityContext("/repo/a")?.authentication).toBeDefined();

    // 关闭窗口：恰好 release 一次，最后一个引用消失后上下文被清除。
    __webviewPanels[0].triggerDispose();
    expect(release).toHaveBeenCalledTimes(1);
    expect(resolveSvnSecurityContext("/repo/a")).toBeUndefined();

    controller.dispose();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("两个窗口同仓库：关闭一个不清除，关闭最后一个才清除", async () => {
    const registry = new SvnSecurityContextRegistry();
    const controllerA = createController("changes", registry);
    const controllerB = createController("commit", registry);
    const scope = makeScope("/repo/a");

    await controllerA.open(openRequest("changes", scope));
    await controllerB.open(openRequest("commit", scope));
    registry.sync("/repo/a", {
      authentication: { username: "alice", password: "secret" },
    });

    // 关闭窗口 A：窗口 B 仍在引用，上下文必须保留。
    __webviewPanels[0].triggerDispose();
    expect(resolveSvnSecurityContext("/repo/a")?.authentication).toBeDefined();

    // 关闭窗口 B：最后一个引用消失，上下文清除。
    __webviewPanels[1].triggerDispose();
    expect(resolveSvnSecurityContext("/repo/a")).toBeUndefined();
  });

  it("换仓库准确 release 旧引用并 acquire 新引用", async () => {
    const registry = new SvnSecurityContextRegistry();
    const acquire = vi.spyOn(registry, "acquire");
    const release = vi.spyOn(registry, "release");
    const controller = createController("changes", registry);

    await controller.open(openRequest("changes", makeScope("/repo/a")));
    await controller.open(openRequest("changes", makeScope("/repo/b")));
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(1);

    // 同仓库重开回到 a：a 已被释放且未重新登记，因此再 acquire 一次。
    await controller.open(openRequest("changes", makeScope("/repo/a")));
    expect(acquire).toHaveBeenCalledTimes(3);
    expect(release).toHaveBeenCalledTimes(2);

    // 关闭后 a 的上下文清除。
    registry.sync("/repo/a", {
      authentication: { username: "alice", password: "secret" },
    });
    __webviewPanels[0].triggerDispose();
    expect(release).toHaveBeenCalledTimes(3);
    expect(resolveSvnSecurityContext("/repo/a")).toBeUndefined();
  });

  it("面板关闭后 dispose、重复 dispose 不重复释放；注册表重复 release 是安全 no-op", async () => {
    const registry = new SvnSecurityContextRegistry();
    const release = vi.spyOn(registry, "release");
    const invalidate = vi.fn();
    registry.onDidInvalidate(invalidate);

    // 场景 1：面板先关闭，扩展停用时再 dispose → 只 release 一次。
    const controller = createController("changes", registry);
    await controller.open(openRequest("changes", makeScope("/repo/a")));
    registry.sync("/repo/a", {
      authentication: { username: "alice", password: "secret" },
    });
    __webviewPanels[0].triggerDispose();
    expect(release).toHaveBeenCalledTimes(1);
    controller.dispose();
    expect(release).toHaveBeenCalledTimes(1);
    expect(resolveSvnSecurityContext("/repo/a")).toBeUndefined();

    // 场景 2：直接 dispose 两次 → 只 release 一次（无下溢、无重复广播）。
    const controllerB = createController("commit", registry);
    await controllerB.open(openRequest("commit", makeScope("/repo/b")));
    registry.sync("/repo/b", {
      authentication: { username: "bob", password: "other" },
    });
    controllerB.dispose();
    controllerB.dispose();
    expect(release).toHaveBeenCalledTimes(2);
    expect(resolveSvnSecurityContext("/repo/b")).toBeUndefined();

    // 场景 3：对从未持有的仓库重复 release → 不清除、不广播其他有效上下文。
    registry.acquire("/repo/c");
    registry.sync("/repo/c", {
      authentication: { username: "carol", password: "third" },
    });
    const invalidationsBefore = invalidate.mock.calls.length;
    registry.release("/repo/d");
    registry.release("/repo/d");
    expect(resolveSvnSecurityContext("/repo/c")?.authentication?.username).toBe(
      "carol",
    );
    expect(resolveSvnSecurityContext("/repo/d")).toBeUndefined();
    // 重复 release 未持有引用：不产生新的失效广播（此前 1 次属于合法释放）。
    expect(invalidate.mock.calls.length).toBe(invalidationsBefore);
  });

  it("SecretStorage 异步读取期间面板关闭，陈旧会话不写回已清除的上下文", async () => {
    const registry = new SvnSecurityContextRegistry();
    const sync = vi.spyOn(registry, "sync");
    const controller = createController("changes", registry);
    const scope = makeScope("/repo/a");
    await controller.open(openRequest("changes", scope));
    registry.sync("/repo/a", {
      authentication: { username: "alice", password: "secret" },
    });
    const syncCallsForRepoA = () =>
      sync.mock.calls.filter(([root]) => root === "/repo/a").length;
    const syncBefore = syncCallsForRepoA();

    // 触发失效刷新，并在凭据读取处挂起；先确认读取已真正进入挂起状态。
    // 使用与注册表广播一致的归一化身份键（Windows 下盘符大小写已归一化）。
    credentialGate.setIntercept(true);
    controller.handleSecurityInvalidated(repoKey("/repo/a"));
    expect(credentialGate.hasPending()).toBe(true);
    const hungRead = credentialGate.currentPromise();
    expect(hungRead).toBeDefined();

    // 停止拦截未来读取（不影响已挂起的读取），然后面板关闭：release + 清除上下文。
    credentialGate.setIntercept(false);
    __webviewPanels[0].triggerDispose();
    expect(resolveSvnSecurityContext("/repo/a")).toBeUndefined();

    // 真实放行挂起读取（resolve 为“陈旧”凭据），并等待其 settled：
    // 读取 resolve 时 refreshSessionSecurity 的续延微任务先于本测试的 await 排队，
    // 因此 await hungRead 返回后，写回前校验已经执行并返回。
    expect(
      credentialGate.release({
        username: "stale-user",
        password: "stale-password",
      }),
    ).toBe(true);
    await hungRead;
    expect(credentialGate.settledCount()).toBe(1);
    expect(credentialGate.hasPending()).toBe(false);

    // 陈旧会话未 sync 回 /repo/a（写回前校验已拦截），上下文保持清除。
    expect(syncCallsForRepoA()).toBe(syncBefore);
    expect(resolveSvnSecurityContext("/repo/a")).toBeUndefined();
  });

  it("SecretStorage 异步读取期间切换仓库，陈旧会话不写回旧仓库", async () => {
    const registry = new SvnSecurityContextRegistry();
    const sync = vi.spyOn(registry, "sync");
    const controller = createController("changes", registry);
    await controller.open(openRequest("changes", makeScope("/repo/a")));
    registry.sync("/repo/a", {
      authentication: { username: "alice", password: "secret" },
    });
    const syncCallsForRepoA = () =>
      sync.mock.calls.filter(([root]) => root === "/repo/a").length;
    const syncBefore = syncCallsForRepoA();

    // 挂起读取并确认进入挂起状态（使用归一化身份键，跨平台一致）。
    credentialGate.setIntercept(true);
    controller.handleSecurityInvalidated(repoKey("/repo/a"));
    expect(credentialGate.hasPending()).toBe(true);
    const hungRead = credentialGate.currentPromise();
    expect(hungRead).toBeDefined();

    // 停止拦截，挂起期间切换到仓库 B：release A、acquire B。
    credentialGate.setIntercept(false);
    await controller.open(openRequest("changes", makeScope("/repo/b")));
    registry.sync("/repo/b", {
      authentication: { username: "bob", password: "other" },
    });
    expect(resolveSvnSecurityContext("/repo/a")).toBeUndefined();

    // 真实放行挂起读取并等待 settled（续延已完成写回前校验）。
    expect(
      credentialGate.release({
        username: "stale-user",
        password: "stale-password",
      }),
    ).toBe(true);
    await hungRead;
    expect(credentialGate.settledCount()).toBe(1);
    expect(credentialGate.hasPending()).toBe(false);

    // 陈旧会话未 sync 回旧仓库 A，仓库 B 保持有效。
    expect(syncCallsForRepoA()).toBe(syncBefore);
    expect(resolveSvnSecurityContext("/repo/a")).toBeUndefined();
    expect(resolveSvnSecurityContext("/repo/b")?.authentication?.username).toBe(
      "bob",
    );
  });
});
