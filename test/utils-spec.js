/* eslint-env mocha */

const { expect } = require('chai')
const { captureConsole } = require('./helpers/fixtures')
const packageFoldersFromPatterns = require('../lib/utils/package-folders-from-patterns')
const mapLimit = require('../lib/utils/map-limit')

describe('packageFoldersFromPatterns', () => {
  let output
  beforeEach(() => { output = captureConsole() })
  afterEach(() => output.restore())

  it('turns "<folder>/*" patterns into folder names', () => {
    expect(packageFoldersFromPatterns(['packages/*', 'plugins/*', 'blueprints/*']))
      .to.deep.equal(['packages', 'plugins', 'blueprints'])
  })

  it('normalises leading ./, trailing slashes and Windows separators', () => {
    expect(packageFoldersFromPatterns(['./plugins/*', 'blueprints\\*', 'apps/*/']))
      .to.deep.equal(['plugins', 'blueprints', 'apps'])
  })

  it('keeps nested folders', () => {
    expect(packageFoldersFromPatterns(['plugins/core/*'])).to.deep.equal(['plugins/core'])
  })

  it('skips negations silently', () => {
    expect(packageFoldersFromPatterns(['packages/*', '!packages/legacy'])).to.deep.equal(['packages'])
    expect(output.lines).to.have.length(0)
  })

  it('warns about and skips patterns that cannot be a clone target', () => {
    expect(packageFoldersFromPatterns(['apps/**', 'apps/*/packages/*', 'packages'])).to.deep.equal([])
    expect(output.lines).to.have.length(3)
    expect(output.text()).to.include('apps/**')
  })

  it('de-duplicates', () => {
    expect(packageFoldersFromPatterns(['plugins/*', './plugins/*'])).to.deep.equal(['plugins'])
  })
})

describe('mapLimit', () => {
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

  it('returns results in input order, not completion order', async () => {
    const result = await mapLimit([30, 10, 20], 3, async ms => { await delay(ms); return ms })
    expect(result).to.deep.equal([30, 10, 20])
  })

  it('never runs more than the limit at once', async () => {
    let running = 0
    let peak = 0
    await mapLimit(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      running++
      peak = Math.max(peak, running)
      await delay(5)
      running--
    })
    expect(peak).to.equal(3)
  })

  it('handles an empty list', async () => {
    expect(await mapLimit([], 4, async x => x)).to.deep.equal([])
  })

  it('passes the index to the callback', async () => {
    expect(await mapLimit(['a', 'b'], 2, async (x, i) => `${x}${i}`)).to.deep.equal(['a0', 'b1'])
  })
})
