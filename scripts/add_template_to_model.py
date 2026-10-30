#!/usr/bin/env python3
import json

# Read the chat template from file
with open('scripts/chat_template_ornith.txt', 'r', encoding='utf-8') as f:
    chat_template = f.read()

# Read the current modelo.json
with open('chat/modelo.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# Add the chat template to the ornith9b model
data['catalogo']['ornith9b']['chat_template'] = chat_template

# Write back
with open('chat/modelo.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print("Chat template added successfully!")
print(f"Template length: {len(chat_template)} characters")