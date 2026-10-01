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

describe('git helper', () => {
  const { git, tryGit } = require('../lib/utils/git')
  const os = require('os')

  // A git alias runs through sh, which Git for Windows also ships
  const alias = command => ['-c', `alias.probe=!${command}`, 'probe']

  it('resolves with trimmed stdout', async () => {
    expect(await git(alias('printf "hello\\n\\n"'), os.tmpdir())).to.equal('hello')
  })

  it('kills a command that runs past the timeout', async () => {
    let error
    try {
      await git(alias('sleep 5'), os.tmpdir(), { timeout: 300 })
    } catch (e) {
      error = e
    }
    expect(error.killed).to.equal(true)
    expect(error.message).to.match(/timed out after 300ms/)
  })

  it('returns null from tryGit instead of throwing', async () => {
    expect(await tryGit(alias('exit 1'), os.tmpdir())).to.equal(null)
  })

  describe('environment', () => {
    const saved = {}
    const keys = ['GIT_TERMINAL_PROMPT', 'GIT_SSH_COMMAND', 'GIT_SSH']

    beforeEach(() => keys.forEach(k => { saved[k] = process.env[k]; delete process.env[k] }))
    afterEach(() => keys.forEach(k => {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }))

    const envVar = name => git(alias(`printf %s "$${name}"`), os.tmpdir())

    it('disables terminal credential prompts', async () => {
      expect(await envVar('GIT_TERMINAL_PROMPT')).to.equal('0')
    })

    it('stops ssh prompting for passphrases or host keys', async () => {
      expect(await envVar('GIT_SSH_COMMAND')).to.equal('ssh -o BatchMode=yes')
    })

    it('keeps a GIT_SSH_COMMAND the user already set', async () => {
      process.env.GIT_SSH_COMMAND = 'ssh -i ~/.ssh/work_key'
      expect(await envVar('GIT_SSH_COMMAND')).to.equal('ssh -i ~/.ssh/work_key')
    })

    it('does not change process.env itself', async () => {
      await envVar('GIT_TERMINAL_PROMPT')
      expect(process.env.GIT_TERMINAL_PROMPT).to.equal(undefined)
    })
  })
})
