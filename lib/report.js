const chalk = require('chalk')
const { ACTIONS, REASONS } = require('./plan-sync')
const { OUTCOMES } = require('./execute-plan')

const attention = (name, detail, commits) => ({ group: 'attention', name, detail, commits })
const housekeeping = (name, detail) => ({ group: 'housekeeping', name, detail })
const firstLine = s => (s || '').split('\n')[0]

function report (plan, results, { verbose = false } = {}) {
  const resultFor = new Map(results.map(r => [r.decision, r]))
  const groups = { cloned: [], updated: [], attention: [], housekeeping: [], errors: [] }
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

  section('Cloned', groups.cloned, chalk.green)
  section('Updated', groups.updated, chalk.cyan)
  section('Needs your attention', groups.attention, chalk.yellow)
  section('Housekeeping', groups.housekeeping, chalk.gray)
  section('Errors', groups.errors, chalk.red)

  if (verbose && plan.ignored.length) {
    console.log(chalk.gray(`\nIgnored ${plan.ignored.length} repos:`))
    plan.ignored.forEach(i => console.log(chalk.gray(`  ${i.repoName}: ${i.reason}`)))
  }

  console.log('')
  console.log(
    `${chalk.green(okCount)} up to date, ${groups.cloned.length} cloned, ${groups.updated.length} updated, ` +
    `${chalk.yellow(groups.attention.length)} need attention, ${chalk.red(groups.errors.length)} errors`
  )

  if (depsMayHaveChanged) {
    console.log(chalk.yellow('\nDependencies may have changed. Reinstall/relink before running anything.'))
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
  console.log(chalk.underline(`${title} (${entries.length})`))
  for (const e of entries) {
    console.log(`  ${colour(e.name)}${e.detail ? chalk.gray(` ${e.detail}`) : ''}`)
    for (const w of e.warnings || []) console.log(chalk.yellow(`    ! ${w}`))
    for (const c of e.commits || []) console.log(chalk.gray(`    ${c.sha} ${c.subject} (${c.author}, ${c.when})`))
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

  console.log(chalk.bold('\nDry run: nothing has been changed'))
  section('Would clone', groups.clone, chalk.green)
  section('Would fast-forward', groups.fastForward, chalk.cyan)
  section('Would fetch only (your branch is left alone)', groups.fetchOnly, chalk.yellow)
  section('Needs your attention', groups.attention, chalk.yellow)
  section('Housekeeping', groups.housekeeping, chalk.gray)

  if (verbose && plan.ignored.length) {
    console.log(chalk.gray(`\nIgnored ${plan.ignored.length} repos:`))
    plan.ignored.forEach(i => console.log(chalk.gray(`  ${i.repoName}: ${i.reason}`)))
  }

  console.log('')
  console.log(
    `${chalk.green(okCount)} up to date, ${groups.clone.length} to clone, ` +
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
      return { label: 'Cloned', colour: chalk.green }
    case OUTCOMES.UPDATED:
      return { label: 'Updated', colour: chalk.cyan, detail: `pulled ${n(r.behind, 'commit')}` }
    case OUTCOMES.CURRENT:
      if (d.reason === REASONS.ON_BRANCH) return { label: 'On branch', colour: chalk.blue, detail: `${branch}, nothing new on ${base}` }
      if (d.reason === REASONS.DETACHED) return { label: 'Detached', colour: chalk.blue, detail: `nothing new on ${base}` }
      if (d.reason === REASONS.LOCAL_CHANGES) return { label: 'Up to date', colour: chalk.green, detail: 'has uncommitted changes' }
      return { label: 'Up to date', colour: chalk.green }
    case OUTCOMES.BEHIND:
      if (d.reason === REASONS.ON_BRANCH) return { label: 'On branch', colour: chalk.yellow, detail: `${branch}, ${base} has ${n(r.behind, 'new commit')}` }
      if (d.reason === REASONS.DETACHED) return { label: 'Detached', colour: chalk.yellow, detail: `${base} has ${n(r.behind, 'new commit')}` }
      return { label: 'Not pulled', colour: chalk.yellow, detail: `uncommitted changes, ${base} has ${n(r.behind, 'new commit')}` }
    case OUTCOMES.LOCAL_AHEAD:
      return { label: 'Unpushed', colour: chalk.yellow, detail: `${n(r.ahead, 'local commit')} on ${base}` }
    case OUTCOMES.DIVERGED:
      return { label: 'Diverged', colour: chalk.yellow, detail: `${r.ahead} ahead, ${r.behind} behind, not pulled` }
    case OUTCOMES.BLOCKED_BY_UNTRACKED:
      return { label: 'Not pulled', colour: chalk.yellow, detail: 'untracked files would be overwritten' }
    case OUTCOMES.FAILED:
      return { label: 'Failed', colour: chalk.red, detail: firstLine(r.error) }
    default:
      return { label: r.outcome, colour: chalk.gray }
  }
}

module.exports = { report, printPlan, describeResult }
