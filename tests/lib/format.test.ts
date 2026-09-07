import { describe, it, expect } from 'vitest'
import {
  congressGovBillUrl,
  congressLabel,
  displayUrl,
  errorMessage,
  formatBillId,
  formatMemberName,
  formatParty,
  formatResetsAt,
  formatVoteCast,
  formatVoteDate,
  isHttpUrl,
  isNonVotingRole,
  plainText,
  plainTextBlocks,
  telHref,
  truncate,
  voteTone,
} from '../../src/lib/format'

const NAME_PARTS = {
  firstName: 'Jane',
  middleName: null,
  lastName: 'Doe',
  nickname: null,
  suffix: null,
}

describe('formatMemberName', () => {
  it('joins the present name parts in order', () => {
    expect(
      formatMemberName({ ...NAME_PARTS, middleName: 'Q', suffix: 'Jr.' }),
    ).toBe('Jane Q Doe Jr.')
  })

  it('prefers the nickname over the first name when set', () => {
    expect(formatMemberName({ ...NAME_PARTS, nickname: 'Janie' })).toBe('Janie Doe')
  })

  it('falls back to firstName when nickname is an empty string, not just null', () => {
    expect(formatMemberName({ ...NAME_PARTS, nickname: '' })).toBe('Jane Doe')
  })

  it('returns an empty string when every part is missing', () => {
    expect(
      formatMemberName({
        firstName: null,
        middleName: null,
        lastName: null,
        nickname: null,
        suffix: null,
      }),
    ).toBe('')
  })
})

describe('errorMessage', () => {
  it('uses the message of an Error (e.g. CdServerError)', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
  })

  it('falls back to a generic message for a non-Error', () => {
    expect(errorMessage('nope')).toBe('Something went wrong. Please try again.')
    expect(errorMessage(undefined)).toBe('Something went wrong. Please try again.')
  })
})

describe('isHttpUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isHttpUrl('http://example.gov')).toBe(true)
    expect(isHttpUrl('https://example.gov/path')).toBe(true)
  })

  it('rejects non-http(s) schemes', () => {
    expect(isHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isHttpUrl('mailto:rep@example.gov')).toBe(false)
  })

  it('rejects strings that are not URLs', () => {
    expect(isHttpUrl('not a url')).toBe(false)
    expect(isHttpUrl('')).toBe(false)
  })
})

describe('isNonVotingRole', () => {
  it('is true for a Delegate and the Resident Commissioner', () => {
    expect(isNonVotingRole('Delegate')).toBe(true)
    expect(isNonVotingRole('Resident Commissioner')).toBe(true)
  })

  it('is false for a Senator or Representative', () => {
    expect(isNonVotingRole('Senator')).toBe(false)
    expect(isNonVotingRole('Representative')).toBe(false)
  })
})

describe('formatParty', () => {
  it('title-cases the SHOUTING party names cd-server relays', () => {
    expect(formatParty('DEMOCRATIC')).toBe('Democratic')
    expect(formatParty('REPUBLICAN')).toBe('Republican')
    expect(formatParty('INDEPENDENT')).toBe('Independent')
  })

  it('title-cases each word of a hyphenated or multi-word name', () => {
    expect(formatParty('DEMOCRATIC-FARMER-LABOR')).toBe('Democratic-Farmer-Labor')
  })

  it('leaves an already mixed-case value alone', () => {
    expect(formatParty('Democratic')).toBe('Democratic')
  })
})

describe('displayUrl', () => {
  it('drops the scheme and any trailing slash', () => {
    expect(displayUrl('https://ocasio-cortez.house.gov/')).toBe('ocasio-cortez.house.gov')
    expect(displayUrl('http://example.gov')).toBe('example.gov')
  })

  it('keeps a path but still trims a trailing slash', () => {
    expect(displayUrl('https://example.gov/members/smith/')).toBe('example.gov/members/smith')
  })
})

describe('telHref', () => {
  it('turns a formatted 10-digit US number into a +1 tel: URI', () => {
    expect(telHref('(202) 225-2523')).toBe('tel:+12022252523')
  })

  it('treats a leading 1 as the country code', () => {
    expect(telHref('1-800-555-0199')).toBe('tel:+18005550199')
  })

  it('passes through anything that is not 10 or 11 digits, digits only', () => {
    expect(telHref('202-225')).toBe('tel:202225')
  })
})

describe('congressLabel', () => {
  it('adds the ordinal suffix', () => {
    expect(congressLabel(119)).toBe('119th Congress')
    expect(congressLabel(101)).toBe('101st Congress')
    expect(congressLabel(122)).toBe('122nd Congress')
    expect(congressLabel(123)).toBe('123rd Congress')
    expect(congressLabel(113)).toBe('113th Congress')
  })
})

