#!/usr/bin/env python3
"""
Add the official Ornith 1.5 9B chat template to modelo.json using json.dump()
to properly escape control characters, newlines, quotes, and Jinja2 syntax.
"""

import json

# Read template from file (raw, no escaping needed)
with open('scripts/chat_template_ornith.txt', 'r', encoding='utf-8') as f:
    chat_template = f.read()

# Load modelo.json, add template, write back with json.dump()
with open('chat/modelo.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

data['catalogo']['ornith9b']['chat_template'] = chat_template

with open('chat/modelo.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print("[OK] Chat template added to modelo.json successfully")
print(f"   Template length: {len(chat_template)} characters")