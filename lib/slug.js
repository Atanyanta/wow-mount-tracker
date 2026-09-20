// Realm/character name -> Blizzard-style URL slug ("Area 52" -> "area-52",
// "Mal'Ganis" -> "malganis"). Shared by the collections API route and the
// external character-page links so both agree on the same slug.
export function toSlug(input) {
  return input.trim().toLowerCase().replace(/'/g, "").replace(/\s+/g, "-");
}
