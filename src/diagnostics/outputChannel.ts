import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel("SVN 工作台");
  }
  return channel;
}

export function appendOutput(message: string): void {
  getOutputChannel().appendLine(message);
}

export function showOutput(): void {
  getOutputChannel().show(true);
}

export function sanitizeDiagnostic(value: string): string {
  return value
    .replace(/(authorization:\s*bearer\s+)[^\s]+/gi, "$1[redacted]")
    .replace(/(api[-_ ]?key["']?\s*[:=]\s*["']?)[^"'\s]+/gi, "$1[redacted]")
    .replace(/(--password\s+)[^\s]+/gi, "$1[redacted]")
    .replace(/(password["']?\s*[:=]\s*["']?)[^"'\s]+/gi, "$1[redacted]");
}
