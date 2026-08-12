import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OperationScope } from "../../src/scope/operationScope";
import { DiffEditTokenRegistry } from "../../src/diffEdit/diffEditTokenRegistry";
import { DiffDraftService } from "../../src/diffEdit/diffDraftService";
import {
  DiffAtomicWriter,
  DiffAtomicWriterService,
  toPreservingBytes,
} from "../../src/diffEdit/diffAtomicWriter";
import {
  analyzeUtf8,
  hashBytes,
  validateDiffEditTarget,
} from "../../src/diffEdit/diffPathGuard";
import {
  DiffEditingService,
  type DiffEditingServiceDeps,
} from "../../src/diffEdit/diffEditingService";
import { diffLines } from "../../src/diffEdit/diffPatch";
import type {
  DiffSvnBindingProbeResult,
  DiffTargetFreshness,
} from "../../src/diffEdit/diffEditTypes";

let workRoot: string;
let repositoryRoot: string;

function makeScope(root: string, targets: string[]): OperationScope {
  return {
    id: "scope",
    repositoryRoot: root,
    source: "editorFile",
    roots: [
      {
        absolutePath: targets[0],
        relativePath: path.relative(root, targets[0]),
        kind: "folder",
      },
    ],
    allowExpandScope: false,
    includeExternals: false,
    includeNestedWorkingCopies: false,
    createdAt: 0,
  };
}

