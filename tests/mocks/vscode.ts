/** Minimal runtime facade for Vitest. Extension Host behavior is covered by @vscode/test-electron. */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const testWorkspacePath = process.env.SVN_WORKBENCH_TEST_WORKSPACE;
export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3
} as const;

export const FileType = {
  Unknown: 0,
  File: 1,
  Directory: 2,
  SymbolicLink: 64
} as const;

function unsupported(name: string): never {
  throw new Error(`vscode mock: ${name} must be supplied by the unit test`);
}

export const workspace = {
  workspaceFolders: testWorkspacePath ? [{ uri: { fsPath: path.resolve(testWorkspacePath) }, name: path.basename(testWorkspacePath), index: 0 }] : undefined,
  getConfiguration: () => ({
    get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
    update: async () => undefined
  }),
  fs: {
    stat: async (uri: { fsPath: string }) => {
      const value = await fs.stat(uri.fsPath);
      return { type: value.isDirectory() ? FileType.Directory : FileType.File };
    }
  }
};

export const Uri = {
  file: (fsPath: string) => ({ fsPath }),
  joinPath: (base: { fsPath: string }, ...parts: string[]) => ({ fsPath: path.join(base.fsPath, ...parts) })
};

export const extensions = {
  getExtension: () => undefined
};

export const commands = {
  getCommands: async () => []
};

export const window = {
  createOutputChannel: () => ({
    appendLine: () => undefined,
    show: () => undefined,
    dispose: () => undefined,
    clear: () => undefined,
    replace: () => undefined,
    append: () => undefined,
    name: 'SVN 工作台'
  })
};
