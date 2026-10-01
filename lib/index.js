const jsonfile = require('jsonfile')
const path = require('path')
const humanizeDuration = require('humanize-duration')
const chalk = require('chalk')
const { graphql } = require('@octokit/graphql')
const discover = require('./discover')
const inspect = require('./inspect')
const planSync = require('./plan-sync')
const { report, printPlan } = require('./report')
const { executePlan } = require('./execute-plan')
const packageFoldersFromPatterns = require('./utils/package-folders-from-patterns')

class LernaSync {
  constructor (options) {
    this.options = options // todo: is this necessary?
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

    const remoteRepos = await discover(this.graphql, this.options.gitHubOrgName)

    // 2. Inspect (local)
    // For each folder that already exists, read its
    // current branch, whether it has uncommitted changes,
    // its HEAD SHA and its folder name.

    const localRepos = await inspect.inspectLocalRepos(
      this.options.monorepoPath,
      this.lernaJson.packages,
      { concurrency: this.options.concurrency }
    )

    // 3. Plan (pure function)
    // Take `(remoteRepos, localRepos, router)` and
    // return a list of decisions, each with a reason.
    // This stage does no I/O.

    const plan = planSync.planSync({
      remoteRepos,
      localRepos,
      router: this.options.lernaPackageRouterFunction,
      orgName: this.options.gitHubOrgName,
      packageFolders
    })

    // 4. Execute and report
    // Run the decisions, then print a summary
    // grouped by outcome.

    if (this.options.dryRun) {
      printPlan(plan, { verbose: this.options.verbose })
      return { plan, results: [], errorCount: 0, attentionCount: 0 }
    }

    const results = await executePlan(plan, {
      monorepoPath: this.options.monorepoPath,
      gitHubOrgName: this.options.gitHubOrgName,
      concurrency: this.options.concurrency,
      cloneUrl: this.options.cloneUrl,
      onResult: r => console.log(chalk.gray(`  ${r.outcome.padEnd(20)} ${r.decision.folder}/${r.decision.repoName}`))
    })

    const { errorCount, attentionCount } = report(plan, results, { verbose: this.options.verbose })
    console.log(`\nDone (${humanizeDuration(Date.now() - start, { largest: 2, round: true })}).`)

    return { plan, results, errorCount, attentionCount }
  }
}

module.exports = LernaSync
