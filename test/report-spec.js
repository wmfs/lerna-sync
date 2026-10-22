/* eslint-env mocha */

const { expect } = require('chai')
const { router, remote, local, captureConsole } = require('./helpers/fixtures')
const { planSync } = require('../lib/plan-sync')
const { OUTCOMES } = require('../lib/execute-plan')
const { report, printPlan, describeResult } = require('../lib/report')

const makePlan = (remoteRepos, localRepos) => planSync({
  remoteRepos,
  localRepos,
  router,
  orgName: 'wmfs',
  packageFolders: ['plugins', 'blueprints']
})

const find = (plan, repoName) => plan.decisions.find(d => d.repoName === repoName)

describe('describeResult', () => {
  const d = overrides => ({ repoName: 'a', folder: 'plugins', defaultBranch: 'master', local: { branch: 'master' }, ...overrides })

  it('names the branch when on a feature branch with nothing new', () => {
    const r = describeResult({ decision: d({ reason: 'ON_BRANCH', local: { branch: 'feature/x' } }), outcome: OUTCOMES.CURRENT })
    expect(r.label).to.equal('On branch')
    expect(r.detail).to.equal('feature/x, nothing new on master')
  })

  it('counts new commits on the default branch when on a feature branch', () => {
    const r = describeResult({ decision: d({ reason: 'ON_BRANCH', local: { branch: 'feature/x' } }), outcome: OUTCOMES.BEHIND, behind: 3 })
    expect(r.detail).to.equal('feature/x, master has 3 new commits')
  })

  it('uses the singular for one commit', () => {
    const r = describeResult({ decision: d({ reason: 'BEHIND' }), outcome: OUTCOMES.UPDATED, behind: 1 })
    expect(r).to.include({ label: 'Updated', detail: 'pulled 1 commit' })
  })

  it('uses the repo\'s default branch name', () => {
    const r = describeResult({ decision: d({ reason: 'DETACHED', defaultBranch: 'main', local: { branch: null } }), outcome: OUTCOMES.BEHIND, behind: 2 })
    expect(r.detail).to.equal('main has 2 new commits')
  })

  it('describes each outcome without falling back to the raw enum', () => {
    const cases = [
      [OUTCOMES.CLONED, 'NEW', 'Cloned'],
      [OUTCOMES.CURRENT, 'BEHIND', 'Up to date'],
      [OUTCOMES.CURRENT, 'LOCAL_CHANGES', 'Up to date'],
      [OUTCOMES.CURRENT, 'DETACHED', 'Detached'],
      [OUTCOMES.BEHIND, 'LOCAL_CHANGES', 'Not pulled'],
      [OUTCOMES.LOCAL_AHEAD, 'BEHIND', 'Unpushed'],
      [OUTCOMES.DIVERGED, 'BEHIND', 'Diverged'],
      [OUTCOMES.BLOCKED_BY_UNTRACKED, 'BEHIND', 'Not pulled'],
      [OUTCOMES.FAILED, 'BEHIND', 'Failed']
    ]
    for (const [outcome, reason, label] of cases) {
      const r = describeResult({ decision: d({ reason }), outcome, ahead: 1, behind: 1, error: 'x' })
      expect(r.label, `${outcome}/${reason}`).to.equal(label)
    }
  })

  it('shows only the first line of an error', () => {
    const r = describeResult({ decision: d({ reason: 'NEW' }), outcome: OUTCOMES.FAILED, error: 'fatal: nope\nmore detail' })
    expect(r.detail).to.equal('fatal: nope')
  })
})

