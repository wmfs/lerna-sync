module.exports = class Messages {
  constructor () {
    this.messages = {}
  }

  addMessage (messageType, messageText) {
    if (!this.messages.hasOwnProperty(messageType)) {
      this.messages[messageType] = []
    }
    this.messages[messageType].push(
      {
        text: messageText
      }
    )
  }
}
