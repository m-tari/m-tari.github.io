---
layout: post
title: Benchmarking Whisper serving for Phrasel
date: 2026-07-29 10:00:00-0400
description: Comparing HF Transformers, faster-whisper, vLLM, SGLang, and TensorRT-LLM for concurrent speech transcription.
tags: whisper, speech, benchmarking, vllm, tensorrt, phrasel
categories: writing
---

For [Phrasel](https://www.phrasel.com/), transcription is not a one-off script: learners speak, we need transcripts back quickly, and load is bursty. Running Whisper once on a GPU is easy. Serving it under concurrency, with predictable latency and acceptable quality, is a different problem.

I wanted a clear answer for which stack to use, so I built [open-speech-serve](https://github.com/m-tari/open-speech-serve): a small harness that benchmarks the same Whisper model across several serving paths and reports throughput, latency, and WER side by side.

## What I compared

All cells use `openai/whisper-large-v3-turbo` in FP16 on a single NVIDIA RTX 6000 Ada, with the same LibriSpeech-style audio manifest, English transcription, and text normalization. Concurrency levels were 1, 8, and 32. Metrics are medians across three passes after warmup.

The frameworks fall into two groups:

- **In-process baselines:** Hugging Face Transformers and faster-whisper. These run inside the client process with a serialized gate: concurrent arrivals are allowed, but only one call reaches inference at a time.
- **Serving engines:** vLLM, SGLang, and TensorRT-LLM behind Triton. These take concurrent HTTP/gRPC requests and can batch or schedule on the GPU.

Serialized vs concurrent is an important distinction. With serialization, end-to-end latency is mostly queue wait and throughput stays flat. With concurrent serving, client queue wait drops near zero and throughput scales until the GPU saturates.

I also added a streaming path that measures **TTFS** (time from client end-of-speech to the final transcript) over a WebSocket, which matters more for interactive product flows than pure offline batch RTF.

## Results

{% include figure.liquid path="assets/img/2026-07-29-whisper-serving-benchmark/gpu_sweep.png" class="img-fluid" zoomable=true alt="GPU sweep comparing throughput, latency, RTF, and WER across Whisper serving frameworks" %}

On this hardware, concurrent throughput ranks:

**TensorRT-LLM > vLLM ≫ SGLang (at c1/c8) > HF Transformers ≈ faster-whisper.**

A few numbers that stood out:

| framework | concurrency | throughput (× realtime) | e2e p95 (s) | WER |
| --- | ---: | ---: | ---: | ---: |
| faster-whisper | 8 | 28.5 | 3.719 | 0.023 |
| HF Transformers | 8 | 32.7 | 2.648 | 0.021 |
| SGLang | 8 | 68.4 | 1.288 | 0.021 |
| vLLM | 8 | 242.4 | 0.446 | 0.021 |
| TensorRT-LLM | 8 | 310.7 | 0.335 | 0.052 |

In-process baselines stay around **30× realtime** no matter how many clients wait in line. Engineered servers climb into the **250-310×** range before saturating. SGLang at concurrency 32 is invalid on this sweep (the experimental Whisper path timed out and the server killed itself under load), so I treat c1/c8 as informative and discard c32.

Quality is mostly aligned: HF, vLLM, and SGLang sit near **2.1% WER**, faster-whisper near **2.3%**. TensorRT-LLM is faster but lands around **5.2% WER** on this engine, likely due to different configuration settings.

## What I took away for Phrasel

1. **Single-request RTF is not serving capacity.** A fast in-process Whisper call can still collapse under concurrent product traffic because it processes each request individually rather than batching them together.

2. **vLLM and TensorRT-LLM both look like solid serving options.** On this box, vLLM reached ~250× realtime with WER matching the HF baseline, while TensorRT-LLM pushed higher throughput (~310×) with a higher WER on this engine/build. Both seem like good tools for the job.

3. **SGLang’s Whisper support struggled with high concurrency in these tests.** It’s suitable for experimentation but currently not robust enough for demanding production workloads.

4. **Prioritize the metrics that reflect user experience.** While offline throughput is crucial for handling large-scale batch jobs efficiently, the time-to-final-speech (TTFS) is much more relevant for interactive speaking exercises, where users are waiting for feedback in real time. By benchmarking both, the choices that are grounded in how responsive and natural the experience will feel to your end users, not just raw processing speed.

The full matrix, methodology, and reproduction steps live in the [open-speech-serve](https://github.com/m-tari/open-speech-serve) repo. If you are choosing a Whisper backend for a product rather than a demo notebook, concurrent load and WER together are the comparison that matters.