describe('report', () => {
  let output
  beforeEach(() => { output = captureConsole() })
  afterEach(() => output.restore())

  it('counts errors and items needing attention', () => {
    const plan = makePlan(
      [remote('ok', { sha: 'same' }), remote('new'), remote('branch'), remote('broken')],
      [local('ok', { headSha: 'same' }), local('branch', { branch: 'feature/x' }), local('broken'), local('mid', { operationInProgress: true })]
    )
    const results = [
      { decision: find(plan, 'new'), outcome: OUTCOMES.CLONED },
      { decision: find(plan, 'branch'), outcome: OUTCOMES.BEHIND, behind: 2, commits: [] },
      { decision: find(plan, 'broken'), outcome: OUTCOMES.FAILED, error: 'fatal: boom' }
    ]

    const counts = report(plan, results)

    // "branch" is behind (attention); "mid" is ORPHANED (not in remotes), so housekeeping
    expect(counts).to.deep.equal({ errorCount: 1, attentionCount: 1 })
    expect(output.text()).to.include('Errors (1)')
    expect(output.text()).to.include('plugins/broken fatal: boom')
  })

  it('lists repos left alone on a branch, rather than counting them as up to date', () => {
    const plan = makePlan([remote('a')], [local('a', { branch: 'feature/x' })])
    report(plan, [{ decision: plan.decisions[0], outcome: OUTCOMES.CURRENT, ahead: 0, behind: 0, commits: [] }])

    expect(output.text()).to.include('On branches (left alone) (1)')
    expect(output.text()).to.include('plugins/a on feature/x, nothing new on master')
    expect(output.text()).to.include('0 up to date')
  })

  it('shows incoming commits for a branch that is behind', () => {
    const plan = makePlan([remote('a')], [local('a', { branch: 'feature/x' })])
    report(plan, [{
      decision: plan.decisions[0],
      outcome: OUTCOMES.BEHIND,
      behind: 1,
      commits: [{ sha: 'abc123', subject: 'Fix the thing', author: 'Ann', when: '2 hours ago' }]
    }])

    expect(output.text()).to.include('Needs your attention (1)')
    expect(output.text()).to.include('abc123 Fix the thing (Ann, 2 hours ago)')
  })

  it('prints warnings under the repo they belong to', () => {
    const bp = remote('a', { packageJson: { keywords: ['tymly', 'blueprint'] } })
    const plan = makePlan([bp], [local('a', { folder: 'plugins' })])
    report(plan, [{ decision: plan.decisions[0], outcome: OUTCOMES.UPDATED, behind: 1, commits: [] }])

    expect(output.text()).to.include('! Lives in /plugins but is now routed to /blueprints')
  })

  it('reports NONE decisions without needing a result', () => {
    const plan = makePlan([], [local('gone'), local('scratch', { isGitRepo: false, origin: undefined })])
    const counts = report(plan, [])

    expect(counts).to.deep.equal({ errorCount: 0, attentionCount: 0 })
    expect(output.text()).to.include('Housekeeping (2)')
    expect(output.text()).to.include('No longer in the org')
  })

  it('suggests reinstalling only when dependencies may have changed', () => {
    const plan = makePlan([remote('a'), remote('b')], [local('a'), local('b')])
    report(plan, plan.decisions.map(d => ({ decision: d, outcome: OUTCOMES.UPDATED, behind: 1, commits: [], packageJsonChanged: false })))
    expect(output.text()).to.not.include('Dependencies may have changed')

    output.lines.length = 0
    report(plan, [{ decision: plan.decisions[0], outcome: OUTCOMES.UPDATED, behind: 1, commits: [], packageJsonChanged: true }])
    expect(output.text()).to.include('Dependencies may have changed')
  })

  it('lists ignored repos only when verbose', () => {
    const plan = makePlan([remote('other', { packageJson: { keywords: [] } })], [])
    report(plan, [])
    expect(output.text()).to.not.include('Ignored')

    report(plan, [], { verbose: true })
    expect(output.text()).to.include('Ignored 1 repos')
    expect(output.text()).to.include('other: Not selected by router')
  })
})

describe('printPlan', () => {
  let output
  beforeEach(() => { output = captureConsole() })
  afterEach(() => output.restore())

  it('describes what would happen, grouped by action', () => {
    const plan = makePlan(
      [remote('new'), remote('behind'), remote('branch'), remote('ok', { sha: 'same' })],
      [local('behind'), local('branch', { branch: 'feature/x' }), local('ok', { headSha: 'same' })]
    )
    printPlan(plan)
    const text = output.text()

    expect(text).to.include('Dry run: nothing has been changed')
    expect(text).to.include('Would clone (1)')
    expect(text).to.include('plugins/new new description')
    expect(text).to.include('Would fast-forward (1)')
    expect(text).to.include('Would fetch only (your branch is left alone) (1)')
    expect(text).to.include('plugins/branch on feature/x')
    expect(text).to.include('1 up to date, 1 to clone, 1 to fast-forward, 1 to fetch')
  })

  it('includes attention items from the plan itself', () => {
    printPlan(makePlan([remote('a')], [local('a', { operationInProgress: true })]))
    expect(output.text()).to.include('Needs your attention (1)')
    expect(output.text()).to.include('Mid-merge/rebase')
  })
})
