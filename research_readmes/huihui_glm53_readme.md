---
language:
- en
- zh
library_name: transformers
license: mit
pipeline_tag: image-text-to-text
base_model:
- zai-org/GLM-5.3-Flash
tags:
- abliterated
- uncensored
- huihui
- unsloth
- glm5_next
---

# huihui-ai/Huihui-GLM-5.3-Flash-abliterated-GGUF

This is an uncensored version of [zai-org/GLM-5.3-Flash](https://huggingface.co/zai-org/GLM-5.3-Flash) created with abliteration (see [remove-refusals-with-transformers](https://github.com/Sumandora/remove-refusals-with-transformers) to know more about it).
This is a crude, proof-of-concept implementation to remove refusals from an LLM model.

## Latest update
The latest version of [llama.cpp](https://github.com/ggml-org/llama.cpp/releases) now officially supports zai-org/GLM-5.3-Flash. 

We have updated the first file of each quantized version, so you only need to download the first file.

## Note
GGUFs come from [unsloth/GLM-5.3-Flash-GGUF](https://huggingface.co/unsloth/GLM-5.3-Flash-GGUF). 

Only layers **15 to 35 (0-based indexing)** have been ablated, while the other layers and all expert modules remain unablated. 

## llama.cpp
To run, please [unslothai llama.cpp PR](https://github.com/unslothai/llama.cpp/tree/glm5next/upstream),
```
llama-cli -m huihui-ai/Huihui-GLM-5.3-Flash-abliterated-GGUF/UD-Q4_K_XL/GLM-5.3-Flash-UD-Q4_K_XL-00001-of-00006.gguf -c 262144
```

### Usage Warnings


 - **Risk of Sensitive or Controversial Outputs**: This model’s safety filtering has been significantly reduced, potentially generating sensitive, controversial, or inappropriate content. Users should exercise caution and rigorously review generated outputs.

 - **Not Suitable for All Audiences**: Due to limited content filtering, the model’s outputs may be inappropriate for public settings, underage users, or applications requiring high security.

 - **Legal and Ethical Responsibilities**: Users must ensure their usage complies with local laws and ethical standards. Generated content may carry legal or ethical risks, and users are solely responsible for any consequences.

 - **Research and Experimental Use**: It is recommended to use this model for research, testing, or controlled environments, avoiding direct use in production or public-facing commercial applications.

 - **Monitoring and Review Recommendations**: Users are strongly advised to monitor model outputs in real-time and conduct manual reviews when necessary to prevent the dissemination of inappropriate content.

 - **No Default Safety Guarantees**: Unlike standard models, this model has not undergone rigorous safety optimization. huihui.ai bears no responsibility for any consequences arising from its use.


### Donation
##### Your donation helps us continue our further development and improvement, a cup of coffee can do it.
- bitcoin:
```
  bc1qqnkhuchxw0zqjh2ku3lu4hq45hc6gy84uk70ge
```
- Support our work on [Ko-fi](https://ko-fi.com/huihuiai)!

