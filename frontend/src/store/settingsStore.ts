import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SettingsState {
  backendUrl: string
  authToken: string
  owner: string
  repo: string
  branch: string
  setBackendUrl: (v: string) => void
  setAuthToken: (v: string) => void
  setOwner: (v: string) => void
  setRepo: (v: string) => void
  setBranch: (v: string) => void
  isConfigured: () => boolean
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      backendUrl: '',
      authToken: '',
      owner: '',
      repo: '',
      branch: 'main',
      setBackendUrl: (v) => set({ backendUrl: v.trim().replace(/\/+$/, '') }),
      setAuthToken: (v) => set({ authToken: v.trim() }),
      setOwner: (v) => set({ owner: v.trim() }),
      setRepo: (v) => set({ repo: v.trim() }),
      setBranch: (v) => set({ branch: v.trim() || 'main' }),
      isConfigured: () => Boolean(get().backendUrl && get().authToken),
    }),
    { name: 'codeide-settings' },
  ),
)
