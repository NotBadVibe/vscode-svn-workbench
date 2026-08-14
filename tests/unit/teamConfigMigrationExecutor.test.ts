import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  executeTeamConfigMigration,
  nodeTeamConfigMigrationIo,
  type TeamConfigMigrationIo,
} from "../../src/config/teamConfigMigrationExecutor";
import { hashTeamConfigContent } from "../../src/config/teamConfigMigration";

/*
 * v0.0.7 §9 迁移事务执行层：成功、预检失败、目标竞态、源替换失败 +
 * 回滚成功/失败、复验失败全部覆盖；任何失败不得显示成功。
 */

const SOURCE = "/repo/code/.svn-workbench.json";
const TARGET = "/repo/code/EmApi/.svn-workbench.json";
const SOURCE_BEFORE = '{\n  "commitConvention": {},\n  "other": 1\n}\n';
const TARGET_CONTENT = '{\n  "commitConvention": {}\n}\n';
const SOURCE_AFTER = '{\n  "other": 1\n}\n';

function makeInput() {
  return {
    sourcePath: SOURCE,
    targetPath: TARGET,
    targetContent: TARGET_CONTENT,
    sourceContentAfter: SOURCE_AFTER,
    expectedSourceHash: hashTeamConfigContent(SOURCE_BEFORE),
  };
}

interface FakeFs {
  files: Map<string, string>;
  failWriteExclusive?: unknown;
  failReplace?: unknown;
  failRemove?: unknown;
  corruptOnRead?: Record<string, string>;
}

function makeIo(fake: FakeFs): TeamConfigMigrationIo & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    readFile: vi.fn(async (filePath: string) => {
      const value = fake.files.get(filePath);
      if (value === undefined) throw new Error("ENOENT");
      return value;
    }),
    exists: async (filePath: string) => fake.files.has(filePath),
    writeExclusive: vi.fn(async (filePath: string, content: string) => {
      calls.push(`writeExclusive:${filePath}`);
      if (fake.failWriteExclusive) throw fake.failWriteExclusive;
      if (fake.files.has(filePath)) {
        const error = new Error("EEXIST") as Error & { code: string };
        error.code = "EEXIST";
        throw error;
      }
      fake.files.set(filePath, content);
    }),
    replaceAtomic: vi.fn(async (filePath: string, content: string) => {
      calls.push(`replaceAtomic:${filePath}`);
      if (fake.failReplace) throw fake.failReplace;
      fake.files.set(filePath, content);
    }),
    removeFile: vi.fn(async (filePath: string) => {
      calls.push(`removeFile:${filePath}`);
      if (fake.failRemove) throw fake.failRemove;
      fake.files.delete(filePath);
    }),
  };
}

