import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ChatMessage, ToolCall } from '../types'
import { sendChat } from '../lib/api'
import { useSettingsStore } from './settingsStore'

interface ChatState {
  messages: ChatMessage[]
  isSending: boolean
  error: string | null
  send: (text: string) => Promise<void>
  clear: () => void
}

function newId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      messages: [],
      isSending: false,
      error: null,

      clear: () => set({ messages: [], error: null }),

      send: async (text: string) => {
        const trimmed = text.trim()
        if (!trimmed || get().isSending) return

        const settings = useSettingsStore.getState()
        if (!settings.isConfigured()) {
          set({ error: 'Settings tab-с backend URL болон token-оо тохируулна уу.' })
          return
        }

        const userMsg: ChatMessage = { id: newId(), role: 'user', content: trimmed, createdAt: Date.now() }
        const assistantMsg: ChatMessage = { id: newId(), role: 'assistant', content: '', toolCalls: [], createdAt: Date.now() }
        set((s) => ({ messages: [...s.messages, userMsg, assistantMsg], isSending: true, error: null }))

        const history = get()
          .messages.filter((m) => m.role !== 'tool')
          .map((m) => ({ role: m.role, content: m.content }))

        try {
          await sendChat(
            {
              backendUrl: settings.backendUrl,
              authToken: settings.authToken,
              owner: settings.owner,
              repo: settings.repo,
              branch: settings.branch,
              messages: history,
            },
            (event) => {
              set((s) => {
                const messages = [...s.messages]
                const idx = messages.findIndex((m) => m.id === assistantMsg.id)
                if (idx === -1) return s
                const msg = { ...messages[idx] }
                const toolCalls: ToolCall[] = msg.toolCalls ? [...msg.toolCalls] : []

                if (event.type === 'text_delta') {
                  msg.content += event.delta
                } else if (event.type === 'tool_call') {
                  toolCalls.push({ id: event.id, name: event.name, args: event.args, status: 'running' })
                  msg.toolCalls = toolCalls
                } else if (event.type === 'tool_result') {
                  const tcIdx = toolCalls.findIndex((tc) => tc.id === event.id)
                  if (tcIdx !== -1) {
                    toolCalls[tcIdx] = { ...toolCalls[tcIdx], status: event.error ? 'error' : 'done', result: event.result }
                    msg.toolCalls = toolCalls
                  }
                } else if (event.type === 'error') {
                  return { ...s, error: event.message }
                }

                messages[idx] = msg
                return { ...s, messages }
              })
            },
          )
        } catch (err) {
          set({ error: err instanceof Error ? err.message : String(err) })
        } finally {
          set({ isSending: false })
        }
      },
    }),
    { name: 'codeide-chat', partialize: (s) => ({ messages: s.messages }) },
  ),
)
