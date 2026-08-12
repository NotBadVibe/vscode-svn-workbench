import * as path from "node:path";
import { runSvnCommand } from "../../svn/svnCommandRunner";
import { parseFileExternalFlag } from "../../svn/parsers/statusXmlParser";
import {
  parseSvnExternalsTargetNames,
  parseSvnPropertiesXml,
} from "../../properties/svnProperties";
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
    // file external 标记：同仓库 file external 的 wc-root/UUID 均与主 WC
    // 相同。双信号识别：目标自身 status 的 file-external 属性（标准场景），
    // 以及父目录 svn:externals 定义中的本地目标名（删除后同名重新挂载等
    // status 不报告的残留场景）。
    const status = await runSvnCommand(
      svnPath,
      ["status", "--xml", targetPath],
      cwd,
      { maxOutputBytes: 1024 * 1024 },
    );
    if (status.exitCode !== 0) {
      return { ok: false, code: "noSvnInfo" };
    }
    const externals = await runSvnCommand(
      svnPath,
      ["propget", "svn:externals", "--xml", cwd],
      cwd,
    );
    // 未设置该属性时 svn 以 W200017 警告退出 1——视为空集合；其他失败安全拒绝。
    if (externals.exitCode !== 0 && !externals.stderr.includes("W200017")) {
      return { ok: false, code: "noSvnInfo" };
    }
    const externalTargetNames = new Set(
      parseSvnPropertiesXml(externals.stdout)
        .filter((item) => item.name === "svn:externals")
        .flatMap((item) => parseSvnExternalsTargetNames(item.value)),
    );
    const fileExternal =
      parseFileExternalFlag(status.stdout) ||
      externalTargetNames.has(path.basename(targetPath));
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
      fileExternal,
    };
  };
}
