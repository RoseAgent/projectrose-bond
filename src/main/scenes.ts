import type { BondClient } from './bondClient'
import type { BondScene, BondSceneStep } from './types'

export interface SceneStepResult {
  step: BondSceneStep
  ok: boolean
  error?: string
  durationMs: number
}

export interface SceneRunResult {
  sceneId: string
  sceneName: string
  ok: boolean
  steps: SceneStepResult[]
}

/**
 * Runs scene steps sequentially. `delay` steps `await` for ms before the next
 * step. `action` steps are dispatched via the per-bridge client. A failed step
 * does NOT abort the scene — it's recorded and we move on. Returning `ok=false`
 * if any step failed lets the AI tool surface partial-failure cleanly.
 */
export async function runScene(
  scene: BondScene,
  clientFor: (bondid: string) => BondClient | null,
  onStep?: (idx: number, result: SceneStepResult) => void
): Promise<SceneRunResult> {
  const results: SceneStepResult[] = []

  for (let i = 0; i < scene.steps.length; i++) {
    const step = scene.steps[i]!
    const startMs = Date.now()
    let ok = true
    let error: string | undefined

    try {
      if (step.kind === 'delay') {
        await new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, step.ms)))
      } else {
        const client = clientFor(step.bondid)
        if (!client) {
          throw new Error(`Bridge ${step.bondid} not connected`)
        }
        await client.runAction(step.deviceId, step.action, step.params)
      }
    } catch (err) {
      ok = false
      error = err instanceof Error ? err.message : String(err)
    }

    const result: SceneStepResult = { step, ok, error, durationMs: Date.now() - startMs }
    results.push(result)
    onStep?.(i, result)
  }

  return {
    sceneId: scene.id,
    sceneName: scene.name,
    ok: results.every((r) => r.ok),
    steps: results
  }
}
