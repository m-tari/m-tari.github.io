---
layout: post
title: Benchmarking Whisper serving for Phrasel
date: 2026-07-29 10:00:00-0400
description: Comparing HF Transformers, faster-whisper, vLLM, SGLang, and TensorRT-LLM for concurrent speech transcription.
tags: whisper, speech, benchmarking, vllm, tensorrt, phrasel
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

<div markdown="1">

| framework | concurrency | throughput (× realtime) | p95 (s) | WER |
| --- | ---: | ---: | ---: | ---: |
| faster-whisper | 8 | 28.5 | 3.719 | 0.023 |
| HF Transformers | 8 | 32.7 | 2.648 | 0.021 |
| SGLang | 8 | 68.4 | 1.288 | 0.021 |
| vLLM | 8 | 242.4 | 0.446 | 0.021 |
| TensorRT-LLM | 8 | 310.7 | 0.335 | 0.052 |

</div>

In-process baselines stay around **30× realtime** no matter how many clients wait in line. Engineered servers climb into the **250-310×** range before saturating. SGLang at concurrency 32 is invalid on this sweep (the experimental Whisper path timed out and the server killed itself under load), so I treat c1/c8 as informative and discard c32.

Quality is mostly aligned: HF, vLLM, and SGLang sit near **2.1% WER**, faster-whisper near **2.3%**. TensorRT-LLM is faster but lands around **5.2% WER** on this engine, likely due to different configuration settings.

## Why throughput plateaus

The interesting systems question is not only which stack is fastest at concurrency 8, but **why scaling slows from c8 to c32**.

A follow-up telemetry sweep on the same GPU (`nvidia-smi` during timed passes, N=205, 3 passes) makes the answer clear. TensorRT-LLM throughput flattens (~347→331× realtime) while mean GPU util sits at **90–97%**. vLLM still gains some headroom c8→c32 (~278→306×) as util rises **82%→93%**. Serialized HF stays ~32× throughput and ~40% mean util at every concurrency.

{% include figure.liquid path="assets/img/2026-07-29-whisper-serving-benchmark/gpu_util_vs_concurrency.png" class="img-fluid" zoomable=true alt="Throughput and mean GPU utilization versus concurrency for HF, vLLM, and TensorRT-LLM" %}

Memory residency also separates the stacks: HF ~2.5–3 GiB, TensorRT-LLM ~12 GiB, vLLM ~44 GiB (high `gpu-memory-utilization`). Full table and methodology are in [open-speech-serve](https://github.com/m-tari/open-speech-serve/blob/main/docs/RESULTS.md).

## What the GPU is doing

The same samples plotted **vs time** at concurrency 8 show the duty-cycle contrast: HF stays in a mid-util band under serialization; vLLM runs dense, high occupancy for the length of the timed window.

{% include figure.liquid path="assets/img/2026-07-29-whisper-serving-benchmark/gpu_util_vs_time_c8.png" class="img-fluid" zoomable=true alt="GPU util versus time at concurrency 8 for HF Transformers serialized and vLLM concurrent" %}

This is host-level occupancy sampling. When combined with the util versus concurrency curves, the results are sufficient to conclude that c8 is close to the inflection point—the "knee"—of the capacity curve on this box for TensorRT-LLM. At the same time, vLLM still realizes some additional throughput up to c32.

## What I took away for Phrasel

1. **Single-request RTF is not serving capacity.** A fast in-process Whisper call can still collapse under concurrent product traffic because it processes each request individually rather than batching them together.

2. **vLLM and TensorRT-LLM both look like solid serving options.** On this box, vLLM reached ~250× realtime with WER matching the HF baseline, while TensorRT-LLM pushed higher throughput (~310×) with a higher WER on this engine/build. Both seem like good tools for the job.

3. **Don’t max out concurrency just because you can.** Once the GPU is already busy, adding more parallel requests barely improves throughput and mostly makes the slow requests slower. Pick a concurrency level near where throughput stops climbing — that is the useful setting in production.

4. **SGLang’s Whisper support struggled with high concurrency in these tests.** It’s suitable for experimentation but currently not robust enough for demanding production workloads.

5. **Prioritize the metrics that reflect user experience.** Offline throughput matters for batch jobs; TTFS matters for interactive speaking exercises. Benchmark both so choices match how the product feels.

## What I want to experiment next

This writeup answers “which Whisper stack, and why does throughput stop scaling?” The natural follow-ups are the ones I’d run in a real serving engagement:

1. **Explain the TensorRT-LLM quality gap.** Same model and audio, but ~5% WER vs ~2% elsewhere. Dig into decode settings and engine build flags until the gap is either closed or clearly a real accuracy/speed tradeoff.

2. **Profile with Nsight Systems.** Move from `nvidia-smi` occupancy to CUDA timelines for HF vs vLLM vs TensorRT-LLM at the concurrency knee, to see where time goes (idle gaps, kernels, CPU overhead).

3. **Tune the operating point.** Sweep max batch / in-flight caps and plot latency vs throughput curves to turn “run near where throughput stops climbing” into specific server settings.

4. **Stretch the harness toward LLM serving.** Reuse the same loadgen and telemetry ideas on a small vLLM text model (TTFT, decode throughput, KV-cache pressure). I am curious how serving behavior compares when the workload is text decode rather than audio transcription.

5. **Multi-GPU and scheduled clusters.** Run the same benchmark across multiple GPUs under Kubernetes or Slurm, and measure how throughput and latency scale when replicas or tensor-parallel shards share the load.

The full matrix, methodology, and GPU telemetry reproduction steps live in the [open-speech-serve](https://github.com/m-tari/open-speech-serve) repo. If you are choosing a Whisper backend for a product rather than a demo notebook, concurrent load, quality, and device saturation together are the comparison that matters.
