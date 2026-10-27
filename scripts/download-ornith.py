"""Download the pinned official GGUF, resume ranges and verify its published SHA256."""
import concurrent.futures
import argparse
import hashlib
import json
import pathlib
import shutil
import threading
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--vision", action="store_true", help="download the matching official BF16 vision projector")
args = parser.parse_args()
NAME = "mmproj-Ornith-1.5-9B-BF16.gguf" if args.vision else "Ornith-1.5-9B-Q4_K_M.gguf"
URL = "https://huggingface.co/ornith-ai/Ornith-1.5-9B-GGUF/resolve/abdd624b12ebf020b767fff532ff44fe552b28c3/" + NAME
SIZE = 5780090816
SHA = "70c112196e0b7023803c9762752e46d29e612a92c83f995bc3ba1ceb07e8fab6"
if args.vision:
    SIZE = 921704672
    SHA = "626f9f90627402a6bf4a999111d0fbd69b5fcca7aa8ba089d69e5f10e8858e1d"
TARGET = ROOT / "models" / NAME
if TARGET.exists():
    with TARGET.open("rb") as existing:
        installed_sha = hashlib.file_digest(existing, "sha256").hexdigest()
    if TARGET.stat().st_size == SIZE and installed_sha == SHA:
        print(f"Already installed and verified: {TARGET}", flush=True)
        raise SystemExit(0)
    raise RuntimeError(f"An unverified file already exists: {TARGET}; inspect it before replacing it")
PART = TARGET.with_suffix(".gguf.part")
CHUNKS = TARGET.with_suffix(".gguf.ranges")
CHUNKS.mkdir(exist_ok=True)
MANIFEST = CHUNKS / "manifest.json"
if not PART.exists():
    PART.touch()
if not MANIFEST.exists():
    MANIFEST.write_text(json.dumps({"prefix": PART.stat().st_size}), encoding="utf-8")
PREFIX = json.loads(MANIFEST.read_text(encoding="utf-8"))["prefix"]
BLOCK = 64 * 1024 * 1024
RANGES = [(start, min(start + BLOCK, SIZE) - 1) for start in range(PREFIX, SIZE, BLOCK)]
lock = threading.Lock()
progress = [PREFIX]
started = time.monotonic()


def fetch(bounds):
    start, end = bounds
    chunk = CHUNKS / str(start)
    have = chunk.stat().st_size if chunk.exists() else 0
    with lock:
        progress[0] += have
    for attempt in range(6):
        if have == end - start + 1:
            return chunk
        try:
            # The range must participate in the cache key: some CDNs cache a 206
            # response without varying on the Range header.
            req = urllib.request.Request(URL + f"?download=true&range={start + have}-{end}",
                                         headers={"Range": f"bytes={start + have}-{end}", "User-Agent": "Bonsai-model-installer"})
            with urllib.request.urlopen(req, timeout=90) as response:
                if response.status != 206 or not response.headers.get("Content-Range", "").startswith(f"bytes {start + have}-"):
                    raise RuntimeError("Server did not honor the requested byte range")
                with chunk.open("ab") as output:
                    while data := response.read(min(256 * 1024, end - start + 1 - have)):
                        output.write(data)
                        have += len(data)
                        with lock:
                            progress[0] += len(data)
                        if have == end - start + 1:
                            return chunk
            raise RuntimeError("Incomplete range response")
        except Exception as error:
            if attempt == 5:
                raise
            print(f"Retry range {start}: {error}", flush=True)
            time.sleep(min(2 ** attempt, 15))


with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    futures = [pool.submit(fetch, item) for item in RANGES]
    while not all(future.done() for future in futures):
        done = progress[0]
        print(f"Downloaded {done / SIZE:.1%}: {done // 1048576}/{SIZE // 1048576} MiB; {(done - PREFIX) / max(1, time.monotonic() - started) / 1048576:.1f} MiB/s", flush=True)
        concurrent.futures.wait(futures, timeout=10)
        for future in futures:
            if future.done():
                future.result()
    paths = [future.result() for future in futures]

print("Assembling and verifying SHA256...", flush=True)
# Truncate any interrupted assembly back to the known initial contiguous prefix.
with PART.open("r+b") as output:
    output.truncate(PREFIX)
    output.seek(PREFIX)
    for chunk in paths:
        with chunk.open("rb") as source:
            shutil.copyfileobj(source, output, 8 * 1024 * 1024)
with PART.open("rb") as downloaded:
    digest = hashlib.file_digest(downloaded, "sha256").hexdigest()
if PART.stat().st_size != SIZE or digest != SHA:
    raise RuntimeError(f"GGUF verification FAILED: {PART.stat().st_size} bytes, SHA256 {digest}")
PART.replace(TARGET)
for chunk in paths:
    chunk.unlink()
MANIFEST.unlink()
CHUNKS.rmdir()
print(f"Verified: {TARGET}\n{SIZE} bytes\nSHA256 {digest}", flush=True)
