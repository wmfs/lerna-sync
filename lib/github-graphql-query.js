module.exports = {
  repos: `
    query myOrgRepos($queryString: String!, $afterValue: String) {
      search(
        query: $queryString
        type: REPOSITORY
        first: 50
        after: $afterValue
      ) {
        pageInfo {
          hasNextPage
          endCursor
        }

        edges {
          node {
            ... on Repository {
              name

              object(expression: "master:package.json") {
                ... on Blob {
                  text
                }
              }
            }
          }
        }
      }
    }
  `,

  repoCommit: `
    query repoCommit($orgName: String!, $repoName: String!) {
      repository(owner: $orgName, name: $repoName) {
        ref(qualifiedName: "master") {
          target {
            ... on Commit {
              history(first: 1) {
                edges {
                  node {
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
    }
  `
}
