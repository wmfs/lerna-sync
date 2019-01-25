const path = require('path')
const STATUS_CMD = 'git -c core.quotepath=false status'
const MERGE_CMD = 'git -c core.quotepath=false merge origin/master --no-stat -v'
const COMMIT_OR_STASH = /commit your changes or stash them /
const ALREADY_UP_TO_DATE = /Already up to date./
const UNMERGED_CHANGES = /not possible because you have unmerged files/
const FETCH_CMD = 'git -c core.quotepath=false fetch origin --progress --prune'
const run = require('./../utils/run')
const chalk = require('chalk')
module.exports = async function pullAction (action, options, messages) {
  const repoName = action.config.repoName
  const destPath = path.join(
    options.monorepoPath,
    action.config.packageName,
    repoName
  )

  try {
    await run(FETCH_CMD, destPath)
    const mergeResult = await run(MERGE_CMD, destPath)
    if (ALREADY_UP_TO_DATE.test(mergeResult)) {
      await run(STATUS_CMD, destPath)
      action.type = 'SKIP'
      // TODO: Study what's returned and regex to victory, if such a thing is possible.
      messages.addMessage(
        repoName,
        'Pulling',
        'INFO',
        new Error('You may have untracked files that need adding.')
      )
      console.log(`${chalk.blue(' INFO')} ${chalk.gray(`/${action.config.packageName}/`)}${repoName}`)
    } else {
      console.log(`${chalk.cyan(' PULL')} ${chalk.gray(`/${action.config.packageName}/`)}${repoName}`)
    }
  } catch (err) {
    if (COMMIT_OR_STASH.test(err.message) || UNMERGED_CHANGES.test(err.message)) {
      messages.addMessage(
        repoName,
        'Pulling',
        'WARNING',
        new Error('Failed to fetch/pull because there are local changes afoot.\nYou\'ll need to push/stash them before this repo can be synced.')
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
