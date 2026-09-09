import { describe, expect, it } from "vitest";
import {
  buildShelfId,
  isSafeShelfId,
  loadShelfIndex,
  mergeLegacyPatchFiles,
  parseShelfIndexFile,
  resolveShelfPatchPath,
  saveShelfIndexAtomic,
  shelfPatchFileName,
  validateShelfDisplayName,
  type ShelfEntry,
  type ShelfIndexDeps,
} from "../../src/repository/shelfIndex";

function fakeDeps(options: {
  files?: Record<string, string>;
  dirFiles?: string[];
  failWrite?: boolean;
  failRename?: boolean;
}): ShelfIndexDeps & { written: Record<string, string>; removed: string[] } {
  const written: Record<string, string> = {};
  const removed: string[] = [];
  const files = options.files ?? {};
  const dirFiles = options.dirFiles ?? [];
  return {
    written,
    removed,
    readTextFile: async (p) => {
      if (p in written) return written[p];
      if (p in files) return files[p];
      const error = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    },
    writeTextFile: async (p, content) => {
      if (options.failWrite) throw new Error("存储不可写");
      written[p] = content;
    },
    renameFile: async (from, to) => {
      if (options.failRename) throw new Error("重命名失败");
      if (from in written) {
        written[to] = written[from];
        delete written[from];
        return;
      }
      if (from in files) {
        written[to] = files[from];
        return;
      }
      throw new Error("缺失临时文件");
    },
    removeFile: async (p) => {
      removed.push(p);
    },
    listDir: async () => [...dirFiles],
  };
}

describe("shelfIndex V024-R48 中文显示名分离", () => {
  it("中文与空格展示名通过校验", () => {
    expect(validateShelfDisplayName("修复登录", [])).toEqual([]);
    expect(validateShelfDisplayName("  修复 登录 v2  ", [])).toEqual([]);
  });

  it("空名称、超长、重复与控制字符被拒", () => {
    expect(validateShelfDisplayName("", [])).toContain("请输入搁置名称。");
    expect(validateShelfDisplayName("   ", [])).toContain("请输入搁置名称。");
    expect(validateShelfDisplayName("a".repeat(65), [])).toContain(
      "搁置名称不能超过 64 个字符。",
    );
    expect(validateShelfDisplayName("修复登录", ["修复登录"])).toContain(
      "已存在同名搁置，请换个名称或用日期/项目区分。",
    );
    expect(validateShelfDisplayName("a\0b", [])).toContain(
      "搁置名称包含不支持的控制字符。",
    );
    expect(validateShelfDisplayName("a\nb", [])).toContain(
      "搁置名称包含不支持的控制字符。",
    );
    expect(validateShelfDisplayName("../evil", ["x"])).toEqual([]);
  });

  it("内部 ID 独立于显示名且安全", () => {
    const id = buildShelfId(1700000000000, "ab/cd..ef\n12");
    expect(isSafeShelfId(id)).toBe(true);
    expect(id).not.toContain("/");
    expect(id).not.toContain(".");
    expect(shelfPatchFileName(id)).toBe(`${id}.patch`);
    expect(shelfPatchFileName("../evil")).toBeUndefined();
    expect(shelfPatchFileName("a/b")).toBeUndefined();
  });

  it("../、NUL、换行不能改变存储路径", () => {
    const dir = "/tmp/shelves/repo-1";
    expect(resolveShelfPatchPath(dir, "../evil.patch")).toBeUndefined();
    expect(resolveShelfPatchPath(dir, "a/b.patch")).toBeUndefined();
    expect(resolveShelfPatchPath(dir, "a\\b.patch")).toBeUndefined();
    expect(resolveShelfPatchPath(dir, "shelf-1.patch")).toContain(
      "shelf-1.patch",
    );
    // 平台无关：相对判定不依赖分隔符字面量。
    const resolved = resolveShelfPatchPath(dir, "shelf-1.patch");
    expect(resolved?.startsWith(dir)).toBe(true);
  });
});

