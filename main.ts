import { registerBondHandlers } from './src/main/handlers'
// First-party extensions in the monorepo type-only-import the host contract
// via a relative path. The import is erased by esbuild, so the path only
// needs to resolve at type-check time inside the worktree.
import type { ExtensionMainContext } from '../../ProjectRose/src/shared/extension-contract'

export function register(ctx: ExtensionMainContext): () => void {
  ctx.registerSensitiveFields(['bond'])
  return registerBondHandlers(ctx)
}
