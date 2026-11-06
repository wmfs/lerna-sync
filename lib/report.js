const colours = require('./colours')
const { ACTIONS, REASONS } = require('./plan-sync')
const { OUTCOMES } = require('./execute-plan')

const attention = (name, detail, commits) => ({ group: 'attention', name, detail, commits })
const housekeeping = (name, detail) => ({ group: 'housekeeping', name, detail })
const firstLine = s => (s || '').split('\n')[0]

function report (plan, results, { verbose = false } = {}) {
  const resultFor = new Map(results.map(r => [r.decision, r]))
  const groups = { branches: [], cloned: [], updated: [], attention: [], housekeeping: [], errors: [] }
  let okCount = 0
  let depsMayHaveChanged = false

  for (const d of plan.decisions) {
    const r = resultFor.get(d)
    const entry = classify(d, r)
    if (!entry) {
      okCount++
    } else {
      groups[entry.group].push({ ...entry, warnings: d.warnings })
    }
    if (r && (r.outcome === OUTCOMES.CLONED || r.packageJsonChanged)) depsMayHaveChanged = true
  }

  section('Cloned', groups.cloned, colours.green)
  section('Updated', groups.updated, colours.cyan)
  section('On branches (left alone)', groups.branches, colours.blue)
  section('Needs your attention', groups.attention, colours.yellow)
  section('Housekeeping', groups.housekeeping, colours.gray)
  section('Errors', groups.errors, colours.red)

  if (verbose && plan.ignored.length) {
    console.log(colours.gray(`\nIgnored ${plan.ignored.length} repos:`))
    plan.ignored.forEach(i => console.log(colours.gray(`  ${i.repoName}: ${i.reason}`)))
  }

  console.log('')
  console.log(
    `${colours.green(okCount)} up to date, ${groups.cloned.length} cloned, ${groups.updated.length} updated, ` +
    `${colours.yellow(groups.attention.length)} need attention, ${colours.red(groups.errors.length)} errors`
  )

  if (depsMayHaveChanged) {
    console.log(colours.yellow('\nDependencies may have changed. Reinstall/relink before running anything.'))
  }

  return { errorCount: groups.errors.length, attentionCount: groups.attention.length }
}

function classify (d, r) {
  const name = `${d.folder}/${d.repoName}`

  if (!r) {
    switch (d.reason) {
      case REASONS.UP_TO_DATE: return null
      case REASONS.UNSAFE_STATE: return attention(name, 'Mid-merge/rebase or unreadable status, skipped')
      case REASONS.FOREIGN_ORIGIN: return attention(name, 'origin is not this org, skipped')
      case REASONS.NOT_A_REPO:
        return d.warnings.length
          ? attention(name, 'Folder exists but is not a git repo, cannot clone')
          : housekeeping(name, 'Not a git repo')
      case REASONS.ORPHANED: return housekeeping(name, 'No longer in the org (deleted, archived or renamed)')
      case REASONS.NO_LONGER_QUALIFIES: return housekeeping(name, 'No longer selected for sync')
      case REASONS.DUPLICATE: return housekeeping(name, 'Duplicate clone')
      default: return housekeeping(name, d.reason)
    }
  }

  const branch = d.local?.branch
  switch (r.outcome) {
    case OUTCOMES.CLONED:
      return { group: 'cloned', name, detail: d.remote.packageJson?.description }
    case OUTCOMES.UPDATED:
      return { group: 'updated', name, detail: `${r.behind} new commit${r.behind === 1 ? '' : 's'}`, commits: r.commits }
    case OUTCOMES.CURRENT:
      if (d.reason === REASONS.ON_BRANCH) return { group: 'branches', name, detail: `on ${branch}, nothing new on ${d.defaultBranch}` }
      if (d.reason === REASONS.DETACHED) return { group: 'branches', name, detail: 'detached HEAD, nothing new' }
      return null
    case OUTCOMES.BEHIND:
      if (d.reason === REASONS.ON_BRANCH) return attention(name, `On ${branch}: ${d.defaultBranch} has ${r.behind} commit(s) you don't`, r.commits)
      if (d.reason === REASONS.DETACHED) return attention(name, `Detached HEAD: ${d.defaultBranch} is ${r.behind} commit(s) ahead`, r.commits)
      return attention(name, `Uncommitted changes on ${d.defaultBranch}: ${r.behind} commit(s) not pulled`, r.commits)
    case OUTCOMES.LOCAL_AHEAD:
      return attention(name, `${r.ahead} unpushed commit(s) on ${d.defaultBranch}`)
    case OUTCOMES.DIVERGED:
      return attention(name, `${d.defaultBranch} has diverged (${r.ahead} ahead, ${r.behind} behind), not pulled`, r.commits)
    case OUTCOMES.BLOCKED_BY_UNTRACKED:
      return attention(name, 'Untracked files would be overwritten, not pulled', r.commits)
    case OUTCOMES.FAILED:
      return { group: 'errors', name, detail: r.error }
  }
}

