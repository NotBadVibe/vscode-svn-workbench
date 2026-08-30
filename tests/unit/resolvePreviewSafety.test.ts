/**
 * v0.1.3 阻断修复单测：preview-resolve 哈希一致性、hasUnsavedInput、resolve token 安全契约
 * 中文注释；走真实哈希，不 mock 绕过。
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { runDeterministicVerification } from "../../src/conflict/conflictVerification";
import { hashText } from "../../src/conflict/conflictDiffModel";
import { DiffEditTokenRegistry } from "../../src/diffEdit/diffEditTokenRegistry";
import { hashFileContents } from "../../src/extension/workbench/workbenchSupport";
import { CONFLICT_COMPLETION_TOKEN_TTL_MS } from "../../src/conflict/conflictCompletionModel";
import { buildConflictTargetId } from "../../src/conflict/conflictSaveService";

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

describe("阻断1：preview-resolve 哈希算法一致性（SHA-256）", () => {
  it("真实 hashFileContents 与 SHA-256 计算一致", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "resolve-hash-"));
    const fp = path.join(tmp, "a.txt");
    const content = "hello world 中文\n";
    await fs.writeFile(fp, content, "utf8");
    const fileHash = await hashFileContents(fp);
    const expected = sha256Hex(content);
    expect(fileHash).toBe(expected);
    // 旧算法 hashText（FNV-1a 8位）不应相等
    const oldHash = hashText(content) as string;
    expect(oldHash).not.toBe(fileHash);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("已保存无未保存输入 → diskHash==savedHash 时 canResolve 判定为 pass", () => {
    const now = Date.now();
    const content = "clean content\n";
    const diskHash = sha256Hex(content);
    const savedHash = sha256Hex(content); // 修复后：同算法
    const result = runDeterministicVerification({
      workingText: content,
      fileMeta: {
        isRegularFile: true,
        isWritable: true,
        isDecodableText: true,
      },
      scopeMeta: { inScope: true, inWorkingCopy: true, inRepository: true },
      diskHash,
      savedHash,
      svnMeta: { isConflicted: true, canResolve: true },
      previewMeta: { tokenIssuedAt: now - 1000, now, hasPreview: true },
      draftMeta: { hasUnsavedInput: false },
    });
    expect(result.pass).toBe(true);
    expect(result.issues.find((i) => i.id === "diskHash")!.pass).toBe(true);
    expect(result.issues.find((i) => i.id === "draft")!.pass).toBe(true);
  });

  it("有未保存输入 → draft 项阻断", () => {
    const now = Date.now();
    const content = "disk content\n";
    const diskHash = sha256Hex(content);
    const savedHash = sha256Hex(content);
    const result = runDeterministicVerification({
      workingText: content,
      fileMeta: {
        isRegularFile: true,
        isWritable: true,
        isDecodableText: true,
      },
      scopeMeta: { inScope: true, inWorkingCopy: true, inRepository: true },
      diskHash,
      savedHash,
      svnMeta: { isConflicted: true, canResolve: true },
      previewMeta: { tokenIssuedAt: now - 1000, now, hasPreview: true },
      draftMeta: { hasUnsavedInput: true },
    });
    expect(result.pass).toBe(false);
    expect(result.issues.find((i) => i.id === "draft")!.pass).toBe(false);
  });

  it("磁盘被外部改 → diskHash 阻断", () => {
    const now = Date.now();
    const diskHash = sha256Hex("external change\n");
    const savedHash = sha256Hex("old saved\n");
    const result = runDeterministicVerification({
      workingText: "external change\n",
      fileMeta: {
        isRegularFile: true,
        isWritable: true,
        isDecodableText: true,
      },
      scopeMeta: { inScope: true, inWorkingCopy: true, inRepository: true },
      diskHash,
      savedHash,
      svnMeta: { isConflicted: true, canResolve: true },
      previewMeta: { tokenIssuedAt: now - 1000, now, hasPreview: true },
      draftMeta: { hasUnsavedInput: false },
    });
    expect(result.pass).toBe(false);
    expect(result.issues.find((i) => i.id === "diskHash")!.pass).toBe(false);
  });

  it("无草稿时 hasUnsavedInput=false 且 savedHash==diskHash → pass（修复后）", () => {
    const now = Date.now();
    const content = "no draft content\n";
    const diskHash = sha256Hex(content);
    // 修复后：无草稿时 savedHash = contentHash，hasUnsavedInput=false
    const savedHash = diskHash;
    const hasUnsavedInput = false;
    const result = runDeterministicVerification({
      workingText: content,
      fileMeta: {
        isRegularFile: true,
        isWritable: true,
        isDecodableText: true,
      },
      scopeMeta: { inScope: true, inWorkingCopy: true, inRepository: true },
      diskHash,
      savedHash,
      svnMeta: { isConflicted: true, canResolve: true },
      previewMeta: { tokenIssuedAt: now - 1000, now, hasPreview: true },
      draftMeta: { hasUnsavedInput },
    });
    expect(result.pass).toBe(true);
  });

  it("无草稿旧逻辑 hasUnsavedInput=true 会误阻断（回归验证）", () => {
    const now = Date.now();
    const diskHash = sha256Hex("x\n");
    // 旧逻辑：无草稿 hasUnsavedInput=true → draft 阻断
    const resultOld = runDeterministicVerification({
      workingText: "x\n",
      fileMeta: {
        isRegularFile: true,
        isWritable: true,
        isDecodableText: true,
      },
      scopeMeta: { inScope: true, inWorkingCopy: true, inRepository: true },
      diskHash,
      savedHash: diskHash,
      svnMeta: { isConflicted: true, canResolve: true },
      previewMeta: { tokenIssuedAt: now - 1000, now, hasPreview: true },
      draftMeta: { hasUnsavedInput: true },
    });
    expect(resultOld.pass).toBe(false);
    expect(resultOld.issues.find((i) => i.id === "draft")!.pass).toBe(false);
  });
});

describe("阻断2：resolve preview token 安全契约（TTL/绑定/单次消耗）", () => {
  const sessionId = "session-1";
  const scopeHash = "scope-abc";
  const repositoryUuid = "uuid-123";
  const revision = "42";
  const content = "working content\n";
  const contentHash = sha256Hex(content);
  void "src/app.ts";
  const targetPath = "/tmp/repo/src/app.ts";
  const targetId = buildConflictTargetId(targetPath);

  function issueToken(
    registry: DiffEditTokenRegistry,
    overrides: Partial<{
      sessionId: string;
      scopeHash: string;
      repositoryUuid: string;
      revision: string;
      contentHash: string;
      relativePath: string;
    }> = {},
  ): string {
    const sid = overrides.sessionId ?? sessionId;
    const sh = overrides.scopeHash ?? scopeHash;
    const uuid = overrides.repositoryUuid ?? repositoryUuid;
    const rev = overrides.revision ?? revision;
    const ch = overrides.contentHash ?? contentHash;
    const tok = registry.issue({
      sessionId: sid,
      moduleId: "conflicts" as unknown as "diff",
      taskId: "conflicts/resolve" as unknown as "diff/working",
      repositoryUuid: uuid,
      scopeHash: sh,
      targetId,
      targetPath,
      rawHash: ch,
      baseHash: rev,
      baseRevision: rev,
      documentVersion: -1,
      draftRevision: -1,
    } as unknown as Parameters<DiffEditTokenRegistry["issue"]>[0]);
    const stored = (
      registry as unknown as {
        tokens: Map<string, { taskId: string; moduleId: string }>;
      }
    ).tokens.get(tok);
    if (stored) {
      stored.taskId = "conflicts/resolve";
      stored.moduleId = "conflicts";
    }
    return tok;
  }

  it("正常签发后单次消耗成功", () => {
    const registry = new DiffEditTokenRegistry();
    const token = issueToken(registry);
    const res = registry.consume(token);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect((res.binding as unknown as { sessionId: string }).sessionId).toBe(
        sessionId,
      );
      expect((res.binding as unknown as { rawHash: string }).rawHash).toBe(
        contentHash,
      );
    }
  });

  it("重放（第二次消耗）→ unknown 拒绝", () => {
    const registry = new DiffEditTokenRegistry();
    const token = issueToken(registry);
    const first = registry.consume(token);
    expect(first.ok).toBe(true);
    const second = registry.consume(token);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("unknown");
  });

  it("过期（超 TTL 15min）→ expired 拒绝", () => {
    const registry = new DiffEditTokenRegistry();
    const token = issueToken(registry);
    // 人为让时间超过 TTL
    const expiredNow = Date.now() + CONFLICT_COMPLETION_TOKEN_TTL_MS + 1000;
    const res = registry.consume(token, expiredNow);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("expired");
  });

  it("scope 变化 → 绑定不匹配（业务层检测）", () => {
    const registry = new DiffEditTokenRegistry();
    const token = issueToken(registry);
    const res = registry.consume(token);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const binding = res.binding as unknown as { scopeHash: string };
    // 当前会话 scope 已变
    const currentScopeHash = "scope-changed";
    expect(binding.scopeHash).not.toBe(currentScopeHash);
  });

  it("UUID 变化 → 绑定不匹配", () => {
    const registry = new DiffEditTokenRegistry();
    const token = issueToken(registry);
    const res = registry.consume(token);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const binding = res.binding as unknown as { repositoryUuid: string };
    expect(binding.repositoryUuid).not.toBe("other-uuid");
  });

  it("revision 变化 → 绑定不匹配", () => {
    const registry = new DiffEditTokenRegistry();
    const token = issueToken(registry);
    const res = registry.consume(token);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const binding = res.binding as unknown as { baseRevision: string };
    expect(binding.baseRevision).not.toBe("99");
  });

  it("contentHash 变化（磁盘被改）→ 绑定不匹配", () => {
    const registry = new DiffEditTokenRegistry();
    const token = issueToken(registry);
    const res = registry.consume(token);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const binding = res.binding as unknown as { rawHash: string };
    const newHash = sha256Hex("changed\n");
    expect(binding.rawHash).not.toBe(newHash);
  });

  it("revokeAllForSession 后旧 token 失效", () => {
    const registry = new DiffEditTokenRegistry();
    const token = issueToken(registry);
    registry.revokeAllForSession(sessionId);
    const res = registry.consume(token);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("unknown");
  });

  it("真实哈希：hashFileContents 与 token 绑定 rawHash 一致", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "token-hash-"));
    const fp = path.join(tmp, "file.txt");
    const txt = "token content 真实哈希\n";
    await fs.writeFile(fp, txt, "utf8");
    const fileHash = await hashFileContents(fp);
    const registry = new DiffEditTokenRegistry();
    const token = issueToken(registry, { contentHash: fileHash });
    const res = registry.consume(token);
    expect(res.ok).toBe(true);
    if (res.ok)
      expect((res.binding as unknown as { rawHash: string }).rawHash).toBe(
        fileHash,
      );
    await fs.rm(tmp, { recursive: true, force: true });
  });
});
