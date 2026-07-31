import * as fs from 'node:fs';
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index');
  const workspacePath = getValidationWorkspace(extensionDevelopmentPath);
  const vscodeExecutablePath = getLocalVsCodeExecutable();

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: workspacePath ? [workspacePath] : [],
    vscodeExecutablePath
  });
}

function getValidationWorkspace(extensionDevelopmentPath: string): string | undefined {
  const configured = process.env.SVN_WORKBENCH_TEST_WORKSPACE;
  if (configured && fs.existsSync(configured)) {
    return configured;
  }

  const defaultWorkspace =
    process.platform === 'win32'
      ? 'C:\\svn-workbench-validation-test-wc'
      : path.resolve(extensionDevelopmentPath, '..', 'svn-workbench-validation-test-wc');

  return fs.existsSync(defaultWorkspace) ? defaultWorkspace : undefined;
}

function getLocalVsCodeExecutable(): string | undefined {
  const configured = process.env.VSCODE_EXECUTABLE_PATH;
  if (configured && fs.existsSync(configured)) {
    return configured;
  }

  const candidates =
    process.platform === 'win32'
      ? [
          path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
          path.join(process.env.ProgramFiles ?? '', 'Microsoft VS Code', 'Code.exe'),
          path.join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft VS Code', 'Code.exe'),
          'D:\\Program Files\\Microsoft VS Code\\Code.exe'
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
            '/Applications/Visual Studio Code.app/Contents/MacOS/Code'
          ]
        : ['/usr/share/code/code', '/snap/bin/code'];

  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
