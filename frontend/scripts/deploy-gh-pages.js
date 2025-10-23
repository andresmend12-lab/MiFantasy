#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function runGit(args, options = {}) {
  const result = spawnSync('git', args, {
    stdio: 'inherit',
    ...options,
  });
  if (result.status !== 0) {
    const error = new Error(`git ${args.join(' ')} failed`);
    error.result = result;
    throw error;
  }
  return result;
}

function readGit(args, options = {}) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    ...options,
  });
  if (result.status !== 0) {
    const error = new Error(`git ${args.join(' ')} failed`);
    error.result = result;
    throw error;
  }
  return result.stdout.trim();
}

function ensureWorktree(repoRoot, worktreeDir) {
  fs.rmSync(worktreeDir, { recursive: true, force: true });
  runGit(['worktree', 'prune'], { cwd: repoRoot });

  const attempts = [
    ['worktree', 'add', '--force', worktreeDir, 'gh-pages'],
    ['worktree', 'add', '--force', '-B', 'gh-pages', worktreeDir, 'origin/gh-pages'],
    ['worktree', 'add', '--force', '-B', 'gh-pages', worktreeDir, 'HEAD'],
  ];

  for (let index = 0; index < attempts.length; index += 1) {
    try {
      runGit(attempts[index], { cwd: repoRoot });
      return;
    } catch (error) {
      if (index === attempts.length - 1) {
        throw error;
      }
    }
  }
}

function emptyDirectoryExceptGit(dir) {
  for (const entry of fs.readdirSync(dir)) {
    if (entry === '.git') continue;
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

function hasChanges(dir) {
  const result = spawnSync('git', ['status', '--porcelain'], {
    cwd: dir,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error('Failed to determine git status for gh-pages worktree');
  }
  return result.stdout.trim().length > 0;
}

function main() {
  const buildDir = path.join(process.cwd(), 'build');
  if (!fs.existsSync(buildDir)) {
    console.error('The build directory does not exist. Run "npm run build" first.');
    process.exit(1);
  }

  const repoRoot = readGit(['rev-parse', '--show-toplevel']);
  const worktreeDir = path.join(repoRoot, '.gh-pages-worktree');

  let worktreeReady = false;
  ensureWorktree(repoRoot, worktreeDir);
  worktreeReady = true;

  try {
    emptyDirectoryExceptGit(worktreeDir);
    fs.cpSync(buildDir, worktreeDir, { recursive: true });

    if (!hasChanges(worktreeDir)) {
      console.log('No changes detected in build output. Skipping deploy.');
      return;
    }

    runGit(['add', '.'], { cwd: worktreeDir });
    const commitMessage = `Deploy ${new Date().toISOString()}`;
    runGit(['commit', '-m', commitMessage], { cwd: worktreeDir });
    runGit(['push', 'origin', 'gh-pages'], { cwd: worktreeDir });

    console.log('Deployment to gh-pages completed successfully.');
  } finally {
    if (worktreeReady && fs.existsSync(worktreeDir)) {
      runGit(['worktree', 'remove', worktreeDir, '--force'], { cwd: repoRoot });
    }
  }
}

try {
  main();
} catch (error) {
  console.error('\nDeployment failed.');
  if (error && error.message) {
    console.error(error.message);
  }
  process.exitCode = 1;
}
