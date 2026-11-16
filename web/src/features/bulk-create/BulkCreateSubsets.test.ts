import { cleanup, render, screen } from '@testing-library/vue'
import { createI18n } from 'vue-i18n'
import { afterEach, expect, it } from 'vitest'
import { messages } from '@/app/i18n'
import { componentStubs } from '@/test/component-stubs'
import BulkCreateCsvHelp from './BulkCreateCsvHelp.vue'

afterEach(cleanup)
// Omitting either paragraph would hide changed defaults or the original authorization boundary.
it.each(['zh-CN', 'en'] as const)('explains sparse defaults and unchanged permissions in %s help', locale => {
  render(BulkCreateCsvHelp, { global: { plugins: [createI18n({ legacy: false, locale, messages })], stubs: componentStubs } })
  const help = screen.getByTestId('bulk-create-csv-help')
  expect(help.textContent).toMatch(locale === 'zh-CN' ? /必须包含唯一的 target_url，其他七个标准列可任选/ : /exactly one target_url.*other seven standard columns are optional/)
  expect(help.textContent).toMatch(locale === 'zh-CN' ? /省略的标题和短码为空、标签为 \[\]/ : /Omitted titles and codes are empty; tags default to \[\]/)
  expect(help.textContent).toMatch(locale === 'zh-CN' ? /非空倒计时必须显式提供 intermediate/ : /A nonempty countdown requires explicit intermediate/)
  expect(help.textContent).toMatch(locale === 'zh-CN' ? /省列不减少原格式的权限要求/ : /Omitting columns does not reduce the original format permissions/)
  expect(help.textContent).toMatch(locale === 'zh-CN' ? /短码或更后字段的格式仍需自定义短码权限，即使短码为空/ : /Formats with codes or later fields still require custom-code permission, even with an empty code/)
  expect(help.querySelectorAll('pre code')).toHaveLength(8)
})
