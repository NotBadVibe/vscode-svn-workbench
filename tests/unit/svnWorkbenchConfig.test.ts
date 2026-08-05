import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SVN_WORKBENCH_CONFIG_FILE,
  describeSvnWorkbenchConfigError,
  ensureSvnWorkbenchConfigFile,
  getSvnWorkbenchConfigPath,
  mergeSvnWorkbenchConfigContent,
  parseSvnWorkbenchConfigContent,
  readSvnWorkbenchConfig,
  removeSvnWorkbenchConfigKey,
  serializeSvnWorkbenchConfig,
  updateSvnWorkbenchConfig,
} from "../../src/config/svnWorkbenchConfig";

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "svn-workbench-config-test-"),
  );
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

async function writeConfig(content: string): Promise<void> {
  await fs.writeFile(
    path.join(tempRoot, SVN_WORKBENCH_CONFIG_FILE),
    content,
    "utf8",
  );
}

describe("readSvnWorkbenchConfig", () => {
  it("文件不存在时返回 exists=false 且无警告", async () => {
    const result = await readSvnWorkbenchConfig(tempRoot);
    expect(result.configPath).toBe(
      path.join(tempRoot, SVN_WORKBENCH_CONFIG_FILE),
    );
    expect(result.exists).toBe(false);
    expect(result.raw).toBeUndefined();
    expect(result.warnings).toEqual([]);
    expect(result.readError).toBeUndefined();
  });

  it("无效 JSON 时容错并给出“不是合法 JSON”警告", async () => {
    await writeConfig("{ bad json");
    const result = await readSvnWorkbenchConfig(tempRoot);
    expect(result.exists).toBe(true);
    expect(result.raw).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("不是合法 JSON");
  });

  it("顶层不是 JSON 对象时给出固定警告", async () => {
    await writeConfig('["commitConvention"]');
    const result = await readSvnWorkbenchConfig(tempRoot);
    expect(result.exists).toBe(true);
    expect(result.raw).toBeUndefined();
    expect(result.warnings).toEqual([
      `${SVN_WORKBENCH_CONFIG_FILE} 顶层必须是 JSON 对象。`,
    ]);
  });

  it("合法对象一次解析并完整返回未知键", async () => {
    await writeConfig(
      JSON.stringify({
        commitConvention: { enabled: true },
        commitCandidateFilterPresets: [],
        teamCustomKey: { note: "团队自定义" },
      }),
    );
    const result = await readSvnWorkbenchConfig(tempRoot);
    expect(result.exists).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.raw).toEqual({
      commitConvention: { enabled: true },
      commitCandidateFilterPresets: [],
      teamCustomKey: { note: "团队自定义" },
    });
  });

  it("非 ENOENT 读取错误放入 readError 而不抛出", async () => {
    await fs.mkdir(path.join(tempRoot, SVN_WORKBENCH_CONFIG_FILE));
    const result = await readSvnWorkbenchConfig(tempRoot);
    expect(result.exists).toBe(false);
    expect(result.raw).toBeUndefined();
    expect(result.warnings).toEqual([]);
    expect(result.readError).toBeDefined();
    expect(typeof describeSvnWorkbenchConfigError(result.readError)).toBe(
      "string",
    );
  });
});

