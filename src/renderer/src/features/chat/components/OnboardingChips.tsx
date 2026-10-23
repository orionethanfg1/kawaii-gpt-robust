/**
 * M2/M4/M5 — onboarding + pending nickname chips (uses MemoryChipBar).
 */
import { useMemo } from "react"
import { useSettingsStore } from "@shared/lib/stores/settingsStore"
import {
  shouldRunOnboarding,
  chipsForStep,
  applyOnboardingChip,
  type OnboardingStep
} from "@core/conversation/memory-onboarding"
import { isUserMemorySparse } from "@core/conversation/dual-memory"
import {
  chipsForPendingNickname,
  acceptNickname,
  rejectNickname
} from "@core/conversation/relationship-confidence"
import { MemoryChipBar } from "./MemoryChipBar"

type Props = {
  onChipSend?: (text: string) => void
}

export function OnboardingChips({ onChipSend }: Props) {
  const settings = useSettingsStore((s) => s.settings)
  const mem = settings.userMemory
  const ob = settings.memoryOnboarding
  const gate = settings.memoryGatePending

  const active = useMemo(
    () =>
      shouldRunOnboarding({
        userMemory: mem,
        onboarding: ob,
        memoryGatePending: gate
      }),
    [mem, ob, gate]
  )

  const step: OnboardingStep = (ob?.step as OnboardingStep) || "name"
  const pending = (mem?.pendingNickname || "").trim()

  if (pending) {
    const nChips = chipsForPendingNickname(pending)
    return (
      <MemoryChipBar
        hint={"¿Te llamo «" + pending + "»?"}
        chips={nChips.map((c) => ({
          id: c.id,
          label: c.label,
          variant: c.action === "reject" ? "muted" : "default"
        }))}
        onPick={(id) => {
          const c = nChips.find((x) => x.id === id)
          if (!c) return
          const rel = useSettingsStore.getState().settings.relationshipState
          if (c.action === "accept") {
            const r = acceptNickname(mem, rel, pending)
            useSettingsStore.getState().update({
              userMemory: r.userMemory,
              relationshipState: r.relationship
            })
            onChipSend?.(c.label)
          } else if (c.action === "reject") {
            const r = rejectNickname(mem, rel, pending)
            useSettingsStore.getState().update({
              userMemory: r.userMemory,
              relationshipState: r.relationship
            })
          }
        }}
      />
    )
  }

  if (!active || step === "done") return null

  if (step === "name") {
    return (
      <p className="text-[10px] text-kawaii-text-muted px-1 pb-1">
        Aún no te conozco del todo — puedes decirme cómo te llamas cuando quieras.
      </p>
    )
  }

  const chips = chipsForStep(step)
  if (!chips.length) return null

  return (
    <MemoryChipBar
      hint="Sugerencias:"
      chips={[
        ...chips.map((c) => ({ id: c.id, label: c.label })),
        { id: "__later__", label: "Luego", variant: "muted" as const }
      ]}
      onPick={(id) => {
        if (id === "__later__") {
          useSettingsStore.getState().update({
            memoryOnboarding: {
              active: false,
              step: "done",
              dismissed: true,
              updatedAt: Date.now()
            }
          })
          return
        }
        const c = chips.find((x) => x.id === id)
        if (!c) return
        const { memory, step: next } = applyOnboardingChip(mem, step, c.value)
        useSettingsStore.getState().update({
          userMemory: memory,
          memoryOnboarding: {
            active: next !== "done",
            step: next,
            dismissed: false,
            updatedAt: Date.now()
          }
        })
        if (c.value !== "__skip__" && onChipSend) onChipSend(c.label)
      }}
    />
  )
}

export function ensureOnboardingBoot(): void {
  const s = useSettingsStore.getState().settings
  if (s.memoryGatePending) return
  if (s.memoryOnboarding?.dismissed) return
  if (!isUserMemorySparse(s.userMemory)) return
  if (s.memoryOnboarding?.active) return
  useSettingsStore.getState().update({
    memoryOnboarding: {
      active: true,
      step: "name",
      dismissed: false,
      updatedAt: Date.now()
    }
  })
}
