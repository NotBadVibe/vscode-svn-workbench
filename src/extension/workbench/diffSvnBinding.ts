import * as path from "node:path";
import { runSvnCommand } from "../../svn/svnCommandRunner";
import { hashBytes, MAX_EDITABLE_BYTES } from "../../diffEdit/diffPathGuard";
import type { DiffSvnBindingProbeResult } from "../../diffEdit/diffEditTypes";

/*
 * v0.0.6 页内编辑的 SVN 绑定探测（Host adapter，可注入可测试）。
 *
 * 打开编辑态与每次保存前，领域服务通过本探测复验：
 * - 目标当前所属工作副本根（`svn info --show-item wc-root`）——嵌套工作副本
 *   与 svn:externals 目录形成独立 WC 根，与原主 WC 根不同即拒绝；
 * - 目标当前仓库 UUID（`--show-item repos-uuid`）——必须与签发时一致；
 * - 当前 BASE 完整字节 hash（`svn cat -r BASE`）——SVN Update/Switch 后
 *   即使工作文件字节未变，BASE 变化也必须拒绝保存。
 *
 *  BASE 超过 5 MB（截断）按 noBase 安全拒绝：页内编辑目标本身 ≤5 MB，
 *  BASE 更大属于异常场景，宁可拒绝也不绑定错误基准。
 */
export function createSvnBindingProbe(
  svnPath: string,
): (targetPath: string) => Promise<DiffSvnBindingProbeResult> {
  return async (targetPath: string): Promise<DiffSvnBindingProbeResult> => {
    const cwd = path.dirname(targetPath);
    const wcRoot = await runSvnCommand(
      svnPath,
      ["info", "--show-item", "wc-root", targetPath],
      cwd,
    );
    if (wcRoot.exitCode !== 0 || wcRoot.stdout.trim() === "") {
      return { ok: false, code: "noSvnInfo" };
    }
    const uuid = await runSvnCommand(
      svnPath,
      ["info", "--show-item", "repos-uuid", targetPath],
      cwd,
    );
    if (uuid.exitCode !== 0 || uuid.stdout.trim() === "") {
      return { ok: false, code: "noSvnInfo" };
    }
    const base = await runSvnCommand(
      svnPath,
      ["cat", "-r", "BASE", targetPath],
      cwd,
      { maxOutputBytes: MAX_EDITABLE_BYTES + 1 },
    );
    if (base.exitCode !== 0 || base.truncated === true) {
      return { ok: false, code: "noBase" };
    }
    return {
      ok: true,
      repositoryUuid: uuid.stdout.trim(),
      workingCopyRoot: wcRoot.stdout.trim(),
      baseHash: hashBytes(Buffer.from(base.stdout, "utf8")),
    };
  };
}
