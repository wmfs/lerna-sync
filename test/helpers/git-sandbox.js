// Throwaway git repositories in a temp directory, for tests that need real git.
// No network: "origins" are local bare repos.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

// Isolate from the developer's own git config (signing, hooks, default branch, ...).
// lib/utils/git.js inherits process.env, so this applies to the code under test too.
process.env.GIT_CONFIG_GLOBAL = os.devNull
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_AUTHOR_NAME = 'Test Author'
process.env.GIT_AUTHOR_EMAIL = 'author@example.com'
process.env.GIT_COMMITTER_NAME = 'Test Author'
process.env.GIT_COMMITTER_EMAIL = 'author@example.com'
process.env.GIT_TERMINAL_PROMPT = '0'

function git (cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function tryGit (cwd, ...args) {
  try {
    return git(cwd, ...args)
  } catch (e) {
    return null
  }
}

class Sandbox {
  constructor () {
    this.root = fs.mkdtempSync(path.join(os.tmpdir(), 'lerna-sync-test-'))
  }

  dir (...parts) {
    const p = path.join(this.root, ...parts)
    fs.mkdirSync(p, { recursive: true })
    return p
  }

  write (repoPath, file, content) {
    const full = path.join(repoPath, file)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }

  commit (repoPath, file, content, message = `Change ${file}`) {
    this.write(repoPath, file, content)
    git(repoPath, 'add', file)
    git(repoPath, 'commit', '--quiet', '-m', message)
    return git(repoPath, 'rev-parse', 'HEAD')
  }

  // A bare "GitHub" repo plus a working clone used to push new commits to it
  createOrigin (name) {
    const bare = this.dir('remotes', 'wmfs', `${name}.git`)
    git(bare, 'init', '--quiet', '--bare', '-b', 'master')

    const pusher = path.join(this.root, 'pushers', name)
    git(this.root, 'clone', '--quiet', bare, pusher)
    git(pusher, 'symbolic-ref', 'HEAD', 'refs/heads/master')
    this.commit(pusher, 'package.json', JSON.stringify({ name, keywords: ['tymly', 'plugin'] }, null, 2), 'Initial commit')
    git(pusher, 'push', '--quiet', 'origin', 'master')

    const push = (file, content, message) => {
      const sha = this.commit(pusher, file, content, message)
      git(pusher, 'push', '--quiet', 'origin', 'master')
      return sha
    }

    return { name, bare, pusher, push }
  }

  // A developer's clone of an origin, inside the monorepo husk
  cloneInto (origin, ...folderParts) {
    const dest = path.join(this.dir(...folderParts), origin.name)
    git(this.root, 'clone', '--quiet', origin.bare, dest)
    return dest
  }

  cleanup () {
    fs.rmSync(this.root, { recursive: true, force: true })
  }
}

module.exports = { Sandbox, git, tryGit }
