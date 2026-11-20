// Language comes from explicit publication metadata; never infer it from text.
export function publicationLang(value) {
  if (typeof value !== "string" || !/^[a-z]{2,3}(?:-|$)/i.test(value)) return "und";
  try {
    return Intl.getCanonicalLocales(value)[0] || "und";
  } catch {
    return "und";
  }
}
