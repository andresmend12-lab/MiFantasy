const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoDir = path.resolve(__dirname, '..');
const buildDir = path.join(repoDir, 'build');
const worktreeDir = path.join(repoDir, '.gh-pages');
const branch = 'gh-pages';

function run(command, options = {}) {
  execSync(command, {
    stdio: 'inherit',
    cwd: options.cwd ?? repoDir,
    ...options,
  });
}

function runQuiet(command, options = {}) {
  return execSync(command, {
    stdio: ['ignore', 'pipe', 'ignore'],
    cwd: options.cwd ?? repoDir,
    ...options,
  }).toString();
}

function ensureBuildExists() {
  if (!fs.existsSync(buildDir)) {
    throw new Error(`Build directory not found at ${buildDir}. Run \`npm run build\` first.`);
  }
}

function ensureWorktree() {
  if (fs.existsSync(worktreeDir)) {
    return;
  }

  const remoteBranch = `origin/${branch}`;

  try {
    run(`git worktree add ${worktreeDir} ${branch}`);
    return;
  } catch (error) {
    if (hasRef(remoteBranch)) {
      run(`git worktree add ${worktreeDir} ${remoteBranch}`);
      return;
    }
  }

  run(`git worktree add ${worktreeDir} --detach`);
  run(`git checkout --orphan ${branch}`, { cwd: worktreeDir });
}

function emptyDirectoryExceptGit(dir) {
  if (!fs.existsSync(dir)) {
    return;
  }

  for (const entry of fs.readdirSync(dir)) {
    if (entry === '.git') {
      continue;
    }

    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

function copyBuildToWorktree() {
  fs.mkdirSync(worktreeDir, { recursive: true });

  const entries = fs.readdirSync(buildDir, { withFileTypes: true });
  for (const entry of entries) {
    const source = path.join(buildDir, entry.name);
    const destination = path.join(worktreeDir, entry.name);
    copyEntry(source, destination, entry);
  }
}

function copyEntry(source, destination, dirent) {
  if (dirent?.isDirectory()) {
    removeIfExists(destination);
    fs.mkdirSync(destination, { recursive: true });
    const children = fs.readdirSync(source, { withFileTypes: true });
    for (const child of children) {
      copyEntry(path.join(source, child.name), path.join(destination, child.name), child);
    }
    return;
  }

  if (dirent?.isSymbolicLink()) {
    removeIfExists(destination);
    const target = fs.readlinkSync(source);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const type = getSymlinkType(source);
    fs.symlinkSync(target, destination, type);
    return;
  }

  removeIfExists(destination);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function removeIfExists(targetPath) {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

function getSymlinkType(source) {
  if (process.platform !== 'win32') {
    return undefined;
  }

  try {
    const stats = fs.statSync(source);
    if (stats.isDirectory()) {
      return 'dir';
    }
  } catch (error) {
    // Ignore errors and fall back to default type below.
  }

  return 'file';
}

function commitAndPush() {
  const status = runQuiet('git status --porcelain', { cwd: worktreeDir }).trim();
  if (!status) {
    console.log('No changes to deploy.');
    return;
  }

  run('git add .', { cwd: worktreeDir });
  const commitMessage = `Deploy site - ${new Date().toISOString()}`;
  run(`git commit -m "${commitMessage}"`, { cwd: worktreeDir });

  if (!hasRemote('origin')) {
    console.log('Skipping push because remote "origin" is not configured.');
    return;
  }

  run(`git push origin ${branch}`, { cwd: worktreeDir });
}

function main() {
  ensureBuildExists();
  ensureWorktree();
  emptyDirectoryExceptGit(worktreeDir);
  copyBuildToWorktree();
  commitAndPush();
}

function hasRef(ref) {
  try {
    runQuiet(`git show-ref ${ref}`);
    return true;
  } catch (error) {
    return false;
  }
}

function hasRemote(name) {
  try {
    const remotes = runQuiet('git remote').split('\n').map((entry) => entry.trim()).filter(Boolean);
    return remotes.includes(name);
  } catch (error) {
    return false;
  }
}

main();
