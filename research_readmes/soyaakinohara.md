---
license: apache-2.0
base_model:
- AEON-7/Qwen3.8-27B-AEON-ULTIMATE-UNCENSORED-BF16
language:
- ja
- en
- multilingual
library_name: gguf
pipeline_tag: text-generation
tags:
- gguf
- llama.cpp
- qwen3.8
- qwen3_5
- gated-deltanet
- hybrid-attention
- mtp
- abliterated
- uncensored
- quantized
- iq2_s
- iq3_s
- q4_k
- q5_k
- q6_k
- q8_0
---

# Qwen3.8-27B Abliterated 3.69bpw 12GB MTP GGUF

A **Ridge-style mixed-quantized GGUF** of the BF16
[AEON-7/Qwen3.8-27B-AEON-ULTIMATE-UNCENSORED-BF16](https://huggingface.co/AEON-7/Qwen3.8-27B-AEON-ULTIMATE-UNCENSORED-BF16)
model.

This model keeps the AEON-7 uncensored / refusal-removed weights, while using a
Gated-DeltaNet-aware mixed quantization layout inspired by
[empero-ai/Qwen3.8-27B-Ridge-GGUF](https://huggingface.co/empero-ai/Qwen3.8-27B-Ridge-GGUF).
The goal is to retain as much quality as possible in the sensitive Gated-DeltaNet
path while obtaining a small, fast GGUF suitable for local llama.cpp inference.

> **Important:** This is not an official Empero Ridge release and is not the
> same set of weights. It is an independent quantization of AEON-7 using a
> Ridge-inspired tensor-type map and an AEON-specific importance matrix.

---

## Files

```text
qwen3.8-27b-abliterated-3.69bpw-12GB-MTP.gguf
```

| Property | Value |
|---|---|
| Architecture | Qwen3.5 / Qwen3.8 hybrid Gated-DeltaNet + full attention |
| Parameters | 27B |
| Format | GGUF |
| Nominal quantization | 3.69 bpw |
| File size | 12,599,187,808 bytes (~11.73 GiB) |
| Context metadata | 262,144 tokens |
| MTP | Preserved in the GGUF; native `draft-mtp` supported |
| Vision | Text GGUF only; use a compatible mmproj if image support is required |
| License | Apache-2.0, inherited from the base model |

---

## Quantization layout

The quantization map is mixed rather than a flat IQ2 dump.

| GGML type | Tensor count | Main purpose |
|---|---:|---|
| `F32` | 360 | norms and scalar/state tensors |
| `Q4_K` | 144 | Gated-DeltaNet mixer/projection tensors |
| `Q8_0` | 96 | sensitive Gated-DeltaNet state path (`ssm_alpha` / `ssm_beta`) |
| `IQ2_S` | 160 | mid-stack FFN weights |
| `IQ3_S` | 32 | selected FFN weights kept at higher precision |
| `Q5_K` | 51 | full-attention Q/K/V tensors |
| `Q6_K` | 23 | output/embedding tensors, full-attention output, and MTP tensors |

The MTP tensors have no importance matrix and are kept at `Q6_K`, following the
important design choice documented by the Ridge project.

### Calibration

The AEON-specific importance matrix was generated locally from a calibration
corpus containing English WikiText, Japanese Wikipedia extracts, and llama.cpp
source code.

```text
context length: 512
batch size:     512
chunks:         80
process output: enabled
importance entries: 497
```

The calibration corpus and quantization map are not the private calibration
artifacts used by the original Ridge release. They are an independent local
reproduction of the same general quantization strategy.

---

## llama.cpp usage

The file name intentionally matches the repository name.

```bash
./llama-server \
  -m ./qwen3.8-27b-abliterated-3.69bpw-12GB-MTP.gguf \
  --spec-type draft-mtp \
  --spec-draft-n-max 3 \
  --split-mode layer \
  --tensor-split 2,1 \
  --host 0.0.0.0 \
  --port 8080 \
  -ctk q4_0 \
  -ctv q4_0 \
  -c 114514
```

For a local-only server, prefer binding to localhost instead:

```bash
--host 127.0.0.1
```

`--host 0.0.0.0` exposes the server to the network. Add your own
authentication, firewall, and access controls before exposing it beyond a
trusted LAN.

To disable thinking when using a compatible client, use the Qwen3.8 chat
options supported by your frontend or API client.

---

## Reported local performance

The model was prepared and tested on:

```text
OS:       Ubuntu 24.04
CPU:      Intel Core i7-10700K
GPU 0:    NVIDIA GeForce RTX 5060 Ti 16GB
GPU 1:    NVIDIA GeForce RTX 3070 8GB
RAM:      32GB
Runtime:  llama.cpp CUDA build
```

On this machine, the command above has reached a reported peak of **up to
approximately 37 tokens/second**. Actual speed depends on context length,
prompt length, sampling settings, MTP acceptance rate, CUDA/llama.cpp version,
background workload, and the amount of KV cache in use.

For this hardware, `--spec-draft-n-max 3` is recommended as a starting point.
Higher draft counts can add overhead rather than improve throughput.

---

## Provenance

### Base model

- [AEON-7/Qwen3.8-27B-AEON-ULTIMATE-UNCENSORED-BF16](https://huggingface.co/AEON-7/Qwen3.8-27B-AEON-ULTIMATE-UNCENSORED-BF16)
- Base revision used locally: `a6775a9a8ebb65cab3f707b4ab087fc7aa698634`
- Original upstream model: [Qwen/Qwen3.8-27B](https://huggingface.co/Qwen/Qwen3.8-27B)

AEON-7 is an abliterated BF16 derivative. Its model card describes an SSM
conv1d outlier-repair step, abliterix processing, a stock MTP head graft, and
an untouched vision tower. This GGUF quantizes the AEON-7 BF16 weights; it is
not a re-quantization of an already-quantized FP8 checkpoint.

### Quantization idea

The mixed quantization strategy was inspired by:

- [empero-ai/Qwen3.8-27B-Ridge-GGUF](https://huggingface.co/empero-ai/Qwen3.8-27B-Ridge-GGUF)
- [llama.cpp](https://github.com/ggml-org/llama.cpp)

The local conversion and quantization used llama.cpp commit
[`030ebb558`](https://github.com/ggml-org/llama.cpp/commit/030ebb558a5820b444a8f836ed5cdd46c9b4bd7a).

---

## AI assistance disclosure

The local model preparation workflow, conversion, calibration-data preparation,
quantization, validation, and this model card were performed with assistance
from **GPT-5.6-Luna via Hermes Agent**. The model was then reviewed and
published by the repository owner.

---

## Responsible use

This is an uncensored / refusal-removed model. It may produce content that an
aligned model would refuse, including unsafe, illegal, or harmful material.
It has no reliable built-in safety layer. Use appropriate access controls,
moderation, logging, and human review for any deployment, and comply with all
applicable laws and policies.

The model is provided as-is. Users are responsible for prompts, outputs, and
any downstream actions based on them.

---

## 日本語

### 概要

これは、
[AEON-7/Qwen3.8-27B-AEON-ULTIMATE-UNCENSORED-BF16](https://huggingface.co/AEON-7/Qwen3.8-27B-AEON-ULTIMATE-UNCENSORED-BF16)
をベースに、Gated-DeltaNetの特性を考慮したRidge式の混合量子化を適用した
GGUFモデルです。

無検閲・拒否除去済みのAEON-7の重みを維持しながら、
[empero-ai/Qwen3.8-27B-Ridge-GGUF](https://huggingface.co/empero-ai/Qwen3.8-27B-Ridge-GGUF)
で使われている考え方を参考に、GDNの壊れやすい経路へビットを優先配分しています。

これはEmpero公式のRidgeモデルではなく、AEON-7を独自に量子化した派生GGUFです。

### 基本仕様

```text
ファイル名: qwen3.8-27b-abliterated-3.69bpw-12GB-MTP.gguf
形式:       GGUF
サイズ:     12,599,187,808 bytes（約11.73 GiB）
量子化:     3.69 bpw
パラメータ: 27B
MTP:        GGUF内に保持、native draft-mtp対応
```

### 混合量子化の内訳

```text
F32    360 tensors  norm / state系
Q4_K   144 tensors  Gated-DeltaNet mixer系
Q8_0    96 tensors  ssm_alpha / ssm_beta
IQ2_S  160 tensors  中間層FFN
IQ3_S   32 tensors  高めの精度を残したFFN
Q5_K   51 tensors  通常AttentionのQ/K/V
Q6_K   23 tensors  output、embedding、Attention output、MTP
```

MTPテンソルにはimatrixを適用せず、`Q6_K`で保持しています。

AEON専用のimatrixは、以下を混ぜたcalibrationデータから作成しました。

- 英語WikiText
- 日本語Wikipedia
- llama.cppのC/C++/Pythonソースコード

```text
context: 512
batch:   512
chunks:  80
entries: 497
```

### llama.cppでの起動

```bash
./llama-server \
  -m ./qwen3.8-27b-abliterated-3.69bpw-12GB-MTP.gguf \
  --spec-type draft-mtp \
  --spec-draft-n-max 3 \
  --split-mode layer \
  --tensor-split 2,1 \
  --host 0.0.0.0 \
  --port 8080 \
  -ctk q4_0 \
  -ctv q4_0 \
  -c 114514
```

ローカルからのみ接続する場合は、`--host 127.0.0.1`を推奨します。
`0.0.0.0`はネットワーク上へ公開する設定なので、認証・Firewall・アクセス制御を
必ず追加してください。

### 作成・検証環境

```text
Ubuntu 24.04
Intel Core i7-10700K
RTX 5060 Ti 16GB + RTX 3070 8GB
RAM 32GB
llama.cpp CUDA build
```

上記の環境と起動設定で、最高約37 tokens/secondが報告されています。
実際の速度は、コンテキスト長、プロンプト長、KV cache、MTPの受理率、
llama.cppのバージョン、バックグラウンド負荷などで変化します。

### AI利用の開示

ローカルへのモデル取得、変換、calibrationデータ作成、imatrix作成、量子化、
動作確認、およびこのREADMEの作成は、**Hermes Agent経由のGPT-5.6-Luna**の
支援を受けて行われました。最終的な確認と公開はリポジトリ所有者が行っています。

### 利用上の注意

このモデルは無検閲・拒否除去済みです。通常のアライン済みモデルが拒否するような、
危険・違法・有害な内容を出力する可能性があります。信頼できる安全機構を内蔵して
いるとは考えないでください。

公開運用する場合は、アクセス制御、入力・出力フィルタ、監査ログ、レート制限、
人間による確認などを用途に応じて実装してください。利用者はプロンプト、出力、
出力を利用した downstream の行為について責任を負います。
