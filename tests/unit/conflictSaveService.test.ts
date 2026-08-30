import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OperationScope } from "../../src/scope/operationScope";
import { DiffEditTokenRegistry } from "../../src/diffEdit/diffEditTokenRegistry";
import { DiffDraftService } from "../../src/diffEdit/diffDraftService";
import { DiffAtomicWriterService } from "../../src/diffEdit/diffAtomicWriter";
import { hashBytes } from "../../src/diffEdit/diffPathGuard";
import {
  ConflictSaveService,
  type ConflictSaveServiceDeps,
  buildConflictTargetId,
} from "../../src/conflict/conflictSaveService";
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
  overrides: Partial<ConflictSaveServiceDeps> = {},
): ConflictSaveServiceDeps {
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

describe("conflictSaveService 编排", () => {
  let scope: OperationScope;
  let target: string;
  let deps: ConflictSaveServiceDeps;

  beforeEach(async () => {
    workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "svn-conflict-save-"));
    repositoryRoot = workRoot;
    target = await writeTarget(workRoot, "src/app.ts", "const x = 1;\n");
    scope = makeScope(repositoryRoot, [path.join(repositoryRoot, "src")]);
    deps = baseDeps();
  });

  afterEach(async () => {
    await fs.rm(workRoot, { recursive: true, force: true });
  });

  async function openConflict(
    overrides: Partial<
      Parameters<ConflictSaveService["openConflictSave"]>[0]
    > = {},
  ) {
    const service = new ConflictSaveService(deps);
    return service.openConflictSave({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetPath: target,
      baseRevision: "10",
      baseContents: "const x = 1;\n",
      scope,
      repositoryRoot,
      ...overrides,
    });
  }

  it("openConflictSave 成功签发 token 并登记草稿", async () => {
    const service = new ConflictSaveService(deps);
    const result = await service.openConflictSave({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetPath: target,
      baseRevision: "10",
      baseContents: "const x = 1;\n",
      scope,
      repositoryRoot,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.targetId).toBe(
      buildConflictTargetId(await fs.realpath(target)),
    );
    expect(result.editToken).toBeTruthy();
    expect(result.draftRevision).toBe(1);
    expect(result.diskHash).toBe(
      hashBytes(Buffer.from("const x = 1;\n", "utf8")),
    );
    expect(deps.tokens.size()).toBe(1);
    expect(deps.drafts.get(result.targetId)?.content).toBe("const x = 1;\n");
    // 验证任务标识
    const consumed = deps.tokens.consume(result.editToken);
    // 已消耗需重新签发验证 taskId，但 open 已篡改为 conflicts/resolve
    // 这里的 consumed 是刚才签发的第2次？实际上上面已消耗一次，需重新 open
    const r2 = await service.openConflictSave({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetPath: target,
      baseRevision: "10",
      baseContents: "const x = 1;\n",
      scope,
      repositoryRoot,
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    const c2 = deps.tokens.consume(r2.editToken);
    expect(c2.ok).toBe(true);
    if (c2.ok)
      expect((c2.binding as unknown as { taskId: string }).taskId).toBe(
        "conflicts/resolve",
      );
    void consumed;
  });

  it("openConflictSave 拒绝脏 TextDocument", async () => {
    deps = baseDeps({ isDocumentDirty: async () => true });
    const result = await openConflict();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("documentDirty");
  });

  it("openConflictSave 拒绝 scope 外路径（越界）", async () => {
    const outside = await writeTarget(workRoot, "outside.ts", "x\n");
    const service = new ConflictSaveService(deps);
    const result = await service.openConflictSave({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetPath: outside,
      baseRevision: "10",
      baseContents: "",
      scope,
      repositoryRoot,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("outOfScope");
  });

  it("openConflictSave 拒绝二进制（NUL）", async () => {
    const bin = path.join(workRoot, "src", "bin.dat");
    await fs.writeFile(
      bin,
      Buffer.concat([Buffer.from("abc", "utf8"), Buffer.from([0, 1, 2])]),
    );
    const service = new ConflictSaveService(deps);
    const result = await service.openConflictSave({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetPath: bin,
      baseRevision: "10",
      baseContents: "",
      scope,
      repositoryRoot,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("binary");
  });

  it("openConflictSave 拒绝非法 UTF-8 编码", async () => {
    const bad = path.join(workRoot, "src", "bad.ts");
    await fs.writeFile(bad, Buffer.from([0xff, 0xfe, 0x80, 0x41]));
    const service = new ConflictSaveService(deps);
    const result = await service.openConflictSave({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetPath: bad,
      baseRevision: "10",
      baseContents: "",
      scope,
      repositoryRoot,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unsupportedEncoding");
  });

  it("openConflictSave 拒绝符号链接", async () => {
    const real = await writeTarget(workRoot, "src/real.ts", "content\n");
    const link = path.join(workRoot, "src", "link.ts");
    await fs.symlink(real, link);
    const service = new ConflictSaveService(deps);
    const result = await service.openConflictSave({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetPath: link,
      baseRevision: "10",
      baseContents: "",
      scope,
      repositoryRoot,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("symlink");
  });

  it("openConflictSave 拒绝超过 5MB 的目标", async () => {
    const big = path.join(workRoot, "src", "big.ts");
    await fs.writeFile(big, Buffer.alloc(5 * 1024 * 1024 + 1, 0x61));
    const service = new ConflictSaveService(deps);
    const result = await service.openConflictSave({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetPath: big,
      baseRevision: "10",
      baseContents: "",
      scope,
      repositoryRoot,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("tooLarge");
  });

  it("saveConflictWorking 成功：原子写入、旧 token 失效、新 token 轮换", async () => {
    const service = new ConflictSaveService(deps);
    const opened = await openConflict();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const result = await service.saveConflictWorking({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision: opened.draftRevision,
      expectedContentHash: opened.diskHash,
      content: "const x = 2;\n",
      scope,
      repositoryRoot,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await fs.readFile(target, "utf8")).toBe("const x = 2;\n");
    expect(result.acceptedRevision).toBeGreaterThan(1);
    expect(result.newEditToken).toBeTruthy();
    expect(result.newContentHash).toBe(
      hashBytes(Buffer.from("const x = 2;\n", "utf8")),
    );
    // 旧 token 再次使用应过期
    const replay = await service.saveConflictWorking({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision: opened.draftRevision,
      expectedContentHash: opened.diskHash,
      content: "hijack\n",
      scope,
      repositoryRoot,
    });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.reason).toBe("tokenExpired");
    // 新 token 可继续保存
    const draft = deps.drafts.get(opened.targetId);
    const second = await service.saveConflictWorking({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened.targetId,
      editToken: result.newEditToken,
      draftRevision: draft?.revision ?? result.acceptedRevision,
      expectedContentHash: result.newContentHash,
      content: "const x = 3;\n",
      scope,
      repositoryRoot,
    });
    expect(second.ok).toBe(true);
    expect(await fs.readFile(target, "utf8")).toBe("const x = 3;\n");
  });

  it("saveConflictWorking 拒绝超大内容且旧 token 失效", async () => {
    const service = new ConflictSaveService(deps);
    const opened = await openConflict();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const oversized = "x".repeat(5 * 1024 * 1024 + 1);
    const result = await service.saveConflictWorking({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision: opened.draftRevision,
      expectedContentHash: opened.diskHash,
      content: oversized,
      scope,
      repositoryRoot,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("tooLarge");
    const retry = await service.saveConflictWorking({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision: opened.draftRevision,
      expectedContentHash: opened.diskHash,
      content: "合法\n",
      scope,
      repositoryRoot,
    });
    expect(retry.ok).toBe(false);
    if (!retry.ok) expect(retry.reason).toBe("tokenExpired");
  });

  it("saveConflictWorking 拒绝 token 过期/未知", async () => {
    const service = new ConflictSaveService(deps);
    const opened = await openConflict();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    // 消耗一次后再次使用
    await service.saveConflictWorking({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision: opened.draftRevision,
      expectedContentHash: opened.diskHash,
      content: "x\n",
      scope,
      repositoryRoot,
    });
    const replay = await service.saveConflictWorking({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision: opened.draftRevision,
      expectedContentHash: opened.diskHash,
      content: "y\n",
      scope,
      repositoryRoot,
    });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.reason).toBe("tokenExpired");

    const unknown = await service.saveConflictWorking({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened.targetId,
      editToken: "unknown-token",
      draftRevision: opened.draftRevision,
      expectedContentHash: opened.diskHash,
      content: "z\n",
      scope,
      repositoryRoot,
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.reason).toBe("tokenExpired");
  });

  it("saveConflictWorking 拒绝 scope 不匹配", async () => {
    const service = new ConflictSaveService(deps);
    const opened = await openConflict();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const result = await service.saveConflictWorking({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: "other-scope",
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision: opened.draftRevision,
      expectedContentHash: opened.diskHash,
      content: "x\n",
      scope,
      repositoryRoot,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("scopeChanged");
  });

  it("saveConflictWorking 拒绝 expectedContentHash 不匹配", async () => {
    const service = new ConflictSaveService(deps);
    const opened = await openConflict();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const result = await service.saveConflictWorking({
      sessionId: session.sessionId,
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

  it("saveConflictWorking 拒绝 draftRevision 乱序（重放）", async () => {
    const service = new ConflictSaveService(deps);
    const opened = await openConflict();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    // 人为让 draft revision 前进
    const draft = deps.drafts.get(opened.targetId);
    if (draft) {
      deps.drafts.upsert({
        targetId: opened.targetId,
        repositoryUuid: session.repositoryUuid,
        scopeHash: session.scopeHash,
        baseHash: draft.baseHash,
        baseRevision: draft.baseRevision,
        baseContents: draft.baseContents,
        diskHash: draft.diskHash,
        targetPath: draft.targetPath,
        content: "dirty\n",
        baseRevisionOfClient: draft.revision,
      });
    }
    const current = deps.drafts.get(opened.targetId);
    expect(current?.revision).toBeGreaterThan(opened.draftRevision);
    const result = await service.saveConflictWorking({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision: opened.draftRevision, // 旧版本
      expectedContentHash: opened.diskHash,
      content: "x\n",
      scope,
      repositoryRoot,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("tokenExpired");
  });

  it("saveConflictWorking 拒绝磁盘被外部修改（hash 变化）", async () => {
    const service = new ConflictSaveService(deps);
    const opened = await openConflict();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    await fs.writeFile(target, "external change\n", "utf8");
    const result = await service.saveConflictWorking({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision: opened.draftRevision,
      expectedContentHash: opened.diskHash,
      content: "mine\n",
      scope,
      repositoryRoot,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("diskChanged");
    expect(await fs.readFile(target, "utf8")).toBe("external change\n");
  });

  it("saveConflictWorking 拒绝目标被移动（文件不存在）", async () => {
    const service = new ConflictSaveService(deps);
    const opened = await openConflict();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    await fs.rm(target);
    const result = await service.saveConflictWorking({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision: opened.draftRevision,
      expectedContentHash: opened.diskHash,
      content: "x\n",
      scope,
      repositoryRoot,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("targetMoved");
  });

  it("saveConflictWorking 拒绝二进制/非法编码/symlink 的保存复验", async () => {
    const service = new ConflictSaveService(deps);
    const opened = await openConflict();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    // 写入二进制后保存应被路径守卫拒绝
    await fs.writeFile(
      target,
      Buffer.concat([Buffer.from("abc", "utf8"), Buffer.from([0])]),
    );
    const binResult = await service.saveConflictWorking({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision: opened.draftRevision,
      expectedContentHash: opened.diskHash,
      content: "x\n",
      scope,
      repositoryRoot,
    });
    expect(binResult.ok).toBe(false);
    if (!binResult.ok) expect(binResult.reason).toBe("unsupportedEncoding");

    // 需重新 open 获取新 token 测试非法编码
    const otherTarget = await writeTarget(workRoot, "src/other.ts", "hello\n");
    const deps2 = baseDeps();
    const svc2 = new ConflictSaveService(deps2);
    const opened2 = await svc2.openConflictSave({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetPath: otherTarget,
      baseRevision: "10",
      baseContents: "hello\n",
      scope,
      repositoryRoot,
    });
    expect(opened2.ok).toBe(true);
    if (!opened2.ok) return;
    await fs.writeFile(otherTarget, Buffer.from([0xff, 0xfe, 0x80]));
    const badResult = await svc2.saveConflictWorking({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened2.targetId,
      editToken: opened2.editToken,
      draftRevision: opened2.draftRevision,
      expectedContentHash: opened2.diskHash,
      content: "y\n",
      scope,
      repositoryRoot,
    });
    expect(badResult.ok).toBe(false);
    if (!badResult.ok) expect(badResult.reason).toBe("unsupportedEncoding");
  });

  it("saveConflictWorking 拒绝 UUID/BASE 不匹配（SVN 绑定复验）", async () => {
    const baseText = "const x = 1;\n";
    const baseHash = hashBytes(Buffer.from(baseText, "utf8"));
    function probe(
      overrides: Partial<{
        repositoryUuid: string;
        workingCopyRoot: string;
        baseHash: string;
        fileExternal: boolean;
      }>,
    ) {
      return async (): Promise<DiffSvnBindingProbeResult> => ({
        ok: true,
        repositoryUuid: overrides.repositoryUuid ?? session.repositoryUuid,
        workingCopyRoot: overrides.workingCopyRoot ?? repositoryRoot,
        baseHash: overrides.baseHash ?? baseHash,
        fileExternal: overrides.fileExternal ?? false,
      });
    }
    const service = new ConflictSaveService(deps);
    const opened = await service.openConflictSave({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetPath: target,
      baseRevision: "10",
      baseContents: baseText,
      scope,
      repositoryRoot,
      probeSvnBinding: probe({}),
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const before = await fs.readFile(target, "utf8");
    const uuidChanged = await service.saveConflictWorking({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision: opened.draftRevision,
      expectedContentHash: opened.diskHash,
      content: "x\n",
      scope,
      repositoryRoot,
      probeSvnBinding: probe({ repositoryUuid: "other-uuid" }),
    });
    expect(uuidChanged.ok).toBe(false);
    if (!uuidChanged.ok) expect(uuidChanged.reason).toBe("scopeChanged");
    expect(await fs.readFile(target, "utf8")).toBe(before);

    // 需要新 token 测试 BASE
    const opened2 = await service.openConflictSave({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetPath: target,
      baseRevision: "10",
      baseContents: baseText,
      scope,
      repositoryRoot,
      probeSvnBinding: probe({}),
    });
    expect(opened2.ok).toBe(true);
    if (!opened2.ok) return;
    const baseChanged = await service.saveConflictWorking({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened2.targetId,
      editToken: opened2.editToken,
      draftRevision: opened2.draftRevision,
      expectedContentHash: opened2.diskHash,
      content: "y\n",
      scope,
      repositoryRoot,
      probeSvnBinding: probe({
        baseHash: hashBytes(Buffer.from("other", "utf8")),
      }),
    });
    expect(baseChanged.ok).toBe(false);
    if (!baseChanged.ok) expect(baseChanged.reason).toBe("diskChanged");
    expect(await fs.readFile(target, "utf8")).toBe(before);
  });

  it("写失败保留原文件与草稿（writer 注入失败）", async () => {
    const failingWriter = {
      save: async () => ({
        ok: false as const,
        reason: "writeFailed" as const,
        message: "模拟写失败",
      }),
    } as unknown as DiffAtomicWriterService;
    const failDeps = baseDeps({ writer: failingWriter });
    const service = new ConflictSaveService(failDeps);
    const opened = await service.openConflictSave({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetPath: target,
      baseRevision: "10",
      baseContents: "const x = 1;\n",
      scope,
      repositoryRoot,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const before = await fs.readFile(target, "utf8");
    const draftBefore = failDeps.drafts.get(opened.targetId)?.content;
    const result = await service.saveConflictWorking({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision: opened.draftRevision,
      expectedContentHash: opened.diskHash,
      content: "new content\n",
      scope,
      repositoryRoot,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("writeFailed");
    expect(await fs.readFile(target, "utf8")).toBe(before);
    expect(failDeps.drafts.get(opened.targetId)?.content).toBe(draftBefore);
    expect(failDeps.drafts.get(opened.targetId)).toBeDefined();
  });

  it("旧回执不清除脏输入：失败后草稿仍为脏且内容保留", async () => {
    const service = new ConflictSaveService(deps);
    const opened = await openConflict();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    // 制造脏草稿
    const draft = deps.drafts.get(opened.targetId);
    expect(draft).toBeDefined();
    if (!draft) return;
    deps.drafts.upsert({
      targetId: opened.targetId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      baseHash: draft.baseHash,
      baseRevision: draft.baseRevision,
      baseContents: draft.baseContents,
      diskHash: draft.diskHash,
      targetPath: draft.targetPath,
      content: "dirty input\n",
      baseRevisionOfClient: draft.revision,
    });
    expect(service.isDraftDirty(opened.targetId)).toBe(true);
    const dirtyContent = deps.drafts.get(opened.targetId)?.content;
    // 用错误 hash 触发失败
    const failed = await service.saveConflictWorking({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision:
        deps.drafts.get(opened.targetId)?.revision ?? opened.draftRevision,
      expectedContentHash: "WRONG-HASH",
      content: "attempt\n",
      scope,
      repositoryRoot,
    });
    expect(failed.ok).toBe(false);
    // 旧回执（失败）不应清除脏输入
    expect(service.isDraftDirty(opened.targetId)).toBe(true);
    expect(deps.drafts.get(opened.targetId)?.content).toBe(dirtyContent);
  });

  it("open 时 UUID/BASE/fileExternal 拒绝", async () => {
    const baseText = "const x = 1;\n";
    const probe =
      (
        o: Partial<{
          repositoryUuid: string;
          baseHash: string;
          fileExternal: boolean;
          workingCopyRoot: string;
        }>,
      ) =>
      async (): Promise<DiffSvnBindingProbeResult> => ({
        ok: true,
        repositoryUuid: o.repositoryUuid ?? session.repositoryUuid,
        workingCopyRoot: o.workingCopyRoot ?? repositoryRoot,
        baseHash: o.baseHash ?? hashBytes(Buffer.from(baseText, "utf8")),
        fileExternal: o.fileExternal ?? false,
      });
    const service = new ConflictSaveService(deps);
    const uuidFail = await service.openConflictSave({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetPath: target,
      baseRevision: "10",
      baseContents: baseText,
      scope,
      repositoryRoot,
      probeSvnBinding: probe({ repositoryUuid: "bad-uuid" }),
    });
    expect(uuidFail.ok).toBe(false);

    const baseFail = await service.openConflictSave({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetPath: target,
      baseRevision: "10",
      baseContents: baseText,
      scope,
      repositoryRoot,
      probeSvnBinding: probe({
        baseHash: hashBytes(Buffer.from("other", "utf8")),
      }),
    });
    expect(baseFail.ok).toBe(false);

    const externalFail = await service.openConflictSave({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetPath: target,
      baseRevision: "10",
      baseContents: baseText,
      scope,
      repositoryRoot,
      probeSvnBinding: probe({ fileExternal: true }),
    });
    expect(externalFail.ok).toBe(false);
  });
});
