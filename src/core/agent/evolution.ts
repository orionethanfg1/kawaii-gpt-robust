import { z } from 'zod'

export const ImprovementProposalSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  rationale: z.string().min(1),
  evidence: z.array(z.string()).default([]),
  proposedChange: z.string().min(1),
  status: z.enum(['pending', 'approved', 'rejected', 'applied']).default('pending'),
  createdAt: z.number().int().nonnegative(),
  reviewedAt: z.number().int().nonnegative().optional()
})
export type ImprovementProposal = z.infer<typeof ImprovementProposalSchema>

export class EvolutionStore {
  private proposals: ImprovementProposal[] = []

  propose(input: Omit<ImprovementProposal, 'status' | 'createdAt'> & Partial<Pick<ImprovementProposal, 'status' | 'createdAt'>>): ImprovementProposal {
    const proposal = ImprovementProposalSchema.parse({
      ...input,
      status: input.status ?? 'pending',
      createdAt: input.createdAt ?? Date.now()
    })
    this.proposals = [...this.proposals.filter((item) => item.id !== proposal.id), proposal]
    return proposal
  }

  list(status?: ImprovementProposal['status']): ImprovementProposal[] {
    return this.proposals.filter((proposal) => !status || proposal.status === status)
  }

  serialize(): string { return JSON.stringify(this.proposals) }

  restore(raw: string): boolean {
    try {
      const parsed = z.array(ImprovementProposalSchema).safeParse(JSON.parse(raw))
      if (!parsed.success) return false
      this.proposals = parsed.data
      return true
    } catch {
      return false
    }
  }

  review(id: string, status: 'approved' | 'rejected'): ImprovementProposal | undefined {
    const current = this.proposals.find((proposal) => proposal.id === id)
    if (!current) return undefined
    const updated = { ...current, status, reviewedAt: Date.now() }
    this.proposals = this.proposals.map((proposal) => proposal.id === id ? updated : proposal)
    return updated
  }
}
