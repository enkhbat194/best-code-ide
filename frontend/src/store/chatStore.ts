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
          set({ error: 'Settings tab-д backend URL, token, GitHub owner, repo, branch-аа бүрэн тохируулна уу.' })
          return
        }

        const userMsg: ChatMessage = { id: newId(), role: 'user', content: trimmed, createdAt: Date.now() }
        const assistantMsg: ChatMessage = { id: newId(), role: 'assistant', content: '', toolCalls: [], createdAt: Date.now() }

        const history = [...get().messages, userMsg]
          .filter((message) => message.role !== 'tool' && message.content.trim())
          .map((message) => ({ role: message.role, content: message.content }))

        set((state) => ({ messages: [...state.messages, userMsg, assistantMsg], isSending: true, error: null }))

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
              if (event.type === 'branch_changed' || (event.type === 'done' && event.branch)) {
                const branch = event.type === 'branch_changed' ? event.branch : event.branch
                if (branch) useSettingsStore.getState().setBranch(branch)
                return
              }

              set((state) => {
                const messages = [...state.messages]
                const index = messages.findIndex((message) => message.id === assistantMsg.id)
                if (index === -1) return state
                const message = { ...messages[index] }
                const toolCalls: ToolCall[] = message.toolCalls ? [...message.toolCalls] : []

                if (event.type === 'text_delta') {
                  message.content += event.delta
                } else if (event.type === 'tool_call') {
                  toolCalls.push({ id: event.id, name: event.name, args: event.args, status: 'running' })
                  message.toolCalls = toolCalls
                } else if (event.type === 'tool_result') {
                  const toolIndex = toolCalls.findIndex((toolCall) => toolCall.id === event.id)
                  if (toolIndex !== -1) {
                    toolCalls[toolIndex] = {
                      ...toolCalls[toolIndex],
                      status: event.error ? 'error' : 'done',
                      result: event.result,
                    }
                    message.toolCalls = toolCalls
                  }
                } else if (event.type === 'error') {
                  return { ...state, error: event.message }
                }

                messages[index] = message
                return { ...state, messages }
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
    { name: 'codeide-chat', partialize: (state) => ({ messages: state.messages }) },
  ),
)
