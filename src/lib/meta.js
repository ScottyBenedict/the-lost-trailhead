export const SITE_NAME = 'The Lost Trailhead'

// First sentence of a hike description. Splits on sentence-ending
// punctuation followed by a capital, skipping abbreviations like "Mt." so
// "Mt. Si" doesn't end a sentence.
export function firstSentence(text) {
  const re = /[.!?](?=\s+["'“A-Z])/g
  let m
  while ((m = re.exec(text))) {
    const before = text.slice(0, m.index)
    if (/\b(Mt|St|Ft|Mr|Mrs|Dr|vs)$/.test(before)) continue
    return text.slice(0, m.index + 1)
  }
  return text
}
