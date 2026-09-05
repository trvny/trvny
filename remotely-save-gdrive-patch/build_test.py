"""Extract the (patched) Google Drive class from a real main.js and turn test_template.mjs
into a runnable, dependency-free test: `node <output.mjs>`.

Usage: python build_test.py <patched_main.js> <output.mjs>
"""
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from patch_gdrive import class_span  # noqa: E402


def main():
    plugin_path, out_path = sys.argv[1], sys.argv[2]
    s = open(plugin_path, encoding='utf-8').read()
    a, b = class_span(s)
    klass = s[a:b]

    template_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'test_template.mjs')
    template = open(template_path, encoding='utf-8').read()
    with io.open(out_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(template.replace('__KLASS__', klass))
    print(out_path)


if __name__ == '__main__':
    main()
