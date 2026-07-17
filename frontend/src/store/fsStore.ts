import { create } from 'zustand'
import type { FileEntry } from '../types'
import * as vfs from '../lib/fs'

interface FsState {
  files: FileEntry[]
  openPath: string | null
  openContent: string
  dirty: boolean
  loading: boolean
  refresh: () => Promise<void>
  open: (path: string) => Promise<void>
  setOpenContent: (content: string) => void
  save: () => Promise<void>
  createFile: (path: string, content?: string) => Promise<void>
  remove: (path: string) => Promise<void>
}

export const useFsStore = create<FsState>((set, get) => ({
  files: [],
  openPath: null,
  openContent: '',
  dirty: false,
  loading: false,

  refresh: async () => {
    set({ loading: true })
    try {
      const files = await vfs.listTree('/')
      set({ files })
    } finally {
      set({ loading: false })
    }
  },

  open: async (path: string) => {
    const content = await vfs.readFile(path)
    set({ openPath: path, openContent: content, dirty: false })
  },

  setOpenContent: (content: string) => set({ openContent: content, dirty: true }),

  save: async () => {
    const { openPath, openContent } = get()
    if (!openPath) return
    await vfs.writeFile(openPath, openContent)
    set({ dirty: false })
    await get().refresh()
  },

  createFile: async (path: string, content = '') => {
    await vfs.writeFile(path, content)
    await get().refresh()
    await get().open(path)
  },

  remove: async (path: string) => {
    await vfs.deletePath(path)
    if (get().openPath === path) set({ openPath: null, openContent: '', dirty: false })
    await get().refresh()
  },
}))
