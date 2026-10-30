#!/usr/bin/env python3
import json

# Read the current modelo.json
with open('chat/modelo.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# The official chat template from Hugging Face for Ornith 1.5 9B
chat_template = """{%- set image_count = namespace(value=0) %}
{%- set video_count = namespace(value=0) %}
{%- macro render_content(content, do_vision_count, is_system_content=false) %}
    {%- if content is string %}
        {{- content }}
    {%- elif content is iterable and content is not mapping %}
        {%- for item in content %}
            {%- if 'image' in item or 'image_url' in item or item.type == 'image' %}
                {%- if is_system_content %}
                    {{- raise_exception('System message cannot contain images.') }}
                {%- endif %}
                {%- if do_vision_count %}
                    {%- set image_count.value = image_count.value + 1 %}
                {%- endif %}
                {%- if add_vision_id %}
                    {{- 'Picture ' ~ image_count.value ~ ': ' }}
                {%- endif %}
                {{- '<|vision_start|><|image_pad|><|vision_end|>' }}
            {%- elif 'video' in item or item.type == 'video' %}
                {%- if is_system_content %}
                    {{- raise_exception('System message cannot contain videos.') }}
                {%- endif %}
                {%- if do_vision_count %}
                    {%- set video_count.value = video_count.value + 1 %}
                {%- endif %}
                {%- if add_vision_id %}
                    {{- 'Video ' ~ video_count.value ~ ': ' }}
                {%- endif %}
                {{- '<|vision_start|><|video_pad|><|vision_end|>' }}
            {%- elif 'text' in item %}
                {{- item.text }}
            {%- else %}
                {{- raise_exception('Unexpected item type in content.') }}
            {%- endif %}
        {%- endfor %}
    {%- elif content is none or content is undefined %}
        {{- '' }}
    {%- else %}
        {{- raise_exception('Unexpected content type.') }}
    {%- endif %}
{%- endmacro %}
{%- if not messages %}
    {{- raise_exception('No messages provided.') }}
{%- endif %}
{%- set num_sys = 0 %}
{%- set merged_system = '' %}
{%- if messages[0].role == 'system' or messages[0].role == 'developer' %}
    {%- set first = render_content(messages[0].content, false, true)|trim %}
    {%- if messages|length > 1 and (messages[1].role == 'system' or messages[1].role == 'developer') %}
        {%- set second = render_content(messages[1].content, false, true)|trim %}
        {%- set merged_system = first + '\n' + second %}
        {%- set num_sys = 2 %}
    {%- else %}
        {%- set merged_system = first %}
        {%- set num_sys = 1 %}
    {%- endif %}
{%- endif %}
{%- if tools and tools is iterable and tools is not mapping %}
    {{- '##system\n' }}
    {{- '# Tools\n\nYou have access to the following functions:\n\n<tools>' }}
    {%- for tool in tools %}
        {{- '\n' }}
        {{- tool | tojson }}
    {%- endfor %}
    {{- '\n</tools>' }}
    {{- '\n\nIf you choose to call a function ONLY reply in the following format with NO suffix:\n\n<|tool_call_begin|><function=example_function_name><parameter=example_parameter_1>value_1