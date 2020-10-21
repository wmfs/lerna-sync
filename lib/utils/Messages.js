const chalk = require('chalk')

module.exports = class Messages {
  constructor () {
    this.messages = {}
    this.errorCount = 0
    this.messageCount = 0
  }

  addMessage (repoName, domain, level, err) {
    this.messageCount++
    if (!this.messages(domain)) {
      this.messages[domain] = []
    }
    this.messages[domain].push(
      {
        repoName: repoName,
        level: level,
        err: err
      }
    )
    if (level === 'ERROR') {
      this.errorCount++
    }
  }

  output () {
    if (this.messageCount > 0) {
      console.log('')
      console.log(`Messages ${chalk.blue(`(${this.messageCount})`)}`)

      Object.entries(this.messages).forEach(([domain, messages]) => {
        console.log('')
        console.log(`  ${chalk.underline(domain)}`)
        console.log('')
        messages.forEach(
          message => {
            let title = message.level
            title = `[${title}]`
            switch (message.level) {
              case 'ERROR':
                title = chalk.red(`${title} ${message.repoName}`)
                break
              case 'WARNING':
                title = chalk.yellow(`${title} ${message.repoName}`)
                break
              case 'INFO':
                title = chalk.blue(`${title} ${message.repoName}`)
                break
            }
            title = chalk.bold(title)
            let messageBody = message.err.toString().replace(/\n/g, '\n      ')
            if (messageBody.slice(0, 7) === 'Error: ') {
              messageBody = messageBody.slice(7)
            }

            console.log(`    ${title}`)
            console.log(`      ${messageBody}`)
            console.log('')
          }
        )
      })

      if (this.errorCount > 0) {
        console.log(chalk.inverse(chalk.red(`SYNCING FINISHED WITH ${this.errorCount} ERROR${this.errorCount === 1 ? '' : 'S'}`)))
      }
    }
  }
}
