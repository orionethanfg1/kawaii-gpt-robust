/// <reference types="vite/client" />

import type { HardwareProfile, KawaiiAPI } from '../../preload/index'

declare global {
  interface Window {
    kawaii: KawaiiAPI
  }
  type RendererHardwareProfile = HardwareProfile
}

export {}
