import { useEffect } from 'react'
import { useChatStore } from '@shared/lib/stores/chatStore'

export function useChatPluginTools(): void {
  useEffect(() => {
    const handleRunHostTools = async (event: Event) => {
      const detail = (event as CustomEvent<{ tools?: string[]; phrase?: string }>).detail
      const tools = detail?.tools || []
      if (!tools.length) return

      const store = useChatStore.getState()
      const convId = store.activeId || store.create()
      const phrase = detail?.phrase || tools.join(', ')
      store.addMessage(convId, { role: 'user', content: phrase })
      const assistantId = store.addMessage(convId, {
        role: 'assistant',
        content: 'Ejecutando: ' + tools.join(' → ') + '…',
        isStreaming: true,
        meta: { kind: 'harness-activity', route: 'local' }
      })

      try {
        const { executeAppTool } = await import('../services/appAgent')
        const lines: string[] = []
        const observations: string[] = []
        for (const tool of tools.slice(0, 6)) {
          const name = String(tool)
          const args: Record<string, unknown> = {}
          if (/web_search|search/i.test(name)) {
            args.query = phrase && !/ejecutar|plugin/i.test(phrase) ? phrase : 'estado actual'
            args.max_results = 5
          }
          const toolId = name === 'web_search' ? 'web_search' : name
          const result = await executeAppTool({
            tool: toolId as import('@core/agent').AppToolName,
            args
          })
          lines.push((result.ok ? '✓ ' : '✗ ') + toolId + ': ' + (result.summary || '').slice(0, 400))
          observations.push(
            JSON.stringify({
              tool: toolId,
              ok: result.ok,
              summary: (result.summary || '').slice(0, 500)
            })
          )
        }
        let body = lines.join(String.fromCharCode(10))
        try {
          const mod = await import('@core/agent/humanize-host-reply')
          const humanize = (mod as { humanizeHostObservations?: (items: string[]) => string })
            .humanizeHostObservations
          if (typeof humanize === 'function' && observations.length) {
            const human = humanize(observations)
            if (human && String(human).trim().length > 20) {
              body =
                String(human).trim() +
                String.fromCharCode(10, 10) +
                '---' +
                String.fromCharCode(10) +
                body
            }
          }
        } catch {
          /* keep ticks */
        }
        useChatStore.getState().updateMessage(convId, assistantId, {
          content: body || 'Listo.',
          isStreaming: false,
          meta: {
            route: 'local',
            kind: 'harness-activity',
            model: 'harness-host',
            tools: tools.slice(0, 6),
            source: 'plugins-panel'
          }
        })
      } catch (error) {
        useChatStore.getState().updateMessage(convId, assistantId, {
          content: 'Error: ' + (error instanceof Error ? error.message : String(error)),
          isStreaming: false,
          meta: { isError: true }
        })
      }
    }

    window.addEventListener('kawaii:run-host-tools', handleRunHostTools)
    return () => window.removeEventListener('kawaii:run-host-tools', handleRunHostTools)
  }, [])
}
