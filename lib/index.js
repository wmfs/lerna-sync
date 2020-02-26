const jsonfile = require('jsonfile')
const path = require('path')
const fs = require('fs')
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
            const localRepoInfo = {
              localGit: getLocalGitInfo(repoPath),
              localLernaPackageName: path.basename(path.resolve(repoPath, '..'))
            }

            const packageJsonPath = path.join(repoPath, 'package.json')
            try {
              localRepoInfo.localPackageJson = jsonfile.readFileSync(packageJsonPath)
            } catch (e) {
              // Just ignore failure to grab package.json.
              console.error(e)
            }
            this.applyRepo(
              path.basename(repoPath),
              localRepoInfo
            )
          }
        )
      }
    )
  }

  applyRepo (repoName, info) {
    if (Object.prototype.hasOwnProperty.call(this.repos, repoName)) {
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
      flattenedPackages: [],
      totalPackageCount: 0,
      rejectedCount: 0,
      actions: [],
      allNpmPackageNames: [],
      gitHubDeps: {
        dependencyPackageNames: [],
        devDependencyPackageNames: []
      },
      existingLocalDeps: {
        dependencyPackageNames: [],
        devDependencyPackageNames: []
      }
    }

    function applyDeps (target, packageJson) {
      if (packageJson) {
        if (packageJson.dependencies) {
          target.dependencyPackageNames = _.union(
            target.dependencyPackageNames,
            _.keys(packageJson.dependencies)
          )
        }
        if (packageJson.devDependencies) {
          target.devDependencyPackageNames = _.union(
            target.devDependencyPackageNames,
            _.keys(packageJson.devDependencies)
          )
        }
      }
    }

    function applyNpmPackageName (packageJson) {
      if (packageJson) {
        const name = packageJson.name
        if (processed.allNpmPackageNames.indexOf(name) === -1) {
          processed.allNpmPackageNames.push(name)
        }
      }
    }

    for (const [repoName, rawRepo] of Object.entries(this.repos)) {
      const pkgName = rawRepo.gitHubLernaPackageName
      if (pkgName) {
        processed.flattenedPackages.push({ repoName, pkgName })

        let pkgInfo
        if (!Object.prototype.hasOwnProperty.call(processed.packages, pkgName)) {
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

        applyDeps(processed.existingLocalDeps, rawRepo.localPackageJson)
        applyNpmPackageName(rawRepo.localPackageJson)
        if (rep.gitHubSha === rep.localSha) {
          rep.syncAction = 'SKIP'
        } else if (!rep.localSha) {
          rep.syncAction = 'CLONE'
          applyDeps(processed.gitHubDeps, rawRepo.gitHubPackageJson)
          applyNpmPackageName(rawRepo.gitHubPackageJson)
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
          applyDeps(processed.gitHubDeps, rawRepo.gitHubPackageJson)
          applyNpmPackageName(rawRepo.gitHubPackageJson)
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

    processed.newDependencies = _.difference(
      _.union(processed.gitHubDeps.dependencyPackageNames, processed.gitHubDeps.devDependencyPackageNames),
      _.union(processed.existingLocalDeps.dependencyPackageNames, processed.existingLocalDeps.devDependencyPackageNames)
    )
    processed.newDependenciesWithoutLinkables = _.difference(
      processed.newDependencies,
      processed.allNpmPackageNames
    )
    return processed
  }

  outputSummary (info) {
    console.log(chalk.underline('Lerna Sync summary'))
    console.log('')
    console.log(`/${info.containingDirName}`)

    for (const [packageName, packageInfo] of Object.entries(info.packages)) {
      console.log('')
      console.log(`  /${packageName}`)
      let sameCount = 0
      for (const [repoName, repoInfo] of Object.entries(packageInfo.repos)) {
        // Running an action might have revised its type, so find it in actions array
        let syncAction
        info.actions.forEach(
          action => {
            if (action.config.repoName === repoName) {
              syncAction = action.type
            }
          }
        )

        if (syncAction && syncAction !== 'SKIP') {
          let repoLine = `    /${chalk.white(chalk.bold(repoName))} `

          if (syncAction === 'CLONE') {
            repoLine += chalk.green(chalk.inverse('Clone'))
          } else {
            repoLine += chalk.cyan(chalk.inverse('Pull'))
          }
          console.log(repoLine)

          if (syncAction === 'CLONE') {
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
      }
      let sameLine = chalk.gray('    OK count: ')
      sameLine += chalk.green(sameCount)
      console.log(sameLine)
    }
  }

  outputSuggestedNextSteps (newDependencies, newDependenciesWithoutLinkables) {
    console.log('')
    if (newDependenciesWithoutLinkables.length === 0) {
      if (newDependencies.length === 0) {
        console.log(chalk.green('Good times, no Lerna bootstrapping/linking required!'))
      } else {
        console.log(chalk.yellow('You\'ll need to \'lerna link\' because synced-packages need links to:'))
        newDependencies.forEach(
          (packageName) => {
            console.log(chalk.yellow(` - ${packageName}`))
          }
        )
      }
    } else {
      console.log(chalk.red('Oh no! You need to \'lerna bootstrap\', because these are unheard of:'))
      newDependenciesWithoutLinkables.forEach(
        (packageName) => {
          console.log(chalk.red(` - ${packageName}`))
        }
      )
    }
  }

  async performActions (actions, messages) {
    console.log('')
    if (actions.length > 0) {
      console.log(chalk.underline(`Identified ${actions.length} action${actions.length === 1 ? '' : 's'} to run`))
      console.log('')
      // let idx = 0
      // const totalActionCount = actions.length
      for (const action of actions) {
        await actionFunctions[action.type](action, this.options, messages)
      }
    }
    console.log('')
  }

  async sync () {
    const messages = new Messages()
    this.syncStart = new Date()
    this.repos = {}
    await this.discoverGithubRepos()
    this.collectLocalGitInfo()
    this.processed = this.process()
    if (this.processed.actions.length > 0) {
      await this.performActions(
        this.processed.actions,
        messages
      )
    }
    this.outputSummary(this.processed)
    messages.output()

    const localNonMasterBranches = this.processed.flattenedPackages
      .map(({ repoName, pkgName }) => {
        const destPath = path.join(this.options.monorepoPath, pkgName, repoName)
        const gitHeadPath = path.join(destPath, '.git', 'HEAD')
        if (fs.existsSync(destPath)) {
          if (fs.existsSync(gitHeadPath)) {
            const currentBranch = fs.readFileSync(gitHeadPath, 'utf-8').trim().split('refs/heads/')[1]

            if (currentBranch !== 'master') {
              return { repoName, pkgName, currentBranch }
            }
          }
        }
      })
      .filter(p => p)

    if (localNonMasterBranches.length > 0) {
      console.log(chalk.bgYellow.gray('\n\n ----- Found some non-master branches, best double check that you should be on these! ----- '))
      localNonMasterBranches.forEach(branch => {
        console.log(chalk.yellow.underline(`${branch.repoName}:`))
        console.log(chalk.yellow(`Branch name: ${branch.currentBranch}\n`))
      })
    }

    this.outputSuggestedNextSteps(
      this.processed.newDependencies,
      this.processed.newDependenciesWithoutLinkables
    )
    this.syncEnd = new Date()
    console.log('')
    console.log(`Done (${humanizeDuration(this.syncEnd - this.syncStart)}).`)
  }
}

module.exports = LernaSync
