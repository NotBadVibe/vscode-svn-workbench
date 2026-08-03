import { spawn } from "node:child_process";
import { appendOutput, sanitizeDiagnostic } from "../diagnostics/outputChannel";
import {
  buildSvnSecurityInvocation,
  resolveSvnSecurityContext,
} from "../security/svnSecurityContext";
import { SvnCommandResult } from "./svnTypes";

export function runSvnCommand(
  svnPath: string,
  args: string[],
  cwd?: string,
  options: { signal?: AbortSignal; maxOutputBytes?: number } = {},
): Promise<SvnCommandResult> {
  const startedAt = Date.now();
  const invocation = buildSvnSecurityInvocation(
    args,
    resolveSvnSecurityContext(cwd),
  );
  appendOutput(`> ${svnPath} ${invocation.safeArgs.join(" ")}`);
  if (cwd) {
    appendOutput(`cwd: ${cwd}`);
  }

  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      resolve({
        command: svnPath,
        args: invocation.safeArgs,
        cwd,
        exitCode: null,
        stdout: "",
        stderr: "操作已取消。",
        durationMs: 0,
        cancelled: true,
      });
      return;
    }
    const child = spawn(svnPath, invocation.args, {
      cwd,
      shell: false,
      windowsHide: true,
      // SVN's human-readable summaries are parsed for revision/conflict status.
      // Keep only the message locale stable; preserving LANG/LC_CTYPE avoids
      // changing how non-ASCII paths and file contents are encoded.
      env: { ...process.env, LC_MESSAGES: "C", LANGUAGE: "en" },
    });
    if (invocation.stdin !== undefined) {
      child.stdin.on("error", () => undefined);
      child.stdin.end(invocation.stdin, "utf8");
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let capturedBytes = 0;
    let cancelled = false;
    let truncated = false;
    const abort = () => {
      cancelled = true;
      child.kill("SIGTERM");
    };
    options.signal?.addEventListener("abort", abort, { once: true });

    const capture = (chunks: Buffer[], chunk: Buffer) => {
      if (truncated) return;
      const limit = options.maxOutputBytes;
      if (limit === undefined) {
        chunks.push(chunk);
        return;
      }
      const remaining = Math.max(0, limit - capturedBytes);
      if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
      capturedBytes += Math.min(chunk.byteLength, remaining);
      if (chunk.byteLength > remaining) {
        truncated = true;
        child.kill("SIGTERM");
      }
    };
    child.stdout.on("data", (chunk: Buffer) => capture(stdoutChunks, chunk));
    child.stderr.on("data", (chunk: Buffer) => capture(stderrChunks, chunk));

    child.on("error", (error) => {
      options.signal?.removeEventListener("abort", abort);
      reject(error);
    });

    child.on("close", (exitCode) => {
      options.signal?.removeEventListener("abort", abort);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const capturedStderr = Buffer.concat(stderrChunks).toString("utf8");
      const stderr = cancelled
        ? "操作已取消。"
        : truncated
          ? `${capturedStderr}${capturedStderr ? "\n" : ""}输出超过安全上限，进程已终止。`
          : capturedStderr;
      const durationMs = Date.now() - startedAt;
      const result: SvnCommandResult = {
        command: svnPath,
        args: invocation.safeArgs,
        cwd,
        exitCode,
        stdout,
        stderr,
        durationMs,
        cancelled,
        truncated,
      };

      appendOutput(`exit: ${exitCode}; duration: ${durationMs}ms`);
      if (stdout.trim()) {
        appendOutput(sanitizeDiagnostic(stdout.trim()));
      }
      if (stderr.trim()) {
        appendOutput(sanitizeDiagnostic(stderr.trim()));
      }

      resolve(result);
    });
  });
}
