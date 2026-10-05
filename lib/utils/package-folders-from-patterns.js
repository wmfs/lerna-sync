const GLOB_CHARS = /[*?[\]{}!]/

function packageFoldersFromPatterns (patterns) {
  const folders = new Set()

  for (const raw of patterns) {
    const pattern = raw.trim().replace(/\\/g, '/').replace(/\/+$/, '')

    // Negations like "!packages/legacy" exclude folders, they don't add one
    if (pattern.startsWith('!')) continue

    // Only "<folder>/*" can be a clone target: lerna-sync clones to <folder>/<repoName>
    const match = pattern.match(/^(.+)\/\*$/)
    if (!match || GLOB_CHARS.test(match[1])) {
      console.warn(`lerna-sync: ignoring package pattern "${raw}", expected "<folder>/*"`)
      continue
    }

    folders.add(match[1].replace(/^\.\//, ''))
  }

  return [...folders]
}

module.exports = packageFoldersFromPatterns
