const path = require('path')
const FETCH_CMD = 'git -c core.quotepath=false fetch origin --progress --prune'
const PULL_CMD = 'git -c core.quotepath=false merge origin/master --no-stat -v'
const UP_TO_DATE_MESSAGE = /Already up.to.date/
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
  // TODO: Make it actually pull!
  // TODO: run is available
  // TODO: So messages has a addMessage(messageType, messageText)

  console.log(`${chalk.cyan(' PULL')} ${chalk.gray(`/${action.config.packageName}/`)}${repoName}`)
  console.log(`   ${chalk.gray(destPath)}`)
  console.log(`   ${chalk.gray(FETCH_CMD)}`)
  console.log(`   ${chalk.gray(PULL_CMD)}`)

  /*
  try {
    const fetchCmd = 'git -c core.quotepath=false fetch origin --progress --prune'
    const pullCmd = 'git -c core.quotepath=false merge origin/master --no-stat -v'
    await run(fetchCmd, destPath)
    const result = await run(pullCmd, destPath)
    return [
      'true',
      UP_TO_DATE_MESSAGE.test(result) ? 'upToDate' : 'pulled'
    ]
  } catch (err) {
    if (COMMIT_OR_STASH.test(err.message) || UNMERGED_CHANGES.test(err.message)) {
      unstagedChangesErr.push(repoName)
      return [true, 'skipped']
    }
    gitErrs.push(`${repoName} : ${err.message}`)
    return [false, 'pulled']
  }
  */
}
