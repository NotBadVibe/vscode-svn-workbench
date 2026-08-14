import type { PathSemantics } from "./pathIdentity";

/*
 * v0.0.8 唯一 native 语义边界：扩展进程的路径语义在此捕获一次。
 *
 * 领域纯函数（pathIdentity / projectIdentity / projectResolver /
 * workingCopyClassification / projectSlicing 等）不得自行读取
 * process.platform / process.cwd()；生产 Host 入口统一从这里注入。
 * 测试夹具禁止引用本模块，必须显式传入 posix / win32 语义。
 */
export const nativePathSemantics: PathSemantics = {
  platform: process.platform,
  cwd: process.cwd(),
};
