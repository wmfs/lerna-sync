module.exports = `
    query myOrgRepos($queryString: String!, $afterValue: String) {
        search(query: $queryString, type: REPOSITORY, first: 100, after: $afterValue) {
            pageInfo {
                startCursor
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
                        ref(qualifiedName: "master") {
                            target {
                                ... on Commit {
                                    history(first: 1) {
                                        edges {
                                            node {
                                                oid                            
                                                messageHeadline,
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
            }
        }
    }
`
