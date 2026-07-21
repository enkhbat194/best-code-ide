import { useState } from 'react'
import { Bot, Target } from 'lucide-react'
import { ChatView } from '../chat/ChatView'
import { MissionCanvas } from './MissionCanvas'
import styles from './MissionCanvas.module.css'

type WorkspaceMode = 'mission' | 'chat'

export function MissionWorkspace() {
  const [mode, setMode] = useState<WorkspaceMode>('mission')

  return (
    <div className={styles.workspace}>
      <div className={styles.modeBar} role="tablist" aria-label="Mission workspace mode">
        <button className={mode === 'mission' ? styles.modeActive : ''} onClick={() => setMode('mission')} role="tab" aria-selected={mode === 'mission'}>
          <Target size={16} /> Mission
        </button>
        <button className={mode === 'chat' ? styles.modeActive : ''} onClick={() => setMode('chat')} role="tab" aria-selected={mode === 'chat'}>
          <Bot size={16} /> AI Chat
        </button>
      </div>
      {mode === 'mission' ? <MissionCanvas /> : <ChatView />}
    </div>
  )
}
