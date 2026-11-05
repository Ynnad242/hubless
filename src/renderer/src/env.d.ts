import type { HublessApi } from '@shared/types'

declare global {
  interface Window {
    hubless: HublessApi
  }
}