describe('formatBillId', () => {
  it('dots the uppercase, dot-less type cd-api sends', () => {
    expect(formatBillId('HR', 2056)).toBe('H.R. 2056')
    expect(formatBillId('S', 2)).toBe('S. 2')
    expect(formatBillId('HJRES', 14)).toBe('H.J.Res. 14')
  })

  it('falls back to "<type>. <n>" for an unknown type', () => {
    expect(formatBillId('XYZ', 9)).toBe('XYZ. 9')
  })
})

describe('congressGovBillUrl', () => {
  it('builds the canonical congress.gov bill URL', () => {
    expect(congressGovBillUrl(119, 'HR', 2056)).toBe(
      'https://www.congress.gov/bill/119th-congress/house-bill/2056',
    )
    expect(congressGovBillUrl(119, 'S', 2)).toBe(
      'https://www.congress.gov/bill/119th-congress/senate-bill/2',
    )
  })

  it('returns null for a bill type it has no path mapping for', () => {
    expect(congressGovBillUrl(119, 'XYZ', 1)).toBeNull()
  })
})

describe('voteTone / formatVoteCast', () => {
  it('maps the four vote_cast values', () => {
    expect([voteTone('YEA'), formatVoteCast('YEA')]).toEqual(['yea', 'Voted Yea'])
    expect([voteTone('NAY'), formatVoteCast('NAY')]).toEqual(['nay', 'Voted Nay'])
    expect([voteTone('PRESENT'), formatVoteCast('PRESENT')]).toEqual(['present', 'Voted Present'])
    expect([voteTone('NOT_VOTING'), formatVoteCast('NOT_VOTING')]).toEqual(['none', 'Did not vote'])
  })

  it('treats an unexpected value as "none" and shows it verbatim', () => {
    expect(voteTone('WEIRD')).toBe('none')
    expect(formatVoteCast('WEIRD')).toBe('WEIRD')
  })
})

describe('formatVoteDate', () => {
  it('formats an ISO date as a long US date', () => {
    expect(formatVoteDate('2025-06-12')).toBe('June 12, 2025')
  })

  it('returns the input unchanged when it is not a parseable date', () => {
    expect(formatVoteDate('nope')).toBe('nope')
  })
})

describe('plainText', () => {
  it('strips tags and collapses whitespace from CRS summary HTML', () => {
    expect(plainText('<p><strong>Foo Act</strong></p>\n<p>Does&nbsp;a thing.</p>')).toBe(
      'Foo Act Does a thing.',
    )
  })

  it('inserts a separator between adjacent block elements with no whitespace between the tags', () => {
    // textContent alone would glue these into "...ActThis section...".
    expect(
      plainText('<p><strong>Secure America Act</strong></p><p>This section funds border security.</p>'),
    ).toBe('Secure America Act This section funds border security.')
  })
})

describe('plainTextBlocks', () => {
  it('splits on <p> boundaries', () => {
    expect(plainTextBlocks('<p>One.</p><p>Two.</p>')).toEqual(['One.', 'Two.'])
  })

  it('splits on <li> boundaries inside a list, alongside surrounding <p>s', () => {
    expect(
      plainTextBlocks('<p>Intro.</p><ul><li>First.</li><li>Second.</li></ul>'),
    ).toEqual(['Intro.', 'First.', 'Second.'])
  })

  it('drops empty blocks', () => {
    expect(plainTextBlocks('<p></p><p>Real.</p><p>   </p>')).toEqual(['Real.'])
  })

  it('falls back to the whole body as one block when there is no block-level markup', () => {
    expect(plainTextBlocks('Just <strong>inline</strong> text.')).toEqual(['Just inline text.'])
  })

  it('returns an empty array for empty input', () => {
    expect(plainTextBlocks('')).toEqual([])
  })

  it('does not double-count a block nested inside another matched block', () => {
    expect(plainTextBlocks('<ul><li><p>Some point.</p></li></ul>')).toEqual(['Some point.'])
  })
})

describe('truncate', () => {
  it('leaves a short string alone', () => {
    expect(truncate('short', 10)).toBe('short')
  })

  it('cuts to length and appends an ellipsis', () => {
    expect(truncate('one two three four', 7)).toBe('one two…')
  })
})

describe('formatResetsAt', () => {
  const reset = '2026-09-07T00:00:00Z'

  it('shows a local time and a rough countdown', () => {
    const now = new Date('2026-09-06T18:00:00Z') // 6h before reset
    expect(formatResetsAt(reset, now)).toMatch(/\(in about 6 hours\)$/)
  })

  it('uses the singular for one hour', () => {
    const now = new Date('2026-09-06T23:00:00Z')
    expect(formatResetsAt(reset, now)).toMatch(/\(in about an hour\)$/)
  })

  it('says "soon" when the reset time has passed', () => {
    const now = new Date('2026-09-07T00:30:00Z')
    expect(formatResetsAt(reset, now)).toMatch(/\(soon\)$/)
  })

  it('returns the input unchanged for an unparseable value', () => {
    expect(formatResetsAt('not a date')).toBe('not a date')
  })
})
