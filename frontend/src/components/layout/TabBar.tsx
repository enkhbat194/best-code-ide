import { MessageSquare, FolderCode, Play, Settings } from 'lucide-react'
import styles from './TabBar.module.css'
import type { Tab } from '../../App'

const TABS: { id: Tab; label: string; icon: typeof MessageSquare }[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'files', label: 'Files', icon: FolderCode },
  { id: 'preview', label: 'Preview', icon: Play },
  { id: 'settings', label: 'Settings', icon: Settings },
]

export function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <nav className={styles.bar}>
      {TABS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          className={`${styles.tab} ${active === id ? styles.active : ''}`}
          onClick={() => onChange(id)}
        >
          <Icon size={22} strokeWidth={active === id ? 2.4 : 1.8} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}
