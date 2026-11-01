export type CommandHandler = () => void | Promise<void>

const commands = new Map<string, CommandHandler>()

export function registerCommand(id: string, handler: CommandHandler): void {
  commands.set(id, handler)
}

export function executeCommand(id: string): void {
  const handler = commands.get(id)
  if (!handler) {
    console.warn(`[commands] no command registered for "${id}"`)
    return
  }
  void handler()
}

export function hasCommand(id: string): boolean {
  return commands.has(id)
}
