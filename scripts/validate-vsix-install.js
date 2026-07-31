const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(repoRoot, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const defaultVsixPath = path.join(repoRoot, `${packageJson.name}-${packageJson.version}.vsix`);
const vsixPath = path.resolve(process.argv[2] || defaultVsixPath);
const expectedExtensionId = `${packageJson.publisher}.${packageJson.name}`;
const expectedExtension = `${packageJson.publisher}.${packageJson.name}@${packageJson.version}`;
const acceptanceRoot = path.join(repoRoot, '.validation', 'vsix-install-acceptance');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const runRoot = path.join(acceptanceRoot, runId);
const userDataDir = path.join(runRoot, 'user-data');
const extensionsDir = path.join(runRoot, 'extensions');
const codeCommand = resolveCodeCommand();

if (!fs.existsSync(vsixPath)) {
  throw new Error(`VSIX file not found: ${vsixPath}`);
}

fs.mkdirSync(userDataDir, { recursive: true });
fs.mkdirSync(extensionsDir, { recursive: true });

const install = runCode([
  '--user-data-dir',
  userDataDir,
  '--extensions-dir',
  extensionsDir,
  '--install-extension',
  vsixPath,
  '--force'
]);

const installed = runCode([
  '--user-data-dir',
  userDataDir,
  '--extensions-dir',
  extensionsDir,
  '--list-extensions',
  '--show-versions'
]);

const codeVersion = runCode(['--version']);
const installedExtensions = installed.stdout
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

if (!installedExtensions.includes(expectedExtension)) {
  throw new Error(`Expected ${expectedExtension} in clean profile, got: ${installedExtensions.join(', ')}`);
}

const uninstall = runCode([
  '--user-data-dir',
  userDataDir,
  '--extensions-dir',
  extensionsDir,
  '--uninstall-extension',
  expectedExtensionId
]);

const afterUninstall = listInstalledExtensions();
if (afterUninstall.includes(expectedExtension)) {
  throw new Error(`Expected ${expectedExtensionId} to be removed, got: ${afterUninstall.join(', ')}`);
}

const reinstall = runCode([
  '--user-data-dir',
  userDataDir,
  '--extensions-dir',
  extensionsDir,
  '--install-extension',
  vsixPath,
  '--force'
]);

const afterReinstall = listInstalledExtensions();
if (!afterReinstall.includes(expectedExtension)) {
  throw new Error(`Expected ${expectedExtension} after reinstall, got: ${afterReinstall.join(', ')}`);
}

const summary = {
  ok: true,
  runId,
  expectedExtension,
  vsixPath,
  vsixSha256: sha256File(vsixPath),
  vsixSizeBytes: fs.statSync(vsixPath).size,
  userDataDir,
  extensionsDir,
  codeVersion: codeVersion.stdout.trim().split(/\r?\n/),
  installOutput: normalizeOutput(install),
  installedExtensions,
  uninstallOutput: normalizeOutput(uninstall),
  afterUninstall,
  reinstallOutput: normalizeOutput(reinstall),
  afterReinstall
};

fs.mkdirSync(acceptanceRoot, { recursive: true });
fs.writeFileSync(path.join(runRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
fs.writeFileSync(path.join(acceptanceRoot, 'latest-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(summary, null, 2));

function runCode(args) {
  const result = process.platform === 'win32'
    ? spawnSync([codeCommand, ...args].map(quoteWindowsShellArg).join(' '), {
      encoding: 'utf8',
      shell: true
    })
    : spawnSync(codeCommand, args, {
      encoding: 'utf8',
      shell: false
    });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error([
      `code ${args.join(' ')} failed with exit code ${result.status}`,
      result.stdout,
      result.stderr
    ].filter(Boolean).join('\n'));
  }

  return result;
}

function resolveCodeCommand() {
  if (process.env.VSCODE_CLI) {
    return process.env.VSCODE_CLI;
  }

  if (process.platform !== 'win32') {
    const downloaded = findDownloadedCodeCli();
    if (downloaded) return downloaded;
    return 'code';
  }

  const result = spawnSync('where.exe', ['code'], {
    encoding: 'utf8',
    shell: false
  });
  if (result.status !== 0) {
    return findDownloadedCodeCli() ?? 'code.cmd';
  }

  const candidates = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return candidates.find((candidate) => candidate.toLocaleLowerCase().endsWith('.cmd')) ?? candidates[0] ?? 'code.cmd';
}

function findDownloadedCodeCli() {
  const testRoot = path.join(repoRoot, '.vscode-test');
  if (!fs.existsSync(testRoot)) return undefined;
  const distributions = fs.readdirSync(testRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('vscode-'))
    .map((entry) => path.join(testRoot, entry.name))
    .sort()
    .reverse();
  for (const distribution of distributions) {
    const candidates = process.platform === 'darwin'
      ? [path.join(distribution, 'Visual Studio Code.app', 'Contents', 'Resources', 'app', 'bin', 'code')]
      : process.platform === 'win32'
        ? [path.join(distribution, 'bin', 'code.cmd')]
        : [path.join(distribution, 'bin', 'code')];
    const match = candidates.find((candidate) => fs.existsSync(candidate));
    if (match) return match;
  }
  return undefined;
}

function quoteWindowsShellArg(value) {
  const text = String(value);
  if (!/[ \t&()^%!,;="'<>|]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '\\"')}"`;
}

function normalizeOutput(result) {
  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

function listInstalledExtensions() {
  return runCode([
    '--user-data-dir',
    userDataDir,
    '--extensions-dir',
    extensionsDir,
    '--list-extensions',
    '--show-versions'
  ]).stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}
