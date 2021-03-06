const chalk = require('chalk')
const path = require('path')
const run = require('./../utils/run')

module.exports = async function cloneAction (action, options, messages) {
  const repoName = action.config.repoName
  const destPath = path.join(
    options.monorepoPath,
    action.config.packageName,
    repoName
  )

  const creds = `${options.gitHubUser}:${options.gitHubToken}@github.com`

  // eg.g. cloneUrl = 'https://github.com/octocat/Hello-World.git'
  const cloneUrl = `https://github.com/${options.gitHubOrgName}/${repoName}.git`
  const cloneCmd = `git clone ${cloneUrl.replace('github.com', creds)} ${destPath}`

  console.log(`${chalk.green('CLONE')} ${chalk.gray(`/${action.config.packageName}/`)}${repoName}`)

  try {
    await run(cloneCmd)
  } catch (err) {
    console.log(`${chalk.inverse(chalk.red('FAILED'))} - ${chalk.red(err.message)}`)
    messages.addMessage(
      repoName,
      'Cloning',
      'ERROR',
      err
    )
  }
}

/*
async function cloneRepo (cloneUrl, creds, destPath) {
  const cloneCmd = `git clone ${cloneUrl.replace('github.com', creds)} ${destPath}`

  try {
    await run(cloneCmd)
    return [true, 'cloned']
  } catch (err) {
    if (!err.message.includes('already exists and is not an empty directory')) {
      throw err
    }
  }
  return [false, 'cloned']
}

 */
