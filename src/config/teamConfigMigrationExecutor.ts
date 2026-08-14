import * as fs from "node:fs/promises";
import * as path from "node:path";
import { writeAndSyncTempFile } from "../diffEdit/diffAtomicWriter";
import { hashTeamConfigContent } from "./teamConfigMigration";

/*
 * v0.0.7 §9 团队规则迁移的事务执行层（IO 可注入）。
 *
 * 安全顺序与补偿：
 * 1. 预检：源内容哈希必须与预览一致，目标必须不存在；
 * 2. 排他创建目标（wx 语义，避免存在性检查后的 TOCTOU 覆盖）；
 * 3. 同目录临时文件 + fsync + rename 原子替换源（不留下截断/损坏文件，
 *    保留源其他键）；
 * 4. 任一写失败：确认目标仍是本次生成内容后回滚目标；回滚也失败时返回
 *    结构化 partial 结果与人工恢复步骤——绝不显示成功；
 * 5. 执行后复验目标与源内容。
 */

export interface TeamConfigMigrationIo {
  readFile(filePath: string): Promise<string>;
  exists(filePath: string): Promise<boolean>;
  /** 排他创建；已存在时必须以类 EEXIST 错误失败。 */
  writeExclusive(filePath: string, content: string): Promise<void>;
  /** 同目录临时文件 fsync 后 rename 的原子替换。 */
  replaceAtomic(filePath: string, content: string): Promise<void>;
  removeFile(filePath: string): Promise<void>;
}

export interface TeamConfigMigrationExecuteInput {
  sourcePath: string;
  targetPath: string;
  /** 目标文件内容（仅含迁移键）。 */
  targetContent: string;
  /** 迁移后源文件内容（保留其余键）。 */
  sourceContentAfter: string;
  /** 预览时记录的源内容哈希。 */
  expectedSourceHash: string;
}

export type TeamConfigMigrationFailureStage =
  "precheck" | "target-create" | "source-replace" | "verify";

export type TeamConfigMigrationExecuteResult =
  | { ok: true }
  | {
      ok: false;
      stage: TeamConfigMigrationFailureStage;
      error: string;
      /** 半完成状态是否已回滚（目标文件已删除）。 */
      rolledBack?: boolean;
      /** 人工恢复步骤。 */
      recovery: string[];
    };

function fail(
  stage: TeamConfigMigrationFailureStage,
  error: string,
  extra: { rolledBack?: boolean; recovery: string[] },
): TeamConfigMigrationExecuteResult {
  return { ok: false, stage, error, ...extra };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "EEXIST"
  );
}

/** 仅当目标文件仍是本次生成内容时才删除，避免误删他人文件。 */
async function rollbackTarget(
  io: TeamConfigMigrationIo,
  input: TeamConfigMigrationExecuteInput,
): Promise<{ ok: boolean; detail?: string }> {
  try {
    const current = await io.readFile(input.targetPath);
    if (current !== input.targetContent) {
      return {
        ok: false,
        detail: "目标文件内容已不是本次迁移生成的内容，未删除以避免误删。",
      };
    }
    await io.removeFile(input.targetPath);
    return { ok: true };
  } catch (error) {
    return { ok: false, detail: errorText(error) };
  }
}

function partialRecoverySteps(
  input: TeamConfigMigrationExecuteInput,
): string[] {
  return [
    `检查目标文件 ${input.targetPath}：若内容恰为本次迁移生成的配置，可手动删除它恢复原状。`,
    `检查源文件 ${input.sourcePath}：确认工作副本根的团队规则键仍在；若已丢失，可从版本控制或备份恢复。`,
    "两个文件都确认无误后，重新生成迁移预览再试。",
  ];
}

