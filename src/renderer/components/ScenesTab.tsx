import { useState } from 'react'
import { useBondStore, effectiveName } from '../store'
import { scenesRemove, scenesRun, scenesUpsert } from '../lib/api'
import type { BondScene, BondSceneStep } from '../lib/types'
import styles from '../SettingsView.module.css'

function newSceneId(): string {
  return `scene-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

export function ScenesTab(): JSX.Element {
  const scenes = useBondStore((s) => s.scenes)
  const refresh = useBondStore((s) => s.refreshScenes)

  const [draft, setDraft] = useState('')

  const addScene = async (): Promise<void> => {
    const name = draft.trim()
    if (!name) return
    await scenesUpsert({ id: newSceneId(), name, steps: [] })
    setDraft('')
    await refresh()
  }

  return (
    <div>
      <section className={styles.section}>
        <div className={styles.sectionTitle}>Add scene</div>
        <div className={styles.formInline}>
          <input
            className={styles.input}
            style={{ flex: 1 }}
            placeholder="Scene name (e.g. Movie Mode)"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void addScene() }}
          />
          <button className={styles.btnPrimary} onClick={addScene} disabled={!draft.trim()}>Add</button>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionTitle}>Scenes</div>
        {scenes.length === 0
          ? <div className={styles.sectionHint}>No scenes yet. Add one to chain device toggles and delays.</div>
          : <div className={styles.cardList}>{scenes.map((s) => <SceneEditor key={s.id} scene={s} onChange={refresh} />)}</div>
        }
      </section>
    </div>
  )
}

function SceneEditor({ scene, onChange }: { scene: BondScene; onChange: () => Promise<void> }): JSX.Element {
  const devices = useBondStore((s) => s.devices)

  const [name, setName] = useState(scene.name)
  const [description, setDescription] = useState(scene.description ?? '')
  const [steps, setSteps] = useState<BondSceneStep[]>(scene.steps)
  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<string | null>(null)

  const persist = async (next: { name?: string; description?: string; steps?: BondSceneStep[] }): Promise<void> => {
    await scenesUpsert({
      ...scene,
      name: (next.name ?? name).trim() || scene.name,
      description: (next.description ?? description).trim() || undefined,
      steps: next.steps ?? steps
    })
    await onChange()
  }

  const remove = async (): Promise<void> => {
    if (!confirm(`Delete scene '${scene.name}'?`)) return
    await scenesRemove(scene.id)
    await onChange()
  }

  const run = async (): Promise<void> => {
    setRunning(true); setRunResult(null)
    try {
      const res = await scenesRun(scene.id)
      setRunResult(res.ok ? 'Ran successfully' : `Failed: ${res.error ?? '(see log)'}`)
    } catch (e) {
      setRunResult((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  const addToggleStep = async (): Promise<void> => {
    const first = devices[0]
    if (!first) {
      alert('No devices available — connect a bridge first.')
      return
    }
    const newStep: BondSceneStep = {
      kind: 'toggle',
      bondid: first.bondid,
      deviceId: first.deviceId
    }
    const next = [...steps, newStep]
    setSteps(next)
    await persist({ steps: next })
  }

  const addDelayStep = async (): Promise<void> => {
    const next: BondSceneStep[] = [...steps, { kind: 'delay', ms: 1000 }]
    setSteps(next)
    await persist({ steps: next })
  }

  const updateStep = async (idx: number, step: BondSceneStep): Promise<void> => {
    const next = steps.map((s, i) => (i === idx ? step : s))
    setSteps(next)
    await persist({ steps: next })
  }

  const removeStep = async (idx: number): Promise<void> => {
    const next = steps.filter((_, i) => i !== idx)
    setSteps(next)
    await persist({ steps: next })
  }

  const moveStep = async (idx: number, dir: -1 | 1): Promise<void> => {
    const j = idx + dir
    if (j < 0 || j >= steps.length) return
    const next = steps.slice()
    ;[next[idx], next[j]] = [next[j]!, next[idx]!]
    setSteps(next)
    await persist({ steps: next })
  }

  return (
    <div className={styles.bridgeCard}>
      <div className={styles.bridgeCardHeader}>
        <input
          className={styles.inlineInput}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void persist({ name })}
          style={{ fontSize: 14, fontWeight: 600, flex: 1 }}
        />
        <button className={styles.btnSm} onClick={run} disabled={running}>{running ? 'Running…' : '▶ Test run'}</button>
        <button className={styles.btnSm} style={{ color: 'var(--color-error, #dc3545)' }} onClick={remove}>Delete</button>
      </div>

      <input
        className={styles.input}
        placeholder="Description (optional, shown in tooltip)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={() => void persist({ description })}
        style={{ marginBottom: 8 }}
      />

      <div style={{ marginTop: 8 }}>
        {steps.map((step, idx) =>
          step.kind === 'toggle'
            ? <ToggleStep key={idx}
                step={step}
                idx={idx}
                last={idx === steps.length - 1}
                onChange={(s) => void updateStep(idx, s)}
                onRemove={() => void removeStep(idx)}
                onMove={(dir) => void moveStep(idx, dir)}
              />
            : <DelayStep key={idx}
                step={step}
                idx={idx}
                last={idx === steps.length - 1}
                onChange={(s) => void updateStep(idx, s)}
                onRemove={() => void removeStep(idx)}
                onMove={(dir) => void moveStep(idx, dir)}
              />
        )}
      </div>

      <div className={styles.formInline} style={{ marginTop: 8 }}>
        <button className={styles.btn} onClick={addToggleStep}>+ Toggle step</button>
        <button className={styles.btn} onClick={addDelayStep}>+ Delay step</button>
      </div>

      {runResult && <div className={runResult.startsWith('Ran') ? styles.successText : styles.errorText} style={{ marginTop: 8 }}>{runResult}</div>}
    </div>
  )
}

function ToggleStep({
  step, idx, last, onChange, onRemove, onMove
}: {
  step: Extract<BondSceneStep, { kind: 'toggle' }>
  idx: number
  last: boolean
  onChange: (s: BondSceneStep) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
}): JSX.Element {
  const devices = useBondStore((s) => s.devices)

  const updateDevice = (key: string): void => {
    const [bondid, deviceId] = key.split('|')
    onChange({ kind: 'toggle', bondid: bondid!, deviceId: deviceId! })
  }

  return (
    <div className={styles.sceneStep}>
      <span className={styles.stepKindLabel}>{idx + 1} • TOGGLE</span>
      <select
        className={styles.inlineInput}
        value={`${step.bondid}|${step.deviceId}`}
        onChange={(e) => updateDevice(e.target.value)}
      >
        {devices.map((d) => (
          <option key={`${d.bondid}|${d.deviceId}`} value={`${d.bondid}|${d.deviceId}`}>{effectiveName(d)}</option>
        ))}
      </select>
      <span className={styles.formInline}>
        <button className={styles.btnSm} onClick={() => onMove(-1)} disabled={idx === 0} title="Move up">↑</button>
        <button className={styles.btnSm} onClick={() => onMove(1)}  disabled={last}      title="Move down">↓</button>
      </span>
      <button className={styles.btnSm} style={{ color: 'var(--color-error, #dc3545)' }} onClick={onRemove}>×</button>
    </div>
  )
}

function DelayStep({
  step, idx, last, onChange, onRemove, onMove
}: {
  step: Extract<BondSceneStep, { kind: 'delay' }>
  idx: number
  last: boolean
  onChange: (s: BondSceneStep) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
}): JSX.Element {
  const [draft, setDraft] = useState(String(step.ms))
  return (
    <div className={styles.sceneStepDelay}>
      <span className={styles.stepKindLabel}>{idx + 1} • DELAY</span>
      <span>
        <input
          type="number"
          className={styles.inlineInput}
          style={{ width: 100 }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onChange({ kind: 'delay', ms: Math.max(0, Number(draft) || 0) })}
        /> ms
      </span>
      <span className={styles.formInline}>
        <button className={styles.btnSm} onClick={() => onMove(-1)} disabled={idx === 0} title="Move up">↑</button>
        <button className={styles.btnSm} onClick={() => onMove(1)}  disabled={last}      title="Move down">↓</button>
      </span>
      <button className={styles.btnSm} style={{ color: 'var(--color-error, #dc3545)' }} onClick={onRemove}>×</button>
    </div>
  )
}
