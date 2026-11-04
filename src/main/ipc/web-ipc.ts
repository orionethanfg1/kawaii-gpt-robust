/** Web search IPC — multi-backend (main process) */
import { ipcMain } from 'electron'

export function registerWebIpc(): void {
  ipcMain.handle(
    'web:search',
    async (
      _event,
      query: string,
      maxResults = 5,
      opts?: { searxngBaseUrl?: string }
    ): Promise<{ title: string; snippet: string; url?: string; source?: string }[]> => {
      try {
        const { searchWeb } = await import('../web-search')
        return await searchWeb(query, {
          maxResults,
          searxngBaseUrl: opts?.searxngBaseUrl
        })
      } catch (e) {
        console.error('[web:search]', e)
        return []
      }
    }
  )
}
