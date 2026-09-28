const { execFile } = require('child_process')

module.exports = function run (cmd, cwd = null) {
  return new Promise((resolve, reject) => {
    const [file, ...args] = Array.isArray(cmd) ? cmd : cmd.split(' ')
    execFile(file, args, { cwd }, (err, stdout, stderr) => {
      // console.log(stdout)
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}
