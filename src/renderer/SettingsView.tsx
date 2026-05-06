import { useEffect, useState } from 'react'
import { useBondStore } from './store'
import { BridgesTab } from './components/BridgesTab'
import { RoomsTab } from './components/RoomsTab'
import { ScenesTab } from './components/ScenesTab'
import { LearnTab } from './components/LearnTab'
import styles from './SettingsView.module.css'

type TabId = 'bridges' | 'rooms' | 'scenes' | 'learn'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'bridges', label: 'Bridges' },
  { id: 'rooms',   label: 'Rooms' },
  { id: 'scenes',  label: 'Scenes' },
  { id: 'learn',   label: 'Learn' }
]

export function BondSettingsView(): JSX.Element {
  const init = useBondStore((s) => s.init)
  const [tab, setTab] = useState<TabId>('bridges')

  useEffect(() => { void init() }, [init])

  return (
    <div className={styles.container}>
      <nav className={styles.tabs} role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`${styles.tab} ${tab === t.id ? styles.tabActive : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className={styles.tabBody}>
        {tab === 'bridges' && <BridgesTab />}
        {tab === 'rooms'   && <RoomsTab />}
        {tab === 'scenes'  && <ScenesTab />}
        {tab === 'learn'   && <LearnTab />}
      </div>
    </div>
  )
}
