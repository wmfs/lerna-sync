const { exec } = require('child_process')

module.exports = function run (cmd, cwd = null) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: cwd }, (err, stdout, stderr) => {
      // console.log(stdout)
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}
