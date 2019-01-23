const jsonfile = require('jsonfile')
const path = require('path')
const glob = require('glob')
const humanizeDuration = require('humanize-duration')
const chalk = require('chalk')
const getLocalGitInfo = require('git-repo-info')
const dottie = require('dottie')
const graphql = require('@octokit/graphql')
const _ = require('lodash')
const query = require('./github-graphql-query')
const actionFunctions = require('./actions')
const Messages = require('./utils/Messages')

class LernaSync {
  constructor (options) {
    this.options = options
    this.lernaJson = jsonfile.readFileSync(path.join(this.options.monorepoPath, 'lerna.json'))
  }

  async discoverGithubRepos () {
    const gitHubOrgName = this.options.gitHubOrgName
    console.log(chalk.gray(`Downloading repo information from https://github.com/${gitHubOrgName}`))
    let afterValue = null
    let hasNextPage = true
    while (hasNextPage) {
      const result = await graphql(
        query,
        {
          afterValue: afterValue,
          queryString: `org:${this.options.gitHubOrgName}`,
          headers: {
            authorization: `token ${this.options.gitHubToken}`
          }
        })
      result.search.edges.forEach(
        (edge) => {
          const repoName = dottie.get(edge, 'node.name')
          const historyEdges = dottie.get(edge, 'node.ref.target.history.edges')
          if (historyEdges && historyEdges.length > 0) {
            let packageJson = dottie.get(edge, 'node.object.text')
            if (packageJson) {
              packageJson = JSON.parse(packageJson)
            }
            this.applyRepo(
              repoName,
              {
                gitHubSha: historyEdges[0].node.oid,
                gitHubMessageHeadline: historyEdges[0].node.messageHeadline,
                gitHubAuthor: historyEdges[0].node.author,
                gitHubPackageJson: packageJson,
                gitHubLernaPackageName: this.options.lernaPackageRouterFunction(packageJson)
              }
            )
          }
        }
      )
      hasNextPage = result.search.pageInfo.hasNextPage
      afterValue = result.search.pageInfo.endCursor
    }
  }

  collectLocalGitInfo () {
    console.log(chalk.gray('Collecting local Git information'))
    this.lernaJson.packages.forEach(
      (relPackagePath) => {
        const fullPackagePath = path.resolve(this.options.monorepoPath, relPackagePath + '/')
        const packageRepoPaths = glob.sync(fullPackagePath)
        packageRepoPaths.forEach(
          (repoPath) => {
            this.applyRepo(
              path.basename(repoPath),
              {
                localGit: getLocalGitInfo(repoPath),
                localLernaPackageName: path.basename(path.resolve(repoPath, '..'))
              }
            )
          }
        )
      }
    )
  }

  applyRepo (repoName, info) {
    if (this.repos.hasOwnProperty(repoName)) {
      const existingInfo = this.repos[repoName]
      this.repos[repoName] = _.defaults(info, existingInfo)
    } else {
      this.repos[repoName] = info
    }
  }

  process () {
    const processed = {
      containingDirName: path.basename(this.options.monorepoPath),
      packages: {},
      totalPackageCount: 0,
      rejectedCount: 0,
      actions: []
    }
    for (const [repoName, rawRepo] of Object.entries(this.repos)) {
      const pkgName = rawRepo.gitHubLernaPackageName
      if (pkgName) {
        let pkgInfo
        if (!processed.packages.hasOwnProperty(pkgName)) {
          pkgInfo = {
            name: pkgName,
            repos: {}
          }
          processed.packages[pkgName] = pkgInfo
        } else {
          pkgInfo = processed.packages[pkgName]
        }
        const rep = {
          name: repoName,
          gitHubSha: rawRepo.gitHubSha,
          gitHubMessageHeadline: rawRepo.gitHubMessageHeadline,
          gitHubAuthor: rawRepo.gitHubAuthor,
          localSha: dottie.get(rawRepo, 'localGit.sha'),
          localLernaPackageName: rawRepo.localLernaPackageName,
          gitHubLernaPackageName: rawRepo.gitHubLernaPackageName,
          githubPackageJsonDescription: dottie.get(rawRepo, 'gitHubPackageJson.description')
        }

        if (rep.gitHubSha === rep.localSha) {
          rep.syncAction = 'SKIP'
        } else if (!rep.localSha) {
          rep.syncAction = 'CLONE'
          processed.actions.push(
            {
              type: 'CLONE',
              config: {
                packageName: rep.gitHubLernaPackageName,
                repoName: repoName
              }
            }
          )
        } else {
          rep.syncAction = 'PULL'
          processed.actions.push(
            {
              type: 'PULL',
              config: {
                packageName: rep.localLernaPackageName,
                repoName: repoName
              }
            }
          )
        }
        pkgInfo.repos[repoName] = rep
        processed.totalPackageCount++
      } else {
        processed.rejectedCount++
      }
    }
    return processed
  }

  outputTarget (info) {
    console.log(chalk.underline('Lerna Sync summary'))
    console.log('')
    console.log(`/${info.containingDirName}`)

    for (const [packageName, packageInfo] of Object.entries(info.packages)) {
      console.log('')
      console.log(`  /${packageName}`)
      let sameCount = 0
      for (const [repoName, repoInfo] of Object.entries(packageInfo.repos)) {
        if (repoInfo.gitHubSha !== repoInfo.localSha) {
          let repoLine = `    /${chalk.white(chalk.bold(repoName))} `
          if (repoInfo.syncAction === 'CLONE') {
            repoLine += chalk.green(chalk.inverse('Clone'))
          } else {
            repoLine += chalk.cyan(chalk.inverse('Pull'))
          }
          console.log(repoLine)

          if (repoInfo.syncAction === 'CLONE') {
            console.log(`      ${chalk.green(repoInfo.githubPackageJsonDescription)}`)
          }

          let agoLabel
          const rawAuthorDate = dottie.get(repoInfo, 'gitHubAuthor.date')
          if (rawAuthorDate) {
            const authorDate = new Date(rawAuthorDate)
            agoLabel = humanizeDuration(
              new Date() - authorDate,
              {
                largest: 1
              }
            )
            agoLabel = `{${agoLabel} ago)`
          }
          console.log(`      ${chalk.yellow(repoInfo.gitHubAuthor.name + ':')} ${chalk.gray(agoLabel)}`)
          console.log(chalk.magenta(`      ${repoInfo.gitHubMessageHeadline}`))
        } else {
          sameCount++
        }
        // console.log(repoInfo)
      }
      let sameLine = chalk.gray('    Same count: ')
      sameLine += chalk.green(sameCount)
      console.log(sameLine)
    }
  }

  async performActions (actions) {
    console.log('')
    if (actions.length > 1) {
      console.log(chalk.underline(`Requires ${actions.length} action${actions.length === 1 ? '' : 's'} to get into sync`))
      console.log('')
      let idx = 0
      const totalActionCount = actions.length
      const messages = new Messages()
      actions.forEach(
        async action => {
          await actionFunctions[action.type](action, this.options, messages)
          idx++
        }
      )
    } else {
      console.log('All in-sync, no action required!')
    }
    console.log('')
  }

  async sync () {
    this.syncStart = new Date()
    this.repos = {}
    await this.discoverGithubRepos()
    this.collectLocalGitInfo()
    this.syncEnd = new Date()
    this.processed = this.process()
    if (this.processed.actions.length > 0) {
      await this.performActions(this.processed.actions)
    }
    this.outputTarget(this.processed)
    console.log('')
    console.log(`Done (${humanizeDuration(this.syncEnd - this.syncStart)}).`)
  }
}

module.exports = LernaSync
