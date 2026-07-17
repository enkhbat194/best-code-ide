import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ChatMessage, ToolCall } from '../types'
import { runLocalAgent } from '../lib/localAgent'
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
        if (!settings.backendUrl || !settings.authToken) {
          set({ error: 'Settings tab-с backend URL болон token-оо тохируулна уу.' })
          return
        }

        const userMsg: ChatMessage = { id: newId(), role: 'user', content: trimmed, createdAt: Date.now() }
        const assistantMsg: ChatMessage = { id: newId(), role: 'assistant', content: '', toolCalls: [], createdAt: Date.now() }

        const history = [...get().messages, userMsg]
          .filter((message) => message.role !== 'tool' && message.content.trim())
          .map((message) => ({ role: message.role as 'user' | 'assistant', content: message.content }))

        set((state) => ({ messages: [...state.messages, userMsg, assistantMsg], isSending: true, error: null }))

        const patchAssistant = (updater: (message: ChatMessage) => ChatMessage) => {
          set((state) => {
            const messages = [...state.messages]
            const index = messages.findIndex((message) => message.id === assistantMsg.id)
            if (index === -1) return state
            messages[index] = updater({ ...messages[index] })
            return { ...state, messages }
          })
        }

        try {
          await runLocalAgent(history, (event) => {
            if (event.type === 'text') {
              patchAssistant((message) => ({
                ...message,
                content: message.content ? `${message.content}\n\n${event.text}` : event.text,
              }))
            } else if (event.type === 'tool_call') {
              patchAssistant((message) => {
                const toolCalls: ToolCall[] = message.toolCalls ? [...message.toolCalls] : []
                toolCalls.push({ id: event.id, name: event.name, args: event.args, status: 'running' })
                return { ...message, toolCalls }
              })
            } else if (event.type === 'tool_result') {
              patchAssistant((message) => {
                const toolCalls: ToolCall[] = message.toolCalls ? [...message.toolCalls] : []
                const index = toolCalls.findIndex((toolCall) => toolCall.id === event.id)
                if (index !== -1) {
                  toolCalls[index] = {
                    ...toolCalls[index],
                    status: event.error ? 'error' : 'done',
                    result: event.result,
                  }
                }
                return { ...message, toolCalls }
              })
            } else if (event.type === 'error') {
              set({ error: event.message })
            }
          })
        } catch (err) {
          set({ error: err instanceof Error ? err.message : String(err) })
        } finally {
          set({ isSending: false })
        }
      },
    }),
    { name: 'codeide-chat', partialize: (state) => ({ messages: state.messages }) },
  ),
)
