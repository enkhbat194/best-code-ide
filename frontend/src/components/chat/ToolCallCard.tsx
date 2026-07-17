import type { ToolCall } from '../../types'
import styles from './ChatView.module.css'

export function ToolCallCard({ call }: { call: ToolCall }) {
  const statusLabel = call.status === 'running' ? '● running' : call.status === 'error' ? '✕ error' : '✓ done'
  return (
    <div className={styles.toolCall}>
      <div className={styles.toolCallHead}>
        <span className={styles[call.status]}>{statusLabel}</span>
        <strong>{call.name}</strong>
        <span>{summarizeArgs(call.args)}</span>
      </div>
      {call.result && <div className={styles.toolResult}>{call.result}</div>}
    </div>
  )
}

function summarizeArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args)
  if (entries.length === 0) return ''
  return entries
    .slice(0, 3)
    .map(([k, v]) => `${k}=${String(v).slice(0, 40)}`)
    .join(' ')
}
