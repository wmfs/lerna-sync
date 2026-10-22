// Builders for the plain records each stage passes to the next.
// Defaults describe the "boring" case; tests override only what they care about.

const chalk = require('chalk')

// Keep assertions on output free of colour codes
chalk.level = 0

const router = pkg => {
  const keywords = pkg.keywords || []
  if (!keywords.includes('tymly')) return null
  if (pkg.config && pkg.config.tymly && pkg.config.tymly.sync === false) {
    return { skip: 'Opted out (config.tymly.sync = false)' }
  }
  if (keywords.includes('blueprint')) return 'blueprints'
  if (keywords.includes('plugin')) return 'plugins'
  return null
}

function remote (name, overrides = {}) {
  return {
    name,
    isPrivate: false,
    defaultBranch: 'master',
    sha: 'remote-sha',
    messageHeadline: 'Latest commit',
    author: { name: 'Someone', date: '2026-01-01T00:00:00Z' },
    packageJson: { name: `@wmfs/${name}`, description: `${name} description`, keywords: ['tymly', 'plugin'] },
    ...overrides
  }
}

function local (name, overrides = {}) {
  return {
    path: `/mono/plugins/${name}`,
    repoName: name,
    folder: 'plugins',
    isGitRepo: true,
    branch: 'master',
    isDetached: false,
    headSha: 'local-sha',
    statusKnown: true,
    trackedChanges: 0,
    untrackedFiles: 0,
    operationInProgress: false,
    origin: { owner: 'wmfs', name, url: `https://github.com/wmfs/${name}.git` },
    packageJson: null,
    ...overrides
  }
}

function captureConsole () {
  const lines = []
  const original = { log: console.log, warn: console.warn }
  console.log = (...args) => lines.push(args.join(' '))
  console.warn = (...args) => lines.push(args.join(' '))
  return {
    lines,
    text: () => lines.join('\n'),
    restore: () => Object.assign(console, original)
  }
}

module.exports = { router, remote, local, captureConsole }
