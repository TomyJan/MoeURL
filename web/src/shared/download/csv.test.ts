import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadCsv } from './csv'

const descriptor = { fileName: 'test.csv', contentType: 'text/csv;charset=utf-8' as const, content: '\uFEFFsection,key,value,visit_count\r\n' }
beforeEach(() => {
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('CSV download', () => {
  it('clicks an attached anchor with the exact UTF-8 content and removes all temporary resources', () => {
    const blob = vi.spyOn(globalThis, 'Blob')
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.isConnected).toBe(true)
      expect(this.download).toBe('test.csv')
      expect(this.href).toBe('blob:test')
    })
    downloadCsv(descriptor)
    expect(blob).toHaveBeenCalledWith([descriptor.content], { type: descriptor.contentType })
    expect(click).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:test')
    expect(document.querySelector('a[download]')).toBeNull()
  })
  it.each(['click', 'append'])('cleans up and propagates a browser %s failure', (stage) => {
    const failure = new Error('browser refused')
    if (stage === 'click') vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw failure })
    else vi.spyOn(document.body, 'appendChild').mockImplementation(() => { throw failure })
    expect(() => downloadCsv(descriptor)).toThrow(failure)
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:test')
    expect(document.querySelector('a[download]')).toBeNull()
  })
  it('does not leak a temporary anchor when URL creation fails', () => {
    vi.mocked(URL.createObjectURL).mockImplementation(() => { throw new Error('URL unavailable') })
    expect(() => downloadCsv(descriptor)).toThrow('URL unavailable')
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    expect(document.querySelector('a[download]')).toBeNull()
  })
})
