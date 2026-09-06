import { z } from 'zod'

export const ModelRuntimeSchema = z.enum(['ollama', 'llama.cpp', 'openai-compatible', 'cloud'])
export type ModelRuntime = z.infer<typeof ModelRuntimeSchema>

export const ModelCapabilitySchema = z.enum(['chat', 'code', 'vision', 'tools', 'summary', 'image-prompt'])
export type ModelCapability = z.infer<typeof ModelCapabilitySchema>

export const ModelDescriptorSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  runtime: ModelRuntimeSchema,
  modelRef: z.string().min(1),
  version: z.string().min(1),
  downloadUrl: z.string().url().optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  minRamGB: z.number().nonnegative().default(0),
  minVramGB: z.number().nonnegative().optional(),
  capabilities: z.array(ModelCapabilitySchema).min(1),
  license: z.string().min(1),
  enabled: z.boolean().default(true)
})
export type ModelDescriptor = z.infer<typeof ModelDescriptorSchema>

export const ModelCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  catalogVersion: z.string().min(1),
  generatedAt: z.string().datetime().optional(),
  models: z.array(ModelDescriptorSchema)
})
export type ModelCatalog = z.infer<typeof ModelCatalogSchema>

export const BUILTIN_MODEL_CATALOG: ModelCatalog = {
  schemaVersion: 1,
  catalogVersion: '2026.09.04',
  models: [
    {
      id: 'qwen2.5-3b-ollama',
      displayName: 'Qwen2.5 3B',
      runtime: 'ollama',
      modelRef: 'qwen2.5:3b',
      version: '2.5',
      minRamGB: 6,
      capabilities: ['chat', 'code', 'summary', 'tools'],
      license: 'Apache-2.0',
      enabled: true
    },
    {
      id: 'llama3.2-3b-ollama',
      displayName: 'Llama 3.2 3B',
      runtime: 'ollama',
      modelRef: 'llama3.2:3b',
      version: '3.2',
      minRamGB: 6,
      capabilities: ['chat', 'summary', 'tools'],
      license: 'Llama Community License',
      enabled: true
    },
    {
      id: 'qwen2.5-14b-ollama',
      displayName: 'Qwen2.5 14B',
      runtime: 'ollama',
      modelRef: 'qwen2.5:14b',
      version: '2.5',
      minRamGB: 16,
      capabilities: ['chat', 'code', 'summary', 'tools'],
      license: 'Apache-2.0',
      enabled: true
    },
    {
      id: 'qwen2.5-7b-ollama',
      displayName: 'Qwen2.5 7B',
      runtime: 'ollama',
      modelRef: 'qwen2.5:7b',
      version: '2.5',
      minRamGB: 10,
      capabilities: ['chat', 'code', 'summary', 'tools'],
      license: 'Apache-2.0',
      enabled: true
    },
    {
      id: 'llama3.1-8b-ollama',
      displayName: 'Llama 3.1 8B',
      runtime: 'ollama',
      modelRef: 'llama3.1:8b',
      version: '3.1',
      minRamGB: 10,
      capabilities: ['chat', 'code', 'summary', 'tools'],
      license: 'Llama Community License',
      enabled: true
    },
    {
      id: 'llava-7b-ollama',
      displayName: 'LLaVA 7B (visión)',
      runtime: 'ollama',
      modelRef: 'llava:7b',
      version: '1.6',
      minRamGB: 10,
      capabilities: ['chat', 'vision', 'summary'],
      license: 'Apache-2.0',
      enabled: true
    },
    {
      id: 'phi3-mini-ollama',
      displayName: 'Phi-3 Mini',
      runtime: 'ollama',
      modelRef: 'phi3:mini',
      version: '3',
      minRamGB: 5,
      capabilities: ['chat', 'summary', 'tools'],
      license: 'MIT',
      enabled: true
    }
  ]
}

export interface ModelRegistryState {
  catalog: ModelCatalog
  installed: Set<string>
  activeByCapability: Partial<Record<ModelCapability, string>>
}

export class ModelRegistry {
  private state: ModelRegistryState

  constructor(catalog: ModelCatalog = BUILTIN_MODEL_CATALOG) {
    this.state = {
      catalog: ModelCatalogSchema.parse(catalog),
      installed: new Set<string>(),
      activeByCapability: {}
    }
  }

  loadCatalog(candidate: unknown): boolean {
    const parsed = ModelCatalogSchema.safeParse(candidate)
    if (!parsed.success) return false
    this.state.catalog = parsed.data
    return true
  }

  getCatalog(): ModelCatalog {
    return this.state.catalog
  }

  listInstalled(): ModelDescriptor[] {
    return this.state.catalog.models.filter((model) => this.state.installed.has(model.id))
  }

  markInstalled(modelId: string): boolean {
    if (!this.find(modelId)) return false
    this.state.installed.add(modelId)
    return true
  }

  markUninstalled(modelId: string): void {
    this.state.installed.delete(modelId)
    for (const [capability, activeId] of Object.entries(this.state.activeByCapability)) {
      if (activeId === modelId) delete this.state.activeByCapability[capability as ModelCapability]
    }
  }

  find(modelId: string): ModelDescriptor | undefined {
    return this.state.catalog.models.find((model) => model.id === modelId && model.enabled)
  }

  recommend(capability: ModelCapability, ramGB?: number): ModelDescriptor[] {
    return this.state.catalog.models
      .filter((model) => model.enabled && model.capabilities.includes(capability))
      .filter((model) => ramGB === undefined || model.minRamGB <= ramGB)
      .sort((a, b) => Number(this.state.installed.has(b.id)) - Number(this.state.installed.has(a.id)) || a.minRamGB - b.minRamGB)
  }

  setActive(capability: ModelCapability, modelId: string): boolean {
    const model = this.find(modelId)
    if (!model || !model.capabilities.includes(capability)) return false
    this.state.activeByCapability[capability] = modelId
    return true
  }

  active(capability: ModelCapability): ModelDescriptor | undefined {
    const id = this.state.activeByCapability[capability]
    return id ? this.find(id) : undefined
  }
}