describe("mergeSvnWorkbenchConfigContent", () => {
  it("合并未知键后写回，未知键保持不变", () => {
    const original = serializeSvnWorkbenchConfig({
      commitConvention: { enabled: true },
      teamCustomKey: { note: "保留我" },
    });
    const result = mergeSvnWorkbenchConfigContent(original, {
      commitConvention: { enabled: false },
    });
    expect(result.warnings).toEqual([]);
    expect(JSON.parse(result.content)).toEqual({
      commitConvention: { enabled: false },
      teamCustomKey: { note: "保留我" },
    });
  });

  it("同一次合并可以写入多个互不破坏的键", () => {
    const original = serializeSvnWorkbenchConfig({
      teamCustomKey: [1, 2, 3],
    });
    const result = mergeSvnWorkbenchConfigContent(original, {
      commitConvention: { enabled: true },
      commitCandidateFilterPresets: [{ id: "teamDocs" }],
    });
    expect(result.warnings).toEqual([]);
    expect(JSON.parse(result.content)).toEqual({
      teamCustomKey: [1, 2, 3],
      commitConvention: { enabled: true },
      commitCandidateFilterPresets: [{ id: "teamDocs" }],
    });
  });

  it("无效 JSON 保存时重建并给出警告", () => {
    const result = mergeSvnWorkbenchConfigContent("{ bad json", {
      commitConvention: { enabled: true },
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("不是合法 JSON，保存时已重建");
    expect(JSON.parse(result.content)).toEqual({
      commitConvention: { enabled: true },
    });
  });

  it("顶层不是对象保存时重建并给出警告", () => {
    const result = mergeSvnWorkbenchConfigContent('"text"', {
      commitConvention: { enabled: true },
    });
    expect(result.warnings).toEqual([
      `${SVN_WORKBENCH_CONFIG_FILE} 顶层不是对象，保存时已重建。`,
    ]);
    expect(JSON.parse(result.content)).toEqual({
      commitConvention: { enabled: true },
    });
  });

  it("空内容直接写入 updates，不产生警告", () => {
    const result = mergeSvnWorkbenchConfigContent("  \n", {
      commitCandidateFilterPresets: [],
    });
    expect(result.warnings).toEqual([]);
    expect(JSON.parse(result.content)).toEqual({
      commitCandidateFilterPresets: [],
    });
  });
});

describe("ensureSvnWorkbenchConfigFile", () => {
  it("文件缺失时写入默认内容", async () => {
    const configPath = await ensureSvnWorkbenchConfigFile(
      tempRoot,
      serializeSvnWorkbenchConfig({ commitConvention: { enabled: true } }),
    );
    expect(configPath).toBe(getSvnWorkbenchConfigPath(tempRoot));
    const content = await fs.readFile(configPath, "utf8");
    expect(JSON.parse(content)).toEqual({
      commitConvention: { enabled: true },
    });
  });

  it("文件已存在时不覆盖现有内容", async () => {
    await writeConfig(JSON.stringify({ teamCustomKey: "不要动" }));
    const configPath = await ensureSvnWorkbenchConfigFile(
      tempRoot,
      serializeSvnWorkbenchConfig({ commitConvention: { enabled: true } }),
    );
    const content = await fs.readFile(configPath, "utf8");
    expect(JSON.parse(content)).toEqual({ teamCustomKey: "不要动" });
  });
});

describe("updateSvnWorkbenchConfig", () => {
  it("连续写入不同配置键互不破坏，未知键保留", async () => {
    await writeConfig(
      serializeSvnWorkbenchConfig({
        commitConvention: { enabled: false },
        teamCustomKey: { note: "团队自定义" },
      }),
    );

    const first = await updateSvnWorkbenchConfig(
      tempRoot,
      { commitCandidateFilterPresets: [{ id: "teamDocs", label: "文档" }] },
      serializeSvnWorkbenchConfig({}),
    );
    expect(first.warnings).toEqual([]);

    const second = await updateSvnWorkbenchConfig(
      tempRoot,
      { commitConvention: { enabled: true, requiredPrefix: true } },
      serializeSvnWorkbenchConfig({}),
    );
    expect(second.warnings).toEqual([]);

    const content = await fs.readFile(second.configPath, "utf8");
    expect(JSON.parse(content)).toEqual({
      commitConvention: { enabled: true, requiredPrefix: true },
      commitCandidateFilterPresets: [{ id: "teamDocs", label: "文档" }],
      teamCustomKey: { note: "团队自定义" },
    });
  });

  it("文件缺失时先写入默认内容再合并 updates", async () => {
    const result = await updateSvnWorkbenchConfig(
      tempRoot,
      { commitCandidateFilterPresets: [] },
      serializeSvnWorkbenchConfig({ commitConvention: { enabled: true } }),
    );
    expect(result.warnings).toEqual([]);
    const content = await fs.readFile(result.configPath, "utf8");
    expect(JSON.parse(content)).toEqual({
      commitConvention: { enabled: true },
      commitCandidateFilterPresets: [],
    });
  });
});

describe("removeSvnWorkbenchConfigKey", () => {
  it("删除目标键并保留其他键与未知字段", () => {
    const original = serializeSvnWorkbenchConfig({
      commitConvention: { enabled: true },
      commitSelection: { version: 1, statusRules: { normal: "excluded" } },
      teamCustomKey: { note: "保留我" },
    });
    const result = removeSvnWorkbenchConfigKey(original, "commitSelection");
    expect(result).toMatchObject({ ok: true, removed: true });
    if (result.ok) {
      expect(JSON.parse(result.content)).toEqual({
        commitConvention: { enabled: true },
        teamCustomKey: { note: "保留我" },
      });
    }
  });

  it("键不存在时幂等：removed=false 且不产生新内容", () => {
    const original = serializeSvnWorkbenchConfig({
      commitConvention: { enabled: true },
    });
    const result = removeSvnWorkbenchConfigKey(original, "commitSelection");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.removed).toBe(false);
      expect(result.content).toBe(original);
    }
  });

  it("空内容视为无配置：removed=false", () => {
    const result = removeSvnWorkbenchConfigKey("  \n", "commitSelection");
    expect(result).toMatchObject({ ok: true, removed: false });
  });

  it("非法 JSON 拒绝删除并给出中文错误，不重建文件", () => {
    const result = removeSvnWorkbenchConfigKey("{ bad json", "commitSelection");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("不是合法 JSON");
      expect(result.error).toContain("无法安全删除");
      expect(result.error).toContain("commitSelection");
    }
  });

  it("顶层不是 JSON 对象时拒绝删除", () => {
    const result = removeSvnWorkbenchConfigKey('["a"]', "commitSelection");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("顶层不是 JSON 对象");
    }
  });
});

describe("序列化与解析格式", () => {
  it("serializeSvnWorkbenchConfig 输出两格缩进并以换行结尾", () => {
    const content = serializeSvnWorkbenchConfig({ a: 1 });
    expect(content).toBe('{\n  "a": 1\n}\n');
  });

  it("parseSvnWorkbenchConfigContent 与读取路径共用同一套警告", () => {
    const invalid = parseSvnWorkbenchConfigContent("{ bad json");
    expect(invalid.raw).toBeUndefined();
    expect(invalid.warnings).toHaveLength(1);
    expect(invalid.warnings[0]).toContain("不是合法 JSON");

    const notObject = parseSvnWorkbenchConfigContent("42");
    expect(notObject.raw).toBeUndefined();
    expect(notObject.warnings).toEqual([
      `${SVN_WORKBENCH_CONFIG_FILE} 顶层必须是 JSON 对象。`,
    ]);

    const ok = parseSvnWorkbenchConfigContent('{"a":1}');
    expect(ok.raw).toEqual({ a: 1 });
    expect(ok.warnings).toEqual([]);
  });
});
