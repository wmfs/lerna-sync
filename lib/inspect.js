const fs = require('fs')
const path = require('path')
const { globSync } = require('glob')
const jsonfile = require('jsonfile')
const { tryGit } = require('./utils/git')
const mapLimit = require('./utils/map-limit')

async function inspectLocalRepos (monorepoPath, lernaPackagePatterns, { concurrency = 8 } = {}) {
  const dirs = new Set()

  for (const pattern of lernaPackagePatterns) {
    // A trailing slash makes glob match directories only
    const matches = globSync(`${pattern.replace(/\/+$/, '')}/`, { cwd: monorepoPath, absolute: true })
    matches.forEach(m => dirs.add(path.resolve(m)))
  }

  return mapLimit([...dirs].sort(), concurrency, dir => inspectRepo(monorepoPath, dir))
}

async function inspectRepo (monorepoPath, repoPath) {
  const record = {
    path: repoPath,
    repoName: path.basename(repoPath),
    folder: path.relative(monorepoPath, path.dirname(repoPath)).split(path.sep).join('/'),
    isGitRepo: false
  }

  // Each package folder sits inside the husk's own repo, so in a folder that
  // isn't a repo of its own, git would happily answer for the husk instead.
  // Only trust the result if this folder is the top level.
  const toplevel = await tryGit(['rev-parse', '--show-toplevel'], repoPath)
  if (!toplevel || !samePath(toplevel, repoPath)) {
    return record
  }

  const [
    branch,
    headSha,
    status,
    originUrl,
    gitPaths
  ] = await Promise.all([
    tryGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], repoPath),
    tryGit(['rev-parse', '--verify', '--quiet', 'HEAD'], repoPath),
    tryGit(['status', '--porcelain'], repoPath),
    tryGit(['remote', 'get-url', 'origin'], repoPath),
    tryGit(['rev-parse', '--git-path', 'MERGE_HEAD', '--git-path', 'rebase-merge', '--git-path', 'rebase-apply'], repoPath)
  ])

  const statusLines = status === null ? null : status.split('\n').filter(Boolean)

  const operationInProgress = (gitPaths || '')
    .split('\n')
    .filter(Boolean)
    .some(p => fs.existsSync(path.resolve(repoPath, p)))

  return {
    ...record,
    isGitRepo: true,
    branch, // null when HEAD is detached
    isDetached: branch === null,
    headSha, // null in a repo with no commits yet
    statusKnown: statusLines !== null,
    trackedChanges: statusLines ? statusLines.filter(l => !l.startsWith('??')).length : 0,
    untrackedFiles: statusLines ? statusLines.filter(l => l.startsWith('??')).length : 0,
    operationInProgress, // mid-merge or mid-rebase
    origin: parseGitHubRemote(originUrl),
    packageJson: readJsonOrNull(path.join(repoPath, 'package.json'))
  }
}

function samePath (a, b) {
  const norm = p => {
    const real = path.resolve(fs.realpathSync.native(p))
    return process.platform === 'win32' ? real.toLowerCase() : real
  }
  try {
    return norm(a) === norm(b)
  } catch (e) {
    return false
  }
}

function parseGitHubRemote (url) {
  if (!url) return null
  // https://github.com/wmfs/repo(.git) or git@github.com:wmfs/repo(.git)
  const m = url.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?\/?$/i)
  return m ? { owner: m[1], name: m[2], url } : { owner: null, name: null, url }
}

function readJsonOrNull (file) {
  try {
    return jsonfile.readFileSync(file)
  } catch (e) {
    return null
  }
}

module.exports = { inspectLocalRepos, inspectRepo }
