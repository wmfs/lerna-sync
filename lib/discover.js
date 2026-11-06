const query = require('./github-graphql-query')
const colours = require('./colours')

function parsePackageJson (repoName, blob) {
  if (!blob || typeof blob.text !== 'string') return null
  if (blob.isTruncated) {
    console.warn(colours.yellow(`package.json for ${repoName} was truncated, skipping`))
    return null
  }
  try {
    return JSON.parse(blob.text)
  } catch (e) {
    console.warn(colours.yellow(`Unable to parse package.json for ${repoName}`))
    return null
  }
}

// GitHub returns these when a GraphQL query takes too long on its side.
// Reading package.json for 100 repos at once can do that, so fetch fewer.
const RETRYABLE_STATUSES = new Set([502, 503, 504])
const MIN_PAGE_SIZE = 10
const MAX_ATTEMPTS = 5

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

module.exports = async function discover (graphql, org, options = {}) {
  const { pageSize = 100, sleep = wait } = options
  const repos = []
  let after = null
  let first = pageSize

  console.log(colours.gray(`Downloading repo information from https://github.com/${org}`))

  // Retries a page that GitHub timed out on, halving the page size each time.
  // The smaller size is kept for the remaining pages.
  async function fetchPage () {
    for (let attempt = 1; ; attempt++) {
      try {
        return await graphql(query.orgRepos, { org, after, first })
      } catch (err) {
        if (!RETRYABLE_STATUSES.has(err.status) || attempt >= MAX_ATTEMPTS) throw err
        first = Math.max(MIN_PAGE_SIZE, Math.floor(first / 2))
        console.warn(colours.yellow(`GitHub returned ${err.status}, retrying with ${first} repos per page`))
        await sleep(attempt * 1000)
      }
    }
  }

  do {
    const { organization } = await fetchPage()
    const { nodes, pageInfo } = organization.repositories

    for (const node of nodes) {
      if (node.isArchived) continue // belt and braces

      const branch = node.defaultBranchRef
      if (!branch) continue // empty repo, nothing to sync

      const commit = branch.target
      const blob = node.packageJson

      repos.push({
        name: node.name,
        isPrivate: node.isPrivate,
        defaultBranch: branch.name,
        sha: commit.oid,
        messageHeadline: commit.messageHeadline,
        author: commit.author,
        packageJson: parsePackageJson(node.name, blob)
      })
    }

    after = pageInfo.hasNextPage ? pageInfo.endCursor : null
  } while (after)

  return repos
}
