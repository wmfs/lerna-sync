const ACTIONS = Object.freeze({
  CLONE: 'CLONE',
  FAST_FORWARD: 'FAST_FORWARD',
  FETCH_ONLY: 'FETCH_ONLY',
  NONE: 'NONE'
})

const REASONS = Object.freeze({
  NEW: 'NEW',
  BEHIND: 'BEHIND',
  UP_TO_DATE: 'UP_TO_DATE',
  ON_BRANCH: 'ON_BRANCH',
  DETACHED: 'DETACHED',
  LOCAL_CHANGES: 'LOCAL_CHANGES',
  UNSAFE_STATE: 'UNSAFE_STATE',
  NOT_A_REPO: 'NOT_A_REPO',
  FOREIGN_ORIGIN: 'FOREIGN_ORIGIN',
  ORPHANED: 'ORPHANED',
  NO_LONGER_QUALIFIES: 'NO_LONGER_QUALIFIES',
  DUPLICATE: 'DUPLICATE'
})

function planSync ({ remoteRepos, localRepos, router, orgName, packageFolders }) {
  const key = name => name.toLowerCase() // GitHub repo names are case-insensitive
  const knownFolders = new Set(packageFolders)

  // 1. Route every remote repo once
  const remoteByName = new Map()
  const ignored = []

  for (const remote of remoteRepos) {
    const route = routeRepo(remote, router, knownFolders)
    remoteByName.set(key(remote.name), { remote, route })
    if (!route.folder) {
      ignored.push({ repoName: remote.name, reason: route.reason })
    }
  }

  // 2. Index local repos by the name origin points at, falling back to folder name
  const localByName = new Map()
  const decisions = []

  for (const local of localRepos) {
    const name = key(local.origin?.name || local.repoName)
    if (localByName.has(name)) {
      decisions.push(
        decision(
          local.repoName,
          ACTIONS.NONE,
          REASONS.DUPLICATE,
          {
            local,
            folder: local.folder,
            warnings: [`Also found at ${localByName.get(name).folder}/${localByName.get(name).repoName}`]
          }
        )
      )
      continue
    }
    localByName.set(name, local)
  }

  // 3. Repos that exist locally
  for (const [name, local] of localByName) {
    const entry = remoteByName.get(name)
    decisions.push(planLocal(local, entry, orgName))
  }

  // 4. Qualifying remote repos with no local copy
  for (const [name, { remote, route }] of remoteByName) {
    if (!route.folder || localByName.has(name)) continue
    decisions.push(decision(remote.name, ACTIONS.CLONE, REASONS.NEW, {
      remote,
      folder: route.folder,
      defaultBranch: remote.defaultBranch
    }))
  }

  decisions.sort((a, b) =>
    a.folder.localeCompare(b.folder) || a.repoName.localeCompare(b.repoName)
  )

  return { decisions, ignored }
}

function planLocal (local, entry, orgName) {
  const base = { local, folder: local.folder }

  if (!local.isGitRepo) {
    // A plain folder where a qualifying repo would be cloned: don't overwrite it
    return decision(local.repoName, ACTIONS.NONE, REASONS.NOT_A_REPO, {
      ...base,
      remote: entry?.remote || null,
      warnings: entry?.route.folder ? ['Folder exists but is not a git repo, so it cannot be cloned into'] : []
    })
  }

  if (local.origin?.owner && local.origin.owner.toLowerCase() !== orgName.toLowerCase()) {
    return decision(local.repoName, ACTIONS.NONE, REASONS.FOREIGN_ORIGIN, {
      ...base,
      warnings: [`origin points at ${local.origin.url}`]
    })
  }

  if (!entry) {
    return decision(local.repoName, ACTIONS.NONE, REASONS.ORPHANED, base)
  }

  const { remote, route } = entry
  const withRemote = { ...base, remote, defaultBranch: remote.defaultBranch, warnings: [] }

  if (!route.folder) {
    return decision(local.repoName, ACTIONS.NONE, REASONS.NO_LONGER_QUALIFIES, {
      ...withRemote,
      warnings: [route.reason]
    })
  }

  if (route.folder !== local.folder) {
    withRemote.warnings.push(`Lives in /${local.folder} but is now routed to /${route.folder}`)
  }

  if (!local.statusKnown || local.operationInProgress || !local.headSha) {
    return decision(local.repoName, ACTIONS.NONE, REASONS.UNSAFE_STATE, withRemote)
  }

  if (local.isDetached) {
    return decision(local.repoName, ACTIONS.FETCH_ONLY, REASONS.DETACHED, withRemote)
  }

  if (local.branch !== remote.defaultBranch) {
    return decision(local.repoName, ACTIONS.FETCH_ONLY, REASONS.ON_BRANCH, withRemote)
  }

  if (local.headSha === remote.sha) {
    return decision(local.repoName, ACTIONS.NONE, REASONS.UP_TO_DATE, withRemote)
  }

  if (local.trackedChanges > 0) {
    return decision(local.repoName, ACTIONS.FETCH_ONLY, REASONS.LOCAL_CHANGES, withRemote)
  }

  // On the default branch, clean, and HEAD differs from GitHub.
  // Usually that means behind. If it has local commits instead, --ff-only
  // will refuse and the executor reports it as diverged.
  return decision(local.repoName, ACTIONS.FAST_FORWARD, REASONS.BEHIND, withRemote)
}

function routeRepo (remote, router, knownFolders) {
  if (!remote.packageJson) return { folder: null, reason: 'No package.json' }

  let result
  try {
    result = router(remote.packageJson)
  } catch (e) {
    return { folder: null, reason: `Router threw: ${e.message}` }
  }

  // Backwards compatible: a string means "route here", null/undefined means "not ours".
  // A router can also return { skip: 'reason' } so the report can say why.
  if (result == null) return { folder: null, reason: 'Not selected by router' }
  if (typeof result === 'object' && result.skip) return { folder: null, reason: result.skip }
  if (typeof result !== 'string') return { folder: null, reason: `Router returned ${JSON.stringify(result)}` }
  if (!knownFolders.has(result)) return { folder: null, reason: `Router chose "${result}", which is not in lerna.json` }

  return { folder: result, reason: null }
}

function decision (repoName, action, reason, extra = {}) {
  return {
    repoName,
    action,
    reason,
    folder: extra.folder,
    defaultBranch: extra.defaultBranch || extra.remote?.defaultBranch || null,
    remote: extra.remote || null,
    local: extra.local || null,
    warnings: extra.warnings || []
  }
}

module.exports = { planSync, ACTIONS, REASONS }
