const query = require('./github-graphql-query')
const chalk = require('chalk')

function parsePackageJson (repoName, blob) {
  if (!blob || typeof blob.text !== 'string') return null
  if (blob.isTruncated) {
    console.warn(chalk.yellow(`package.json for ${repoName} was truncated, skipping`))
    return null
  }
  try {
    return JSON.parse(blob.text)
  } catch (e) {
    console.warn(chalk.yellow(`Unable to parse package.json for ${repoName}`))
    return null
  }
}

module.exports = async function discover (graphql, org) {
  const repos = []
  let after = null

  console.log(chalk.gray(`Downloading repo information from https://github.com/${org}`))

  do {
    const { organization } = await graphql(query.orgRepos, { org, after })
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
