import { randomUUID } from "node:crypto";
import { normalizePathIdentity } from "../scope/pathIdentity";

/**
 * v0.0.6 页内编辑 editToken 注册表（纯逻辑，可单测）。
 *
 * token 至少绑定：sessionId、moduleId + taskId、repositoryUuid、scopeHash、
 * 规范化目标身份、原始字节 hash、BASE hash/revision、TextDocument.version、
 * draftRevision、签发/到期时间。单次使用；过期、消耗、目标/范围/会话变化后失效。
 */

export const DEFAULT_EDIT_TOKEN_TTL_MS = 15 * 60 * 1000;

export interface DiffEditTokenBinding {
  sessionId: string;
  moduleId: "diff";
  taskId: "diff/working";
  repositoryUuid: string;
  scopeHash: string;
  targetId: string;
  targetPath: string;
  rawHash: string;
  baseHash: string;
  baseRevision: string;
  documentVersion: number;
  draftRevision: number;
  issuedAt: number;
  expiresAt: number;
}

export type ConsumeResult =
  | { ok: true; binding: DiffEditTokenBinding }
  | { ok: false; reason: "unknown" | "expired" };

export class DiffEditTokenRegistry {
  private readonly tokens = new Map<string, DiffEditTokenBinding>();
  private readonly byTarget = new Map<string, Set<string>>();

  issue(binding: Omit<DiffEditTokenBinding, "issuedAt" | "expiresAt">): string {
    const token = randomUUID();
    const now = Date.now();
    const full: DiffEditTokenBinding = {
      ...binding,
      issuedAt: now,
      expiresAt: now + DEFAULT_EDIT_TOKEN_TTL_MS,
    };
    this.tokens.set(token, full);
    const targets = this.byTarget.get(binding.targetId) ?? new Set<string>();
    targets.add(token);
    this.byTarget.set(binding.targetId, targets);
    return token;
  }

  /** 单次使用：消耗并返回绑定；已消耗/不存在返回 unknown。 */
  consume(token: string, now = Date.now()): ConsumeResult {
    const binding = this.tokens.get(token);
    if (binding === undefined) {
      return { ok: false, reason: "unknown" };
    }
    this.revoke(token);
    if (now > binding.expiresAt) {
      return { ok: false, reason: "expired" };
    }
    return { ok: true, binding };
  }

  /** 目标/范围/会话变化后使相关 token 全部失效。 */
  revoke(token: string): void {
    const binding = this.tokens.get(token);
    if (binding === undefined) return;
    this.tokens.delete(token);
    const targets = this.byTarget.get(binding.targetId);
    targets?.delete(token);
    if (targets?.size === 0) this.byTarget.delete(binding.targetId);
  }

  revokeAllForTarget(targetId: string): void {
    const targets = this.byTarget.get(targetId);
    if (targets === undefined) return;
    for (const token of [...targets]) this.revoke(token);
  }

  revokeAllForScope(scopeHash: string): void {
    for (const token of [...this.tokens.keys()]) {
      if (this.tokens.get(token)?.scopeHash === scopeHash) this.revoke(token);
    }
  }

  revokeAllForRepository(repositoryUuid: string): void {
    for (const token of [...this.tokens.keys()]) {
      if (this.tokens.get(token)?.repositoryUuid === repositoryUuid) {
        this.revoke(token);
      }
    }
  }

  revokeAllForSession(sessionId: string): void {
    for (const token of [...this.tokens.keys()]) {
      if (this.tokens.get(token)?.sessionId === sessionId) this.revoke(token);
    }
  }

  /** 目标文件外部/文档变化后按规范路径撤销（大小写敏感性与平台一致）。 */
  revokeAllForPath(targetPath: string): void {
    const wanted = normalizePathIdentity(targetPath);
    for (const binding of [...this.tokens.values()]) {
      if (normalizePathIdentity(binding.targetPath) === wanted) {
        this.revokeAllForTarget(binding.targetId);
        return;
      }
    }
  }

  size(): number {
    return this.tokens.size;
  }

  /** 是否存在绑定 targetId+sessionId 的未过期 token（不消耗）。 */
  hasActiveFor(targetId: string, sessionId: string, now = Date.now()): boolean {
    const targets = this.byTarget.get(targetId);
    if (targets === undefined) return false;
    for (const token of targets) {
      const binding = this.tokens.get(token);
      if (binding?.sessionId === sessionId && now <= binding.expiresAt) {
        return true;
      }
    }
    return false;
  }
}
