import { describe, expect, it } from 'vitest'
import { matchCsvHeaderAliases, type CsvHeaderSelection } from './csv-header-aliases'

const empty: CsvHeaderSelection = Object.freeze({ target: null, title: null, tags: null, customSlug: null, redirectMode: null, expiration: null, visitLimit: null, countdown: null })
const allowed = Object.freeze({ title: true, tags: true, advanced: true })

describe('explicit CSV header alias matching', () => {
  it.each([
    ['target_url', 'target'], ['url', 'target'], ['网址', 'target'], ['目标网址', 'target'],
    ['title', 'title'], ['标题', 'title'], ['tags', 'tags'], ['标签', 'tags'],
    ['custom_slug', 'customSlug'], ['slug', 'customSlug'], ['自定义短码', 'customSlug'], ['短码', 'customSlug'],
    ['redirect_mode', 'redirectMode'], ['跳转方式', 'redirectMode'],
    ['expires_at', 'expiration'], ['过期时间', 'expiration'], ['max_visits', 'visitLimit'], ['最大访问次数', 'visitLimit'],
    ['intermediate_delay_seconds', 'countdown'], ['倒计时', 'countdown'], ['中间页倒计时', 'countdown'],
  ])('maps the complete alias %s to %s without reading row data', (header, field) => {
    expect(matchCsvHeaderAliases(Object.freeze(['Private', header]), empty, allowed)).toEqual({ [field]: 1 })
  })

  it('normalizes only ASCII case and edge spaces/tabs', () => {
    expect(matchCsvHeaderAliases([' \tTaRgEt_Url\t ', '\tTITLE ', 'TAGS'], empty, allowed)).toEqual({ target: 0, title: 1, tags: 2 })
  })

  it.each(['', 'Address', 'URL backup', 'target url', 'target__url', 'ｕｒｌ', 'urK', '\u00a0url', 'url\u00a0', '\nurl', 'url\r', '\u200burl', 'ti tle', '__proto__', 'constructor'])('does not guess from %j', header => {
    expect(matchCsvHeaderAliases([header], empty, allowed)).toEqual({})
  })

  it.each([
    ['URL', 'target_url', 'title'], ['url', ' URL ', 'title'], ['title', '标题', 'url'],
  ])('leaves every ambiguous field empty for %j', (...headers) => {
    const result = matchCsvHeaderAliases(headers, empty, allowed)
    expect(result).toEqual(headers[0] === 'title' ? { target: 2 } : { title: 2 })
  })

  it('counts occupied candidates when detecting ambiguity and preserves every manual choice', () => {
    const selected = Object.freeze({ ...empty, title: 0, tags: 4, customSlug: 3 })
    expect(matchCsvHeaderAliases(Object.freeze(['url', 'target_url', 'title', 'slug', 'tags', 'max_visits']), selected, allowed)).toEqual({ visitLimit: 5 })
    expect(selected).toEqual({ target: null, title: 0, tags: 4, customSlug: 3, redirectMode: null, expiration: null, visitLimit: null, countdown: null })
  })

  it('does not reuse a uniquely matching column already selected for a different field', () => {
    expect(matchCsvHeaderAliases(['url', 'title', 'tags'], { ...empty, title: 0 }, allowed)).toEqual({ tags: 2 })
  })

  it('enforces title, tags and advanced permissions independently', () => {
    const headers = ['url', 'title', 'tags', 'slug', 'redirect_mode', 'expires_at', 'max_visits', '倒计时']
    expect(matchCsvHeaderAliases(headers, empty, { title: false, tags: false, advanced: false })).toEqual({ target: 0 })
    expect(matchCsvHeaderAliases(headers, empty, { title: false, tags: true, advanced: false })).toEqual({ target: 0, tags: 2 })
    expect(matchCsvHeaderAliases(headers, empty, { title: true, tags: false, advanced: true })).toEqual({ target: 0, title: 1, customSlug: 3, redirectMode: 4, expiration: 5, visitLimit: 6, countdown: 7 })
  })

  it('never releases a denied manual selection and has no additional matches after applying the result', () => {
    expect(matchCsvHeaderAliases(['url', 'title'], { ...empty, tags: 0 }, { ...allowed, tags: false })).toEqual({ title: 1 })
    const headers = Object.freeze(['Private', 'url', 'title'])
    const result = matchCsvHeaderAliases(headers, empty, allowed)
    expect(result).toEqual({ target: 1, title: 2 })
    expect(matchCsvHeaderAliases(headers, { ...empty, ...result }, allowed)).toEqual({})
    expect(headers).toEqual(['Private', 'url', 'title']); expect(empty.target).toBeNull()
  })
})
