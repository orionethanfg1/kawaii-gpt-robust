import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

type UiChromeState = {
  sidebarCollapsed: boolean
  pluginsOpen: boolean
  setSidebarCollapsed: (v: boolean) => void
  toggleSidebar: () => void
  setPluginsOpen: (v: boolean) => void
  togglePlugins: () => void
}

const safeStorage = {
  getItem: (name: string) => {
    try {
      return localStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem: (name: string, value: string) => {
    try {
      localStorage.setItem(name, value)
    } catch {
      /* quota / private mode */
    }
  },
  removeItem: (name: string) => {
    try {
      localStorage.removeItem(name)
    } catch {
      /* ignore */
    }
  }
}

export const useUiChromeStore = create<UiChromeState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      pluginsOpen: false,
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: Boolean(v) }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setPluginsOpen: (v) => set({ pluginsOpen: Boolean(v) }),
      togglePlugins: () => set((s) => ({ pluginsOpen: !s.pluginsOpen }))
    }),
    {
      name: 'kawaii-ui-chrome',
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed }),
      version: 1
    }
  )
)
