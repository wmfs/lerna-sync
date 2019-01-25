# lerna-sync

[![Build Status](https://travis-ci.com/wmfs/lerna-sync.svg?branch=master)](https://travis-ci.com/wmfs/lerna-sync)

A package to synchronize distributed repos inside a Lerna monorepo.

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
