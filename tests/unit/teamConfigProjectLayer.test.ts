import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getSvnWorkbenchConfigPath,
  resolveSvnWorkbenchConfigLocation,
  resolveSvnWorkbenchConfigWriteRoot,
  serializeSvnWorkbenchConfig,
} from "../../src/config/svnWorkbenchConfig";
import {
  hashTeamConfigContent,
  planTeamConfigMigration,
} from "../../src/config/teamConfigMigration";
import { resolveCommitConventionConfig } from "../../src/commit/commitConvention";
import { CommitSelectionRuleService } from "../../src/commit/commitSelectionRuleService";

/*
 * v0.0.7 §9 团队规则配置层：项目根优先、工作副本根继承、新建默认写入
 * 项目根；迁移必须预览且只迁移白名单键。
 */

let tempRoot: string;
let wcRoot: string;
let projectRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "svn-team-config-"));
  wcRoot = path.join(tempRoot, "code");
  projectRoot = path.join(wcRoot, "EmApi");
  await fs.mkdir(projectRoot, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

async function writeConfig(root: string, raw: Record<string, unknown>) {
  await fs.writeFile(
    getSvnWorkbenchConfigPath(root),
    serializeSvnWorkbenchConfig(raw),
    "utf8",
  );
}

describe("配置位置解析（§9）", () => {
  it("项目根与工作副本根重合时使用工作副本根", async () => {
    const location = await resolveSvnWorkbenchConfigLocation(wcRoot, wcRoot);
    expect(location.source).toBe("workingCopy");
    expect(location.inherited).toBe(false);
    expect(location.configRoot).toBe(wcRoot);
  });

  it("项目根已有独立配置时使用项目根", async () => {
    await writeConfig(projectRoot, { commitConvention: { enabled: true } });
    const location = await resolveSvnWorkbenchConfigLocation(
      projectRoot,
      wcRoot,
    );
    expect(location.source).toBe("project");
    expect(location.inherited).toBe(false);
  });

  it("项目根无配置而工作副本根有时继承并标记来源", async () => {
    await writeConfig(wcRoot, { commitConvention: { enabled: true } });
    const location = await resolveSvnWorkbenchConfigLocation(
      projectRoot,
      wcRoot,
    );
    expect(location.source).toBe("workingCopy");
    expect(location.inherited).toBe(true);
    expect(location.configRoot).toBe(wcRoot);
  });

  it("两者都没有时默认项目根（新建写入已确认项目根）", async () => {
    const location = await resolveSvnWorkbenchConfigLocation(
      projectRoot,
      wcRoot,
    );
    expect(location.source).toBe("project");
    expect(location.configRoot).toBe(projectRoot);
    expect(resolveSvnWorkbenchConfigWriteRoot(projectRoot, wcRoot)).toBe(
      projectRoot,
    );
    expect(resolveSvnWorkbenchConfigWriteRoot(undefined, wcRoot)).toBe(wcRoot);
  });

  it("提交规范解析：项目根配置优先，继承时标记来源", async () => {
    await writeConfig(wcRoot, {
      commitConvention: { enabled: true, requiredPrefix: true },
    });
    const inherited = await resolveCommitConventionConfig(wcRoot, projectRoot);
    expect(inherited.source).toBe("repository");
    expect(inherited.inheritedFromWorkingCopy).toBe(true);
    expect(inherited.config.enabled).toBe(true);

    await writeConfig(projectRoot, {
      commitConvention: { enabled: false },
    });
    const own = await resolveCommitConventionConfig(wcRoot, projectRoot);
    expect(own.source).toBe("project");
    expect(own.inheritedFromWorkingCopy).toBe(false);
    // 项目根配置覆盖继承内容。
    expect(own.config.enabled).toBe(false);
  });
});

describe("提交选择规则的项目层（§9）", () => {
  it("项目根规则优先于工作副本根，缓存按项目隔离", async () => {
    await writeConfig(wcRoot, {
      commitSelection: {
        version: 1,
        pathRules: [
          {
            id: "wc-rule",
            enabled: true,
            pattern: "*.log",
            decision: "excluded",
            reason: "工作副本根规则",
          },
        ],
      },
    });
    await writeConfig(projectRoot, {
      commitSelection: {
        version: 1,
        pathRules: [
          {
            id: "project-rule",
            enabled: true,
            pattern: "*.tmp",
            decision: "excluded",
            reason: "项目规则",
          },
        ],
      },
    });
    const service = new CommitSelectionRuleService();
    try {
      const projectRules = await service.getEffectiveRules(wcRoot, projectRoot);
      expect(projectRules.pathRules.map((rule) => rule.id)).toContain(
        "project-rule",
      );

      const wcRules = await service.getEffectiveRules(wcRoot);
      expect(wcRules.pathRules.map((rule) => rule.id)).toContain("wc-rule");
      expect(wcRules.pathRules.map((rule) => rule.id)).not.toContain(
        "project-rule",
      );

      // 项目配置文件变更只失效相关缓存键。
      await writeConfig(projectRoot, {
        commitSelection: {
          version: 1,
          pathRules: [
            {
              id: "project-rule-v2",
              enabled: true,
              pattern: "*.tmp",
              decision: "excluded",
              reason: "项目规则 v2",
            },
          ],
        },
      });
      service.invalidateRepositoryConfig(
        getSvnWorkbenchConfigPath(projectRoot),
      );
      const reloaded = await service.getEffectiveRules(wcRoot, projectRoot);
      expect(reloaded.pathRules.map((rule) => rule.id)).toContain(
        "project-rule-v2",
      );
      // 工作副本根缓存未被项目配置变更误清（仍含缓存结果）。
      const wcReloaded = await service.getEffectiveRules(wcRoot);
      expect(wcReloaded.pathRules.map((rule) => rule.id)).toContain("wc-rule");
    } finally {
      service.dispose();
    }
  });

  it("保存默认写入项目根，不改动工作副本根既有配置", async () => {
    await writeConfig(wcRoot, {
      commitSelection: { version: 1, pathRules: [] },
    });
    const service = new CommitSelectionRuleService();
    try {
      const result = await service.saveRepositoryRules(
        wcRoot,
        {
          version: 1,
          pathRules: [
            {
              id: "new-rule",
              enabled: true,
              pattern: "*.gen.ts",
              decision: "excluded",
              reason: "新项目规则",
            },
          ],
        } as never,
        projectRoot,
      );
      expect(result.ok).toBe(true);
      expect(result.configPath).toBe(getSvnWorkbenchConfigPath(projectRoot));
      // 工作副本根配置保持不变（未被静默覆盖）。
      const wcContent = await fs.readFile(
        getSvnWorkbenchConfigPath(wcRoot),
        "utf8",
      );
      expect(wcContent).not.toContain("new-rule");
    } finally {
      service.dispose();
    }
  });
});

describe("团队规则迁移计划（§9）", () => {
  const sourceRaw = {
    commitConvention: { enabled: true },
    commitSelection: { version: 1 },
    unrelatedKey: { keep: true },
  };

  it("只迁移白名单键，源保留其余键", () => {
    const plan = planTeamConfigMigration({
      sourceRaw,
      sourceExists: true,
      targetExists: false,
      projectRoot,
      workingCopyRoot: wcRoot,
    });
    expect(plan.issues).toEqual([]);
    expect(plan.keys).toEqual(["commitConvention", "commitSelection"]);
    expect(plan.targetContent).toContain("commitConvention");
    expect(plan.targetContent).not.toContain("unrelatedKey");
    expect(plan.sourceContentAfter).toContain("unrelatedKey");
    expect(plan.sourceContentAfter).not.toContain("commitConvention");
  });

  it("目标已存在、源缺失、边界越界与重合都形成阻止项", () => {
    expect(
      planTeamConfigMigration({
        sourceRaw,
        sourceExists: true,
        targetExists: true,
        projectRoot,
        workingCopyRoot: wcRoot,
      }).issues[0],
    ).toContain("已存在");
    expect(
      planTeamConfigMigration({
        sourceRaw: undefined,
        sourceExists: false,
        targetExists: false,
        projectRoot,
        workingCopyRoot: wcRoot,
      }).issues[0],
    ).toContain("无可迁移内容");
    expect(
      planTeamConfigMigration({
        sourceRaw,
        sourceExists: true,
        targetExists: false,
        projectRoot: path.join(tempRoot, "outside"),
        workingCopyRoot: wcRoot,
      }).issues[0],
    ).toContain("边界校验未通过");
    expect(
      planTeamConfigMigration({
        sourceRaw,
        sourceExists: true,
        targetExists: false,
        projectRoot: wcRoot,
        workingCopyRoot: wcRoot,
      }).issues[0],
    ).toContain("无需迁移");
    expect(
      planTeamConfigMigration({
        sourceRaw: { other: 1 },
        sourceExists: true,
        targetExists: false,
        projectRoot,
        workingCopyRoot: wcRoot,
      }).issues[0],
    ).toContain("没有可迁移的团队规则键");
  });

  it("源内容哈希稳定，用于执行前复验", () => {
    expect(hashTeamConfigContent("abc")).toBe(hashTeamConfigContent("abc"));
    expect(hashTeamConfigContent("abc")).not.toBe(hashTeamConfigContent("abd"));
  });
});
