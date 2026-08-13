export const normalizeCelebrityName = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')

export function selectCelebrityMatch(matches, name, dob) {
  const normalized = normalizeCelebrityName(name)
  const exact = (matches ?? []).filter(item => item.normalized_name === normalized)
  return exact.find(item => item.date_of_birth === dob) ?? (exact.length === 1 ? exact[0] : null)
}

export function hasCelebrityImage(celebrity) {
  return celebrity?.image_kind === 'storage' ? Boolean(celebrity.image_path) : celebrity?.image_kind === 'external' ? /^https:\/\//.test(celebrity.external_image_url ?? '') : false
}

export function shouldTryWikipedia(celebrity, attemptedLocally = false) {
  return Boolean(celebrity && !hasCelebrityImage(celebrity) && !celebrity.wikipedia_checked_at && !attemptedLocally)
}

export function applyCelebrityRecord(target, record, publicStorageUrl) {
  target.id = record.id
  target.name = record.display_name
  target.dob = record.date_of_birth
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
