/* eslint-env mocha */

const { expect } = require('chai')
const { router, remote, local } = require('./helpers/fixtures')
const { planSync, ACTIONS, REASONS } = require('../lib/plan-sync')

const plan = (remoteRepos, localRepos, overrides = {}) => planSync({
  remoteRepos,
  localRepos,
  router,
  orgName: 'wmfs',
  packageFolders: ['plugins', 'blueprints'],
  ...overrides
})

const only = result => {
  expect(result.decisions).to.have.length(1)
  return result.decisions[0]
}

describe('planSync', () => {
  describe('routing remote repos', () => {
    it('ignores repos without a package.json', () => {
      const { decisions, ignored } = plan([remote('a', { packageJson: null })], [])
      expect(decisions).to.have.length(0)
      expect(ignored).to.deep.equal([{ repoName: 'a', reason: 'No package.json' }])
    })

    it('ignores repos the router does not select', () => {
      const { decisions, ignored } = plan([remote('a', { packageJson: { keywords: ['other'] } })], [])
      expect(decisions).to.have.length(0)
      expect(ignored[0].reason).to.equal('Not selected by router')
    })

    it('uses the skip reason a router returns', () => {
      const optedOut = remote('a', { packageJson: { keywords: ['tymly', 'plugin'], config: { tymly: { sync: false } } } })
      const { ignored } = plan([optedOut], [])
      expect(ignored[0].reason).to.equal('Opted out (config.tymly.sync = false)')
    })

    it('ignores a repo when the router throws, instead of failing the sync', () => {
      const throwing = () => { throw new Error('boom') }
      const { decisions, ignored } = plan([remote('a'), remote('b')], [], { router: throwing })
      expect(decisions).to.have.length(0)
      expect(ignored.map(i => i.reason)).to.deep.equal(['Router threw: boom', 'Router threw: boom'])
    })

    it('rejects a folder that is not in lerna.json', () => {
      const { decisions, ignored } = plan([remote('a')], [], { router: () => 'mods' })
      expect(decisions).to.have.length(0)
      expect(ignored[0].reason).to.include('"mods", which is not in lerna.json')
    })

    it('rejects router results that are not strings', () => {
      const { ignored } = plan([remote('a')], [], { router: () => 42 })
      expect(ignored[0].reason).to.equal('Router returned 42')
    })

    it('calls the router exactly once per remote repo', () => {
      let calls = 0
      const counting = pkg => { calls++; return router(pkg) }
      plan([remote('a'), remote('b')], [local('a')], { router: counting })
      expect(calls).to.equal(2)
    })
  })

  describe('repos missing locally', () => {
    it('clones a qualifying repo into its routed folder', () => {
      const d = only(plan([remote('bp', { packageJson: { keywords: ['tymly', 'blueprint'] } })], []))
      expect(d).to.include({ repoName: 'bp', action: ACTIONS.CLONE, reason: REASONS.NEW, folder: 'blueprints', defaultBranch: 'master' })
      expect(d.local).to.equal(null)
    })

    it('carries a non-master default branch through', () => {
      const d = only(plan([remote('a', { defaultBranch: 'main' })], []))
      expect(d.defaultBranch).to.equal('main')
    })
  })

  describe('repos on the default branch', () => {
    it('does nothing when HEAD matches GitHub', () => {
      const d = only(plan([remote('a', { sha: 'same' })], [local('a', { headSha: 'same' })]))
      expect(d).to.include({ action: ACTIONS.NONE, reason: REASONS.UP_TO_DATE })
    })

    it('fast-forwards when clean and HEAD differs', () => {
      const d = only(plan([remote('a')], [local('a')]))
      expect(d).to.include({ action: ACTIONS.FAST_FORWARD, reason: REASONS.BEHIND })
    })

    it('only fetches when there are uncommitted changes', () => {
      const d = only(plan([remote('a')], [local('a', { trackedChanges: 2 })]))
      expect(d).to.include({ action: ACTIONS.FETCH_ONLY, reason: REASONS.LOCAL_CHANGES })
    })

    it('reports up to date, not local changes, when dirty but already current', () => {
      const d = only(plan([remote('a', { sha: 'same' })], [local('a', { headSha: 'same', trackedChanges: 1 })]))
      expect(d.reason).to.equal(REASONS.UP_TO_DATE)
    })

    it('does not treat untracked files alone as local changes', () => {
      const d = only(plan([remote('a')], [local('a', { untrackedFiles: 3 })]))
      expect(d.action).to.equal(ACTIONS.FAST_FORWARD)
    })

    it('treats "main" as the default branch when GitHub says so', () => {
      const d = only(plan([remote('a', { defaultBranch: 'main' })], [local('a', { branch: 'main' })]))
      expect(d.action).to.equal(ACTIONS.FAST_FORWARD)
    })
  })

  describe('repos the developer is working in', () => {
    it('only fetches when on a feature branch', () => {
      const d = only(plan([remote('a')], [local('a', { branch: 'feature/x' })]))
      expect(d).to.include({ action: ACTIONS.FETCH_ONLY, reason: REASONS.ON_BRANCH })
    })

    it('only fetches on a feature branch even if HEAD matches GitHub', () => {
      const d = only(plan([remote('a', { sha: 'same' })], [local('a', { branch: 'feature/x', headSha: 'same' })]))
      expect(d.reason).to.equal(REASONS.ON_BRANCH)
    })

    it('treats local "master" as a branch when the default is "main"', () => {
      const d = only(plan([remote('a', { defaultBranch: 'main' })], [local('a', { branch: 'master' })]))
      expect(d.reason).to.equal(REASONS.ON_BRANCH)
    })

    it('only fetches on a detached HEAD', () => {
      const d = only(plan([remote('a')], [local('a', { branch: null, isDetached: true })]))
      expect(d).to.include({ action: ACTIONS.FETCH_ONLY, reason: REASONS.DETACHED })
    })
  })

  describe('unsafe local state', () => {
    for (const [label, overrides] of [
      ['mid-merge or mid-rebase', { operationInProgress: true }],
      ['git status could not be read', { statusKnown: false }],
      ['no commits yet', { headSha: null }]
    ]) {
      it(`does nothing when ${label}`, () => {
        const d = only(plan([remote('a')], [local('a', overrides)]))
        expect(d).to.include({ action: ACTIONS.NONE, reason: REASONS.UNSAFE_STATE })
      })
    }

    it('checks unsafe state before branch state', () => {
      const d = only(plan([remote('a')], [local('a', { branch: 'feature/x', operationInProgress: true })]))
      expect(d.reason).to.equal(REASONS.UNSAFE_STATE)
    })
  })

  describe('folders that are not plain clones of an org repo', () => {
    it('does not clone over a plain folder where a qualifying repo would go', () => {
      const d = only(plan([remote('a')], [local('a', { isGitRepo: false, origin: undefined })]))
      expect(d).to.include({ action: ACTIONS.NONE, reason: REASONS.NOT_A_REPO })
      expect(d.warnings).to.have.length(1)
    })

    it('notes an unrelated plain folder without a warning', () => {
      const d = only(plan([], [local('scratch', { isGitRepo: false, origin: undefined })]))
      expect(d.reason).to.equal(REASONS.NOT_A_REPO)
      expect(d.warnings).to.deep.equal([])
    })

    it('leaves alone a repo whose origin is another owner', () => {
      const fork = local('a', { origin: { owner: 'someone', name: 'a', url: 'https://github.com/someone/a.git' } })
      const d = only(plan([remote('a')], [fork]))
      expect(d).to.include({ action: ACTIONS.NONE, reason: REASONS.FOREIGN_ORIGIN })
      expect(d.warnings[0]).to.include('github.com/someone/a.git')
    })

    it('compares the origin owner case-insensitively', () => {
      const d = only(plan([remote('a')], [local('a', { origin: { owner: 'WMFS', name: 'a', url: 'x' } })]))
      expect(d.reason).to.not.equal(REASONS.FOREIGN_ORIGIN)
    })

    it('reports local repos that are gone from the org', () => {
      const d = only(plan([], [local('gone')]))
      expect(d).to.include({ action: ACTIONS.NONE, reason: REASONS.ORPHANED })
    })

    it('reports local repos that no longer qualify, with the reason', () => {
      const optedOut = remote('a', { packageJson: { keywords: ['tymly', 'plugin'], config: { tymly: { sync: false } } } })
      const d = only(plan([optedOut], [local('a')]))
      expect(d).to.include({ action: ACTIONS.NONE, reason: REASONS.NO_LONGER_QUALIFIES })
      expect(d.warnings).to.deep.equal(['Opted out (config.tymly.sync = false)'])
    })

    it('still updates a misplaced repo, with a warning', () => {
      const bp = remote('a', { packageJson: { keywords: ['tymly', 'blueprint'] } })
      const d = only(plan([bp], [local('a', { folder: 'plugins' })]))
      expect(d.action).to.equal(ACTIONS.FAST_FORWARD)
      expect(d.warnings).to.deep.equal(['Lives in /plugins but is now routed to /blueprints'])
    })

    it('reports a second clone of the same repo as a duplicate', () => {
      const result = plan([remote('a')], [
        local('a'),
        local('a-copy', { folder: 'blueprints', origin: { owner: 'wmfs', name: 'a', url: 'x' } })
      ])
      const duplicate = result.decisions.find(d => d.reason === REASONS.DUPLICATE)
      expect(duplicate).to.include({ repoName: 'a-copy', action: ACTIONS.NONE })
      expect(duplicate.warnings[0]).to.equal('Also found at plugins/a')
      expect(result.decisions.filter(d => d.action !== ACTIONS.NONE)).to.have.length(1)
    })
  })

  describe('matching local folders to remote repos', () => {
    it('matches on the origin name, not the folder name', () => {
      const renamed = local('my-local-name', { origin: { owner: 'wmfs', name: 'a', url: 'x' } })
      const result = plan([remote('a')], [renamed])
      const d = only(result)
      expect(d.action).to.equal(ACTIONS.FAST_FORWARD)
      expect(d.remote.name).to.equal('a')
    })

    it('falls back to the folder name when there is no origin', () => {
      const d = only(plan([remote('a')], [local('a', { origin: null })]))
      expect(d.action).to.equal(ACTIONS.FAST_FORWARD)
    })

    it('matches names case-insensitively', () => {
      const d = only(plan([remote('Tymly-Core')], [local('tymly-core')]))
      expect(d.action).to.equal(ACTIONS.FAST_FORWARD)
    })

    it('never plans a clone for a repo that already exists locally', () => {
      const result = plan([remote('a')], [local('a', { branch: 'feature/x' })])
      expect(result.decisions.filter(d => d.action === ACTIONS.CLONE)).to.have.length(0)
    })
  })

  it('sorts decisions by folder, then repo name', () => {
    const bp = name => remote(name, { packageJson: { keywords: ['tymly', 'blueprint'] } })
    const { decisions } = plan([remote('z'), bp('c'), remote('a'), bp('b')], [])
    expect(decisions.map(d => `${d.folder}/${d.repoName}`))
      .to.deep.equal(['blueprints/b', 'blueprints/c', 'plugins/a', 'plugins/z'])
  })

  it('does not mutate its inputs', () => {
    const remotes = [remote('a'), remote('b')]
    const locals = [local('a'), local('c')]
    const before = JSON.stringify({ remotes, locals })
    plan(remotes, locals)
    expect(JSON.stringify({ remotes, locals })).to.equal(before)
  })
})
