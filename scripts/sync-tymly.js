// TODO: A temporary thing before lerna-sync is available on NPM proper.

const LernaSync = require('../lib/index')
const process = require('process')

async function main () {
  const lernaSync = new LernaSync(
    {
      monorepoPath: process.env.LERNA_SYNC_MONOREPO_PATH,
      gitHubToken: process.env.LERNA_SYNC_GITHUB_TOKEN,
      gitHubOrgName: process.env.LERNA_SYNC_GITHUB_ORG,
      gitHubUser: process.env.LERNA_SYNC_GITHUB_USER,
      lernaPackageRouterFunction: function (gitHubPackageObj) {
        if (gitHubPackageObj) {
          const keywordToPackageMap = [
            ['package', 'packages'],
            ['plugin', 'plugins'],
            ['blueprint', 'blueprints'],
            ['cardscript', 'cardscript']
          ]
          if (gitHubPackageObj.hasOwnProperty('keywords') && gitHubPackageObj.keywords.indexOf('tymly') !== -1) {
            let lernaPackageName = null
            const keywords = gitHubPackageObj.keywords
            keywordToPackageMap.forEach(
              tuple => {
                if (keywords.indexOf(tuple[0]) !== -1) {
                  lernaPackageName = tuple[1]
                }
              }
            )
            return lernaPackageName
          }
        }
      }
    }
  )
  await lernaSync.sync()
  // await lernaSync.logSummary()
}

(async () => {
  await main()
})().catch(e => {
  console.error(e)
})
