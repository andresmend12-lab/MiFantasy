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
  for (const entry of fs.readdirSync(buildDir)) {
    const source = path.join(buildDir, entry);
    const destination = path.join(worktreeDir, entry);
    fs.cpSync(source, destination, { recursive: true, force: true });
  }
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
