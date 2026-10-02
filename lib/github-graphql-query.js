module.exports = {
  orgRepos: `
    query orgRepos($org: String!, $after: String) {
      organization(login: $org) {
        repositories(
          first: 100
          after: $after
          isFork: false
          isArchived: false
          orderBy: { field: NAME, direction: ASC }
        ) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            name
            isArchived
            isPrivate
            packageJson: object(expression: "HEAD:package.json") {
              ... on Blob {
                text
                isTruncated
              }
            }
            defaultBranchRef {
              name
              target {
                ... on Commit {
                  oid
                  messageHeadline
                  author {
                    name
                    date
                  }
                }
              }
            }
          }
        }
      }
    }
  `
}
