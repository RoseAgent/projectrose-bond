import { registerBondHandlers } from './src/main/handlers'
import type { ExtensionMainContext } from './src/main/types'

export function register(ctx: ExtensionMainContext): () => void {
  ctx.registerSensitiveFields(['bond'])
  return registerBondHandlers(ctx)
}
