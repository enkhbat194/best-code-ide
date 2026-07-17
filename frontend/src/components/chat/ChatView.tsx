import { useEffect, useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { useChatStore } from '../../store/chatStore'
import { useSettingsStore } from '../../store/settingsStore'
import { ToolCallCard } from './ToolCallCard'
import styles from './ChatView.module.css'

export function ChatView() {
  const { messages, isSending, error, send } = useChatStore()
  const configured = useSettingsStore((s) => s.isConfigured())
  const [text, setText] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const submit = () => {
    if (!text.trim()) return
    send(text)
    setText('')
  }

  return (
    <div className={styles.wrap}>
      <div className={`${styles.messages} scroll-y`} ref={scrollRef}>
        {messages.length === 0 && (
          <div className={styles.empty}>
            {configured
              ? 'Даалгавраа бичээрэй — жишээ нь "src/App.tsx-д товч нэмээд push хий".'
              : 'Эхлээд Settings tab-с backend URL болон token-оо тохируулна уу.'}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`${styles.bubbleRow} ${m.role === 'user' ? 'user' : 'assistant'}`}>
            <div className={styles.bubble}>
              {m.content || (isSending && m.role === 'assistant' ? '…' : '')}
              {m.toolCalls && m.toolCalls.length > 0 && (
                <div className={styles.toolCalls}>
                  {m.toolCalls.map((tc) => (
                    <ToolCallCard key={tc.id} call={tc} />
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.inputBar}>
        <textarea
          rows={1}
          value={text}
          placeholder="Даалгавраа бичих..."
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <button className={styles.sendBtn} onClick={submit} disabled={isSending || !text.trim()}>
          <ArrowUp size={18} />
        </button>
      </div>
    </div>
  )
}