describe("迁移事务执行层（v0.0.7 §9）", () => {
  it("成功：排他创建目标、原子替换源、复验通过", async () => {
    const fake: FakeFs = { files: new Map([[SOURCE, SOURCE_BEFORE]]) };
    const io = makeIo(fake);
    const result = await executeTeamConfigMigration(io, makeInput());
    expect(result).toEqual({ ok: true });
    expect(fake.files.get(TARGET)).toBe(TARGET_CONTENT);
    expect(fake.files.get(SOURCE)).toBe(SOURCE_AFTER);
  });

  it("源哈希变化（预览过期）拒绝且不写任何文件", async () => {
    const fake: FakeFs = { files: new Map([[SOURCE, "changed"]]) };
    const io = makeIo(fake);
    const result = await executeTeamConfigMigration(io, makeInput());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("precheck");
    expect(result.error).toContain("已变化");
    expect(io.writeExclusive).not.toHaveBeenCalled();
  });

  it("目标预检已存在拒绝", async () => {
    const fake: FakeFs = {
      files: new Map([
        [SOURCE, SOURCE_BEFORE],
        [TARGET, "existing"],
      ]),
    };
    const result = await executeTeamConfigMigration(makeIo(fake), makeInput());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("precheck");
    expect(result.error).toContain("已存在");
  });

  it("目标竞态创建（EEXIST）按竞态处理且不覆盖", async () => {
    const fake: FakeFs = {
      files: new Map([[SOURCE, SOURCE_BEFORE]]),
      failWriteExclusive: Object.assign(new Error("EEXIST"), {
        code: "EEXIST",
      }),
    };
    const result = await executeTeamConfigMigration(makeIo(fake), makeInput());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("target-create");
    expect(result.error).toContain("被其他操作创建");
    expect(fake.files.has(TARGET)).toBe(false);
    expect(fake.files.get(SOURCE)).toBe(SOURCE_BEFORE);
  });

  it("目标创建失败（非竞态）不触碰源", async () => {
    const fake: FakeFs = {
      files: new Map([[SOURCE, SOURCE_BEFORE]]),
      failWriteExclusive: new Error("EROFS 只读文件系统"),
    };
    const result = await executeTeamConfigMigration(makeIo(fake), makeInput());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("target-create");
    expect(fake.files.get(SOURCE)).toBe(SOURCE_BEFORE);
  });

  it("源替换失败且回滚成功：删除本次目标，保持迁移前状态", async () => {
    const fake: FakeFs = {
      files: new Map([[SOURCE, SOURCE_BEFORE]]),
      failReplace: new Error("EIO"),
    };
    const result = await executeTeamConfigMigration(makeIo(fake), makeInput());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("source-replace");
    expect(result.rolledBack).toBe(true);
    expect(fake.files.has(TARGET)).toBe(false);
    expect(fake.files.get(SOURCE)).toBe(SOURCE_BEFORE);
  });

  it("源替换失败且目标已被他人改写：不回滚并给出人工恢复步骤", async () => {
    const fake: FakeFs = {
      files: new Map([[SOURCE, SOURCE_BEFORE]]),
      failReplace: new Error("EIO"),
    };
    const io = makeIo(fake);
    // 目标创建后被外部改写：回滚保护拒绝删除。
    (io.writeExclusive as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (filePath: string) => {
        fake.files.set(filePath, "someone-else-content");
      },
    );
    const result = await executeTeamConfigMigration(io, makeInput());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("source-replace");
    expect(result.rolledBack).toBe(false);
    expect(result.error).toContain("半完成状态");
    expect(result.recovery.join("\n")).toContain(TARGET);
    expect(result.recovery.join("\n")).toContain(SOURCE);
    // 目标未被误删。
    expect(fake.files.get(TARGET)).toBe("someone-else-content");
  });

  it("源替换失败且回滚删除失败：结构化 partial 结果", async () => {
    const fake: FakeFs = {
      files: new Map([[SOURCE, SOURCE_BEFORE]]),
      failReplace: new Error("EIO"),
      failRemove: new Error("EPERM"),
    };
    const result = await executeTeamConfigMigration(makeIo(fake), makeInput());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rolledBack).toBe(false);
    expect(result.error).toContain("EPERM");
    expect(result.recovery.length).toBeGreaterThan(0);
  });

  it("源复验失败且双回滚成功：源恢复为迁移前内容、目标删除", async () => {
    const fake: FakeFs = { files: new Map([[SOURCE, SOURCE_BEFORE]]) };
    const io = makeIo(fake);
    // 第一次 replaceAtomic（迁移写源）写坏内容，第二次（恢复源）正常。
    (io.replaceAtomic as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (filePath: string) => {
        fake.files.set(filePath, "corrupted");
      },
    );
    const result = await executeTeamConfigMigration(io, makeInput());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("verify");
    expect(result.rolledBack).toBe(true);
    expect(result.error).toContain("已回滚到迁移前状态");
    // 关键安全断言：源恢复为迁移前内容，迁移键不丢失。
    expect(fake.files.get(SOURCE)).toBe(SOURCE_BEFORE);
    expect(fake.files.has(TARGET)).toBe(false);
  });

  it("目标复验失败且双回滚成功", async () => {
    const fake: FakeFs = { files: new Map([[SOURCE, SOURCE_BEFORE]]) };
    const io = makeIo(fake);
    // 目标创建后的第一次读回（复验）被篡改，之后读取返回真实内容。
    const originalRead = io.readFile;
    let tamperOnce = true;
    io.readFile = (async (filePath: string) => {
      const value = await originalRead(filePath);
      if (tamperOnce && filePath === TARGET && fake.files.has(TARGET)) {
        tamperOnce = false;
        return "tampered";
      }
      return value;
    }) as typeof io.readFile;
    const result = await executeTeamConfigMigration(io, makeInput());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("verify");
    expect(result.rolledBack).toBe(true);
    expect(fake.files.get(SOURCE)).toBe(SOURCE_BEFORE);
    expect(fake.files.has(TARGET)).toBe(false);
  });

  it("复验失败且恢复源失败：不回滚完成，报告源可能丢键", async () => {
    const fake: FakeFs = { files: new Map([[SOURCE, SOURCE_BEFORE]]) };
    const io = makeIo(fake);
    let replaceCalls = 0;
    (io.replaceAtomic as ReturnType<typeof vi.fn>).mockImplementation(
      async (filePath: string) => {
        replaceCalls += 1;
        if (replaceCalls === 1) {
          fake.files.set(filePath, "corrupted");
          return;
        }
        throw new Error("EIO 恢复失败");
      },
    );
    const result = await executeTeamConfigMigration(io, makeInput());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rolledBack).toBe(false);
    expect(result.error).toContain("恢复失败");
    expect(result.error).toContain("团队规则键可能已缺失");
    expect(result.recovery.join("\n")).toContain(SOURCE);
    // 目标仍被删除（目标回滚成功）。
    expect(fake.files.has(TARGET)).toBe(false);
  });

  it("复验失败且删除目标失败：源已恢复但目标需人工核对", async () => {
    const fake: FakeFs = { files: new Map([[SOURCE, SOURCE_BEFORE]]) };
    const io = makeIo(fake);
    let replaceCalls = 0;
    (io.replaceAtomic as ReturnType<typeof vi.fn>).mockImplementation(
      async (filePath: string, content: string) => {
        replaceCalls += 1;
        if (replaceCalls === 1) {
          fake.files.set(filePath, "corrupted");
          return;
        }
        fake.files.set(filePath, content);
      },
    );
    fake.failRemove = new Error("EPERM");
    const result = await executeTeamConfigMigration(io, makeInput());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rolledBack).toBe(false);
    expect(result.error).toContain("已恢复为迁移前内容");
    expect(result.error).toContain("需人工核对");
    expect(fake.files.get(SOURCE)).toBe(SOURCE_BEFORE);
  });

  it("复验失败且两个补偿动作均失败：结构化 partial 与人工步骤", async () => {
    const fake: FakeFs = { files: new Map([[SOURCE, SOURCE_BEFORE]]) };
    const io = makeIo(fake);
    let replaceCalls = 0;
    (io.replaceAtomic as ReturnType<typeof vi.fn>).mockImplementation(
      async (filePath: string) => {
        replaceCalls += 1;
        if (replaceCalls === 1) {
          // 迁移写源“成功”但内容错误，触发复验失败。
          fake.files.set(filePath, "corrupted");
          return;
        }
        // 恢复源失败。
        throw new Error("EIO");
      },
    );
    fake.failRemove = new Error("EPERM");
    const result = await executeTeamConfigMigration(io, makeInput());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("verify");
    expect(result.rolledBack).toBe(false);
    expect(result.error).toContain("恢复失败");
    expect(result.error).toContain("需人工核对");
    expect(result.recovery.join("\n")).toContain(TARGET);
    expect(result.recovery.join("\n")).toContain(SOURCE);
  });

  it("复验失败且目标被外部改写：不误删目标，仍恢复源", async () => {
    const fake: FakeFs = { files: new Map([[SOURCE, SOURCE_BEFORE]]) };
    const io = makeIo(fake);
    let replaceCalls = 0;
    (io.replaceAtomic as ReturnType<typeof vi.fn>).mockImplementation(
      async (filePath: string, content: string) => {
        replaceCalls += 1;
        if (replaceCalls === 1) {
          fake.files.set(filePath, "corrupted");
          return;
        }
        fake.files.set(filePath, content);
      },
    );
    // 目标创建后被外部改写。
    (io.writeExclusive as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (filePath: string) => {
        fake.files.set(filePath, "someone-else-content");
      },
    );
    const result = await executeTeamConfigMigration(io, makeInput());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rolledBack).toBe(false);
    expect(result.error).toContain("需人工核对");
    // 外部内容不被误删，源已恢复。
    expect(fake.files.get(TARGET)).toBe("someone-else-content");
    expect(fake.files.get(SOURCE)).toBe(SOURCE_BEFORE);
  });
});

