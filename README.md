# lerna-sync

[![CircleCI](https://circleci.com/gh/wmfs/lerna-sync.svg?style=svg)](https://circleci.com/gh/wmfs/lerna-sync)

A package to synchronize distributed GitHub repos inside a Lerna monorepo.

## Use Case

**If the following sounds familiar, then *lerna-sync* may be of interest:**

* You're building lots of [Node.js](https://nodejs.org/en/) packages.
* You're using a [Lerna](https://github.com/lerna/lerna) monorepo to help manage all your packages.
* You really need Lerna's ability to link together all your package dependencies.
* But you're also missing all the things that distinct GitHub repos gave you:
  * Mixing private/public repos
  * A place for focused issues
  * Dedicated wikis
  * Simple commit histories
  * Custom build-shenanigans
  * Etc.

**This is the situation *lerna-sync* is designed to help with.** :smiley:

## How it works

You keep an **empty husk** of a monorepo: a `lerna.json` and a set of empty package directories. Our [tymly](https://github.com/wmfs/tymly) repo is an example. Each time you sync, lerna-sync:

1. **Discovers** every repo in your GitHub organization with one paginated GraphQL query, collecting each repo's default branch, latest commit and `package.json`. Archived repos and forks are skipped.
2. **Inspects** the directories already in your monorepo: which are git repos, which branch is checked out, and whether there are local changes or a merge or rebase in progress.
3. **Plans** what to do with every repo, using your [routing function](#routing-function) to decide which repos belong in the monorepo and where.
4. **Executes** the plan, running git in parallel, and prints a summary of what happened and what needs your attention.

### What happens to each repo

lerna-sync never creates merge commits and never touches a branch you're working on.

| Local state | What lerna-sync does |
| ----------- | -------------------- |
| Not cloned yet | Clones it into the directory the routing function chose |
| On the default branch, clean | Fetches, then fast-forwards (`git merge --ff-only`) |
| On another branch | Fetches only. Your branch and working tree are left alone, and the report lists any new commits on the default branch for you to merge or rebase yourself. Your local default branch is fast-forwarded in the background when that's safe. |
| Detached HEAD | Fetches only, as above |
| Uncommitted changes on the default branch | Fetches only, and reports how far behind it is |
| Unpushed commits, or diverged from GitHub | Fetches only, and reports it |
| Untracked files that an update would overwrite | Doesn't update, and reports it |
| Mid-merge or mid-rebase | Leaves it alone, and reports it |
| A directory that isn't a git repo | Leaves it alone. Never clones over it. |
| `origin` points at a different owner (e.g. a personal fork) | Leaves it alone, and reports it |
| No longer in the org, or no longer selected by the routing function | Leaves it alone, and lists it under *Housekeeping* |
| In a different directory from the one the routing function now chooses | Updates it as normal, with a warning. Never moves it. |

Each repo's **default branch is read from GitHub**, so repos using `main` work as well as those using `master`.

## Requirements

* [Node.js](https://nodejs.org/en/download/) 20 or later.
* [Git](https://git-scm.com/downloads) on your `PATH`.
* A **[GitHub access token](https://github.com/settings/tokens)** that can read your organization's repos (see [Credentials](#credentials)).

## Installation

``` bash
npm install @wmfs/lerna-sync --save
```

## Usage

``` javascript
const path = require('path')
const LernaSync = require('@wmfs/lerna-sync')

async function main () {
  const lernaSync = new LernaSync({
    monorepoPath: path.resolve(__dirname, '..'),
    gitHubToken: process.env.MY_GITHUB_TOKEN,
    gitHubOrgName: 'wmfs',
    lernaPackageRouterFunction: routePackage
  })

  const { errorCount } = await lernaSync.sync()
  if (errorCount > 0) process.exitCode = 1
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
```

See [tymly/lib/sync.js](https://github.com/wmfs/tymly/blob/master/lib/sync.js) for a complete example, including command-line flags.

### Options

| Option | Required | Default | Notes |
| ------ | -------- | ------- | ----- |
| `monorepoPath` | Yes | | Path to the monorepo husk: the directory containing `lerna.json`. |
| `gitHubToken` | Yes | | Token used to query the GitHub API. |
| `gitHubOrgName` | Yes | | The GitHub organization to sync from, e.g. `wmfs`. |
| `lernaPackageRouterFunction` | Yes | | Decides which repos to sync and where. See [Routing function](#routing-function). |
| `dryRun` | No | `false` | Plan and print what would happen, without running any git commands that change anything. |
| `verbose` | No | `false` | Also list every repo that was ignored, with the reason. |
| `concurrency` | No | `8` when inspecting, `6` for git network operations | How many repos to work on at once. Lower it on slow disks or connections. |
| `cloneUrl` | No | `https://github.com/<org>/<repo>.git` | `(orgName, repoName) => url`. Use it to clone over SSH, e.g. `` (org, name) => `git@github.com:${org}/${name}.git` ``. |
| `updateLocalDefaultBranch` | No | `true` | When you're on another branch, also fast-forward your local default branch if it can be done safely. |

### Return value

`sync()` resolves with:

``` javascript
{
  plan,           // every decision lerna-sync made, with its reason
  results,        // what happened for each repo that git was run on (empty on a dry run)
  errorCount,     // repos where git failed
  attentionCount  // repos that need you to look at them
}
```

Use `errorCount` to set your script's exit code.

## Routing function

Your organization probably has repos that shouldn't come anywhere near your monorepo. You might also want to use Lerna's support for multiple package directories to give things some structure.

The routing function handles both. lerna-sync calls it once for each repo in the organization that has a valid `package.json`, passing that `package.json` as a parsed object. Repos with no `package.json` are skipped without calling it.

It should return one of:

* **A directory name**, such as `'plugins'`, to sync the repo into that directory. It must match an entry in the `packages` array of the monorepo's `lerna.json` (`'plugins'` for `"plugins/*"`). If it doesn't, the repo is ignored and the reason says so.
* **`{ skip: 'reason' }`** to leave the repo out and say why. The reason appears in the report, which helps when someone expects a repo that isn't there.
* **`null` or `undefined`** to leave the repo out silently. Use this for repos that are nothing to do with the monorepo.

If the function throws, that repo is ignored with the error as its reason, and the rest of the sync carries on.

``` javascript
// Use keywords in each repo's package.json to pick its directory.
// The first matching keyword wins.
const KEYWORD_FOLDERS = [
  ['blueprint', 'blueprints'],
  ['plugin', 'plugins'],
  ['package', 'packages']
]

function routePackage (pkg) {
  const keywords = Array.isArray(pkg.keywords) ? pkg.keywords : []
  if (!keywords.includes('tymly')) return null

  if (pkg.config && pkg.config.tymly && pkg.config.tymly.sync === false) {
    return { skip: 'Opted out (config.tymly.sync = false)' }
  }

  const match = KEYWORD_FOLDERS.find(([keyword]) => keywords.includes(keyword))
  return match ? match[1] : { skip: 'No folder keyword' }
}
```

## The report

As each repo finishes, lerna-sync prints a progress line, then a summary grouped by what you need to do:

```
Downloading repo information from https://github.com/wmfs
  Cloned      plugins/tymly-rbac-plugin
  On branch   plugins/tymly-pg-plugin  (feature/connection-pool, master has 1 new commit)
  Updated     plugins/tymly-core  (pulled 1 commit)

Cloned (1)
  plugins/tymly-rbac-plugin Plugin for Tymly

Updated (1)
  plugins/tymly-core 1 new commit
    ff3037f fix: handle missing state machine (Jane Smith, 2 hours ago)

Needs your attention (1)
  plugins/tymly-pg-plugin On feature/connection-pool: master has 1 commit(s) you don't
    8ccdfe1 feat: support schema search paths (Jane Smith, 3 hours ago)

1 up to date, 1 cloned, 1 updated, 1 need attention, 0 errors

Dependencies may have changed. Reinstall/relink before running anything.

Done (14 seconds).
```

The possible sections are *Cloned*, *Updated*, *On branches (left alone)*, *Needs your attention*, *Housekeeping* and *Errors*. The reminder about dependencies only appears when a repo was cloned or an update changed a `package.json`.

## Credentials

lerna-sync uses credentials in two separate places:

* **The GitHub API** (discovering repos) uses `gitHubToken`. A classic token needs the **repo** scope to see private repos. A fine-grained token needs read access to **Contents** and **Metadata** for the organization's repos. Without that, private repos are silently missing from the results.
* **Git** (clone and fetch) uses **your own git credentials**, not the token. For HTTPS, set up a credential helper such as [Git Credential Manager](https://github.com/git-ecosystem/git-credential-manager) or run `gh auth setup-git`. For SSH, use the `cloneUrl` option and make sure your key is loaded in `ssh-agent`.

Because many git commands run in parallel with their output captured, lerna-sync runs git non-interactively. A missing credential makes that repo fail with an error instead of waiting for a password prompt nobody can see. Each git command also has a 5-minute timeout. A credential manager that opens its own sign-in window can still do so.

## Development

``` bash
npm test     # mocha with coverage (nyc)
npm run lint # standard
```

The tests need git on your `PATH` but no network access or GitHub token. Tests that exercise git create throwaway repos in your temp directory, using local bare repos as the "GitHub" origin, and ignore your global git config.

## License

[MIT](https://github.com/wmfs/lerna-sync/blob/master/LICENSE)