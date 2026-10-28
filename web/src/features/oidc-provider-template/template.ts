export type ProviderTemplateID = 'manual' | 'google'
export interface ProviderTemplateFields { key: string; displayName: string; issuerUrl: string; enabled: boolean }

/** Builds a fresh credential-free creation draft without changing any saved provider. */
export function buildProviderTemplate(id: ProviderTemplateID): ProviderTemplateFields {
  if (id === 'manual') return { key: '', displayName: '', issuerUrl: '', enabled: true }
  return { key: 'google', displayName: 'Google', issuerUrl: 'https://accounts.google.com', enabled: false }
}
