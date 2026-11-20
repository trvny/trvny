// Language comes from publication metadata; never infer from the title.
export function publicationLang(value) {
  if (typeof value !== "string" || !/^[a-z]{2,3}(?:-[a-zA-Z]{2,8}|-\\d{3})*$/u.test(value)) return "und";
  return value;
}
