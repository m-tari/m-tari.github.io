---
layout: post
title: Benchmarking Whisper serving for Phrasel
date: 2026-07-29 10:00:00-0400
description: Comparing HF Transformers, faster-whisper, vLLM, SGLang, and TensorRT-LLM for concurrent speech transcription.
tags: whisper, speech, benchmarking, vllm, tensorrt, phrasel
---

For [Phrasel](https://www.phrasel.com/), transcription is not a one-off script. Learners speak, we need transcripts back quickly, and the load comes in bursts. Running Whisper once on a GPU is easy; serving it under concurrency, with predictable latency and acceptable quality, is a different problem.

I wanted a clear answer for which stack to use, so I built [open-speech-serve](https://github.com/m-tari/open-speech-serve): a small harness that runs the same Whisper model across several serving paths and reports throughput, latency, and WER side by side.

## What I compared

Every cell uses `openai/whisper-large-v3-turbo` in FP16 on a single NVIDIA RTX 6000 Ada, against the same LibriSpeech-style audio manifest, with English transcription and the same text normalization. I swept concurrency at 1, 8, and 32, and report medians across three passes after warmup.

The frameworks fall into two groups:

- **In-process baselines:** Hugging Face Transformers and faster-whisper. These run inside the client process behind a serialized gate: concurrent arrivals are allowed, but only one call reaches inference at a time.
- **Serving engines:** vLLM, SGLang, and TensorRT-LLM behind Triton. These accept concurrent HTTP/gRPC requests and can batch or schedule work on the GPU.

That distinction matters. Under serialization, end-to-end latency is mostly queue wait and throughput stays flat no matter how many clients pile up. With concurrent serving, client queue wait drops near zero and throughput scales until the GPU saturates.

I also added a streaming path that measures **TTFS** (time from client end-of-speech to the final transcript) over a WebSocket. For interactive product flows, that number matters more than pure offline batch RTF.

## Results

{% include figure.liquid path="assets/img/2026-07-29-whisper-serving-benchmark/gpu_sweep.png" class="img-fluid" zoomable=true alt="GPU sweep comparing throughput, latency, RTF, and WER across Whisper serving frameworks" %}

On this hardware, concurrent throughput ranks roughly as TensorRT-LLM ahead of vLLM, then a clear gap down to SGLang (at least at concurrency 1 and 8), with HF Transformers and faster-whisper roughly tied at the bottom.

A representative slice at concurrency 8:

<div markdown="1">

| framework | concurrency | throughput (× realtime) | p95 (s) | WER |
| --- | ---: | ---: | ---: | ---: |
| faster-whisper | 8 | 28.5 | 3.719 | 0.023 |
| HF Transformers | 8 | 32.7 | 2.648 | 0.021 |
| SGLang | 8 | 68.4 | 1.288 | 0.021 |
| vLLM | 8 | 242.4 | 0.446 | 0.021 |
| TensorRT-LLM | 8 | 310.7 | 0.335 | 0.052 |

</div>

The in-process baselines hover around 30× realtime regardless of how many clients wait in line. The engineered servers climb into the mid-hundreds of realtime before saturating: vLLM around 240× and TensorRT-LLM a bit over 300× at concurrency 8. SGLang at concurrency 32 is invalid on this sweep: the experimental Whisper path timed out and the server killed itself under load, so I treat the lower concurrency points as informative and discard that cell.

Quality is mostly aligned. HF, vLLM, and SGLang all land near 2.1% WER, with faster-whisper a shade higher at about 2.3%. TensorRT-LLM is the speed leader here, but it pays for that with roughly 5.2% WER on this engine, likely from different configuration settings rather than a fundamental model gap.

## Why throughput plateaus

The interesting systems question is not only which stack is fastest at concurrency 8, but why scaling slows from 8 to 32.

A follow-up telemetry sweep on the same GPU (`nvidia-smi` sampled during timed passes, a few hundred samples across three runs) makes the answer fairly clear. TensorRT-LLM’s throughput flattens (roughly 347× down to 331× realtime) while mean GPU utilization sits in the 90–97% range. vLLM still finds a bit of headroom over the same span, climbing from about 278× to 306× as utilization rises from the low eighties into the low nineties. Serialized HF, by contrast, stays near 32× throughput and about 40% mean utilization at every concurrency level.

{% include figure.liquid path="assets/img/2026-07-29-whisper-serving-benchmark/gpu_util_vs_concurrency.png" class="img-fluid" zoomable=true alt="Throughput and mean GPU utilization versus concurrency for HF, vLLM, and TensorRT-LLM" %}

Memory residency also separates the stacks: HF sits around 2.5–3 GiB, TensorRT-LLM around 12 GiB, and vLLM around 44 GiB with a high `gpu-memory-utilization` setting. The full table and methodology are in [open-speech-serve](https://github.com/m-tari/open-speech-serve/blob/main/docs/RESULTS.md).

## What the GPU is doing

Plotting the same samples against time at concurrency 8 makes the duty-cycle contrast obvious. HF stays in a mid-utilization band under serialization, while vLLM runs dense, high occupancy for the length of the timed window.

{% include figure.liquid path="assets/img/2026-07-29-whisper-serving-benchmark/gpu_util_vs_time_c8.png" class="img-fluid" zoomable=true alt="GPU util versus time at concurrency 8 for HF Transformers serialized and vLLM concurrent" %}

This is host-level occupancy sampling, not a CUDA timeline. Still, taken together with the utilization-versus-concurrency curves, it is enough to say that concurrency 8 is close to the knee of the capacity curve for TensorRT-LLM on this box, while vLLM still realizes some additional throughput out to concurrency 32.

## What I took away for Phrasel

1. **Single-request RTF is not serving capacity.** A fast in-process Whisper call can still collapse under concurrent product traffic if it processes each request individually rather than batching them.

2. **vLLM and TensorRT-LLM both look like solid serving options.** On this box, vLLM reached a few hundred times realtime with WER matching the HF baseline, while TensorRT-LLM pushed a bit higher on throughput at the cost of higher WER on this engine build. Both seem like good tools for the job.

3. **Don’t max out concurrency just because you can.** Once the GPU is already busy, adding more parallel requests barely improves throughput and mostly makes the slow requests slower. The useful production setting is near where throughput stops climbing.

4. **SGLang’s Whisper support struggled at high concurrency in these tests.** Fine for experimentation, but not yet robust enough for demanding production workloads.

5. **Prioritize the metrics that reflect user experience.** Offline throughput matters for batch jobs; TTFS matters for interactive speaking exercises. Benchmark both so the choice matches how the product feels.

## What I want to experiment next

This writeup answers which Whisper stack to prefer and why throughput stops scaling. The natural follow-ups are the ones I’d run in a real serving engagement:

1. **Explain the TensorRT-LLM quality gap.** Same model and audio, but about 5% WER versus about 2% elsewhere. Dig into decode settings and engine build flags until the gap is either closed or clearly a real accuracy/speed tradeoff.

2. **Profile with Nsight Systems.** Move from `nvidia-smi` occupancy to CUDA timelines for HF, vLLM, and TensorRT-LLM at the concurrency knee, to see where time actually goes: idle gaps, kernels, CPU overhead.

3. **Tune the operating point.** Sweep max batch and in-flight caps, then plot latency versus throughput curves so “run near where throughput stops climbing” becomes a concrete server setting.

4. **Stretch the harness toward LLM serving.** Reuse the same loadgen and telemetry ideas on a small vLLM text model (TTFT, decode throughput, KV-cache pressure) and see how serving behavior compares when the workload is text decode rather than audio transcription.

5. **Multi-GPU and scheduled clusters.** Run the same benchmark across multiple GPUs under Kubernetes or Slurm, and measure how throughput and latency scale when replicas or tensor-parallel shards share the load.

The full matrix, methodology, and GPU telemetry reproduction steps live in the [open-speech-serve](https://github.com/m-tari/open-speech-serve) repo. If you are choosing a Whisper backend for a product rather than a demo notebook, concurrent load, quality, and device saturation together are the comparison that matters.
