/* eslint-env mocha */

const fs = require('fs')
const path = require('path')
const { expect } = require('chai')
const { Sandbox, git, tryGit } = require('./helpers/git-sandbox')
const { inspectLocalRepos, inspectRepo } = require('../lib/inspect')

describe('inspect (real git)', function () {
  this.timeout(30000)

  let sandbox, mono, origin

  beforeEach(() => {
    sandbox = new Sandbox()
    origin = sandbox.createOrigin('tymly-test-plugin')

    // The husk is itself a git repo, as the real tymly monorepo is
    mono = sandbox.dir('mono')
    git(mono, 'init', '--quiet', '-b', 'master')
    sandbox.dir('mono', 'plugins')
    sandbox.dir('mono', 'blueprints')
  })

  afterEach(() => sandbox.cleanup())

  const cloneAndPointAtGitHub = (...folder) => {
    const repo = sandbox.cloneInto(origin, 'mono', ...folder)
    git(repo, 'remote', 'set-url', 'origin', `https://github.com/wmfs/${origin.name}.git`)
    return repo
  }

  it('finds one record per folder matched by the lerna patterns', async () => {
    cloneAndPointAtGitHub('plugins')
    sandbox.dir('mono', 'blueprints', 'scratch')
    fs.writeFileSync(path.join(mono, 'plugins', 'README.md'), 'a file, not a package folder')

    const records = await inspectLocalRepos(mono, ['plugins/*', 'blueprints/*'])

    expect(records.map(r => `${r.folder}/${r.repoName}`))
      .to.deep.equal(['blueprints/scratch', `plugins/${origin.name}`])
  })

  it('returns nothing for empty package folders', async () => {
    expect(await inspectLocalRepos(mono, ['plugins/*', 'blueprints/*'])).to.deep.equal([])
  })

  it('reads a clean clone on the default branch', async () => {
    const repo = cloneAndPointAtGitHub('plugins')
    const record = await inspectRepo(mono, repo)

    expect(record).to.include({
      repoName: origin.name,
      folder: 'plugins',
      isGitRepo: true,
      branch: 'master',
      isDetached: false,
      headSha: git(repo, 'rev-parse', 'HEAD'),
      statusKnown: true,
      trackedChanges: 0,
      untrackedFiles: 0,
      operationInProgress: false
    })
    expect(record.origin).to.include({ owner: 'wmfs', name: origin.name })
    expect(record.packageJson.name).to.equal(origin.name)
  })

  it('does not mistake a plain folder for a repo, even inside the husk\'s repo', async () => {
    const plain = sandbox.dir('mono', 'plugins', 'not-a-repo')
    const record = await inspectRepo(mono, plain)

    expect(record).to.deep.equal({
      path: plain,
      repoName: 'not-a-repo',
      folder: 'plugins',
      isGitRepo: false
    })
  })

  it('reports the current feature branch', async () => {
    const repo = cloneAndPointAtGitHub('plugins')
    git(repo, 'checkout', '--quiet', '-b', 'feature/new-thing')

    const record = await inspectRepo(mono, repo)
    expect(record).to.include({ branch: 'feature/new-thing', isDetached: false })
  })

  it('reports a detached HEAD', async () => {
    const repo = cloneAndPointAtGitHub('plugins')
    git(repo, 'checkout', '--quiet', '--detach')

    const record = await inspectRepo(mono, repo)
    expect(record).to.include({ branch: null, isDetached: true })
    expect(record.headSha).to.equal(git(repo, 'rev-parse', 'HEAD'))
  })

  it('counts tracked changes and untracked files separately', async () => {
    const repo = cloneAndPointAtGitHub('plugins')
    sandbox.write(repo, 'package.json', '{"changed": true}')
    sandbox.write(repo, 'new-1.txt', 'x')
    sandbox.write(repo, 'new-2.txt', 'x')

    const record = await inspectRepo(mono, repo)
    expect(record).to.include({ trackedChanges: 1, untrackedFiles: 2 })
  })

  it('detects a merge in progress', async () => {
    const repo = cloneAndPointAtGitHub('plugins')
    git(repo, 'checkout', '--quiet', '-b', 'other')
    sandbox.commit(repo, 'conflict.txt', 'theirs')
    git(repo, 'checkout', '--quiet', 'master')
    sandbox.commit(repo, 'conflict.txt', 'ours')
    tryGit(repo, 'merge', 'other') // conflicts, leaving MERGE_HEAD

    const record = await inspectRepo(mono, repo)
    expect(record.operationInProgress).to.equal(true)
  })

  it('handles a repo with no commits yet', async () => {
    const repo = sandbox.dir('mono', 'plugins', 'brand-new')
    git(repo, 'init', '--quiet', '-b', 'master')

    const record = await inspectRepo(mono, repo)
    expect(record).to.include({ isGitRepo: true, headSha: null, branch: 'master' })
    expect(record.origin).to.equal(null)
  })

  it('parses SSH origin URLs', async () => {
    const repo = cloneAndPointAtGitHub('plugins')
    git(repo, 'remote', 'set-url', 'origin', 'git@github.com:wmfs/renamed-repo.git')

    const record = await inspectRepo(mono, repo)
    expect(record.origin).to.include({ owner: 'wmfs', name: 'renamed-repo' })
  })

  it('records a non-GitHub origin without an owner', async () => {
    const repo = sandbox.cloneInto(origin, 'mono', 'plugins') // origin is a local path

    const record = await inspectRepo(mono, repo)
    expect(record.origin).to.include({ owner: null, name: null })
  })

  it('reports nested package folders relative to the husk', async () => {
    const repo = cloneAndPointAtGitHub('plugins', 'core')
    const record = await inspectRepo(mono, repo)
    expect(record.folder).to.equal('plugins/core')
  })
})
