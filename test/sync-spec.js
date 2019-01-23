/* eslint-env mocha */

const process = require('process')
describe('Test sync', function () {
  this.timeout(process.env.TIMEOUT || 5000)
  it('oh dear...', () => {
    // TODO: Sort this.
    console.log('Not sure what to do')
    console.log('requiring @octokit/graphql inside Mocha causes the following on Windows (at least)')
    console.log('--> spawnSync cmd.exe ENOENT')
  })
})