function section (title, entries, colour) {
  if (!entries.length) return
  console.log('')
  console.log(colours.underline(`${title} (${entries.length})`))
  for (const e of entries) {
    console.log(`  ${colour(e.name)}${e.detail ? colours.gray(` ${e.detail}`) : ''}`)
    for (const w of e.warnings || []) console.log(colours.yellow(`    ! ${w}`))
    for (const c of e.commits || []) console.log(colours.gray(`    ${c.sha} ${c.subject} (${c.author}, ${c.when})`))
  }
}

function printPlan (plan, { verbose = false } = {}) {
  const groups = { clone: [], fastForward: [], fetchOnly: [], attention: [], housekeeping: [] }

  let okCount = 0

  for (const d of plan.decisions) {
    const name = `${d.folder}/${d.repoName}`
    const warnings = d.warnings

    switch (d.action) {
      case ACTIONS.CLONE:
        groups.clone.push({ name, detail: d.remote.packageJson?.description, warnings })
        break
      case ACTIONS.FAST_FORWARD:
        groups.fastForward.push({ name, warnings })
        break
      case ACTIONS.FETCH_ONLY:
        groups.fetchOnly.push({ name, detail: fetchOnlyDetail(d), warnings })
        break
      default: {
        // NONE decisions: the same wording as the real report
        const entry = classify(d, undefined)
        if (!entry) okCount++
        else groups[entry.group].push({ ...entry, warnings })
      }
    }
  }

  console.log(colours.bold('\nDry run: nothing has been changed'))
  section('Would clone', groups.clone, colours.green)
  section('Would fast-forward', groups.fastForward, colours.cyan)
  section('Would fetch only (your branch is left alone)', groups.fetchOnly, colours.yellow)
  section('Needs your attention', groups.attention, colours.yellow)
  section('Housekeeping', groups.housekeeping, colours.gray)

  if (verbose && plan.ignored.length) {
    console.log(colours.gray(`\nIgnored ${plan.ignored.length} repos:`))
    plan.ignored.forEach(i => console.log(colours.gray(`  ${i.repoName}: ${i.reason}`)))
  }

  console.log('')
  console.log(
    `${colours.green(okCount)} up to date, ${groups.clone.length} to clone, ` +
    `${groups.fastForward.length} to fast-forward, ${groups.fetchOnly.length} to fetch`
  )
}

function fetchOnlyDetail (d) {
  switch (d.reason) {
    case REASONS.ON_BRANCH: return `on ${d.local.branch}`
    case REASONS.DETACHED: return 'detached HEAD'
    case REASONS.LOCAL_CHANGES: return `uncommitted changes on ${d.defaultBranch}`
    default: return d.reason
  }
}

function describeResult (r) {
  const d = r.decision
  const base = d.defaultBranch || 'master'
  const branch = d.local?.branch
  const n = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

  switch (r.outcome) {
    case OUTCOMES.CLONED:
      return { label: 'Cloned', colour: colours.green }
    case OUTCOMES.UPDATED:
      return { label: 'Updated', colour: colours.cyan, detail: `pulled ${n(r.behind, 'commit')}` }
    case OUTCOMES.CURRENT:
      if (d.reason === REASONS.ON_BRANCH) return { label: 'On branch', colour: colours.blue, detail: `${branch}, nothing new on ${base}` }
      if (d.reason === REASONS.DETACHED) return { label: 'Detached', colour: colours.blue, detail: `nothing new on ${base}` }
      if (d.reason === REASONS.LOCAL_CHANGES) return { label: 'Up to date', colour: colours.green, detail: 'has uncommitted changes' }
      return { label: 'Up to date', colour: colours.green }
    case OUTCOMES.BEHIND:
      if (d.reason === REASONS.ON_BRANCH) return { label: 'On branch', colour: colours.yellow, detail: `${branch}, ${base} has ${n(r.behind, 'new commit')}` }
      if (d.reason === REASONS.DETACHED) return { label: 'Detached', colour: colours.yellow, detail: `${base} has ${n(r.behind, 'new commit')}` }
      return { label: 'Not pulled', colour: colours.yellow, detail: `uncommitted changes, ${base} has ${n(r.behind, 'new commit')}` }
    case OUTCOMES.LOCAL_AHEAD:
      return { label: 'Unpushed', colour: colours.yellow, detail: `${n(r.ahead, 'local commit')} on ${base}` }
    case OUTCOMES.DIVERGED:
      return { label: 'Diverged', colour: colours.yellow, detail: `${r.ahead} ahead, ${r.behind} behind, not pulled` }
    case OUTCOMES.BLOCKED_BY_UNTRACKED:
      return { label: 'Not pulled', colour: colours.yellow, detail: 'untracked files would be overwritten' }
    case OUTCOMES.FAILED:
      return { label: 'Failed', colour: colours.red, detail: firstLine(r.error) }
    default:
      return { label: r.outcome, colour: colours.gray }
  }
}

module.exports = { report, printPlan, describeResult }
