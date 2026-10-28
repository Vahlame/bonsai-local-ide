---
license: mit
library_name: gguf
pipeline_tag: text-generation
base_model_relation: quantized
quantized_by: antirez
base_model:
- deepseek-ai/DeepSeek-V4-Flash-0731
tags:
- abliterated
- uncensored
- GGUF
- huihui
- quantized
- deepseek
- deepseek-v4
- deepseek-v4-flash-0731
- moe
- mixture-of-experts
- 2-bit
- 4-bit
- iq2_xxs
- q2_k
- q4_k
- ds4
- apple-silicon
- metal
- unsloth
extra_gated_prompt: >-
  **Usage Warnings**


  “**Risk of Sensitive or Controversial Outputs**“: This model’s safety
  filtering has been significantly reduced, potentially generating sensitive,
  controversial, or inappropriate content. Users should exercise caution and
  rigorously review generated outputs.

  “**Not Suitable for All Audiences**:“ Due to limited content filtering, the
  model’s outputs may be inappropriate for public settings, underage users, or
  applications requiring high security.

  “**Legal and Ethical Responsibilities**“: Users must ensure their usage
  complies with local laws and ethical standards. Generated content may carry
  legal or ethical risks, and users are solely responsible for any consequences.

  “**Research and Experimental Use**“: It is recommended to use this model for
  research, testing, or controlled environments, avoiding direct use in
  production or public-facing commercial applications.

  “**Monitoring and Review Recommendations**“: Users are strongly advised to
  monitor model outputs in real-time and conduct manual reviews when necessary
  to prevent the dissemination of inappropriate content.

  “**No Default Safety Guarantees**“: Unlike standard models, this model has not
  undergone rigorous safety optimization. huihui.ai bears no responsibility for
  any consequences arising from its use.
---

# huihui-ai/Huihui-DeepSeek-V4-Flash-0731-abliterated-GGUF

This is an uncensored version of [deepseek-ai/DeepSeek-V4-Flash-0731](https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash-0731) created with abliteration (see [remove-refusals-with-transformers](https://github.com/Sumandora/remove-refusals-with-transformers) to know more about it).
This is a crude, proof-of-concept implementation to remove refusals from an LLM model without using TransformerLens. 

**Note** These GGUFs support llama.cpp and ds4 and all expert modules were not ablated.

Q4 used a stronger ablation intensity than Q2, so the rejection rate was smaller.

## GGUF Files
The GGUF Files comes from [antirez/deepseek-v4-gguf](https://huggingface.co/antirez/deepseek-v4-gguf)


## llama.cpp
Use the latest [llama.cpp](https://github.com/ggml-org/llama.cpp),
```
llama-cli -m huihui-ai/Huihui-DeepSeek-V4-Flash-0731-abliterated-GGUF/DeepSeek-V4-Flash-Q2-0731.gguf -c 262144
```

## DSpark

We added two types of DSpark files: one for pre-ablation and one for post-ablation. The files are sourced from [unsloth/DeepSeek-V4-Flash-0731-GGUF/dspark](https://huggingface.co/unsloth/DeepSeek-V4-Flash-0731-GGUF/tree/main/dspark).

Use the latest [llama.cpp](https://github.com/ggml-org/llama.cpp),

[dspark](https://huggingface.co/huihui-ai/Huihui-DeepSeek-V4-Flash-0731-abliterated-GGUF/tree/main/dspark)

[dspark-abliterated](https://huggingface.co/huihui-ai/Huihui-DeepSeek-V4-Flash-0731-abliterated-GGUF/tree/main/dspark-abliterated)

## ds4
Use the latest [ds4](https://github.com/antirez/ds4/tree/ds4f-mxfp4),
### single-GPU
```
export CUDA_VISIBLE_DEVICES=0
./ds4 -m huihui-ai/Huihui-DeepSeek-V4-Flash-0731-abliterated-GGUF/DeepSeek-V4-Flash-Q2-0731.gguf --ctx 32768
```
### multi-GPU

```
export CUDA_VISIBLE_DEVICES=0,1
./ds4 -m huihui-ai/Huihui-DeepSeek-V4-Flash-0731-abliterated-GGUF/DeepSeek-V4-Flash-Q2_K-0731.gguf --gpu-devices 0,1 --ctx 32768
```


## Usage Warnings


 - **Risk of Sensitive or Controversial Outputs**: This model’s safety filtering has been significantly reduced, potentially generating sensitive, controversial, or inappropriate content. Users should exercise caution and rigorously review generated outputs.

 - **Not Suitable for All Audiences**: Due to limited content filtering, the model’s outputs may be inappropriate for public settings, underage users, or applications requiring high security.

 - **Legal and Ethical Responsibilities**: Users must ensure their usage complies with local laws and ethical standards. Generated content may carry legal or ethical risks, and users are solely responsible for any consequences.

 - **Research and Experimental Use**: It is recommended to use this model for research, testing, or controlled environments, avoiding direct use in production or public-facing commercial applications.

 - **Monitoring and Review Recommendations**: Users are strongly advised to monitor model outputs in real-time and conduct manual reviews when necessary to prevent the dissemination of inappropriate content.

 - **No Default Safety Guarantees**: Unlike standard models, this model has not undergone rigorous safety optimization. huihui.ai bears no responsibility for any consequences arising from its use.


## Donation

If you like it, please click 'like' and follow us for more updates.  
You can follow [x.com/support_huihui](https://x.com/support_huihui) to get the latest model information from huihui.ai.

### Your donation helps us continue our further development and improvement, a cup of coffee can do it.
- bitcoin（BTC):
```
  bc1qqnkhuchxw0zqjh2ku3lu4hq45hc6gy84uk70ge
```
- Support our work on Ko-fi (https://ko-fi.com/huihuiai)!