describe("迁移事务执行层（真实文件 IO）", () => {
  let tempRoot: string;
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "svn-migrate-io-"));
  });
  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("端到端：目标排他创建、源原子替换保留其他键、复验通过", async () => {
    const source = path.join(tempRoot, "code", ".svn-workbench.json");
    const target = path.join(tempRoot, "code", "EmApi", ".svn-workbench.json");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(source, SOURCE_BEFORE, "utf8");
    const result = await executeTeamConfigMigration(nodeTeamConfigMigrationIo, {
      sourcePath: source,
      targetPath: target,
      targetContent: TARGET_CONTENT,
      sourceContentAfter: SOURCE_AFTER,
      expectedSourceHash: hashTeamConfigContent(SOURCE_BEFORE),
    });
    expect(result).toEqual({ ok: true });
    expect(await fs.readFile(target, "utf8")).toBe(TARGET_CONTENT);
    expect(await fs.readFile(source, "utf8")).toBe(SOURCE_AFTER);
    // 无遗留临时文件。
    const leftovers = (await fs.readdir(path.dirname(source))).filter((name) =>
      name.includes(".migrate-"),
    );
    expect(leftovers).toEqual([]);
  });

  it("真实排他创建：目标已存在时 EEXIST 且不覆盖", async () => {
    const source = path.join(tempRoot, ".svn-workbench.json");
    const target = path.join(tempRoot, "proj", ".svn-workbench.json");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(source, SOURCE_BEFORE, "utf8");
    await fs.writeFile(target, "keep-me", "utf8");
    const result = await executeTeamConfigMigration(nodeTeamConfigMigrationIo, {
      sourcePath: source,
      targetPath: target,
      targetContent: TARGET_CONTENT,
      sourceContentAfter: SOURCE_AFTER,
      expectedSourceHash: hashTeamConfigContent(SOURCE_BEFORE),
    });
    expect(result.ok).toBe(false);
    expect(await fs.readFile(target, "utf8")).toBe("keep-me");
    expect(await fs.readFile(source, "utf8")).toBe(SOURCE_BEFORE);
  });
});
