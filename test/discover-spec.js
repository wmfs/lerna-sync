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
      { org: 'wmfs', after: null },
      { org: 'wmfs', after: 'cursor-1' },
      { org: 'wmfs', after: 'cursor-2' }
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
})
