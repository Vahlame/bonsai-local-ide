"""Inspect GGUF metadata without loading any tensors or using the GPU."""
import argparse
import hashlib
import json
import pathlib
import struct

parser = argparse.ArgumentParser()
parser.add_argument("path", type=pathlib.Path)
parser.add_argument("--template", type=pathlib.Path)
args = parser.parse_args()
with args.path.open("rb") as stream:
    def number(fmt):
        return struct.unpack("<" + fmt, stream.read(struct.calcsize(fmt)))[0]

    def string():
        return stream.read(number("Q")).decode("utf-8")

    formats = {0: "B", 1: "b", 2: "H", 3: "h", 4: "I", 5: "i", 6: "f", 7: "?", 10: "Q", 11: "q", 12: "d"}

    def value(kind):
        if kind == 8:
            return string()
        if kind == 9:
            element, count = number("I"), number("Q")
            for _ in range(count):
                value(element)
            return {"array_length": count}
        return number(formats[kind])

    if stream.read(4) != b"GGUF":
        raise ValueError("Not GGUF")
    version, tensors, pairs = number("I"), number("Q"), number("Q")
    metadata = {}
    template = ""
    for _ in range(pairs):
        key = string()
        item = value(number("I"))
        if key == "tokenizer.chat_template":
            template = item
        elif not key.startswith("tokenizer."):
            metadata[key] = item
    metadata.update({"gguf_version": version, "tensor_count": tensors, "header_bytes": stream.tell(), "template_sha256": hashlib.sha256(template.encode()).hexdigest()})
    if args.template:
        args.template.write_text(template, encoding="utf-8")
    print(json.dumps(metadata, indent=2, ensure_ascii=True))
