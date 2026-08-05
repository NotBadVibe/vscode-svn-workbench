/**
 * commitSelectionRuleService 单元测试（v0.0.3 阶段 2）：按仓库解析与缓存、
 * 配置变更/仓库文件变更失效、失效事件、解析失败降级。
 * 规划依据：docs/releases/v0.0.3/README.md 第 5.3、7.3、8 节。
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CommitSelectionRuleService,
  readRepositoryCommitSelectionLayer,
} from "../../src/commit/commitSelectionRuleService";
import {
  builtinCommitSelectionPathRules,
  defaultCommitSelectionStatusRules,
} from "../../src/commit/commitSelectionRules";

describe("CommitSelectionRuleService 缓存与解析", () => {
  it("同一仓库第二次解析命中缓存，不重复读取来源", async () => {
    const readRepositoryLayer = vi.fn(async () => ({
      layer: { statusRules: { unversioned: "recommended" } },
      warnings: [],
    }));
    const service = new CommitSelectionRuleService({
      readVscodeLayers: () => ({}),
      readRepositoryLayer,
    });

    const first = await service.getEffectiveRules("/repo-a");
    const second = await service.getEffectiveRules("/repo-a");

    expect(second).toBe(first);
    expect(readRepositoryLayer).toHaveBeenCalledTimes(1);
    expect(first.statusRules.unversioned).toBe("recommended");
    expect(first.layers.repository.state).toBe("applied");
  });

  it("不同仓库分别缓存，VS Code 用户/工作区层参与合并", async () => {
    const service = new CommitSelectionRuleService({
      readVscodeLayers: () => ({
        user: { statusRules: { missing: "excluded" } },
        workspace: { statusRules: { unknown: "recommended" } },
      }),
      readRepositoryLayer: async () => ({ warnings: [] }),
    });

    const repoA = await service.getEffectiveRules("/repo-a");
    const repoB = await service.getEffectiveRules("/repo-b");

    expect(repoA).not.toBe(repoB);
    expect(repoA.statusRules.missing).toBe("excluded");
    expect(repoA.statusRules.unknown).toBe("recommended");
    expect(repoA.layers.user.state).toBe("applied");
    expect(repoA.layers.workspace.state).toBe("applied");
    expect(repoB.statusRules.missing).toBe("excluded");
  });

  it("无配置时有效规则等于内置默认", async () => {
    const service = new CommitSelectionRuleService({
      readVscodeLayers: () => ({}),
      readRepositoryLayer: async () => ({ warnings: [] }),
    });
    const resolved = await service.getEffectiveRules("/repo-a");
    expect(resolved.statusRules).toEqual(defaultCommitSelectionStatusRules);
    expect(resolved.pathRules.map((rule) => rule.id)).toEqual(
      builtinCommitSelectionPathRules.map((rule) => rule.id),
    );
    expect(resolved.errors).toEqual([]);
  });
});

describe("CommitSelectionRuleService 失效", () => {
  it("invalidateAll 清空缓存并广播失效事件", async () => {
    const readRepositoryLayer = vi.fn(async () => ({ warnings: [] }));
    const service = new CommitSelectionRuleService({
      readVscodeLayers: () => ({}),
      readRepositoryLayer,
    });
    const events: Array<{ repositoryRoot?: string; reason: string }> = [];
    service.onDidInvalidate((event) => events.push(event));

    const before = await service.getEffectiveRules("/repo-a");
    service.invalidateAll("vscode-configuration");
    const after = await service.getEffectiveRules("/repo-a");

    expect(readRepositoryLayer).toHaveBeenCalledTimes(2);
    expect(after).not.toBe(before);
    expect(events).toEqual([
      { repositoryRoot: undefined, reason: "vscode-configuration" },
    ]);
  });

  it("invalidateRepository 只失效目标仓库，其他仓库缓存保留", async () => {
    const service = new CommitSelectionRuleService({
      readVscodeLayers: () => ({}),
      readRepositoryLayer: async () => ({ warnings: [] }),
    });
    const events: Array<{ repositoryRoot?: string; reason: string }> = [];
    service.onDidInvalidate((event) => events.push(event));

    const repoA = await service.getEffectiveRules("/repo-a");
    const repoB = await service.getEffectiveRules("/repo-b");
    service.invalidateRepository("/repo-a", "manual");

    expect(await service.getEffectiveRules("/repo-b")).toBe(repoB);
    expect(await service.getEffectiveRules("/repo-a")).not.toBe(repoA);
    expect(events).toEqual([{ repositoryRoot: "/repo-a", reason: "manual" }]);
  });

  it("invalidateRepositoryConfig 按 .svn-workbench.json 所在目录定位仓库", async () => {
    const service = new CommitSelectionRuleService({
      readVscodeLayers: () => ({}),
      readRepositoryLayer: async () => ({ warnings: [] }),
    });
    const events: Array<{ repositoryRoot?: string; reason: string }> = [];
    service.onDidInvalidate((event) => events.push(event));

    await service.getEffectiveRules("/repo-a");
    service.invalidateRepositoryConfig("/repo-a/.svn-workbench.json");

    expect(events).toEqual([
      { repositoryRoot: "/repo-a", reason: "repository-config" },
    ]);
  });

  it("dispose 后不再发射失效事件", async () => {
    const service = new CommitSelectionRuleService({
      readVscodeLayers: () => ({}),
      readRepositoryLayer: async () => ({ warnings: [] }),
    });
    const events: unknown[] = [];
    service.onDidInvalidate((event) => events.push(event));
    service.dispose();
    service.invalidateAll("manual");
    expect(events).toEqual([]);
  });
});

describe("CommitSelectionRuleService 降级", () => {
  it("仓库层校验失败时按 resolver 语义回退，错误保留且服务不抛错", async () => {
    const service = new CommitSelectionRuleService({
      readVscodeLayers: () => ({}),
      readRepositoryLayer: async () => ({
        layer: {
          pathRules: [
            { id: "dup", pattern: "a/**", decision: "excluded" },
            { id: "dup", pattern: "b/**", decision: "excluded" },
          ],
        },
        warnings: [],
      }),
    });

    const resolved = await service.getEffectiveRules("/repo-a");

    expect(resolved.layers.repository.state).toBe("failed");
    expect(resolved.errors.length).toBeGreaterThan(0);
    expect(resolved.statusRules).toEqual(defaultCommitSelectionStatusRules);
  });

  it("读取来源抛异常时回退内置默认并记录错误，不向调用方抛错", async () => {
    const service = new CommitSelectionRuleService({
      readVscodeLayers: () => {
        throw new Error("配置存储不可用");
      },
      readRepositoryLayer: async () => ({ warnings: [] }),
    });

    const resolved = await service.getEffectiveRules("/repo-a");

    expect(resolved.statusRules).toEqual(defaultCommitSelectionStatusRules);
    expect(
      resolved.errors.some((message) => message.includes("配置存储不可用")),
    ).toBe(true);
  });
});

describe("readRepositoryCommitSelectionLayer 默认适配", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "svn-workbench-rule-service-test-"),
    );
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("读取 .svn-workbench.json 的 commitSelection 键并保留未知键", async () => {
    await fs.writeFile(
      path.join(tempRoot, ".svn-workbench.json"),
      JSON.stringify({
        commitConvention: { enabled: true },
        commitSelection: {
          version: 1,
          pathRules: [
            {
              id: "team-vendor",
              enabled: true,
              pattern: "vendor/**",
              decision: "excluded",
              reason: "第三方目录",
            },
          ],
        },
      }),
      "utf8",
    );

    const service = new CommitSelectionRuleService({
      readVscodeLayers: () => ({}),
    });
    const resolved = await service.getEffectiveRules(tempRoot);

    expect(resolved.layers.repository.state).toBe("applied");
    expect(resolved.pathRules[0]).toMatchObject({
      id: "team-vendor",
      source: "repository",
    });
  });

  it("非法 JSON 不抛错：层为空、警告呈现、回退内置默认", async () => {
    await fs.writeFile(
      path.join(tempRoot, ".svn-workbench.json"),
      "{ bad json",
      "utf8",
    );

    const service = new CommitSelectionRuleService({
      readVscodeLayers: () => ({}),
    });
    const resolved = await service.getEffectiveRules(tempRoot);

    expect(resolved.layers.repository.state).toBe("empty");
    expect(resolved.warnings.some((w) => w.includes("不是合法 JSON"))).toBe(
      true,
    );
    expect(resolved.statusRules).toEqual(defaultCommitSelectionStatusRules);
  });

  it("commitSelection 不是对象时产生警告并忽略该层", async () => {
    await fs.writeFile(
      path.join(tempRoot, ".svn-workbench.json"),
      JSON.stringify({ commitSelection: "not-an-object" }),
      "utf8",
    );
    const result = await readRepositoryCommitSelectionLayer(tempRoot);
    expect(result.layer).toBeUndefined();
    expect(result.warnings.some((w) => w.includes("必须是 JSON 对象"))).toBe(
      true,
    );
  });
});

describe("CommitSelectionRuleService 保存与恢复默认", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "svn-workbench-rule-save-test-"),
    );
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  async function readFileJson(): Promise<Record<string, unknown>> {
    const content = await fs.readFile(
      path.join(tempRoot, ".svn-workbench.json"),
      "utf8",
    );
    return JSON.parse(content) as Record<string, unknown>;
  }

  it("保存保留文件其他键与 commitSelection 内部未知字段，并显式失效缓存", async () => {
    await fs.writeFile(
      path.join(tempRoot, ".svn-workbench.json"),
      JSON.stringify({
        commitConvention: { enabled: true },
        teamCustomKey: { note: "团队自定义" },
        commitSelection: {
          version: 1,
          experimentalFutureFlag: true,
          statusRules: { modified: "excluded", futureStatusKey: "needsReview" },
        },
      }),
      "utf8",
    );
    const service = new CommitSelectionRuleService({
      readVscodeLayers: () => ({}),
    });
    const events: Array<{ repositoryRoot?: string; reason: string }> = [];
    service.onDidInvalidate((event) => events.push(event));

    const before = await service.getEffectiveRules(tempRoot);
    expect(before.statusRules.modified).toBe("excluded");

    const result = await service.saveRepositoryRules(tempRoot, {
      version: 1,
      statusRules: { modified: "recommended" },
      pathRules: [
        {
          id: "team-vendor",
          enabled: true,
          pattern: "vendor/**",
          decision: "excluded",
          reason: "第三方目录",
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(await readFileJson()).toEqual({
      commitConvention: { enabled: true },
      teamCustomKey: { note: "团队自定义" },
      commitSelection: {
        version: 1,
        experimentalFutureFlag: true,
        statusRules: {
          futureStatusKey: "needsReview",
          modified: "recommended",
        },
        pathRules: [
          {
            id: "team-vendor",
            enabled: true,
            pattern: "vendor/**",
            decision: "excluded",
            reason: "第三方目录",
          },
        ],
      },
    });
    // 显式失效：事件发射且后续解析反映新规则（不依赖 FileSystemWatcher）。
    expect(events).toEqual([
      { repositoryRoot: tempRoot, reason: "repository-config" },
    ]);
    const after = await service.getEffectiveRules(tempRoot);
    expect(after.statusRules.modified).toBe("recommended");
    expect(after.pathRules[0]).toMatchObject({
      id: "team-vendor",
      source: "repository",
    });
  });

  it("文件缺失时按现有惯例创建并写入 commitSelection", async () => {
    const service = new CommitSelectionRuleService({
      readVscodeLayers: () => ({}),
    });
    const result = await service.saveRepositoryRules(tempRoot, {
      version: 1,
      statusRules: { unknown: "recommended" },
    });
    expect(result.ok).toBe(true);
    const json = await readFileJson();
    expect(json.commitConvention).toBeDefined();
    expect(json.commitSelection).toEqual({
      version: 1,
      statusRules: { unknown: "recommended" },
    });
  });

  it("恢复默认只删除 commitSelection 键，文件其余内容不动", async () => {
    await fs.writeFile(
      path.join(tempRoot, ".svn-workbench.json"),
      JSON.stringify({
        commitConvention: { enabled: true },
        teamCustomKey: [1, 2, 3],
        commitSelection: { version: 1, statusRules: { normal: "excluded" } },
      }),
      "utf8",
    );
    const service = new CommitSelectionRuleService({
      readVscodeLayers: () => ({}),
    });
    const events: Array<{ repositoryRoot?: string; reason: string }> = [];
    service.onDidInvalidate((event) => events.push(event));

    const result = await service.restoreRepositoryRulesToDefault(tempRoot);

    expect(result).toMatchObject({ ok: true, removed: true });
    expect(await readFileJson()).toEqual({
      commitConvention: { enabled: true },
      teamCustomKey: [1, 2, 3],
    });
    expect(events).toEqual([
      { repositoryRoot: tempRoot, reason: "repository-config" },
    ]);
    const resolved = await service.getEffectiveRules(tempRoot);
    expect(resolved.layers.repository.state).toBe("empty");
    expect(resolved.statusRules).toEqual(defaultCommitSelectionStatusRules);
  });

  it("恢复默认在文件或键不存在时幂等，不失效缓存", async () => {
    const service = new CommitSelectionRuleService({
      readVscodeLayers: () => ({}),
    });
    const events: unknown[] = [];
    service.onDidInvalidate((event) => events.push(event));

    const noFile = await service.restoreRepositoryRulesToDefault(tempRoot);
    expect(noFile).toMatchObject({ ok: true, removed: false });

    await fs.writeFile(
      path.join(tempRoot, ".svn-workbench.json"),
      JSON.stringify({ commitConvention: { enabled: true } }),
      "utf8",
    );
    const noKey = await service.restoreRepositoryRulesToDefault(tempRoot);
    expect(noKey).toMatchObject({ ok: true, removed: false });
    expect(events).toEqual([]);
  });

  it("配置损坏时恢复默认拒绝执行并给出中文错误，文件内容保持原样", async () => {
    const corrupt = "{ bad json";
    await fs.writeFile(
      path.join(tempRoot, ".svn-workbench.json"),
      corrupt,
      "utf8",
    );
    const service = new CommitSelectionRuleService({
      readVscodeLayers: () => ({}),
    });

    const result = await service.restoreRepositoryRulesToDefault(tempRoot);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("不是合法 JSON");
    await expect(
      fs.readFile(path.join(tempRoot, ".svn-workbench.json"), "utf8"),
    ).resolves.toBe(corrupt);
  });

  // V003-CR-03：文件存在但损坏时保存必须被拒绝，原文件保持字节不变，
  // 不得由统一读写层按空配置重建而丢失其他团队配置。
  it("非法 JSON 配置保存被拒绝，原文件字节不变且不失效缓存", async () => {
    const corrupt = '{ "commitConvention": { "enabled": true }, bad json';
    await fs.writeFile(
      path.join(tempRoot, ".svn-workbench.json"),
      corrupt,
      "utf8",
    );
    const service = new CommitSelectionRuleService({
      readVscodeLayers: () => ({}),
    });
    const events: unknown[] = [];
    service.onDidInvalidate((event) => events.push(event));

    const result = await service.saveRepositoryRules(tempRoot, {
      version: 1,
      statusRules: { modified: "recommended" },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("配置损坏");
    expect(result.error).toContain("不是合法 JSON");
    expect(result.error).toContain("保存已拒绝");
    expect(result.error).toContain("请打开 .svn-workbench.json 修复后重试");
    await expect(
      fs.readFile(path.join(tempRoot, ".svn-workbench.json"), "utf8"),
    ).resolves.toBe(corrupt);
    expect(events).toEqual([]);
  });

  it("数组、字符串或 null 顶层保存被拒绝，原文件内容不变", async () => {
    const service = new CommitSelectionRuleService({
      readVscodeLayers: () => ({}),
    });
    const events: unknown[] = [];
    service.onDidInvalidate((event) => events.push(event));

    for (const corrupt of ['["commitConvention"]', '"text"', "null"]) {
      await fs.writeFile(
        path.join(tempRoot, ".svn-workbench.json"),
        corrupt,
        "utf8",
      );
      const result = await service.saveRepositoryRules(tempRoot, {
        version: 1,
        statusRules: { modified: "recommended" },
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("顶层必须是 JSON 对象");
      expect(result.error).toContain("保存已拒绝");
      await expect(
        fs.readFile(path.join(tempRoot, ".svn-workbench.json"), "utf8"),
      ).resolves.toBe(corrupt);
    }
    expect(events).toEqual([]);
  });

  it("读取配置文件失败时保存被拒绝，不执行写入", async () => {
    // 配置路径被目录占位：读取触发非 ENOENT 错误（readError）。
    const configPath = path.join(tempRoot, ".svn-workbench.json");
    await fs.mkdir(configPath);
    const service = new CommitSelectionRuleService({
      readVscodeLayers: () => ({}),
    });

    const result = await service.saveRepositoryRules(tempRoot, {
      version: 1,
      statusRules: { modified: "recommended" },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("读取 .svn-workbench.json 失败");
    expect(result.error).toContain("未执行保存");
    // 未写入：占位目录保持原样，未被改写为配置文件。
    expect((await fs.stat(configPath)).isDirectory()).toBe(true);
  });

  it("修复损坏配置后保存恢复可用，合法文件仍只更新 commitSelection", async () => {
    const configPath = path.join(tempRoot, ".svn-workbench.json");
    await fs.writeFile(configPath, "{ bad json", "utf8");
    const service = new CommitSelectionRuleService({
      readVscodeLayers: () => ({}),
    });
    const rejected = await service.saveRepositoryRules(tempRoot, {
      version: 1,
      statusRules: { modified: "recommended" },
    });
    expect(rejected.ok).toBe(false);

    // 用户按提示手动修复文件后，同一路径保存成功且保留其他顶层键。
    await fs.writeFile(
      configPath,
      JSON.stringify({
        commitConvention: { enabled: true },
        teamCustomKey: { note: "团队自定义" },
      }),
      "utf8",
    );
    const saved = await service.saveRepositoryRules(tempRoot, {
      version: 1,
      statusRules: { modified: "recommended" },
    });
    expect(saved.ok).toBe(true);
    expect(await readFileJson()).toEqual({
      commitConvention: { enabled: true },
      teamCustomKey: { note: "团队自定义" },
      commitSelection: {
        version: 1,
        statusRules: { modified: "recommended" },
      },
    });
  });
});
