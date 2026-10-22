const { execFile } = require('child_process')

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

// Sync runs many git commands in parallel with no one watching their output,
// so git must fail fast rather than wait for input that will never come.
function nonInteractiveEnv () {
  const env = {
    ...process.env,
    // Never prompt in the terminal for a username/password
    GIT_TERMINAL_PROMPT: '0'
  }

  // Never prompt for an SSH passphrase or to accept an unknown host key.
  // Keys loaded in ssh-agent still work. Respect a command the user already set.
  if (!env.GIT_SSH_COMMAND && !env.GIT_SSH) {
    env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes'
  }

  return env
}

function git (args, cwd, { timeout = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-c', 'core.quotepath=false', ...args],
      {
        cwd,
        timeout,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
        env: nonInteractiveEnv()
      },
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = stderr
          if (err.killed) {
            const limit = timeout >= 1000 ? `${Math.round(timeout / 1000)}s` : `${timeout}ms`
            err.message = `git ${args[0]} timed out after ${limit}`
          }
          return reject(err)
        }
        // trimEnd, not trim: `git status --porcelain` lines can start with a space
        resolve(stdout.trimEnd())
      }
    )
  })
}

async function tryGit (args, cwd, options) {
  try {
    return await git(args, cwd, options)
  } catch (e) {
    return null
  }
}

module.exports = { git, tryGit, DEFAULT_TIMEOUT_MS }
