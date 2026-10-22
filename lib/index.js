const jsonfile = require('jsonfile')
const path = require('path')
const humanizeDuration = require('humanize-duration')
const chalk = require('chalk')
const { graphql } = require('@octokit/graphql')
const discover = require('./discover')
const inspect = require('./inspect')
const planSync = require('./plan-sync')
const { report, printPlan, describeResult } = require('./report')
const { executePlan } = require('./execute-plan')
const packageFoldersFromPatterns = require('./utils/package-folders-from-patterns')

class LernaSync {
  constructor (options) {
    this.lernaPackageRouterFunction = options.lernaPackageRouterFunction
    this.cloneUrl = options.cloneUrl
    this.updateLocalDefaultBranch = options.updateLocalDefaultBranch
    this.verbose = options.verbose
    this.dryRun = options.dryRun
    this.monorepoPath = options.monorepoPath
    this.concurrency = validateConcurrency(options.concurrency)
    this.gitHubOrgName = options.gitHubOrgName
    this.lernaJson = jsonfile.readFileSync(path.join(options.monorepoPath, 'lerna.json'))
    this.graphql = graphql.defaults({
      headers: {
        authorization: `token ${options.gitHubToken}`
      }
    })
  }

  async sync () {
    const start = Date.now()

    const packagePatterns = this.lernaJson.packages
    const packageFolders = packageFoldersFromPatterns(packagePatterns)

    // 1. Discover (remote)
    // Make one paginated GraphQL query that returns the name,
    // default branch, head commit and package.json
    // for every repo in the org.

    const remoteRepos = await discover(this.graphql, this.gitHubOrgName)

    // 2. Inspect (local)
    // For each folder that already exists, read its
    // current branch, whether it has uncommitted changes,
    // its HEAD SHA and its folder name.

    const localRepos = await inspect.inspectLocalRepos(
      this.monorepoPath,
      this.lernaJson.packages,
      { concurrency: this.concurrency }
    )

    // 3. Plan (pure function)
    // Take `(remoteRepos, localRepos, router)` and
    // return a list of decisions, each with a reason.
    // This stage does no I/O.

    const plan = planSync.planSync({
      remoteRepos,
      localRepos,
      router: this.lernaPackageRouterFunction,
      orgName: this.gitHubOrgName,
      packageFolders
    })

    // 4. Execute and report
    // Run the decisions, then print a summary
    // grouped by outcome.

    if (this.dryRun) {
      printPlan(plan, { verbose: this.verbose })
      return { plan, results: [], errorCount: 0, attentionCount: 0 }
    }

    const results = await executePlan(plan, {
      monorepoPath: this.monorepoPath,
      gitHubOrgName: this.gitHubOrgName,
      concurrency: this.concurrency,
      cloneUrl: this.cloneUrl,
      updateLocalDefaultBranch: this.updateLocalDefaultBranch,
      onResult: r => {
        const { label, colour, detail } = describeResult(r)
        const name = `${r.decision.folder}/${r.decision.repoName}`
        console.log(`  ${colour(label.padEnd(11))} ${name}${detail ? chalk.gray(`  (${detail})`) : ''}`)
      }
    })

    const { errorCount, attentionCount } = report(plan, results, { verbose: this.verbose })
    console.log(`\nDone (${humanizeDuration(Date.now() - start, { largest: 2, round: true })}).`)

    return { plan, results, errorCount, attentionCount }
  }
}

// undefined/null means "use each stage's default"; anything else must be a positive integer
function validateConcurrency (value) {
  if (value == null) return undefined
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`concurrency must be a positive integer, got ${JSON.stringify(value)}`)
  }
  return value
}

module.exports = LernaSync
