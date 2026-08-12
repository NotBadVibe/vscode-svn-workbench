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
import type { DiffTargetFreshness } from "../../src/diffEdit/diffEditTypes";

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
});
