export const normalizeCelebrityName = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')

export function selectCelebrityMatch(matches, name, dob) {
  const normalized = normalizeCelebrityName(name)
  const exact = (matches ?? []).filter(item => item.normalized_name === normalized)
  if (dob) return exact.find(item => item.date_of_birth === dob) ?? null
  return exact.length === 1 ? exact[0] : null
}

export const isPlainCalendarDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '')

export function createNewCelebrityDraft() {
  return { name: 'New celebrity', dob: '', image: '', imageSource: '', imageSourceUrl: '' }
}

export function updateCelebrityDob(celebrity, value) {
  celebrity.dob = value
  return celebrity.dob
}

export function dobInputValue(celebrity) {
  return isPlainCalendarDate(celebrity?.dob) ? celebrity.dob : ''
}

export function lineupValidationError(celebrities) {
  if (!celebrities?.length) return 'Add at least one celebrity before syncing.'
  const missingName = celebrities.find(item => !item.name?.trim())
  if (missingName) return 'Every celebrity needs a name before syncing.'
  const missingDob = celebrities.find(item => !isPlainCalendarDate(item.dob))
  return missingDob ? `${missingDob.name.trim()} needs a valid date of birth before syncing.` : null
}

export function wikidataDobFromClaims(payload) {
  const claims = Object.values(payload?.claims?.P569 ?? {})
  const value = claims.find(claim => claim?.rank !== 'deprecated' && claim?.mainsnak?.datavalue?.value?.precision >= 11)?.mainsnak?.datavalue?.value
  const match = value?.time?.match(/^\+?(\d{4}-\d{2}-\d{2})T/)
  return match?.[1] ?? null
}

export function hasCelebrityImage(celebrity) {
  return celebrity?.image_kind === 'storage' ? Boolean(celebrity.image_path) : celebrity?.image_kind === 'external' ? /^https:\/\//.test(celebrity.external_image_url ?? '') : false
}

export function shouldTryWikipedia(celebrity, attemptedLocally = false) {
  return Boolean(celebrity && !hasCelebrityImage(celebrity) && !celebrity.wikipedia_checked_at && !attemptedLocally)
}

export function applyCelebrityRecord(target, record, publicStorageUrl, { preserveDob = false } = {}) {
  const currentDob = target.dob
  target.id = record.id
  target.name = record.display_name
  target.dob = preserveDob && currentDob ? currentDob : record.date_of_birth
  target.imageKind = record.image_kind
  target.imagePath = record.image_path
  target.imageSourceKind = record.image_source
  target.sourceReference = record.source_reference
  target.wikipediaCheckedAt = record.wikipedia_checked_at
  target.image = record.image_kind === 'storage' && record.image_path
    ? `${publicStorageUrl}/${record.image_path}`
    : record.external_image_url ?? ''
  target.libraryStatus = 'existing'
  return target
}
