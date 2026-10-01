const { execFile } = require('child_process')

function git (args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-c', 'core.quotepath=false', ...args],
      { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = stderr
          return reject(err)
        }
        // trimEnd, not trim: `git status --porcelain` lines can start with a space
        resolve(stdout.trimEnd())
      }
    )
  })
}

async function tryGit (args, cwd) {
  try {
    return await git(args, cwd)
  } catch (e) {
    return null
  }
}

module.exports = { git, tryGit }
