const path = require('path')
const { git, tryGit } = require('./utils/git')
const mapLimit = require('./utils/map-limit')
const { ACTIONS, REASONS } = require('./plan-sync')

const OUTCOMES = Object.freeze({
  CLONED: 'CLONED',
  UPDATED: 'UPDATED',
  CURRENT: 'CURRENT',
  BEHIND: 'BEHIND', // fetched only; the default branch has commits HEAD doesn't
  LOCAL_AHEAD: 'LOCAL_AHEAD', // unpushed commits on the default branch
  DIVERGED: 'DIVERGED',
  BLOCKED_BY_UNTRACKED: 'BLOCKED_BY_UNTRACKED',
  FAILED: 'FAILED'
})

const HANDLERS = {
  [ACTIONS.CLONE]: cloneRepo,
  [ACTIONS.FAST_FORWARD]: fastForward,
  [ACTIONS.FETCH_ONLY]: fetchOnly
}

async function executePlan (plan, options) {
  const runnable = plan.decisions.filter(d => d.action !== ACTIONS.NONE)

  return mapLimit(runnable, options.concurrency || 6, async decision => {
    let result
    try {
      result = { decision, ...(await HANDLERS[decision.action](decision, options)) }
    } catch (err) {
      result = { decision, outcome: OUTCOMES.FAILED, error: cleanError(err) }
    }
    if (options.onResult) options.onResult(result) // progress line as each one finishes
    return result
  })
}

async function cloneRepo (d, { monorepoPath, gitHubOrgName, cloneUrl }) {
  const dest = path.join(monorepoPath, ...d.folder.split('/'), d.remote.name)
  const url = cloneUrl
    ? cloneUrl(gitHubOrgName, d.remote.name) // e.g. allow SSH: git@github.com:wmfs/x.git
    : `https://github.com/${gitHubOrgName}/${d.remote.name}.git`

  await git(['clone', '--quiet', url, dest], monorepoPath)
  return { outcome: OUTCOMES.CLONED }
}

async function fastForward (d) {
  const cwd = d.local.path
  const upstream = `origin/${d.defaultBranch}`

  await gitFetch(cwd)
  const { ahead, behind } = await aheadBehind(cwd, upstream)

  if (behind === 0) {
    return { outcome: ahead > 0 ? OUTCOMES.LOCAL_AHEAD : OUTCOMES.CURRENT, ahead, behind }
  }
  if (ahead > 0) {
    return { outcome: OUTCOMES.DIVERGED, ahead, behind, commits: await incoming(cwd, upstream) }
  }

  const commits = await incoming(cwd, upstream)
  const before = await git(['rev-parse', 'HEAD'], cwd)

  try {
    await git(['merge', '--ff-only', '--quiet', upstream], cwd)
  } catch (err) {
    if (/untracked working tree files would be overwritten/i.test(err.stderr || '')) {
      return { outcome: OUTCOMES.BLOCKED_BY_UNTRACKED, ahead, behind, commits }
    }
    throw err
  }

  const changed = await git(['diff', '--name-only', before, 'HEAD', '--', 'package.json'], cwd)
  return { outcome: OUTCOMES.UPDATED, ahead, behind, commits, packageJsonChanged: changed.length > 0 }
}

async function fetchOnly (d, { updateLocalDefaultBranch = true }) {
  const cwd = d.local.path
  const upstream = `origin/${d.defaultBranch}`

  await gitFetch(cwd)

  // On a feature branch or detached HEAD, local master isn't checked out, so it can be
  // fast-forwarded without touching the working tree. Skip it for LOCAL_CHANGES:
  // there, master *is* checked out.
  if (updateLocalDefaultBranch && d.reason !== REASONS.LOCAL_CHANGES) {
    await fastForwardRef(cwd, d.defaultBranch, upstream)
  }

  const { ahead, behind } = await aheadBehind(cwd, upstream)
  return {
    outcome: behind > 0 ? OUTCOMES.BEHIND : OUTCOMES.CURRENT,
    ahead,
    behind,
    commits: behind > 0 ? await incoming(cwd, upstream) : []
  }
}

// Helpers

const gitFetch = cwd => git(['fetch', '--quiet', '--prune', 'origin'], cwd)

async function aheadBehind (cwd, upstream) {
  const out = await git(['rev-list', '--left-right', '--count', `HEAD...${upstream}`], cwd)
  const [ahead, behind] = out.split(/\s+/).map(Number)
  return { ahead, behind }
}

async function incoming (cwd, upstream, limit = 10) {
  const out = await git(
    ['log', `--max-count=${limit}`, '--format=%h%x09%an%x09%ar%x09%s', `HEAD..${upstream}`],
    cwd
  )
  if (!out) return []
  return out.split('\n').map(line => {
    const [sha, author, when, subject] = line.split('\t')
    return { sha, author, when, subject }
  })
}

async function fastForwardRef (cwd, branch, upstream) {
  const ref = `refs/heads/${branch}`
  const current = await tryGit(['rev-parse', '--verify', '--quiet', ref], cwd)
  if (!current) return // no local master branch, nothing to update

  // Exit code 0 only if local master is an ancestor of origin/master, i.e. a fast-forward
  const isFastForward = await tryGit(['merge-base', '--is-ancestor', ref, upstream], cwd)
  if (isFastForward === null) return

  // Passing the old SHA makes this a compare-and-swap
  await tryGit(['update-ref', ref, upstream, current], cwd)
}

function cleanError (err) {
  if (err.killed) return err.message // e.g. "git fetch timed out after 300s"
  const text = (err.stderr || err.message || String(err)).trim()
  return text.split('\n').slice(-3).join('\n')
}

module.exports = { executePlan, OUTCOMES }
