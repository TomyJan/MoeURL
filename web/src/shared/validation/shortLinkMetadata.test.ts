import { describe, expect, it } from 'vitest'
import { metadataDraftSchema, shortLinkMetadataSchema, shortLinkKeywordSchema, shortLinkTagFilterSchema, trimGoSpace } from './shortLinkMetadata'

describe('short-link metadata Unicode contract', () => {
  it('trims exactly Go Unicode whitespace, including NEL but preserving BOM', () => {
    const whitespace = '\u0009\u000a\u000b\u000c\u000d \u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000'
    expect(trimGoSpace(`${whitespace}文 档${whitespace}`)).toBe('文 档')
    expect(trimGoSpace('\ufeff文档\ufeff')).toBe('\ufeff文档\ufeff')
    expect(shortLinkMetadataSchema.parse({ title: '\u0085 文档 \u3000', tags: [' 团队 资料 ', 'Release', 'release'] })).toEqual({ title: '文档', tags: ['团队 资料', 'Release', 'release'] })
  })

  it('counts Unicode code points at the exact title, tag and tag-count boundaries', () => {
    const tags = ['😀'.repeat(32), ...Array.from({ length: 9 }, (_, i) => `标签${i}`)]
    expect(shortLinkMetadataSchema.safeParse({ title: '😀'.repeat(120), tags }).success).toBe(true)
    expect(shortLinkMetadataSchema.safeParse({ title: '😀'.repeat(121), tags: [] }).success).toBe(false)
    expect(shortLinkMetadataSchema.safeParse({ title: '', tags: ['😀'.repeat(33)] }).success).toBe(false)
    expect(shortLinkMetadataSchema.safeParse({ title: '', tags: [...tags, 'Eleventh'] }).success).toBe(false)
    expect(shortLinkMetadataSchema.safeParse({ title: '\ufeff' + 'a'.repeat(120), tags: [] }).success).toBe(false)
  })

  it.each([
    { title: 'bad\u0000title', tags: [] },
    { title: 'a\u0085b', tags: [] },
    { title: '', tags: ['a\u007fb'] },
    { title: '', tags: ['a\u009fb'] },
    { title: '', tags: [' \u3000 '] },
    { title: '', tags: ['a', ' a '] },
    { title: '', tags: null },
  ])('rejects invalid metadata %j', (metadata) => {
    expect(shortLinkMetadataSchema.safeParse(metadata).success).toBe(false)
  })

  it('parses one tag per line while preserving internal spaces and explicit clear', () => {
    expect(metadataDraftSchema.parse({ title: ' 文档 ', tagsText: ' 中文 标签 \r\nRelease 计划' })).toEqual({ title: '文档', tags: ['中文 标签', 'Release 计划'] })
    expect(metadataDraftSchema.parse({ title: '', tagsText: ' \u3000 ' })).toEqual({ title: '', tags: [] })
    expect(metadataDraftSchema.safeParse({ title: '', tagsText: 'A\n\nB' }).success).toBe(false)
  })

  it('validates keyword and exact tag boundaries after trimming without changing LIKE literals', () => {
    expect(shortLinkKeywordSchema.parse(' %_\\ ')).toBe('%_\\')
    expect(shortLinkKeywordSchema.safeParse('😀'.repeat(200)).success).toBe(true)
    expect(shortLinkKeywordSchema.safeParse('😀'.repeat(201)).success).toBe(false)
    expect(shortLinkTagFilterSchema.safeParse('😀'.repeat(32)).success).toBe(true)
    expect(shortLinkTagFilterSchema.safeParse('😀'.repeat(33)).success).toBe(false)
    expect(shortLinkTagFilterSchema.parse('\u0085Release 计划\u3000')).toBe('Release 计划')
    expect(shortLinkKeywordSchema.safeParse('bad\u0000q').success).toBe(false)
    expect(shortLinkTagFilterSchema.safeParse('a\nb').success).toBe(false)
  })
})
