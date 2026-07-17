import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Bot, GitBranch } from 'lucide-react'
import { useChatStore } from '../../store/chatStore'
import { useSettingsStore } from '../../store/settingsStore'
import { ToolCallCard } from './ToolCallCard'
import styles from './ChatView.module.css'

export function ChatView() {
  const { messages, isSending, error, send } = useChatStore()
  const configured = useSettingsStore((state) => state.isConfigured())
  const owner = useSettingsStore((state) => state.owner)
  const repo = useSettingsStore((state) => state.repo)
  const branch = useSettingsStore((state) => state.branch)
  const [text, setText] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const submit = () => {
    if (!text.trim()) return
    void send(text)
    setText('')
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.agentHeader}>
        <div className={styles.agentIdentity}>
          <Bot size={17} />
          <div>
            <strong>Best Code Agent</strong>
            <span>DeepSeek provider</span>
          </div>
        </div>
        <div className={styles.repoContext}>
          <span>{owner && repo ? `${owner}/${repo}` : 'Repository тохируулаагүй'}</span>
          <span className={styles.branch}><GitBranch size={12} /> {branch || 'main'}</span>
        </div>
      </header>

      <div className={`${styles.messages} scroll-y`} ref={scrollRef}>
        {messages.length === 0 && (
          <div className={styles.empty}>
            {configured
              ? 'Даалгавраа бичээрэй — жишээ нь "hello.html үүсгээд hello world харуул". Файлууд Files tab-д үүсэж, Preview tab-аар шууд ажиллана. GitHub руу зөвхөн "push хий" гэсэн үед л илгээнэ.'
              : 'Эхлээд Settings tab-с backend URL болон token-оо тохируулна уу.'}
          </div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`${styles.bubbleRow} ${message.role === 'user' ? styles.user : styles.assistant}`}
          >
            <div className={styles.bubble}>
              {message.content || (isSending && message.role === 'assistant' ? '…' : '')}
              {message.toolCalls && message.toolCalls.length > 0 && (
                <div className={styles.toolCalls}>
                  {message.toolCalls.map((toolCall) => (
                    <ToolCallCard key={toolCall.id} call={toolCall} />
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
          placeholder="Repository дээр хийх ажлаа бичих..."
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <button className={styles.sendBtn} onClick={submit} disabled={isSending || !text.trim()} aria-label="Send">
          <ArrowUp size={18} />
        </button>
      </div>
    </div>
  )
}