describe("shelfIndex V024-R38 索引与迁移", () => {
  it("旧 ASCII 名称保持可检索", () => {
    const merged = mergeLegacyPatchFiles(
      [],
      ["wip-1700000000000.patch", "fix.patch"],
      {
        repositoryUuid: "repo-1",
        nowIso: "2026-09-08T00:00:00.000Z",
      },
    );
    expect(merged.migratedCount).toBe(2);
    expect(merged.entries.map((e) => e.displayName)).toContain("wip");
    expect(merged.entries.map((e) => e.displayName)).toContain("fix");
  });

  it("已索引条目不重复迁移", () => {
    const indexed: ShelfEntry[] = [
      {
        id: "shelf-1",
        displayName: "wip",
        createdAt: "2026-09-01T00:00:00.000Z",
        fileCount: 1,
        files: ["a.ts"],
        repositoryUuid: "repo-1",
        patchFileName: "shelf-1.patch",
        integrity: "ok",
      },
    ];
    const merged = mergeLegacyPatchFiles(
      indexed,
      ["shelf-1.patch", "new-1234567890123.patch"],
      {
        repositoryUuid: "repo-1",
      },
    );
    expect(merged.migratedCount).toBe(1);
    expect(merged.entries).toHaveLength(2);
  });

  it("损坏索引 fail-closed 为空清单", () => {
    expect(parseShelfIndexFile("not-json").entries).toEqual([]);
    expect(parseShelfIndexFile('{"entries":123}').entries).toEqual([]);
  });

  it("索引原子保存使用临时文件+重命名", async () => {
    const deps = fakeDeps({ dirFiles: [] });
    await saveShelfIndexAtomic(deps, "/shelves/repo-1/index.json", []);
    expect(Object.keys(deps.written)).toContain("/shelves/repo-1/index.json");
    expect(deps.removed).toEqual([]);
  });

  it("存储不可写时保存失败且清理临时文件", async () => {
    const deps = fakeDeps({ dirFiles: [], failRename: true });
    await expect(
      saveShelfIndexAtomic(deps, "/shelves/repo-1/index.json", []),
    ).rejects.toThrow("重命名失败");
    expect(deps.removed.length).toBeGreaterThan(0);
  });

  it("目录不可读与索引不可读均可注入且不抛错", async () => {
    const deps: ShelfIndexDeps = {
      readTextFile: async () => {
        const error = new Error("EACCES") as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      },
      writeTextFile: async () => {},
      renameFile: async () => {},
      removeFile: async () => {},
      listDir: async () => {
        const error = new Error("EACCES") as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      },
    };
    const loaded = await loadShelfIndex(deps, "/shelves/repo-1", "repo-1");
    expect(loaded.entries).toEqual([]);
    expect(loaded.issues.join(" ")).toMatch(/不可读|不可读/);
  });

  it("同仓库隔离：他仓库条目不返回", async () => {
    const indexContent = JSON.stringify({
      version: 1,
      entries: [
        {
          id: "a",
          displayName: "同名",
          createdAt: "2026-09-01T00:00:00.000Z",
          fileCount: 1,
          files: ["a"],
          repositoryUuid: "repo-other",
          patchFileName: "a.patch",
          integrity: "ok",
        },
        {
          id: "b",
          displayName: "同名",
          createdAt: "2026-09-02T00:00:00.000Z",
          fileCount: 1,
          files: ["b"],
          repositoryUuid: "repo-1",
          patchFileName: "b.patch",
          integrity: "ok",
        },
      ],
    });
    const deps = fakeDeps({
      files: { "/shelves/repo-1/index.json": indexContent },
      dirFiles: ["a.patch", "b.patch"],
    });
    const loaded = await loadShelfIndex(deps, "/shelves/repo-1", "repo-1");
    expect(loaded.entries.map((e) => e.id)).toEqual(["b"]);
  });

  it("P3-2：含控制字符/换行的旧文件名拒绝迁移并给出中文提示", () => {
    const merged = mergeLegacyPatchFiles(
      [],
      ["good-1700000000000.patch", "bad\nname.patch", "nul\0x.patch"],
      { repositoryUuid: "repo-1" },
    );
    expect(merged.migratedCount).toBe(1);
    expect(merged.entries).toHaveLength(1);
    expect(merged.entries[0].patchFileName).toBe("good-1700000000000.patch");
    expect(merged.issues.join("")).toContain(
      "控制字符或换行，已跳过该文件以保护存储路径",
    );
  });

  it("P3-2：拒绝项经 loadShelfIndex 透出中文提示且不落盘", async () => {
    const deps = fakeDeps({
      dirFiles: ["evil\n-1700000000000.patch"],
    });
    const loaded = await loadShelfIndex(deps, "/shelves/repo-1", "repo-1");
    expect(loaded.entries).toEqual([]);
    expect(loaded.migratedCount).toBe(0);
    expect(loaded.issues.join("")).toContain(
      "控制字符或换行，已跳过该文件以保护存储路径",
    );
  });
});