export async function executeTeamConfigMigration(
  io: TeamConfigMigrationIo,
  input: TeamConfigMigrationExecuteInput,
): Promise<TeamConfigMigrationExecuteResult> {
  // 1. 预检：源可读、哈希一致、目标不存在。
  let sourceContent: string;
  try {
    sourceContent = await io.readFile(input.sourcePath);
  } catch (error) {
    return fail(
      "precheck",
      `无法读取工作副本根配置：${errorText(error)}。迁移未执行。`,
      { recovery: ["检查源配置文件状态后重新生成迁移预览。"] },
    );
  }
  if (hashTeamConfigContent(sourceContent) !== input.expectedSourceHash) {
    return fail("precheck", "工作副本根配置在预览后已变化，迁移已取消。", {
      recovery: ["重新生成迁移预览，确认最新内容后再执行。"],
    });
  }
  if (await io.exists(input.targetPath)) {
    return fail(
      "precheck",
      "项目根已存在 .svn-workbench.json，为避免覆盖已取消迁移。",
      { recovery: ["手动合并两个配置文件后重试，或删除项目根配置。"] },
    );
  }

  // 2. 排他创建目标。
  try {
    await io.writeExclusive(input.targetPath, input.targetContent);
  } catch (error) {
    return fail(
      "target-create",
      isAlreadyExists(error)
        ? "项目根配置在迁移过程中被其他操作创建，为避免覆盖已取消迁移。"
        : `创建项目根配置失败：${errorText(error)}。迁移未执行。`,
      {
        recovery: [
          "确认项目根配置文件状态；源配置未改动，可直接重新生成迁移预览。",
        ],
      },
    );
  }

  // 3. 原子替换源；失败时补偿回滚目标。
  try {
    await io.replaceAtomic(input.sourcePath, input.sourceContentAfter);
  } catch (error) {
    const rollback = await rollbackTarget(io, input);
    if (rollback.ok) {
      return fail(
        "source-replace",
        `更新工作副本根配置失败：${errorText(error)}。已删除本次创建的项目根配置，两个文件保持迁移前状态。`,
        {
          rolledBack: true,
          recovery: ["确认磁盘与文件权限后重新生成迁移预览再试。"],
        },
      );
    }
    return fail(
      "source-replace",
      `更新工作副本根配置失败：${errorText(error)}；且项目根配置回滚未完成（${rollback.detail ?? "未知原因"}）。当前可能处于半完成状态。`,
      { rolledBack: false, recovery: partialRecoverySteps(input) },
    );
  }

  // 4. 执行后复验。失败时双回滚：先原子恢复源到迁移前内容（此时源已
  // 移除迁移键，只删目标会丢规则），再在目标仍是本次内容时删除目标；
  // 两个补偿动作独立失败都返回结构化 partial 结果。
  const verifyTarget = await io
    .readFile(input.targetPath)
    .catch(() => undefined);
  const verifySource = await io
    .readFile(input.sourcePath)
    .catch(() => undefined);
  if (
    verifyTarget !== input.targetContent ||
    verifySource !== input.sourceContentAfter
  ) {
    const mismatch =
      verifySource !== input.sourceContentAfter &&
      verifyTarget !== input.targetContent
        ? "源与目标文件内容都与预期不一致"
        : verifySource !== input.sourceContentAfter
          ? "源文件内容与预期不一致"
          : "目标文件内容与预期不一致";
    let sourceRestored = false;
    let sourceRestoreDetail: string | undefined;
    try {
      await io.replaceAtomic(input.sourcePath, sourceContent);
      sourceRestored = true;
    } catch (error) {
      sourceRestoreDetail = errorText(error);
    }
    const targetRollback = await rollbackTarget(io, input);
    const rolledBack = sourceRestored && targetRollback.ok;
    const stateLines = [
      sourceRestored
        ? "工作副本根配置已恢复为迁移前内容。"
        : `工作副本根配置恢复失败（${sourceRestoreDetail ?? "未知原因"}），其中的团队规则键可能已缺失。`,
      targetRollback.ok
        ? "项目根配置已删除。"
        : `项目根配置未删除（${targetRollback.detail ?? "未知原因"}），需人工核对。`,
    ];
    return fail(
      "verify",
      `迁移后复验未通过：${mismatch}。${rolledBack ? "已回滚到迁移前状态。" : "回滚未完全成功。"}${stateLines.join("")}`,
      {
        rolledBack,
        recovery: rolledBack
          ? ["重新生成迁移预览再试；若反复失败请手动合并配置。"]
          : partialRecoverySteps(input),
      },
    );
  }

  return { ok: true };
}

/** 生产环境文件 IO：排他创建 + 同目录临时文件 fsync + rename 原子替换。 */
export const nodeTeamConfigMigrationIo: TeamConfigMigrationIo = {
  readFile: (filePath) => fs.readFile(filePath, "utf8"),
  exists: async (filePath) => {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  },
  writeExclusive: async (filePath, content) => {
    const handle = await fs.open(filePath, "wx");
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  replaceAtomic: async (filePath, content) => {
    const tempPath = path.join(
      path.dirname(filePath),
      `.svn-workbench.json.migrate-${process.pid}-${Date.now()}`,
    );
    try {
      await writeAndSyncTempFile(tempPath, Buffer.from(content, "utf8"), 0o666);
      await fs.rename(tempPath, filePath);
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  },
  removeFile: (filePath) => fs.rm(filePath),
};
