const path = require('path')
const FETCH_CMD = 'git -c core.quotepath=false fetch origin --progress --prune'
const PULL_CMD = 'git -c core.quotepath=false merge origin/master --no-stat -v'
const COMMIT_OR_STASH = /commit your changes or stash them /
const UNMERGED_CHANGES = /not possible because you have unmerged files/
const run = require('./../utils/run')
const chalk = require('chalk')
module.exports = async function pullAction (action, options, messages) {
  const repoName = action.config.repoName
  const destPath = path.join(
    options.monorepoPath,
    action.config.packageName,
    repoName
  )

  console.log(`${chalk.cyan(' PULL')} ${chalk.gray(`/${action.config.packageName}/`)}${repoName}`)
  // console.log(`   ${chalk.gray(destPath)}`)
  // console.log(`   ${chalk.gray(FETCH_CMD)}`)
  // console.log(`   ${chalk.gray(PULL_CMD)}`)

  try {
    await run(FETCH_CMD, destPath)
    await run(PULL_CMD, destPath)
  } catch (err) {
    if (COMMIT_OR_STASH.test(err.message) || UNMERGED_CHANGES.test(err.message)) {
      messages.addMessage(
        repoName,
        'Pulling',
        'WARNING',
        new Error("Failed to fetch/pull because there are local changes afoot.\nYou'll need to push/stash them before this repo can be synced.")
      )
    } else {
      messages.addMessage(
        repoName,
        'Pulling',
        'ERROR',
        err
      )
    }
  }
}
