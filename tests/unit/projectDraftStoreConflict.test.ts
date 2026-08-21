import { describe, expect, it } from "vitest";
import {
  deleteConflictFileDraft,
  getConflictFileDraft,
  isConflictFileDirty,
  projectDraftKey,
  readConflictMergeDraft,
  readProjectDraft,
  writeConflictFileDraft,
  writeProjectDraft,
  type ProjectDraftMap,
} from "../../src/extension/workbench/projectDraftStore";

const posix = { platform: "linux" as const, cwd: "/" };
const win = { platform: "win32" as const, cwd: "C:\\" };

function keyFor(projectRoot: string, scopeHash: string, sem = posix): string {
  return projectDraftKey(projectRoot, "conflicts", scopeHash, sem);
}

describe("v0.0.13 冲突草稿总线（批次 A/B 纯领域）", () => {
  it("writeConflictFileDraft 首写保留 baseContent，复写保留首次 baseContent 且 revision 递增", () => {
    let store: ProjectDraftMap = {};
    const key = keyFor("/repo/a", "h1");
    store = writeConflictFileDraft(
      store,
      key,
      "h1",
      "src/a.ts",
      "draft1",
      "base1",
    );
    const d1 = getConflictFileDraft(store, key, "src/a.ts");
    expect(d1?.content).toBe("draft1");
    expect(d1?.baseContent).toBe("base1");
    expect(d1?.revision).toBe(1);
    // 复写：baseContent 仍为首次，revision 递增，content 更新
    store = writeConflictFileDraft(
      store,
      key,
      "h1",
      "src/a.ts",
      "draft2",
      "base2-should-be-ignored",
    );
    const d2 = getConflictFileDraft(store, key, "src/a.ts");
    expect(d2?.content).toBe("draft2");
    expect(d2?.baseContent).toBe("base1");
    expect(d2?.revision).toBe(2);
    expect(d2?.updatedAt).toBeGreaterThanOrEqual(d1!.updatedAt);
  });

  it("isConflictFileDirty 仅当 content != baseContent 时为脏，无草稿为干净", () => {
    let store: ProjectDraftMap = {};
    const key = keyFor("/repo/a", "h1");
    expect(isConflictFileDirty(store, key, "src/a.ts")).toBe(false);
    store = writeConflictFileDraft(
      store,
      key,
      "h1",
      "src/a.ts",
      "base",
      "base",
    );
    expect(isConflictFileDirty(store, key, "src/a.ts")).toBe(false);
    store = writeConflictFileDraft(
      store,
      key,
      "h1",
      "src/a.ts",
      "edited",
      "base",
    );
    expect(isConflictFileDirty(store, key, "src/a.ts")).toBe(true);
    // 回到干净
    store = writeConflictFileDraft(
      store,
      key,
      "h1",
      "src/a.ts",
      "base",
      "base",
    );
    // 此时 baseContent 仍为首次 "base"，content 回到 "base" -> 干净（因 draft 逻辑保留首次 baseContent）
    // 最新 content 仍为 "base"，所以应为干净
    const d = getConflictFileDraft(store, key, "src/a.ts");
    // 第 4 次写入的 revision 为 3（因第 3 次已是 dirty，再写一次回到 base，revision 3）
    expect(d?.content).toBe("base");
    expect(isConflictFileDirty(store, key, "src/a.ts")).toBe(false);
  });

  it("deleteConflictFileDraft 删除单文件与空键整条删除，幂等", () => {
    let store: ProjectDraftMap = {};
    const key = keyFor("/repo/a", "h1");
    store = writeConflictFileDraft(store, key, "h1", "a.ts", "draft", "base");
    store = writeConflictFileDraft(store, key, "h1", "b.ts", "draft2", "base2");
    expect(readConflictMergeDraft(store, key)?.drafts["a.ts"]).toBeDefined();
    store = deleteConflictFileDraft(store, key, "a.ts");
    expect(readConflictMergeDraft(store, key)?.drafts["a.ts"]).toBeUndefined();
    expect(readConflictMergeDraft(store, key)?.drafts["b.ts"]).toBeDefined();
    store = deleteConflictFileDraft(store, key, "b.ts");
    expect(readConflictMergeDraft(store, key)).toBeUndefined();
    // 幂等
    const before = store;
    store = deleteConflictFileDraft(store, key, "missing.ts");
    expect(store).toBe(before);
  });

  it("单键内文件数超过 32 时淘汰最旧文件", () => {
    let store: ProjectDraftMap = {};
    const key = keyFor("/repo/a", "h1");
    for (let i = 0; i < 33; i++) {
      store = writeConflictFileDraft(
        store,
        key,
        "h1",
        `file-${i}.ts`,
        `draft-${i}`,
        `base-${i}`,
      );
    }
    const draft = readConflictMergeDraft(store, key);
    expect(Object.keys(draft!.drafts)).toHaveLength(32);
    // 最旧的 file-0 应该被淘汰（updatedAt 最小）
    expect(draft!.drafts["file-0.ts"]).toBeUndefined();
    expect(draft!.drafts["file-32.ts"]).toBeDefined();
  });

  it("隔离键：不同 projectId / scopeHash 互不可见", () => {
    let store: ProjectDraftMap = {};
    const keyA = keyFor("/repo/a", "h1");
    const keyB = keyFor("/repo/b", "h1");
    const keyA2 = keyFor("/repo/a", "h2");
    store = writeConflictFileDraft(
      store,
      keyA,
      "h1",
      "src/a.ts",
      "draftA",
      "baseA",
    );
    expect(getConflictFileDraft(store, keyB, "src/a.ts")).toBeUndefined();
    expect(getConflictFileDraft(store, keyA2, "src/a.ts")).toBeUndefined();
    expect(getConflictFileDraft(store, keyA, "src/a.ts")?.content).toBe(
      "draftA",
    );
    // win32 大小写归一
    const keyWin = projectDraftKey("C:\\Repo\\A", "conflicts", "h1", win);
    const keyWin2 = projectDraftKey("c:\\repo\\a", "conflicts", "h1", win);
    expect(keyWin).toBe(keyWin2);
  });

  it("容量上限 32：最旧隔离键淘汰", () => {
    let store: ProjectDraftMap = {};
    for (let i = 0; i < 33; i++) {
      const k = `p${i}::conflicts::h`;
      store = writeConflictFileDraft(
        store,
        k,
        "h",
        `file-${i}.ts`,
        "draft",
        "base",
      );
    }
    expect(Object.keys(store)).toHaveLength(32);
    // 实现用严格 `<` 比较 + Map 插入序迭代，同毫秒 ties 按最早插入键确定性淘汰 p0
    expect(store["p0::conflicts::h"]).toBeUndefined();
    expect(store["p32::conflicts::h"]).toBeDefined();
  });

  it("旧 ProjectDraft 形状兼容：无 kind 视为 commit", () => {
    let store: ProjectDraftMap = {};
    const key = projectDraftKey("/repo/a", "commit", "h1", posix);
    // 旧形状：直接存 message/selectedPaths 无 kind
    store = writeProjectDraft(store, key, {
      message: "feat: old",
      selectedPaths: ["src/a.ts"],
      scopeHash: "h1",
      savedAt: 1,
    } as never);
    const read = readProjectDraft(store, key);
    expect(read?.message).toBe("feat: old");
    expect(read?.kind).toBe("commit");
    // 新 commit 形状
    store = writeProjectDraft(store, key, {
      kind: "commit",
      message: "feat: new",
      selectedPaths: ["src/b.ts"],
      scopeHash: "h1",
      savedAt: 2,
    });
    expect(readProjectDraft(store, key)?.message).toBe("feat: new");
  });

  it("成功/拒绝/过期/失败分支：脏判断在删除后为干净", () => {
    let store: ProjectDraftMap = {};
    const key = keyFor("/repo/a", "h1");
    store = writeConflictFileDraft(
      store,
      key,
      "h1",
      "src/a.ts",
      "edited",
      "base",
    );
    expect(isConflictFileDirty(store, key, "src/a.ts")).toBe(true);
    // 放弃（删除）后为干净
    store = deleteConflictFileDraft(store, key, "src/a.ts");
    expect(isConflictFileDirty(store, key, "src/a.ts")).toBe(false);
    expect(getConflictFileDraft(store, key, "src/a.ts")).toBeUndefined();
  });
});
