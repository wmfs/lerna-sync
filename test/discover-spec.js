/* eslint-env mocha */

const { expect } = require('chai')
const { captureConsole } = require('./helpers/fixtures')
const discover = require('../lib/discover')

// A GraphQL node as GitHub returns it
function node (name, overrides = {}) {
  return {
    name,
    isArchived: false,
    isPrivate: false,
    packageJson: { text: JSON.stringify({ name, keywords: ['tymly'] }), isTruncated: false },
    defaultBranchRef: {
      name: 'master',
      target: {
        oid: `${name}-sha`,
        messageHeadline: `Commit on ${name}`,
        author: { name: 'Someone', date: '2026-01-01T00:00:00Z' }
      }
    },
    ...overrides
  }
}

// Stand-in for the octokit client: serves pages in order and records calls
function fakeGraphql (pages) {
  const calls = []
  const fn = async (query, variables) => {
    calls.push(variables)
    const index = calls.length - 1
    const nodes = pages[index]
    const hasNextPage = index < pages.length - 1
    return {
      organization: {
        repositories: {
          nodes,
          pageInfo: { hasNextPage, endCursor: hasNextPage ? `cursor-${index + 1}` : null }
        }
      }
    }
  }
  fn.calls = calls
  return fn
}

describe('discover', () => {
  let output
  beforeEach(() => { output = captureConsole() })
  afterEach(() => output.restore())

  it('maps GitHub nodes to plain remote records', async () => {
    const [repo] = await discover(fakeGraphql([[node('a')]]), 'wmfs')
    expect(repo).to.deep.equal({
      name: 'a',
      isPrivate: false,
      defaultBranch: 'master',
      sha: 'a-sha',
      messageHeadline: 'Commit on a',
      author: { name: 'Someone', date: '2026-01-01T00:00:00Z' },
      packageJson: { name: 'a', keywords: ['tymly'] }
    })
  })

  it('follows pagination cursors until the last page', async () => {
    const graphql = fakeGraphql([[node('a'), node('b')], [node('c')], [node('d')]])
    const repos = await discover(graphql, 'wmfs')

    expect(repos.map(r => r.name)).to.deep.equal(['a', 'b', 'c', 'd'])
    expect(graphql.calls).to.deep.equal([
      { org: 'wmfs', after: null, first: 100 },
      { org: 'wmfs', after: 'cursor-1', first: 100 },
      { org: 'wmfs', after: 'cursor-2', first: 100 }
    ])
  })

  it('uses each repo\'s real default branch', async () => {
    const main = node('a')
    main.defaultBranchRef.name = 'main'
    const [repo] = await discover(fakeGraphql([[main]]), 'wmfs')
    expect(repo.defaultBranch).to.equal('main')
  })

  it('skips archived and empty repos', async () => {
    const repos = await discover(fakeGraphql([[
      node('archived', { isArchived: true }),
      node('empty', { defaultBranchRef: null }),
      node('kept')
    ]]), 'wmfs')
    expect(repos.map(r => r.name)).to.deep.equal(['kept'])
  })

  it('keeps repos with no package.json, with packageJson null', async () => {
    const [repo] = await discover(fakeGraphql([[node('a', { packageJson: null })]]), 'wmfs')
    expect(repo.packageJson).to.equal(null)
  })

  it('treats invalid JSON as no package.json, with a warning', async () => {
    const [repo] = await discover(fakeGraphql([[
      node('broken', { packageJson: { text: '{ not json', isTruncated: false } })
    ]]), 'wmfs')
    expect(repo.packageJson).to.equal(null)
    expect(output.text()).to.include('Unable to parse package.json for broken')
  })

  it('treats a truncated blob as no package.json, with a warning', async () => {
    const [repo] = await discover(fakeGraphql([[
      node('huge', { packageJson: { text: '{"name":', isTruncated: true } })
    ]]), 'wmfs')
    expect(repo.packageJson).to.equal(null)
    expect(output.text()).to.include('truncated')
  })

  it('returns an empty list for an org with no repos', async () => {
    expect(await discover(fakeGraphql([[]]), 'wmfs')).to.deep.equal([])
  })

  it('lets GraphQL errors propagate', async () => {
    const failing = async () => { throw new Error('Bad credentials') }
    let error
    try {
      await discover(failing, 'wmfs')
    } catch (e) {
      error = e
    }
    expect(error && error.message).to.equal('Bad credentials')
  })

  describe('when GitHub times out', () => {
    const noSleep = async () => {}

    function httpError (status) {
      return Object.assign(new Error(`HTTP ${status}`), { status })
    }

    // Fails with the given errors first, then serves pages like fakeGraphql
    function flakyGraphql (failures, pages) {
      const inner = fakeGraphql(pages)
      const calls = []
      const fn = async (q, variables) => {
        calls.push({ ...variables })
        if (failures.length) throw failures.shift()
        return inner(q, variables)
      }
      fn.calls = calls
      return fn
    }

    it('retries the same page with half as many repos, and keeps the smaller size', async () => {
      const graphql = flakyGraphql([httpError(502)], [[node('a')], [node('b')]])
      const repos = await discover(graphql, 'wmfs', { sleep: noSleep })

      expect(repos.map(r => r.name)).to.deep.equal(['a', 'b'])
      expect(graphql.calls).to.deep.equal([
        { org: 'wmfs', after: null, first: 100 },
        { org: 'wmfs', after: null, first: 50 },
        { org: 'wmfs', after: 'cursor-1', first: 50 }
      ])
    })

    it('never asks for fewer than 10 repos per page', async () => {
      const graphql = flakyGraphql([httpError(504), httpError(504), httpError(503)], [[node('a')]])
      await discover(graphql, 'wmfs', { pageSize: 30, sleep: noSleep })
      expect(graphql.calls.map(c => c.first)).to.deep.equal([30, 15, 10, 10])
    })

    it('gives up after 5 attempts', async () => {
      const graphql = flakyGraphql(Array.from({ length: 5 }, () => httpError(502)), [[node('a')]])
      let error
      try { await discover(graphql, 'wmfs', { sleep: noSleep }) } catch (e) { error = e }
      expect(error.status).to.equal(502)
      expect(graphql.calls).to.have.length(5)
    })

    it('does not retry other errors', async () => {
      const graphql = flakyGraphql([httpError(401)], [[node('a')]])
      let error
      try { await discover(graphql, 'wmfs', { sleep: noSleep }) } catch (e) { error = e }
      expect(error.status).to.equal(401)
      expect(graphql.calls).to.have.length(1)
    })
  })
})
