import { describe, expect, it } from 'vitest'
import corpus from '../../../../testdata/short-link-note.json'
import { shortLinkNoteSchema } from './shortLinkNote'

describe('note scalar contract shared with Go', () => {
  for (const item of corpus) {
    // Raw invalid UTF-8 has no JS string representation; the real HTTP suite tests that byte case.
    if ('rawHex' in item) continue
    it(item.name, () => {
      const input = 'jsonString' in item ? JSON.parse(item.jsonString!) as string : item.input!.repeat(item.repeat ?? 1)
      const actual = shortLinkNoteSchema.safeParse(input)
      expect(actual.success).toBe(!item.invalid)
      if (!item.invalid) expect(actual.data).toBe(item.wantRepeat ? item.input!.repeat(item.wantRepeat) : item.want)
    })
  }
  it('rejects unpaired surrogates inside otherwise valid content', () => {
    expect(shortLinkNoteSchema.safeParse('hello\ud800world').success).toBe(false)
    expect(shortLinkNoteSchema.safeParse('hello\udfffworld').success).toBe(false)
  })
})
