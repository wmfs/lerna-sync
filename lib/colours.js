'use strict'

// Terminal colours using Node's built-in util.styleText, in place of chalk
// (chalk 5+ is ESM-only). Colours are only added when writing to a terminal
// and NO_COLOR isn't set. Tests switch them off with `colours.enabled = false`.

const { styleText } = require('node:util')

const colours = {
  enabled: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR
}

for (const format of ['red', 'green', 'yellow', 'blue', 'cyan', 'gray', 'bold', 'underline']) {
  colours[format] = text => colours.enabled
    ? styleText(format, String(text), { validateStream: false })
    : String(text)
}

module.exports = colours
