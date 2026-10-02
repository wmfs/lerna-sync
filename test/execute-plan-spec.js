/* eslint-env mocha */

const fs = require('fs')
const path = require('path')
const { expect } = require('chai')
const { Sandbox, git } = require('./helpers/git-sandbox')
const { executePlan, OUTCOMES } = require('../lib/execute-plan')
const { ACTIONS, REASONS } = require('../lib/plan-sync')

describe('executePlan (real git)', function () {
  this.timeout(30000)

  let sandbox, mono, origin, options

  beforeEach(() => {
    sandbox = new Sandbox()
    mono = sandbox.dir('mono')
    origin = sandbox.createOrigin('tymly-test-plugin')
    options = {
      monorepoPath: mono,
      gitHubOrgName: 'wmfs',
      cloneUrl: (org, name) => path.join(sandbox.root, 'remotes', org, `${name}.git`)
    }
  })

  afterEach(() => sandbox.cleanup())

  const decision = (action, reason, repoPath, extra = {}) => ({
    repoName: origin.name,
    action,
    reason,
    folder: 'plugins',
    defaultBranch: 'master',
    remote: { name: origin.name },
    local: repoPath ? { path: repoPath, branch: git(repoPath, 'rev-parse', '--abbrev-ref', 'HEAD') } : null,
    warnings: [],
    ...extra
  })

  const runOne = async d => {
    const [result] = await executePlan({ decisions: [d], ignored: [] }, options)
    return result
  }

  const head = (repo, ref = 'HEAD') => git(repo, 'rev-parse', ref)
  const originHead = () => git(origin.bare, 'rev-parse', 'master')

  describe('CLONE', () => {
    it('clones into <folder>/<repo name>', async () => {
      const result = await runOne(decision(ACTIONS.CLONE, REASONS.NEW, null))

      const dest = path.join(mono, 'plugins', origin.name)
      expect(result.outcome).to.equal(OUTCOMES.CLONED)
      expect(head(dest)).to.equal(originHead())
    })

    it('reports a failure without throwing', async () => {
      options.cloneUrl = () => path.join(sandbox.root, 'does-not-exist.git')
      const result = await runOne(decision(ACTIONS.CLONE, REASONS.NEW, null))

      expect(result.outcome).to.equal(OUTCOMES.FAILED)
      expect(result.error).to.be.a('string').and.not.equal('')
    })
  })

  describe('FAST_FORWARD', () => {
    it('pulls new commits on a clean default branch', async () => {
      const repo = sandbox.cloneInto(origin, 'mono', 'plugins')
      origin.push('a.txt', 'a', 'First new commit')
      origin.push('b.txt', 'b', 'Second new commit')

      const result = await runOne(decision(ACTIONS.FAST_FORWARD, REASONS.BEHIND, repo))

      expect(result).to.include({ outcome: OUTCOMES.UPDATED, ahead: 0, behind: 2, packageJsonChanged: false })
      expect(result.commits.map(c => c.subject)).to.deep.equal(['Second new commit', 'First new commit'])
      expect(head(repo)).to.equal(originHead())
    })

    it('flags when package.json changed', async () => {
      const repo = sandbox.cloneInto(origin, 'mono', 'plugins')
      origin.push('package.json', '{"name":"changed"}', 'Bump deps')

      const result = await runOne(decision(ACTIONS.FAST_FORWARD, REASONS.BEHIND, repo))
      expect(result.packageJsonChanged).to.equal(true)
    })

    it('reports current when there is nothing new', async () => {
      const repo = sandbox.cloneInto(origin, 'mono', 'plugins')
      const result = await runOne(decision(ACTIONS.FAST_FORWARD, REASONS.BEHIND, repo))
      expect(result).to.include({ outcome: OUTCOMES.CURRENT, ahead: 0, behind: 0 })
    })

    it('reports unpushed commits and leaves them alone', async () => {
      const repo = sandbox.cloneInto(origin, 'mono', 'plugins')
      const local = sandbox.commit(repo, 'mine.txt', 'mine', 'Not pushed yet')

      const result = await runOne(decision(ACTIONS.FAST_FORWARD, REASONS.BEHIND, repo))
      expect(result).to.include({ outcome: OUTCOMES.LOCAL_AHEAD, ahead: 1, behind: 0 })
      expect(head(repo)).to.equal(local)
    })

    it('does not merge when the default branch has diverged', async () => {
      const repo = sandbox.cloneInto(origin, 'mono', 'plugins')
      const local = sandbox.commit(repo, 'mine.txt', 'mine', 'Local work')
      origin.push('theirs.txt', 'theirs', 'Remote work')

      const result = await runOne(decision(ACTIONS.FAST_FORWARD, REASONS.BEHIND, repo))
      expect(result).to.include({ outcome: OUTCOMES.DIVERGED, ahead: 1, behind: 1 })
      expect(result.commits.map(c => c.subject)).to.deep.equal(['Remote work'])
      expect(head(repo)).to.equal(local)
    })

    it('does not overwrite an untracked file that is now tracked upstream', async () => {
      const repo = sandbox.cloneInto(origin, 'mono', 'plugins')
      origin.push('notes.txt', 'from upstream', 'Add notes')
      sandbox.write(repo, 'notes.txt', 'my local notes')
      const before = head(repo)

      const result = await runOne(decision(ACTIONS.FAST_FORWARD, REASONS.BEHIND, repo))
      expect(result.outcome).to.equal(OUTCOMES.BLOCKED_BY_UNTRACKED)
      expect(head(repo)).to.equal(before)
      expect(fs.readFileSync(path.join(repo, 'notes.txt'), 'utf8')).to.equal('my local notes')
    })
  })

  describe('FETCH_ONLY', () => {
    it('leaves a feature branch alone and reports what the default branch has', async () => {
      const repo = sandbox.cloneInto(origin, 'mono', 'plugins')
      git(repo, 'checkout', '--quiet', '-b', 'feature/x')
      const branchHead = sandbox.commit(repo, 'feature.txt', 'wip', 'Feature work')
      origin.push('fix.txt', 'fix', 'Fix on master')

      const result = await runOne(decision(ACTIONS.FETCH_ONLY, REASONS.ON_BRANCH, repo))

      expect(result).to.include({ outcome: OUTCOMES.BEHIND, ahead: 1, behind: 1 })
      expect(result.commits.map(c => c.subject)).to.deep.equal(['Fix on master'])
      expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).to.equal('feature/x')
      expect(head(repo)).to.equal(branchHead)
      expect(fs.existsSync(path.join(repo, 'fix.txt'))).to.equal(false)
    })

    it('fast-forwards the local default branch without checking it out', async () => {
      const repo = sandbox.cloneInto(origin, 'mono', 'plugins')
      git(repo, 'checkout', '--quiet', '-b', 'feature/x')
      origin.push('fix.txt', 'fix', 'Fix on master')

      await runOne(decision(ACTIONS.FETCH_ONLY, REASONS.ON_BRANCH, repo))
      expect(head(repo, 'master')).to.equal(originHead())
    })

    it('does not move a local default branch that has its own commits', async () => {
      const repo = sandbox.cloneInto(origin, 'mono', 'plugins')
      const localMaster = sandbox.commit(repo, 'mine.txt', 'mine', 'Unpushed on master')
      git(repo, 'checkout', '--quiet', '-b', 'feature/x')
      origin.push('fix.txt', 'fix', 'Fix on master')

      await runOne(decision(ACTIONS.FETCH_ONLY, REASONS.ON_BRANCH, repo))
      expect(head(repo, 'master')).to.equal(localMaster)
    })

    it('respects updateLocalDefaultBranch: false', async () => {
      const repo = sandbox.cloneInto(origin, 'mono', 'plugins')
      const before = head(repo, 'master')
      git(repo, 'checkout', '--quiet', '-b', 'feature/x')
      origin.push('fix.txt', 'fix', 'Fix on master')

      options.updateLocalDefaultBranch = false
      await runOne(decision(ACTIONS.FETCH_ONLY, REASONS.ON_BRANCH, repo))
      expect(head(repo, 'master')).to.equal(before)
    })

    it('reports current when the default branch has nothing new', async () => {
      const repo = sandbox.cloneInto(origin, 'mono', 'plugins')
      git(repo, 'checkout', '--quiet', '-b', 'feature/x')

      const result = await runOne(decision(ACTIONS.FETCH_ONLY, REASONS.ON_BRANCH, repo))
      expect(result).to.include({ outcome: OUTCOMES.CURRENT, behind: 0 })
      expect(result.commits).to.deep.equal([])
    })

    it('does not touch a checked-out default branch with uncommitted changes', async () => {
      const repo = sandbox.cloneInto(origin, 'mono', 'plugins')
      const before = head(repo)
      sandbox.write(repo, 'package.json', '{"editing": true}')
      origin.push('fix.txt', 'fix', 'Fix on master')

      const result = await runOne(decision(ACTIONS.FETCH_ONLY, REASONS.LOCAL_CHANGES, repo))
      expect(result).to.include({ outcome: OUTCOMES.BEHIND, behind: 1 })
      expect(head(repo)).to.equal(before)
      expect(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).to.equal('{"editing": true}')
    })

    it('handles a detached HEAD', async () => {
      const repo = sandbox.cloneInto(origin, 'mono', 'plugins')
      git(repo, 'checkout', '--quiet', '--detach')
      origin.push('fix.txt', 'fix', 'Fix on master')

      const result = await runOne(decision(ACTIONS.FETCH_ONLY, REASONS.DETACHED, repo))
      expect(result).to.include({ outcome: OUTCOMES.BEHIND, behind: 1 })
      expect(head(repo, 'master')).to.equal(originHead())
    })
  })

  describe('running a whole plan', () => {
    it('skips NONE decisions and isolates failures', async () => {
      const repo = sandbox.cloneInto(origin, 'mono', 'plugins')
      origin.push('a.txt', 'a', 'New commit')

      const good = decision(ACTIONS.FAST_FORWARD, REASONS.BEHIND, repo)
      const bad = decision(ACTIONS.FAST_FORWARD, REASONS.BEHIND, null, {
        repoName: 'missing',
        local: { path: path.join(mono, 'plugins', 'missing'), branch: 'master' }
      })
      const none = decision(ACTIONS.NONE, REASONS.ORPHANED, null, { repoName: 'gone' })

      const seen = []
      options.onResult = r => seen.push(r.decision.repoName)
      const results = await executePlan({ decisions: [good, bad, none], ignored: [] }, options)

      expect(results.map(r => [r.decision.repoName, r.outcome])).to.deep.equal([
        [origin.name, OUTCOMES.UPDATED],
        ['missing', OUTCOMES.FAILED]
      ])
      expect(seen).to.have.members([origin.name, 'missing'])
    })

    it('returns the same decision objects it was given', async () => {
      const d = decision(ACTIONS.CLONE, REASONS.NEW, null)
      const [result] = await executePlan({ decisions: [d], ignored: [] }, options)
      expect(result.decision).to.equal(d)
    })
  })
})
