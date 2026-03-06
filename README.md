# LLM Fault Localization Dashboard

Interactive dashboard for exploring experiment results from evaluating open-source LLMs on fault localization tasks using SWE-bench-Live.

## Live Dashboard

**https://sklonely.github.io/llm-fl-dashboard/**

## About

This project evaluates how well open-source LLMs can localize faults in real-world Python repositories, compared to the closed-source GPT-4.1 baseline.

**Models evaluated:**
| Model | Developer | Parameters | Quantization |
|-------|-----------|------------|--------------|
| GPT-4.1 | OpenAI | Undisclosed | N/A (API) |
| GLM-4.7-Flash | Zhipu AI | 30B (3B active, MoE) | Q4_K_M |
| Qwen2.5-Coder-32B | Alibaba | 32B (dense) | Q4_K_M |
| Gemma3-27B | Google | 27B (dense) | Q4_K_M |

**Dataset:** 50 bugs from [SWE-bench-Live](https://swe-bench.github.io/) across 24 Python repositories, with knowledge cutoff filtering to prevent data leakage.

**Two-stage evaluation:**
- **Stage 1** (File-Level): Given an issue description, identify the buggy file
- **Stage 2** (Line-Level): Given the correct file, pinpoint the buggy line range

Each stage tested at 3 context levels (L1/L2/L3) with increasing information.

## Dashboard Features

| Page | Description |
|------|-------------|
| **Overview** | Experiment summary, model cards, key metrics at a glance |
| **Dataset** | Browse and filter all 50 bugs by repo, type, and complexity |
| **Inspector** | Deep-dive into individual bugs: input context, model predictions, ground truth, evaluation metrics |
| **Results** | Aggregated performance tables and charts across all conditions |
| **RQ Analysis** | Interactive charts for the three research questions |

Supports English and Chinese (toggle in top-right corner).

## Local Development

```bash
cd docs
python3 -m http.server 8000
# Open http://localhost:8000
```

No build step required. Pure HTML + Vanilla JS + [ECharts](https://echarts.apache.org/).

## Project Structure

```
docs/               # Dashboard (GitHub Pages source)
  index.html
  data.json         # All experiment data (7.5MB)
  css/style.css
  js/
    app.js          # Router and data loader
    i18n.js         # Bilingual translations
    icons.js        # Lucide icon renderer
    pages/          # Page renderers (overview, dataset, inspector, results, rq-analysis)
remote-data/        # Raw experiment data
  configs/          # Experiment configuration
  contexts/         # Input contexts per bug
  results/          # Model outputs per condition
  bug_details/      # Detailed bug metadata from GitHub
```

## Related

- Paper: *Open-Source LLMs for Fault Localization: A Comparative Evaluation Using SWE-bench-Live* (CS 563, Portland State University)
- Dataset: [SWE-bench-Live](https://swe-bench.github.io/)

## License

MIT
