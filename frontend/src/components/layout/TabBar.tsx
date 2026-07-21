import { FolderCode, GitCompare, Play, Settings, Target } from 'lucide-react'
import styles from './TabBar.module.css'
import type { Tab } from '../../App'

const TABS: { id: Tab; label: string; icon: typeof FolderCode }[] = [
  { id: 'chat', label: 'Mission', icon: Target },
  { id: 'files', label: 'Files', icon: FolderCode },
  { id: 'changes', label: 'Changes', icon: GitCompare },
  { id: 'preview', label: 'Preview', icon: Play },
  { id: 'settings', label: 'Settings', icon: Settings },
]

export function TabBar({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void }) {
  return (
    <nav className={styles.bar}>
      {TABS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          className={`${styles.tab} ${active === id ? styles.active : ''}`}
          onClick={() => onChange(id)}
        >
          <Icon size={21} strokeWidth={active === id ? 2.4 : 1.8} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}
