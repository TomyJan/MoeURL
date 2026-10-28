import { expect, it } from 'vitest'
import { buildProviderTemplate } from './template'

it('builds the fixed Google creation fields without credentials', () => {
  expect(buildProviderTemplate('google')).toEqual({ key: 'google', displayName: 'Google', issuerUrl: 'https://accounts.google.com', enabled: false })
})

it('restores the pre-existing blank manual creation defaults', () => {
  expect(buildProviderTemplate('manual')).toEqual({ key: '', displayName: '', issuerUrl: '', enabled: true })
})

it('returns a fresh snapshot so edits to one creation cannot affect the next', () => {
  const first = buildProviderTemplate('google')
  first.issuerUrl = 'https://edited.example'
  first.enabled = true
  expect(buildProviderTemplate('google')).toEqual({ key: 'google', displayName: 'Google', issuerUrl: 'https://accounts.google.com', enabled: false })
})
