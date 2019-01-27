# lerna-sync

[![Build Status](https://travis-ci.com/wmfs/lerna-sync.svg?branch=master)](https://travis-ci.com/wmfs/lerna-sync)

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

## Install Lerna

You'll need to have [Node.js](https://nodejs.org/en/download/) installed and [Lerna](https://github.com/lerna/lerna) available **globally**:

``` bash
npm install lerna -g
```

## The monorepo husk

Create an **empty husk** of a Lerna Monorepo (our [tymly](https://github.com/wmfs/tymly) repo is an example).

*Some things:*

* Note that the directories you'd ordinarily expect Lerna packages to be living inside, are empty.
* The [lerna.json](https://github.com/wmfs/tymly/blob/master/lerna.json) file is pretty basic stuff.

This is the the empty husk of your monorepo, it should be committed and pretty much forgotten about after this point.

## GitHub Credentials

Lerna-sync will take-on the work to clone/pull your separate GitHub repos and keep them in-sync within your monorepo.

**You'll need to provide some GitHub credentials to hand, namely:**

* Your GitHub **username**.
* A **[GitHub Access Token](https://github.com/settings/tokens)** associated with the provided **username**. Giving your token a description of "*Lerna Sync Access*" will be fine. This is necessary to avoid certain rate-limits and access private repos. Remember to keep tokens private and treat them as if they were passwords.
* A name of a GitHub **organization** that your Lerna packages will be synchronized with (for example `wmfs`).


## Routing function

You may have many GitHub repos in the organization you specify that shouldn't come anywhere near your monorepo.
Also, you might like to take advantage of Lerna's support for multiple-package directories to help structure things a bit better.

In **lerna-sync** this filtering/routing can be achieved via a simple Javascript function. Here's an example:

``` javascript
function (gitHubPackageObj) {
  if (gitHubPackageObj) {
    const keywordToPackageMap = [
      ['package', 'packages'],
      ['plugin', 'plugins'],
      ['blueprint', 'blueprints'],
      ['cardscript', 'cardscript'],
      ['app', 'apps']
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
```

Lerna-sync will call this function with the `package.json` content (already parsed as a JavaScript object) of each repo in the source GitHub organization.

* Any repos with no `package.json` will be skipped entirely due to not being a suitable candidate for a Lerna Monorepo.

The function should return the name of a directory registered in the `packages` array in the monorepo's [`lerna.json`](https://github.com/wmfs/tymly/blob/master/lerna.json) file.

* If no value is returned by this function, then **lerna-sync** will know not to route the repo to any package directory (i.e. it's filtered out).

-----

WIP

# Environment variables

| Variable | Notes |
| -------- | ----- |
| `LERNA_SYNC_MONOREPO_PATH` | Should be set to a directory where a `lerna.json` can be found. |
| `LERNA_SYNC_GITHUB_TOKEN`	 | Generate a new GitHub token [here](https://github.com/settings/tokens), a description of "lerna-sync connection" will do.
| `LERNA_SYNC_GITHUB_ORG`    | Name of the GitHub organization holding all your repos. |
| `LERNA_SYNC_GITHUB_USER`   | Your GitHub username (used in conjunction with `LERNA_SYNC_GITHUB_TOKEN` to fetch/pull repos. |

# Installation

``` bash
npm install @wmfs/lerna-sync --save
```

## <a name="Usage"></a> Usage

## <a name='license'></a>License
[MIT](https://github.com/wmfs/lerna-sync/blob/master/LICENSE)
