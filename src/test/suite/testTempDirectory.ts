import * as fs from "node:fs";

export interface TestTempDirectoryRemoveOptions {
  recursive: true;
  force: true;
  maxRetries: number;
  retryDelay: number;
}

export interface TestTempDirectoryDeps {
  platform?: NodeJS.Platform;
  removeDirectory?: (
    targetPath: string,
    options: TestTempDirectoryRemoveOptions,
  ) => void;
  warn?: (message: string) => void;
}

export type TestTempDirectoryRemoveResult = "removed" | "deferred";

const WINDOWS_DEFERRED_REMOVE_CODES = new Set(["EPERM", "EBUSY", "ENOTEMPTY"]);

/**
 * 清理 Extension Host/真实 SVN 测试目录。
 *
 * Node 先执行有限重试；Windows 若仍因 SVN/VS Code 延迟释放句柄而失败，
 * 测试断言已经完成，因此只延迟到临时 Runner 销毁时回收。其他平台或其他
 * 错误继续抛出，避免掩盖真实清理问题。
 */
export function removeTestTempDirectory(
  tempRoot: string,
  deps: TestTempDirectoryDeps = {},
): TestTempDirectoryRemoveResult {
  const removeDirectory =
    deps.removeDirectory ??
    ((targetPath, options) => fs.rmSync(targetPath, options));
  try {
    removeDirectory(tempRoot, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
    return "removed";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (
      (deps.platform ?? process.platform) === "win32" &&
      code !== undefined &&
      WINDOWS_DEFERRED_REMOVE_CODES.has(code)
    ) {
      (deps.warn ?? console.warn)(
        `WARN deferred cleanup for Windows test directory (${code}): ${tempRoot}`,
      );
      return "deferred";
    }
    throw error;
  }
}
