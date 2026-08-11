import * as vscode from "vscode";
import {
  clearSvnSecurityContext,
  normalizeSvnRepositoryRoot,
  resolveSvnSecurityContext,
  setSvnSecurityContext,
  type SvnSecurityContext,
} from "./svnSecurityContext";

/**
 * 0.0.5 多窗口共享的 SVN 安全上下文注册表。
 *
 * 语义：
 * - 按 repository identity（repositoryRoot 归一化键）管理认证与证书信任上下文；
 * - 窗口创建会话时 `acquire`，会话被替换或面板关闭时 `release`；
 *   仅当该仓库最后一个引用消失时才清除共享上下文，保证“窗口关闭或换范围
 *   不得清除其他窗口正在使用的认证和证书信任上下文”；
 * - `sync` 采用合并语义：未提供的字段保留既有值，避免空会话覆盖其他窗口的凭据；
 * - 显式清除（清除认证 / 临时证书信任结束）通过 `clearAuthentication` /
 *   `clearCertificateTrust`；`clearAuthentication` 向相关窗口广播 invalidation 事件；
 * - 存储写穿到模块级 `svnSecurityContext` 映射，`SvnCommandRunner` 无需改动。
 */
export class SvnSecurityContextRegistry {
  private readonly refCounts = new Map<string, number>();
  private readonly listeners = new Set<(repositoryRoot: string) => void>();

  /** 窗口会话登记对该仓库上下文的引用。 */
  acquire(repositoryRoot: string): void {
    const key = normalizeSvnRepositoryRoot(repositoryRoot);
    this.refCounts.set(key, (this.refCounts.get(key) ?? 0) + 1);
  }

  /**
   * 窗口会话释放对该仓库上下文的引用；最后一个引用消失时清除共享上下文并广播。
   * 对未持有引用的重复调用是安全 no-op：不清除、不广播，也不产生下溢。
   */
  release(repositoryRoot: string): void {
    const key = normalizeSvnRepositoryRoot(repositoryRoot);
    const current = this.refCounts.get(key);
    if (current === undefined || current <= 0) {
      return;
    }
    const next = current - 1;
    if (next === 0) {
      this.refCounts.delete(key);
      clearSvnSecurityContext(key);
      this.emitInvalidation(key);
    } else {
      this.refCounts.set(key, next);
    }
  }

  /** 合并式同步：仅覆盖提供的字段；未提供的字段保留仓库既有值。 */
  sync(repositoryRoot: string, context: SvnSecurityContext): void {
    const key = normalizeSvnRepositoryRoot(repositoryRoot);
    const existing = resolveSvnSecurityContext(key);
    const merged: SvnSecurityContext = {
      authentication: context.authentication ?? existing?.authentication,
      certificateTrust: context.certificateTrust ?? existing?.certificateTrust,
    };
    setSvnSecurityContext(key, merged);
  }

  /** 显式清除某仓库的认证上下文（用户清除凭据）；向相关窗口广播明确事件。 */
  clearAuthentication(repositoryRoot: string): void {
    const key = normalizeSvnRepositoryRoot(repositoryRoot);
    const existing = resolveSvnSecurityContext(key);
    setSvnSecurityContext(key, {
      certificateTrust: existing?.certificateTrust,
    });
    this.emitInvalidation(key);
  }

  /** 临时证书信任使用完毕后清除（保留认证），不广播（属会话内瞬时状态）。 */
  clearCertificateTrust(repositoryRoot: string): void {
    const key = normalizeSvnRepositoryRoot(repositoryRoot);
    const existing = resolveSvnSecurityContext(key);
    setSvnSecurityContext(key, { authentication: existing?.authentication });
  }

  /** 供 SVN 命令解析：与模块级 `resolveSvnSecurityContext` 一致。 */
  resolve(cwd?: string): SvnSecurityContext | undefined {
    return resolveSvnSecurityContext(cwd);
  }

  /** 订阅安全上下文失效事件（repositoryRoot 为归一化键）。 */
  onDidInvalidate(
    listener: (repositoryRoot: string) => void,
  ): vscode.Disposable {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  /** 测试辅助：重置引用计数，不触碰模块级上下文。 */
  resetForTesting(): void {
    this.refCounts.clear();
  }

  private emitInvalidation(repositoryRoot: string): void {
    for (const listener of this.listeners) {
      listener(repositoryRoot);
    }
  }
}
