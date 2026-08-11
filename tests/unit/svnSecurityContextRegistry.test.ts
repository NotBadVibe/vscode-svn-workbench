import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SvnSecurityContextRegistry } from "../../src/security/svnSecurityContextRegistry";
import {
  resetSvnSecurityContextForTesting,
  resolveSvnSecurityContext,
} from "../../src/security/svnSecurityContext";

const rootA = path.resolve("/repo/a");
const rootB = path.resolve("/repo/b");

describe("SvnSecurityContextRegistry（0.0.5 多窗口安全语义）", () => {
  beforeEach(() => {
    resetSvnSecurityContextForTesting();
  });

  it("sync 合并语义：空会话不会覆盖其他窗口已写入的认证", () => {
    const registry = new SvnSecurityContextRegistry();
    registry.sync(rootA, {
      authentication: { username: "alice", password: "secret" },
    });
    // 另一个窗口（无会话凭据）同步，不应清掉 alice 的认证。
    registry.sync(rootA, {});
    expect(resolveSvnSecurityContext(rootA)?.authentication?.username).toBe(
      "alice",
    );
  });

  it("acquire/release 引用计数：最后一个窗口关闭才清除共享上下文", () => {
    const registry = new SvnSecurityContextRegistry();
    registry.acquire(rootA);
    registry.acquire(rootA);
    registry.sync(rootA, {
      authentication: { username: "alice", password: "secret" },
    });

    // 窗口 A 换范围/关闭：还有窗口 B 引用，上下文必须保留。
    registry.release(rootA);
    expect(resolveSvnSecurityContext(rootA)?.authentication).toBeDefined();

    // 窗口 B 关闭：最后一个引用消失，上下文清除。
    registry.release(rootA);
    expect(resolveSvnSecurityContext(rootA)).toBeUndefined();
  });

  it("不同仓库互不影响", () => {
    const registry = new SvnSecurityContextRegistry();
    registry.acquire(rootA);
    registry.acquire(rootB);
    registry.sync(rootA, {
      authentication: { username: "alice", password: "secret" },
    });
    registry.sync(rootB, {
      authentication: { username: "bob", password: "other" },
    });
    registry.release(rootA);
    expect(resolveSvnSecurityContext(rootA)).toBeUndefined();
    expect(resolveSvnSecurityContext(rootB)?.authentication?.username).toBe(
      "bob",
    );
  });

  it("clearAuthentication 清除认证并保留证书信任，同时广播失效事件", () => {
    const registry = new SvnSecurityContextRegistry();
    const listener = vi.fn();
    const subscription = registry.onDidInvalidate(listener);
    registry.sync(rootA, {
      authentication: { username: "alice", password: "secret" },
      certificateTrust: {
        host: "svn.example.test",
        fingerprint: "AA:BB",
        failures: ["unknown-ca"],
        scope: "once",
      },
    });
    registry.clearAuthentication(rootA);
    expect(resolveSvnSecurityContext(rootA)?.authentication).toBeUndefined();
    expect(resolveSvnSecurityContext(rootA)?.certificateTrust).toBeDefined();
    expect(listener).toHaveBeenCalledWith(rootA);
    subscription.dispose();
  });

  it("clearCertificateTrust 只清除证书信任并保留认证，不广播", () => {
    const registry = new SvnSecurityContextRegistry();
    const listener = vi.fn();
    registry.onDidInvalidate(listener);
    registry.sync(rootA, {
      authentication: { username: "alice", password: "secret" },
      certificateTrust: {
        host: "svn.example.test",
        fingerprint: "AA:BB",
        failures: ["unknown-ca"],
        scope: "once",
      },
    });
    registry.clearCertificateTrust(rootA);
    expect(resolveSvnSecurityContext(rootA)?.authentication?.username).toBe(
      "alice",
    );
    expect(resolveSvnSecurityContext(rootA)?.certificateTrust).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
  });

  it("release 到最后一个引用时广播失效事件", () => {
    const registry = new SvnSecurityContextRegistry();
    const listener = vi.fn();
    registry.onDidInvalidate(listener);
    registry.acquire(rootA);
    registry.release(rootA);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("对未持有引用的重复 release 是安全 no-op：不清除、不广播、不产生下溢", () => {
    const registry = new SvnSecurityContextRegistry();
    const listener = vi.fn();
    registry.onDidInvalidate(listener);
    // 从未 acquire 的仓库即使写入了上下文也不应被 release 误清除。
    registry.sync(rootB, {
      authentication: { username: "bob", password: "other" },
    });
    registry.release(rootB);
    registry.release(rootB);
    expect(resolveSvnSecurityContext(rootB)?.authentication?.username).toBe(
      "bob",
    );
    expect(listener).not.toHaveBeenCalled();

    // 已释放后再重复 release 同样安全。
    registry.acquire(rootA);
    registry.release(rootA);
    const before = listener.mock.calls.length;
    registry.release(rootA);
    registry.release(rootA);
    expect(listener.mock.calls.length).toBe(before);
    expect(resolveSvnSecurityContext(rootB)?.authentication?.username).toBe(
      "bob",
    );
  });
});
