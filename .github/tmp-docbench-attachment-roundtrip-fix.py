from pathlib import Path

path = Path.cwd() / "docbench/public/pdf-core.mjs"
text = path.read_text(encoding="utf-8")
old_attribute = 'new RegExp(`${escaped}:${local}\\s*=\\s*["\']([^"\']+)["\']`, "i")'
new_attribute = 'new RegExp(String.raw`${escaped}:${local}\\s*=\\s*["\']([^"\']+)["\']`, "i")'
old_element = 'new RegExp(`<${escaped}:${local}\\b[^>]*>\\s*([^<]+?)\\s*</${escaped}:${local}\\s*>`, "i")'
new_element = 'new RegExp(String.raw`<${escaped}:${local}\\b[^>]*>\\s*([^<]+?)\\s*</${escaped}:${local}\\s*>`, "i")'
if old_attribute not in text or old_element not in text:
    raise SystemExit("generated PDF/A parser pattern not found")
text = text.replace(old_attribute, new_attribute, 1)
text = text.replace(old_element, new_element, 1)
path.write_text(text, encoding="utf-8", newline="\n")
print("attachment PDF/A parser regex fixed")
