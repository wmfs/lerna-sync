/* eslint-env mocha */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { expect } = require('chai')
const { Sandbox, git } = require('./helpers/git-sandbox')
const { router, captureConsole } = require('./helpers/fixtures')
const LernaSync = require('../lib')
const { ACTIONS, REASONS } = require('../lib/plan-sync')
const { OUTCOMES } = require('../lib/execute-plan')

// Answers the org query from the sandbox's bare repos, as GitHub would
function fakeGitHub (origins) {
  return async () => ({
    organization: {
      repositories: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: origins.map(o => ({
          name: o.name,
          isArchived: false,
          isPrivate: false,
          packageJson: { text: git(o.bare, 'show', 'master:package.json'), isTruncated: false },
          defaultBranchRef: {
            name: 'master',
            target: {
              oid: git(o.bare, 'rev-parse', 'master'),
              messageHeadline: git(o.bare, 'log', '-1', '--format=%s', 'master'),
              author: { name: 'Test Author', date: new Date().toISOString() }
            }
          }
        }))
      }
    }
  })
}

describe('LernaSync.sync (end to end)', function () {
  this.timeout(30000)

  let sandbox, mono, output, existing, fresh, lernaSync

  beforeEach(() => {
    sandbox = new Sandbox()
    mono = sandbox.dir('mono')
    fs.writeFileSync(path.join(mono, 'lerna.json'), JSON.stringify({ packages: ['plugins/*', 'blueprints/*'] }))
    sandbox.dir('mono', 'plugins')
    sandbox.dir('mono', 'blueprints')

    existing = sandbox.createOrigin('tymly-existing-plugin')
    fresh = sandbox.createOrigin('tymly-fresh-plugin')

    // The developer already has one repo, on a feature branch.
    // Its origin is the local bare repo, so fetches work offline.
    const repo = sandbox.cloneInto(existing, 'mono', 'plugins')
    git(repo, 'checkout', '--quiet', '-b', 'feature/x')

    lernaSync = new LernaSync({
      monorepoPath: mono,
      gitHubToken: 'not-used',
      gitHubOrgName: 'wmfs',
      lernaPackageRouterFunction: router,
      cloneUrl: (org, name) => path.join(sandbox.root, 'remotes', org, `${name}.git`)
    })
    lernaSync.graphql = fakeGitHub([existing, fresh])

    output = captureConsole()
  })

  afterEach(() => {
    output.restore()
    sandbox.cleanup()
  })

  it('plans without changing anything on a dry run', async () => {
    lernaSync.dryRun = true
    const { plan, results } = await lernaSync.sync()

    expect(plan.decisions.map(d => [d.repoName, d.action, d.reason])).to.deep.equal([
      [existing.name, ACTIONS.FETCH_ONLY, REASONS.ON_BRANCH],
      [fresh.name, ACTIONS.CLONE, REASONS.NEW]
    ])
    expect(results).to.deep.equal([])
    expect(fs.existsSync(path.join(mono, 'plugins', fresh.name))).to.equal(false)
    expect(output.text()).to.include('Dry run')
  })

  it('clones new repos and leaves feature branches alone', async () => {
    const { results, errorCount } = await lernaSync.sync()

    expect(errorCount).to.equal(0)
    expect(results.map(r => [r.decision.repoName, r.outcome])).to.deep.equal([
      [existing.name, OUTCOMES.CURRENT],
      [fresh.name, OUTCOMES.CLONED]
    ])
    expect(fs.existsSync(path.join(mono, 'plugins', fresh.name, 'package.json'))).to.equal(true)
    expect(git(path.join(mono, 'plugins', existing.name), 'rev-parse', '--abbrev-ref', 'HEAD')).to.equal('feature/x')
    expect(output.text()).to.include('On branches (left alone) (1)')
  })
})

describe('LernaSync options', () => {
  let dir

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lerna-sync-opts-'))
    fs.writeFileSync(path.join(dir, 'lerna.json'), JSON.stringify({ packages: ['packages/*'] }))
  })

  after(() => fs.rmSync(dir, { recursive: true, force: true }))

  const create = concurrency => new LernaSync({
    monorepoPath: dir,
    gitHubToken: 'not-used',
    gitHubOrgName: 'wmfs',
    lernaPackageRouterFunction: () => null,
    concurrency
  })

  it('leaves concurrency unset when not given, so each stage uses its default', () => {
    expect(create(undefined).concurrency).to.equal(undefined)
    expect(create(null).concurrency).to.equal(undefined)
  })

  it('accepts a positive integer', () => {
    expect(create(4).concurrency).to.equal(4)
  })

  for (const bad of [0, -2, 2.5, NaN, '4']) {
    it(`rejects a concurrency of ${String(bad)}`, () => {
      expect(() => create(bad)).to.throw(TypeError, /concurrency must be a positive integer/)
    })
  }
})