async function writeTarget(root: string, name: string, content: string) {
  const filePath = path.join(root, name);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

function baseDeps(
  overrides: Partial<DiffEditingServiceDeps> = {},
): DiffEditingServiceDeps {
  return {
    tokens: new DiffEditTokenRegistry(),
    drafts: new DiffDraftService(),
    writer: new DiffAtomicWriterService(),
    freshness: async (targetPath: string): Promise<DiffTargetFreshness> => {
      try {
        const stat = await fs.lstat(targetPath);
        const bytes = await fs.readFile(targetPath);
        const real = await fs.realpath(targetPath);
        return {
          exists: true,
          isRegularFile: stat.isFile(),
          realPath: real,
          rawHash: hashBytes(bytes),
          sizeBytes: bytes.byteLength,
        };
      } catch {
        return {
          exists: false,
          isRegularFile: false,
          realPath: targetPath,
          rawHash: "",
          sizeBytes: 0,
        };
      }
    },
    readBytes: async (targetPath: string) => fs.readFile(targetPath),
    ...overrides,
  };
}

const session = {
  sessionId: "session-1",
  repositoryUuid: "repo-uuid-1",
  scopeHash: "scope-hash-1",
};

describe("diffEdit 路径守卫", () => {
  let target: string;
  let scope: OperationScope;

  beforeEach(async () => {
    workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "svn-diffedit-"));
    repositoryRoot = workRoot;
    target = await writeTarget(workRoot, "src/app.ts", "const x = 1;\n");
    scope = makeScope(repositoryRoot, [path.join(repositoryRoot, "src")]);
  });

  afterEach(async () => {
    await fs.rm(workRoot, { recursive: true, force: true });
  });

  it("接受工作副本与 scope 内的普通 UTF-8 文件", async () => {
    const result = await validateDiffEditTarget({
      scope,
      repositoryRoot,
      targetPath: target,
      baseContents: "const x = 1;\n",
      baseRevision: "10",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.absolutePath).toBe(await fs.realpath(target));
      expect(result.context.baseHash).toBe(
        hashBytes(Buffer.from("const x = 1;\n", "utf8")),
      );
      expect(result.context.rawHash).toBe(
        hashBytes(Buffer.from("const x = 1;\n", "utf8")),
      );
    }
  });

  it("拒绝不存在的目标", async () => {
    const result = await validateDiffEditTarget({
      scope,
      repositoryRoot,
      targetPath: path.join(workRoot, "missing.ts"),
      baseContents: "",
      baseRevision: "10",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("notFound");
  });

  it("拒绝符号链接", async () => {
    const real = await writeTarget(workRoot, "real.ts", "content\n");
    const link = path.join(workRoot, "link.ts");
    await fs.symlink(real, link);
    const result = await validateDiffEditTarget({
      scope,
      repositoryRoot,
      targetPath: link,
      baseContents: "",
      baseRevision: "10",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("symlink");
  });

  it("拒绝目录", async () => {
    const result = await validateDiffEditTarget({
      scope,
      repositoryRoot,
      targetPath: path.join(repositoryRoot, "src"),
      baseContents: "",
      baseRevision: "10",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("notRegularFile");
  });

  it("拒绝 scope 外路径", async () => {
    const outside = await writeTarget(workRoot, "outside.ts", "x\n");
    const result = await validateDiffEditTarget({
      scope,
      repositoryRoot,
      targetPath: outside,
      baseContents: "",
      baseRevision: "10",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("outOfScope");
  });

  it("拒绝超过 5 MB 的目标", async () => {
    const big = path.join(workRoot, "src", "big.ts");
    await fs.writeFile(big, Buffer.alloc(5 * 1024 * 1024 + 1, 0x61));
    const result = await validateDiffEditTarget({
      scope,
      repositoryRoot,
      targetPath: big,
      baseContents: "",
      baseRevision: "10",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("tooLarge");
  });

  it("拒绝非法 UTF-8 编码", async () => {
    const bad = path.join(workRoot, "src", "bad.ts");
    await fs.writeFile(bad, Buffer.from([0xff, 0xfe, 0x80, 0x41]));
    const result = await validateDiffEditTarget({
      scope,
      repositoryRoot,
      targetPath: bad,
      baseContents: "",
      baseRevision: "10",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unsupportedEncoding");
  });
});

describe("diffEdit token 注册表", () => {
  it("单次使用：消耗后再次消耗返回 unknown", () => {
    const registry = new DiffEditTokenRegistry();
    const token = registry.issue({
      sessionId: "s",
      moduleId: "diff",
      taskId: "diff/working",
      repositoryUuid: "r",
      scopeHash: "sc",
      targetId: "t",
      targetPath: "/repo/a.ts",
      rawHash: "H1",
      baseHash: "B1",
      baseRevision: "10",
      documentVersion: 1,
      draftRevision: 1,
    });
    expect(registry.consume(token).ok).toBe(true);
    expect(registry.consume(token)).toEqual({ ok: false, reason: "unknown" });
  });

  it("过期 token 返回 expired", () => {
    const registry = new DiffEditTokenRegistry();
    const token = registry.issue({
      sessionId: "s",
      moduleId: "diff",
      taskId: "diff/working",
      repositoryUuid: "r",
      scopeHash: "sc",
      targetId: "t",
      targetPath: "/repo/a.ts",
      rawHash: "H1",
      baseHash: "B1",
      baseRevision: "10",
      documentVersion: 1,
      draftRevision: 1,
    });
    expect(registry.consume(token, Date.now() + 16 * 60 * 1000).ok).toBe(false);
  });

  it("按 scope/session/target 撤销", () => {
    const registry = new DiffEditTokenRegistry();
    const t1 = registry.issue({
      sessionId: "s1",
      moduleId: "diff",
      taskId: "diff/working",
      repositoryUuid: "r",
      scopeHash: "sc1",
      targetId: "t1",
      targetPath: "/a.ts",
      rawHash: "H",
      baseHash: "B",
      baseRevision: "1",
      documentVersion: 0,
      draftRevision: 1,
    });
    const t2 = registry.issue({
      sessionId: "s1",
      moduleId: "diff",
      taskId: "diff/working",
      repositoryUuid: "r",
      scopeHash: "sc1",
      targetId: "t1",
      targetPath: "/a.ts",
      rawHash: "H",
      baseHash: "B",
      baseRevision: "1",
      documentVersion: 0,
      draftRevision: 1,
    });
    registry.revokeAllForScope("sc1");
    expect(registry.consume(t1).ok).toBe(false);
    expect(registry.consume(t2).ok).toBe(false);
  });

  it("按规范路径撤销（外部文档/磁盘变化监听）", () => {
    const registry = new DiffEditTokenRegistry();
    const make = (targetPath: string, targetId: string) =>
      registry.issue({
        sessionId: "s1",
        moduleId: "diff",
        taskId: "diff/working",
        repositoryUuid: "r",
        scopeHash: "sc1",
        targetId,
        targetPath,
        rawHash: "H",
        baseHash: "B",
        baseRevision: "1",
        documentVersion: 0,
        draftRevision: 1,
      });
    const hit = make("/repo/a.ts", "t1");
    const miss = make("/repo/b.ts", "t2");
    registry.revokeAllForPath("/repo/a.ts");
    expect(registry.consume(hit).ok).toBe(false);
    expect(registry.consume(miss).ok).toBe(true);
  });
});

describe("diffEdit 原子写入器", () => {
  let filePath: string;

  beforeEach(async () => {
    workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "svn-diffwrite-"));
    filePath = path.join(workRoot, "target.txt");
  });

  afterEach(async () => {
    await fs.rm(workRoot, { recursive: true, force: true });
  });

  it("保留 BOM、CRLF 与末尾换行并原子替换", async () => {
    const original = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("line1\r\nline2\r\n", "utf8"),
    ]);
    await fs.writeFile(filePath, original);
    const analysis = analyzeUtf8(original);
    const service = new DiffAtomicWriterService();
    const result = await service.save({
      targetPath: filePath,
      content: "line1\r\nline2\r\nline3",
      analysis,
      expectedRawHash: hashBytes(original),
    });
    expect(result.ok).toBe(true);
    const after = await fs.readFile(filePath);
    expect(after[0]).toBe(0xef);
    expect(after[1]).toBe(0xbb);
    expect(after[2]).toBe(0xbf);
    expect(after.toString("utf8")).toBe("\uFEFFline1\r\nline2\r\nline3\r\n");
    // 同目录不留临时文件
    const entries = await fs.readdir(workRoot);
    expect(entries).toEqual(["target.txt"]);
  });

  it("磁盘 hash 变化时拒绝并保留原文件", async () => {
    const original = Buffer.from("original\n", "utf8");
    await fs.writeFile(filePath, original);
    const service = new DiffAtomicWriterService();
    const result = await service.save({
      targetPath: filePath,
      content: "changed\n",
      analysis: { bom: false, eol: "\n", finalNewline: true },
      expectedRawHash: "WRONG-HASH",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("diskChanged");
    expect(await fs.readFile(filePath, "utf8")).toBe("original\n");
  });

  it("目标被移动时拒绝且清理临时文件", async () => {
    await fs.writeFile(filePath, "x\n");
    const writer = new DiffAtomicWriter();
    const result = await writer.writeRawBytes({
      targetPath: filePath,
      bytes: Buffer.from("y\n", "utf8"),
      expectedRawHash: hashBytes(Buffer.from("x\n", "utf8")),
      freshness: async () => ({
        exists: false,
        isRegularFile: false,
        realPath: filePath,
        rawHash: "",
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("targetMoved");
    const entries = await fs.readdir(workRoot);
    expect(entries.filter((name) => name.includes(".tmp"))).toEqual([]);
  });

  it("toPreservingBytes 归一化 EOL 与末尾换行", () => {
    const bytes = toPreservingBytes("a\nb", {
      bom: false,
      eol: "\r\n",
      finalNewline: true,
    });
    expect(bytes.toString("utf8")).toBe("a\r\nb\r\n");
    const noFinal = toPreservingBytes("a\n", {
      bom: false,
      eol: "\n",
      finalNewline: false,
    });
    expect(noFinal.toString("utf8")).toBe("a");
  });
});

describe("diffEdit 草稿服务", () => {
  it("检查点递增版本，乱序/重放拒绝", () => {
    const drafts = new DiffDraftService();
    const base = {
      repositoryUuid: "r",
      scopeHash: "sc",
      baseHash: "B",
      baseRevision: "1",
      diskHash: "D",
      targetPath: "/a.ts",
    };
    const first = drafts.upsert({
      ...base,
      targetId: "t",
      content: "v1",
      baseRevisionOfClient: -1,
    });
    expect(first.ok && first.draft.revision).toBe(1);
    const second = drafts.upsert({
      ...base,
      targetId: "t",
      content: "v2",
      baseRevisionOfClient: 1,
    });
    expect(second.ok && second.draft.revision).toBe(2);
    // 乱序（客户端声称旧版本）
    const stale = drafts.upsert({
      ...base,
      targetId: "t",
      content: "v0",
      baseRevisionOfClient: 0,
    });
    expect(stale.ok).toBe(false);
  });

  it("容量上限清除最旧草稿", () => {
    const drafts = new DiffDraftService();
    const base = {
      repositoryUuid: "r",
      scopeHash: "sc",
      baseHash: "B",
      baseRevision: "1",
      diskHash: "D",
      targetPath: "/a.ts",
    };
    for (let i = 0; i < 40; i += 1) {
      drafts.upsert({
        ...base,
        targetId: `t${i}`,
        content: `v${i}`,
        baseRevisionOfClient: -1,
      });
    }
    expect(drafts.list().length).toBeLessThanOrEqual(32);
  });

  it("导出 base→draft 的统一 diff", () => {
    const drafts = new DiffDraftService();
    drafts.upsert({
      targetId: "t",
      repositoryUuid: "r",
      scopeHash: "sc",
      baseHash: "B",
      baseRevision: "1",
      diskHash: "D",
      targetPath: "src/a.ts",
      content: "line1\nline2-changed\n",
      baseRevisionOfClient: -1,
    });
    const patch = drafts.exportPatch("t", "line1\nline2\nline3\n");
    expect(patch).toContain("--- a/src/a.ts");
    expect(patch).toContain("-line2");
    expect(patch).toContain("+line2-changed");
  });

  it("diffLines 纯函数正确生成统一 diff", () => {
    const patch = diffLines(["a", "b", "c"], ["a", "b2", "c"], "f.ts");
    expect(patch).toContain("-b");
    expect(patch).toContain("+b2");
  });
});

describe("diffEditingService 编排", () => {
  let scope: OperationScope;
  let target: string;
  let deps: DiffEditingServiceDeps;

  beforeEach(async () => {
    workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "svn-edit-svc-"));
    repositoryRoot = workRoot;
    target = await writeTarget(workRoot, "src/app.ts", "const x = 1;\n");
    scope = makeScope(repositoryRoot, [path.join(repositoryRoot, "src")]);
    deps = baseDeps();
  });

  afterEach(async () => {
    await fs.rm(workRoot, { recursive: true, force: true });
  });

  async function openEdit(
    overrides: Partial<Parameters<DiffEditingService["openEdit"]>[0]> = {},
  ) {
    const service = new DiffEditingService(deps);
    return service.openEdit({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetPath: target,
      baseContents: "const x = 1;\n",
      baseRevision: "10",
      baseHash: hashBytes(Buffer.from("const x = 1;\n", "utf8")),
      rawHash: hashBytes(Buffer.from("const x = 1;\n", "utf8")),
      documentVersion: 1,
      scope,
      repositoryRoot,
      ...overrides,
    });
  }

  it("openEdit 成功签发 token 并登记草稿", async () => {
    const result = await openEdit();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.targetId).toBeTruthy();
      expect(result.editToken).toBeTruthy();
      expect(result.draftRevision).toBe(1);
      expect(deps.tokens.size()).toBe(1);
      expect(deps.drafts.get(result.targetId)?.content).toBe("const x = 1;\n");
    }
  });

  it("openEdit 拒绝脏 TextDocument", async () => {
    deps = baseDeps({ isDocumentDirty: async () => true });
    const result = await openEdit();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("documentDirty");
  });

  it("saveWorking 成功：原子写入、旧 token 失效、新 token 签发、草稿更新", async () => {
    const service = new DiffEditingService(deps);
    const opened = await openEdit();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const result = await service.saveWorking({
      sessionId: session.sessionId,
      moduleId: "diff",
      taskId: "diff/working",
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision: opened.draftRevision,
      expectedContentHash: opened.rawHash,
      content: "const x = 2;\n",
      scope,
      repositoryRoot,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await fs.readFile(target, "utf8")).toBe("const x = 2;\n");
    expect(result.acceptedRevision).toBeGreaterThan(1);
    expect(result.newEditToken).toBeTruthy();
    // 旧 token 单次使用：再次保存必须用新 token
    const replay = await service.saveWorking({
      sessionId: session.sessionId,
      moduleId: "diff",
      taskId: "diff/working",
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision: opened.draftRevision,
      expectedContentHash: opened.rawHash,
      content: "hijack\n",
      scope,
      repositoryRoot,
    });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.reason).toBe("tokenExpired");
  });

  it("saveWorking 拒绝 scope/会话不匹配", async () => {
    const service = new DiffEditingService(deps);
    const opened = await openEdit();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const result = await service.saveWorking({
      sessionId: "other-session",
      moduleId: "diff",
      taskId: "diff/working",
      repositoryUuid: session.repositoryUuid,
      scopeHash: "other-scope",
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision: opened.draftRevision,
      expectedContentHash: opened.rawHash,
      content: "x\n",
      scope,
      repositoryRoot,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("scopeChanged");
  });

  it("saveWorking 拒绝 expectedContentHash 不匹配（基准变化）", async () => {
    const service = new DiffEditingService(deps);
    const opened = await openEdit();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const result = await service.saveWorking({
      sessionId: session.sessionId,
      moduleId: "diff",
      taskId: "diff/working",
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision: opened.draftRevision,
      expectedContentHash: "STALE-HASH",
      content: "x\n",
      scope,
      repositoryRoot,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("diskChanged");
  });

  it("saveWorking 拒绝保存前磁盘被外部修改", async () => {
    const service = new DiffEditingService(deps);
    const opened = await openEdit();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    await fs.writeFile(target, "external change\n", "utf8");
    const result = await service.saveWorking({
      sessionId: session.sessionId,
      moduleId: "diff",
      taskId: "diff/working",
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision: opened.draftRevision,
      expectedContentHash: opened.rawHash,
      content: "mine\n",
      scope,
      repositoryRoot,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("diskChanged");
    expect(await fs.readFile(target, "utf8")).toBe("external change\n");
  });

  it("saveWorking 拒绝目标被移动", async () => {
    const service = new DiffEditingService(deps);
    const opened = await openEdit();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    await fs.rm(target);
    const result = await service.saveWorking({
      sessionId: session.sessionId,
      moduleId: "diff",
      taskId: "diff/working",
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision: opened.draftRevision,
      expectedContentHash: opened.rawHash,
      content: "x\n",
      scope,
      repositoryRoot,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("targetMoved");
  });

  it("saveWorking 拒绝乱序/重放的 draftRevision", async () => {
    const service = new DiffEditingService(deps);
    const opened = await openEdit();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    // 客户端声称旧版本（replay）
    const result = await service.saveWorking({
      sessionId: session.sessionId,
      moduleId: "diff",
      taskId: "diff/working",
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision: 0,
      expectedContentHash: opened.rawHash,
      content: "x\n",
      scope,
      repositoryRoot,
    });
    expect(result.ok).toBe(false);
  });

  it("saveWorking 拒绝超过 5 MB 的内容且旧 token 失效", async () => {
    const service = new DiffEditingService(deps);
    const opened = await openEdit();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const oversized = "x".repeat(5 * 1024 * 1024 + 1);
    const result = await service.saveWorking({
      sessionId: session.sessionId,
      moduleId: "diff",
      taskId: "diff/working",
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision: opened.draftRevision,
      expectedContentHash: opened.rawHash,
      content: oversized,
      scope,
      repositoryRoot,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("tooLarge");
    // 契约 §5.2：失败后旧 token 必须失效，不允许原样重试。
    const retry = await service.saveWorking({
      sessionId: session.sessionId,
      moduleId: "diff",
      taskId: "diff/working",
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision: opened.draftRevision,
      expectedContentHash: opened.rawHash,
      content: "合法内容\n",
      scope,
      repositoryRoot,
    });
    expect(retry.ok).toBe(false);
    if (!retry.ok) expect(retry.reason).toBe("tokenExpired");
  });

  it("revokeForPath 后保存被拒绝（外部变化立即使 token 失效）", async () => {
    const service = new DiffEditingService(deps);
    const opened = await openEdit();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    await service.revokeForPath(target);
    const result = await service.saveWorking({
      sessionId: session.sessionId,
      moduleId: "diff",
      taskId: "diff/working",
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision: opened.draftRevision,
      expectedContentHash: opened.rawHash,
      content: "x\n",
      scope,
      repositoryRoot,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("tokenExpired");
  });

  it("saveDraft 将草稿经同一安全链落盘并清除草稿", async () => {
    const service = new DiffEditingService(deps);
    const opened = await openEdit();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    // 编辑内容进入草稿（检查点）。
    const checkpoint = service.checkpointDraft({
      targetId: opened.targetId,
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      baseHash: opened.baseHash,
      baseRevision: opened.baseRevision,
      baseContents: opened.baseContents,
      diskHash: opened.rawHash,
      targetPath: target,
      content: "const x = 42;\n",
      baseRevisionOfClient: opened.draftRevision,
    });
    expect(checkpoint.ok).toBe(true);
    const result = await service.saveDraft({
      targetId: opened.targetId,
      scope,
      repositoryRoot,
    });
    expect(result.ok).toBe(true);
    expect(await fs.readFile(target, "utf8")).toBe("const x = 42;\n");
    // 草稿清除、token 撤销。
    expect(service.getDraft(opened.targetId)).toBeUndefined();
    expect(deps.tokens.size()).toBe(0);
  });

  it("saveDraft 在磁盘变化后拒绝并保留草稿", async () => {
    const service = new DiffEditingService(deps);
    const opened = await openEdit();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    service.checkpointDraft({
      targetId: opened.targetId,
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      baseHash: opened.baseHash,
      baseRevision: opened.baseRevision,
      baseContents: opened.baseContents,
      diskHash: opened.rawHash,
      targetPath: target,
      content: "const x = 42;\n",
      baseRevisionOfClient: opened.draftRevision,
    });
    // 外部修改磁盘。
    await fs.writeFile(target, "const x = 999;\n", "utf8");
    const result = await service.saveDraft({
      targetId: opened.targetId,
      scope,
      repositoryRoot,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("diskChanged");
    // 草稿保留、磁盘未被覆盖。
    expect(service.getDraft(opened.targetId)?.content).toBe("const x = 42;\n");
    expect(await fs.readFile(target, "utf8")).toBe("const x = 999;\n");
  });

  it("saveDraft 拒绝缺失草稿", async () => {
    const service = new DiffEditingService(deps);
    const missing = await service.saveDraft({
      targetId: "unknown",
      scope,
      repositoryRoot,
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe("tokenExpired");
  });

  it("token 消耗后仍接受同仓库同范围的恢复检查点", async () => {
    const service = new DiffEditingService(deps);
    const opened = await openEdit();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    // 消耗 token（模拟一次保存/失败）。
    await service.saveWorking({
      sessionId: session.sessionId,
      moduleId: "diff",
      taskId: "diff/working",
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision: opened.draftRevision,
      expectedContentHash: opened.rawHash,
      content: "first\n",
      scope,
      repositoryRoot,
    });
    const draft = service.getDraft(opened.targetId);
    expect(draft).toBeDefined();
    if (!draft) return;
    const checkpoint = service.checkpointDraft({
      targetId: opened.targetId,
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      baseHash: draft.baseHash,
      baseRevision: draft.baseRevision,
      baseContents: draft.baseContents,
      diskHash: draft.diskHash,
      targetPath: draft.targetPath,
      content: "first\nsecond\n",
      baseRevisionOfClient: draft.revision,
    });
    expect(checkpoint.ok).toBe(true);
  });

  it("openEdit 草稿初始化为 Working Copy 内容而非 BASE（防数据破坏）", async () => {
    // Working Copy 与 BASE 不同：草稿绝不能以 BASE 为初始内容。
    const service = new DiffEditingService(deps);
    const opened = await service.openEdit({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetPath: target,
      baseContents: "BASE 原始内容\n",
      baseRevision: "10",
      baseHash: hashBytes(Buffer.from("BASE 原始内容\n", "utf8")),
      rawHash: hashBytes(Buffer.from("const x = 1;\n", "utf8")),
      documentVersion: 1,
      scope,
      repositoryRoot,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const draft = service.getDraft(opened.targetId);
    expect(draft).toBeDefined();
    // 草稿内容必须等于 Working Copy 当前内容，不是 BASE。
    expect(draft?.content).toBe("const x = 1;\n");
    expect(draft?.content).not.toBe("BASE 原始内容\n");
    // 未修改的草稿不是脏草稿。
    expect(service.isDraftDirty(opened.targetId)).toBe(false);
  });

  it("saveDraft 对未修改的干净草稿不写盘（不将 BASE 写回 Working Copy）", async () => {
    const service = new DiffEditingService(deps);
    const opened = await service.openEdit({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetPath: target,
      baseContents: "BASE 原始内容\n",
      baseRevision: "10",
      baseHash: hashBytes(Buffer.from("BASE 原始内容\n", "utf8")),
      rawHash: hashBytes(Buffer.from("const x = 1;\n", "utf8")),
      documentVersion: 1,
      scope,
      repositoryRoot,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const before = await fs.readFile(target, "utf8");
    const result = await service.saveDraft({
      targetId: opened.targetId,
      scope,
      repositoryRoot,
    });
    expect(result.ok).toBe(true);
    // 磁盘内容未被重写（尤其不能变成 BASE）。
    expect(await fs.readFile(target, "utf8")).toBe(before);
    expect(await fs.readFile(target, "utf8")).not.toBe("BASE 原始内容\n");
    expect(service.getDraft(opened.targetId)).toBeUndefined();
  });

  it("saveDraft 只写入用户真实编辑内容（checkpoint 之后）", async () => {
    const service = new DiffEditingService(deps);
    const opened = await openEdit();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    service.checkpointDraft({
      targetId: opened.targetId,
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      baseHash: opened.baseHash,
      baseRevision: opened.baseRevision,
      baseContents: opened.baseContents,
      diskHash: opened.rawHash,
      targetPath: target,
      content: "用户编辑后的内容\n",
      baseRevisionOfClient: opened.draftRevision,
    });
    expect(service.isDraftDirty(opened.targetId)).toBe(true);
    const result = await service.saveDraft({
      targetId: opened.targetId,
      scope,
      repositoryRoot,
    });
    expect(result.ok).toBe(true);
    expect(await fs.readFile(target, "utf8")).toBe("用户编辑后的内容\n");
  });

  it("saveWorking 成功后草稿回到干净状态（cleanContent 更新为已保存内容）", async () => {
    const service = new DiffEditingService(deps);
    const opened = await openEdit();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    // 真实编辑 → 脏草稿。
    service.checkpointDraft({
      targetId: opened.targetId,
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      baseHash: opened.baseHash,
      baseRevision: opened.baseRevision,
      baseContents: opened.baseContents,
      diskHash: opened.rawHash,
      targetPath: target,
      content: "const x = 2;\n",
      baseRevisionOfClient: opened.draftRevision,
    });
    expect(service.isDraftDirty(opened.targetId)).toBe(true);
    const saved = await service.saveWorking({
      sessionId: session.sessionId,
      moduleId: "diff",
      taskId: "diff/working",
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision: opened.draftRevision + 1,
      expectedContentHash: opened.rawHash,
      content: "const x = 2;\n",
      scope,
      repositoryRoot,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    // 保存成功立即干净：快照不应再携带草稿、切换不应触发三选一。
    expect(service.isDraftDirty(opened.targetId)).toBe(false);
  });

  it("保存后的新编辑以新保存内容为干净基准；普通 checkpoint 不改基准", async () => {
    const service = new DiffEditingService(deps);
    const opened = await openEdit();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    service.checkpointDraft({
      targetId: opened.targetId,
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      baseHash: opened.baseHash,
      baseRevision: opened.baseRevision,
      baseContents: opened.baseContents,
      diskHash: opened.rawHash,
      targetPath: target,
      content: "const x = 2;\n",
      baseRevisionOfClient: opened.draftRevision,
    });
    const saved = await service.saveWorking({
      sessionId: session.sessionId,
      moduleId: "diff",
      taskId: "diff/working",
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision: opened.draftRevision + 1,
      expectedContentHash: opened.rawHash,
      content: "const x = 2;\n",
      scope,
      repositoryRoot,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    // 普通 checkpoint 回到与保存内容相同 → 干净（不是回到打开时基准）。
    const draft = service.getDraft(opened.targetId);
    expect(draft).toBeDefined();
    if (!draft) return;
    const same = service.checkpointDraft({
      targetId: opened.targetId,
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      baseHash: draft.baseHash,
      baseRevision: draft.baseRevision,
      baseContents: draft.baseContents,
      diskHash: draft.diskHash,
      targetPath: target,
      content: "const x = 2;\n",
      baseRevisionOfClient: saved.acceptedRevision,
    });
    expect(same.ok).toBe(true);
    expect(service.isDraftDirty(opened.targetId)).toBe(false);
    // checkpoint 回打开时的旧内容 → 仍是脏（基准是保存后的内容）。
    const revert = service.checkpointDraft({
      targetId: opened.targetId,
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      baseHash: draft.baseHash,
      baseRevision: draft.baseRevision,
      baseContents: draft.baseContents,
      diskHash: draft.diskHash,
      targetPath: target,
      content: "const x = 1;\n",
      baseRevisionOfClient: service.getDraft(opened.targetId)?.revision ?? -1,
    });
    expect(revert.ok).toBe(true);
    expect(service.isDraftDirty(opened.targetId)).toBe(true);
  });

  it("连续第二次编辑/保存使用新 token 与新磁盘 hash/干净基准", async () => {
    const service = new DiffEditingService(deps);
    const opened = await openEdit();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const firstSaved = await service.saveWorking({
      sessionId: session.sessionId,
      moduleId: "diff",
      taskId: "diff/working",
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision: opened.draftRevision,
      expectedContentHash: opened.rawHash,
      content: "const x = 2;\n",
      scope,
      repositoryRoot,
    });
    expect(firstSaved.ok).toBe(true);
    if (!firstSaved.ok) return;
    expect(service.isDraftDirty(opened.targetId)).toBe(false);

    // 第二次编辑 → 脏 → 保存必须用第一次保存返回的新 token 与新 hash。
    service.checkpointDraft({
      targetId: opened.targetId,
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      baseHash: opened.baseHash,
      baseRevision: opened.baseRevision,
      baseContents: opened.baseContents,
      diskHash: firstSaved.newContentHash,
      targetPath: target,
      content: "const x = 3;\nconst b = 1;\n",
      baseRevisionOfClient: firstSaved.acceptedRevision,
    });
    expect(service.isDraftDirty(opened.targetId)).toBe(true);
    const secondSaved = await service.saveWorking({
      sessionId: session.sessionId,
      moduleId: "diff",
      taskId: "diff/working",
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened.targetId,
      editToken: firstSaved.newEditToken,
      draftRevision: service.getDraft(opened.targetId)?.revision ?? -1,
      expectedContentHash: firstSaved.newContentHash,
      content: "const x = 3;\nconst b = 1;\n",
      scope,
      repositoryRoot,
    });
    expect(secondSaved.ok).toBe(true);
    expect(secondSaved.ok && secondSaved.newEditToken).not.toBe(
      firstSaved.newEditToken,
    );
    expect(service.isDraftDirty(opened.targetId)).toBe(false);
    // 旧 token（第一次）重放必须拒绝。
    const replay = await service.saveWorking({
      sessionId: session.sessionId,
      moduleId: "diff",
      taskId: "diff/working",
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened.targetId,
      editToken: firstSaved.newEditToken,
      draftRevision: service.getDraft(opened.targetId)?.revision ?? -1,
      expectedContentHash: firstSaved.newContentHash,
      content: "hijack\n",
      scope,
      repositoryRoot,
    });
    expect(replay.ok).toBe(false);
  });

  it("多目标会话：第二个目标的 draftRevision 不被误判乱序", async () => {
    const service = new DiffEditingService(deps);
    const second = await writeTarget(
      workRoot,
      "src/other.ts",
      "const y = 1;\n",
    );
    const firstOpened = await service.openEdit({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetPath: target,
      baseContents: "const x = 1;\n",
      baseRevision: "10",
      baseHash: "",
      rawHash: "",
      scope,
      repositoryRoot,
    });
    const secondOpened = await service.openEdit({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetPath: second,
      baseContents: "const y = 1;\n",
      baseRevision: "10",
      baseHash: "",
      rawHash: "",
      scope,
      repositoryRoot,
    });
    expect(firstOpened.ok && secondOpened.ok).toBe(true);
    if (!firstOpened.ok || !secondOpened.ok) return;
    // 第二个目标的保存携带其 openEdit 返回的 draftRevision，必须成功。
    const saved = await service.saveWorking({
      sessionId: session.sessionId,
      moduleId: "diff",
      taskId: "diff/working",
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: secondOpened.targetId,
      editToken: secondOpened.editToken,
      draftRevision: secondOpened.draftRevision,
      expectedContentHash: secondOpened.rawHash,
      content: "const y = 2;\n",
      scope,
      repositoryRoot,
    });
    expect(saved.ok).toBe(true);
    expect(await fs.readFile(second, "utf8")).toBe("const y = 2;\n");
  });

  it("openEdit 签发的 token 绑定真实 TextDocument.version", async () => {
    deps = baseDeps({ getDocumentVersion: async () => 42 });
    const opened = await openEdit();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const consumed = deps.tokens.consume(opened.editToken);
    expect(consumed.ok).toBe(true);
    if (consumed.ok) expect(consumed.binding.documentVersion).toBe(42);
  });
});

describe("diffEdit SVN 绑定复验（验收 P0：UUID/BASE/external/嵌套 WC）", () => {
  let scope: OperationScope;
  let target: string;
  let deps: DiffEditingServiceDeps;
  const baseText = "const x = 1;\n";

  beforeEach(async () => {
    workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "svn-edit-bind-"));
    repositoryRoot = workRoot;
    target = await writeTarget(workRoot, "src/app.ts", baseText);
    scope = makeScope(repositoryRoot, [path.join(repositoryRoot, "src")]);
    deps = baseDeps();
  });

  afterEach(async () => {
    await fs.rm(workRoot, { recursive: true, force: true });
  });

  function bindingProbe(overrides: {
    repositoryUuid?: string;
    workingCopyRoot?: string;
    baseHash?: string;
    fileExternal?: boolean;
    fail?: "noSvnInfo" | "noBase";
  }) {
    return async (): Promise<DiffSvnBindingProbeResult> => {
      if (overrides.fail !== undefined) {
        return { ok: false, code: overrides.fail };
      }
      return {
        ok: true,
        repositoryUuid: overrides.repositoryUuid ?? session.repositoryUuid,
        workingCopyRoot: overrides.workingCopyRoot ?? repositoryRoot,
        baseHash:
          overrides.baseHash ?? hashBytes(Buffer.from(baseText, "utf8")),
        fileExternal: overrides.fileExternal ?? false,
      };
    };
  }

  async function openEditWithProbe(
    probe: ReturnType<typeof bindingProbe>,
    service = new DiffEditingService(deps),
  ) {
    return service.openEdit({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetPath: target,
      baseContents: baseText,
      baseRevision: "10",
      baseHash: hashBytes(Buffer.from(baseText, "utf8")),
      rawHash: hashBytes(Buffer.from(baseText, "utf8")),
      scope,
      repositoryRoot,
      probeSvnBinding: probe,
    });
  }

  function saveInput(
    opened: {
      targetId: string;
      editToken: string;
      draftRevision: number;
      rawHash: string;
    },
    probe: ReturnType<typeof bindingProbe>,
  ) {
    return {
      sessionId: session.sessionId,
      moduleId: "diff" as const,
      taskId: "diff/working" as const,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision: opened.draftRevision,
      expectedContentHash: opened.rawHash,
      content: "const x = 2;\n",
      scope,
      repositoryRoot,
      probeSvnBinding: probe,
    };
  }

  it("openEdit 拒绝含 NUL 的二进制目标（合法 UTF-8 也不得通过）", async () => {
    const binaryTarget = path.join(path.dirname(target), "bin.dat");
    await fs.writeFile(
      binaryTarget,
      Buffer.concat([Buffer.from("abc", "utf8"), Buffer.from([0, 1, 2])]),
    );
    const service = new DiffEditingService(deps);
    const result = await service.openEdit({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetPath: binaryTarget,
      baseContents: "abc",
      baseRevision: "10",
      baseHash: "",
      rawHash: "",
      scope,
      repositoryRoot,
    });
    expect(result.ok).toBe(false);
  });

  it("openEdit 拒绝嵌套工作副本 / svn:externals 目标（wcroot 不一致）", async () => {
    const result = await openEditWithProbe(
      bindingProbe({ workingCopyRoot: path.join(repositoryRoot, "ext") }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("nestedOrExternal");
  });

  it("openEdit 拒绝 repositoryUuid 不一致", async () => {
    const result = await openEditWithProbe(
      bindingProbe({ repositoryUuid: "another-uuid" }),
    );
    expect(result.ok).toBe(false);
  });

  it("openEdit 拒绝 BASE hash 不一致", async () => {
    const result = await openEditWithProbe(
      bindingProbe({ baseHash: hashBytes(Buffer.from("其他 BASE", "utf8")) }),
    );
    expect(result.ok).toBe(false);
  });

  it("saveWorking 拒绝 UUID 变化（working hash 未变）且不落盘", async () => {
    const service = new DiffEditingService(deps);
    const opened = await openEditWithProbe(bindingProbe({}), service);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const before = await fs.readFile(target, "utf8");
    const result = await service.saveWorking(
      saveInput(opened, bindingProbe({ repositoryUuid: "changed-uuid" })),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("scopeChanged");
    expect(await fs.readFile(target, "utf8")).toBe(before);
  });

  it("saveWorking 拒绝 BASE 变化（working hash 未变）且不落盘", async () => {
    const service = new DiffEditingService(deps);
    const opened = await openEditWithProbe(bindingProbe({}), service);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const before = await fs.readFile(target, "utf8");
    const result = await service.saveWorking(
      saveInput(
        opened,
        bindingProbe({ baseHash: hashBytes(Buffer.from("new base", "utf8")) }),
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("diskChanged");
    expect(await fs.readFile(target, "utf8")).toBe(before);
  });

  it("saveWorking 拒绝目标退入 external/嵌套 WC（wcroot 变化）", async () => {
    const service = new DiffEditingService(deps);
    const opened = await openEditWithProbe(bindingProbe({}), service);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const result = await service.saveWorking(
      saveInput(
        opened,
        bindingProbe({ workingCopyRoot: path.join(repositoryRoot, "ext") }),
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("scopeChanged");
  });

  it("openEdit 拒绝同仓库 file external（wcroot/UUID 相同也必须拒绝）", async () => {
    const result = await openEditWithProbe(
      bindingProbe({ fileExternal: true }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("nestedOrExternal");
  });

  it("saveWorking 拒绝目标在打开后变为 file external 且不落盘", async () => {
    const service = new DiffEditingService(deps);
    const opened = await openEditWithProbe(bindingProbe({}), service);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const before = await fs.readFile(target, "utf8");
    const result = await service.saveWorking(
      saveInput(opened, bindingProbe({ fileExternal: true })),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("scopeChanged");
    expect(await fs.readFile(target, "utf8")).toBe(before);
  });

  it("saveDraft 拒绝目标为 file external 且不落盘", async () => {
    const service = new DiffEditingService(deps);
    const opened = await openEditWithProbe(bindingProbe({}), service);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    service.checkpointDraft({
      targetId: opened.targetId,
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      baseHash: opened.baseHash,
      baseRevision: opened.baseRevision,
      baseContents: opened.baseContents,
      diskHash: opened.rawHash,
      targetPath: target,
      content: "用户编辑内容\n",
      baseRevisionOfClient: opened.draftRevision,
    });
    const before = await fs.readFile(target, "utf8");
    const result = await service.saveDraft({
      targetId: opened.targetId,
      scope,
      repositoryRoot,
      probeSvnBinding: bindingProbe({ fileExternal: true }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("scopeChanged");
    expect(await fs.readFile(target, "utf8")).toBe(before);
    expect(service.getDraft(opened.targetId)?.content).toBe("用户编辑内容\n");
  });

  it("saveDraft 拒绝 UUID/BASE 变化且不落盘（三选一保存链同样复验）", async () => {
    const service = new DiffEditingService(deps);
    const opened = await openEditWithProbe(bindingProbe({}), service);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    service.checkpointDraft({
      targetId: opened.targetId,
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      baseHash: opened.baseHash,
      baseRevision: opened.baseRevision,
      baseContents: opened.baseContents,
      diskHash: opened.rawHash,
      targetPath: target,
      content: "用户编辑内容\n",
      baseRevisionOfClient: opened.draftRevision,
    });
    const before = await fs.readFile(target, "utf8");
    // UUID 变化
    const uuidChanged = await service.saveDraft({
      targetId: opened.targetId,
      scope,
      repositoryRoot,
      probeSvnBinding: bindingProbe({ repositoryUuid: "changed-uuid" }),
    });
    expect(uuidChanged.ok).toBe(false);
    if (!uuidChanged.ok) expect(uuidChanged.reason).toBe("scopeChanged");
    // BASE 变化
    const baseChanged = await service.saveDraft({
      targetId: opened.targetId,
      scope,
      repositoryRoot,
      probeSvnBinding: bindingProbe({
        baseHash: hashBytes(Buffer.from("new base", "utf8")),
      }),
    });
    expect(baseChanged.ok).toBe(false);
    if (!baseChanged.ok) expect(baseChanged.reason).toBe("diskChanged");
    // 均未落盘、草稿保留。
    expect(await fs.readFile(target, "utf8")).toBe(before);
    expect(service.getDraft(opened.targetId)?.content).toBe("用户编辑内容\n");
  });
});
