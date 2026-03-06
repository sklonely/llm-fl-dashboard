#!/usr/bin/env python3
"""
Build a single data.json for the LLM Fault Localization dashboard.

Usage:
    python3 build_dashboard_data.py [--results-dir path/to/results]

Without --results-dir, builds data.json with experiment design + dataset only (no results).
With --results-dir, includes model predictions + evaluation metrics.
"""

import argparse
import json
import os
import sys
from pathlib import Path

BASE = Path(__file__).parent
DATA_DIR = BASE / "remote-data"
CONTEXTS_DIR = DATA_DIR / "contexts"
CONFIG_FILE = DATA_DIR / "configs" / "experiment.json"
GT_FILE = DATA_DIR / "ground_truths.json"
CLASSIFICATION_FILE = DATA_DIR / "bug_classification.json"
DIFFICULTY_FILE = DATA_DIR / "bug_difficulty_analysis.json"
EXPERIMENT_BUGS_FILE = DATA_DIR / "experiment_bugs.json"
BUG_DETAILS_DIR = DATA_DIR / "bug_details"

STAGES = ["stage1", "stage2"]
LEVELS = ["L1", "L2", "L3"]


def _normalize_path(path: str) -> str:
    normalized = path.strip()
    while normalized.startswith("./"):
        normalized = normalized[2:]
    while normalized.startswith("/"):
        normalized = normalized[1:]
    return normalized


def evaluate_stage1(predictions, ground_truth, k_values=(1, 3, 5)):
    norm_pred = [_normalize_path(p) for p in predictions]
    gt_set = set(_normalize_path(g) for g in ground_truth)
    metrics = {}
    for k in k_values:
        top_k = set(norm_pred[:k])
        hit = len(gt_set & top_k)
        metrics[f"any_hit@{k}"] = int(hit > 0)
        metrics[f"recall@{k}"] = (hit / len(gt_set)) if gt_set else 0.0
        metrics[f"all_hit@{k}"] = int(bool(gt_set) and gt_set.issubset(top_k))
    mrr = 0.0
    for idx, p in enumerate(norm_pred, 1):
        if p in gt_set:
            mrr = 1.0 / idx
            break
    metrics["mrr"] = mrr
    return metrics


def _lines_to_ranges(lines):
    if not lines:
        return []
    sorted_lines = sorted(set(lines))
    ranges = []
    start = end = sorted_lines[0]
    for line in sorted_lines[1:]:
        if line == end + 1:
            end = line
        else:
            ranges.append((start, end))
            start = end = line
    ranges.append((start, end))
    return ranges


def _ranges_to_line_set(ranges):
    line_set = set()
    for r in ranges:
        if isinstance(r, (list, tuple)) and len(r) == 2:
            line_set.update(range(int(r[0]), int(r[1]) + 1))
        elif isinstance(r, int):
            line_set.add(r)
    return line_set


def evaluate_stage2(predictions, ground_truth_lines, k_values=(1, 5)):
    gt_lines = sorted(set(ground_truth_lines))
    gt_ranges = _lines_to_ranges(gt_lines)
    gt_line_set = set(gt_lines)
    metrics = {}

    for k in k_values:
        top_k = predictions[:k]
        pred_line_set = _ranges_to_line_set(top_k)
        overlap = pred_line_set & gt_line_set

        metrics[f"any_overlap@{k}"] = int(len(overlap) > 0)

        if pred_line_set or gt_line_set:
            union = pred_line_set | gt_line_set
            metrics[f"iou@{k}"] = len(overlap) / len(union) if union else 0.0
        else:
            metrics[f"iou@{k}"] = 0.0

        metrics[f"recall@{k}"] = len(overlap) / len(gt_line_set) if gt_line_set else 0.0
        metrics[f"precision@{k}"] = (
            len(overlap) / len(pred_line_set) if pred_line_set else 0.0
        )

    top1 = predictions[0] if predictions else None
    if top1 is not None and isinstance(top1, (list, tuple)) and len(top1) == 2:
        top1_set = set(range(int(top1[0]), int(top1[1]) + 1))
        top1_overlap = top1_set & gt_line_set
        metrics["exact_overlap@1"] = int(len(top1_overlap) > 0)
        union = top1_set | gt_line_set
        metrics["top1_iou"] = len(top1_overlap) / len(union) if union else 0.0
        top1_expanded_1 = set(range(max(1, int(top1[0]) - 1), int(top1[1]) + 2))
        metrics["fuzzy_top1_pm1"] = int(len(top1_expanded_1 & gt_line_set) > 0)
        top1_expanded_3 = set(range(max(1, int(top1[0]) - 3), int(top1[1]) + 4))
        metrics["fuzzy_top1_pm3"] = int(len(top1_expanded_3 & gt_line_set) > 0)
    else:
        metrics["exact_overlap@1"] = 0
        metrics["top1_iou"] = 0.0
        metrics["fuzzy_top1_pm1"] = 0
        metrics["fuzzy_top1_pm3"] = 0

    mrr = 0.0
    max_k = max(k_values) if k_values else 0
    for idx, pred_range in enumerate(predictions[:max_k], 1):
        if isinstance(pred_range, (list, tuple)) and len(pred_range) == 2:
            pred_set = set(range(int(pred_range[0]), int(pred_range[1]) + 1))
            if pred_set & gt_line_set:
                mrr = 1.0 / idx
                break
    metrics["mrr"] = mrr

    all_pred_set = _ranges_to_line_set(predictions)
    gt_ranges_hit = sum(
        1 for gs, ge in gt_ranges if set(range(gs, ge + 1)) & all_pred_set
    )
    metrics["gt_range_coverage"] = gt_ranges_hit / len(gt_ranges) if gt_ranges else 0.0

    return metrics


def load_base_data():
    """Load all pre-experiment data."""
    with open(CONFIG_FILE) as f:
        experiment = json.load(f)

    with open(GT_FILE) as f:
        ground_truths = json.load(f)

    with open(CLASSIFICATION_FILE) as f:
        classifications = json.load(f)
    class_map = {e["instance_id"]: e for e in classifications}

    with open(DIFFICULTY_FILE) as f:
        difficulties = json.load(f)
    diff_map = {e["instance_id"]: e for e in difficulties}

    patch_map = {}
    if EXPERIMENT_BUGS_FILE.exists():
        with open(EXPERIMENT_BUGS_FILE) as f:
            exp_bugs = json.load(f)
        patch_map = {e["instance_id"]: e.get("patch", "") for e in exp_bugs}

    details_map = {}
    if BUG_DETAILS_DIR.exists():
        combined = BUG_DETAILS_DIR / "_all_bug_details.json"
        if combined.exists():
            with open(combined) as f:
                all_details = json.load(f)
            details_map = {d["instance_id"]: d for d in all_details}
            print(f"  Loaded bug details for {len(details_map)} bugs")

    return experiment, ground_truths, class_map, diff_map, patch_map, details_map


def build_bug_entry(ctx, gt, classification, difficulty, patch="", details=None):
    """Build a single bug entry for data.json."""
    instance_id = ctx["instance_id"]
    details = details or {}

    source_code = ctx.get("source_code", "")
    ast_summary = ctx.get("ast_summary", "")
    file_list = ctx.get("file_list", [])

    entry = {
        "instance_id": instance_id,
        "repo": ctx.get("repo", ""),
        "base_commit": ctx.get("base_commit", "")[:12],
        "bug_type": classification.get("bug_type", "UNKNOWN"),
        "complexity": classification.get("complexity", "?"),
        "classification_reasoning": classification.get("reasoning", ""),
        "leakage": difficulty.get("leakage", {}) if difficulty else {},
        "ground_truth": {
            "files": gt.get("files", []),
            "lines": gt.get("lines", {}),
            "total_modified_lines": gt.get("total_modified_lines", 0),
        },
        "context": {
            "problem_statement": ctx.get("problem_statement", ""),
            "gt_file": ctx.get("gt_file", ""),
            "gt_lines": ctx.get("gt_lines", []),
            "file_list": file_list,
            "file_count": len(file_list),
            "ast_summary": ast_summary,
            "ast_summary_chars": len(ast_summary),
            "source_code": source_code,
            "source_lines": source_code.count("\n") + 1 if source_code else 0,
            "test_names": ctx.get("test_names", []),
            "test_code": ctx.get("test_code", []),
        },
        "patch": patch,
        "stats": ctx.get("stats", {}),
        "results": {},
        "metrics": {},
    }

    if details:
        detail_files = details.get("files", [])
        file_diffs = []
        for fd in detail_files:
            file_diffs.append(
                {
                    "path": fd.get("path", ""),
                    "diff": fd.get("diff", ""),
                    "changed_functions": fd.get("changed_functions", []),
                }
            )
        entry["fix_info"] = {
            "fix_commit": details.get("fix_commit", ""),
            "commit_subject": details.get("commit_subject", ""),
            "commit_author": details.get("commit_author", ""),
            "commit_date": details.get("commit_date", ""),
            "pr_number": details.get("pr_number"),
            "pr_url": details.get("pr_url", ""),
            "pr_title": details.get("pr_title", ""),
            "pr_body": details.get("pr_body", ""),
            "pr_labels": details.get("pr_labels", []),
            "pr_additions": details.get("pr_additions", 0),
            "pr_deletions": details.get("pr_deletions", 0),
            "file_diffs": file_diffs,
        }

    return entry


def load_results(results_dir, bugs, ground_truths, experiment=None):
    """Load experiment results and compute metrics."""
    results_path = Path(results_dir)
    if not results_path.exists():
        print(f"  Results dir not found: {results_path}", file=sys.stderr)
        return

    dir_to_display = {}
    if experiment:
        for name, spec in experiment.get("models", {}).items():
            sanitized = (
                spec.get("ollama_name", name).replace(":", "-").replace("/", "-")
            )
            dir_to_display[sanitized] = name

    model_dirs = sorted(results_path.glob("*"))
    models_found = [d.name for d in model_dirs if d.is_dir()]
    print(f"  Found model dirs: {models_found}", file=sys.stderr)

    bug_map = {b["instance_id"]: b for b in bugs}

    total_loaded = 0
    for model_dir in model_dirs:
        if not model_dir.is_dir():
            continue
        model_name = dir_to_display.get(model_dir.name, model_dir.name)

        for stage in STAGES:
            for level in LEVELS:
                condition_dir = model_dir / f"{stage}_{level}"
                if not condition_dir.exists():
                    continue

                for result_file in sorted(condition_dir.glob("*.json")):
                    with open(result_file) as f:
                        result = json.load(f)

                    iid = result.get("instance_id", result_file.stem)
                    bug = bug_map.get(iid)
                    if not bug:
                        continue

                    condition_key = f"{stage}_{level}"

                    # Store result
                    if model_name not in bug["results"]:
                        bug["results"][model_name] = {}
                    bug["results"][model_name][condition_key] = {
                        "predictions": result.get("predictions", []),
                        "raw_output": result.get("raw_output", ""),
                        "parse_success": result.get("parse_success", False),
                        "duration_ms": result.get("total_duration_ms", 0),
                        "eval_count": result.get("eval_count"),
                        "error": result.get("error"),
                    }

                    # Compute metrics
                    gt = ground_truths.get(iid, {})
                    predictions = result.get("predictions", [])

                    if model_name not in bug["metrics"]:
                        bug["metrics"][model_name] = {}

                    if stage == "stage1":
                        gt_files = gt.get("files", [])
                        m = evaluate_stage1(predictions, gt_files)
                    else:
                        gt_lines_map = gt.get("lines", {})
                        gt_lines = []
                        for lines in gt_lines_map.values():
                            gt_lines.extend(lines)
                        gt_lines = sorted(set(gt_lines))
                        m = evaluate_stage2(predictions, gt_lines)

                    bug["metrics"][model_name][condition_key] = m
                    total_loaded += 1

    print(f"  Loaded {total_loaded} result files", file=sys.stderr)


def compute_aggregations(bugs, experiment):
    """Compute aggregated metrics for the results dashboard."""
    agg = {
        "by_model": {},
        "by_condition": {},
        "by_model_condition": {},
        "by_bug_type": {},
        "by_complexity": {},
        "by_leakage": {},
    }

    model_names = list(experiment.get("models", {}).keys())
    # Map sanitized dir names back to display names
    sanitized_to_display = {}
    for name, spec in experiment.get("models", {}).items():
        sanitized = spec.get("ollama_name", name).replace(":", "-").replace("/", "-")
        sanitized_to_display[sanitized] = name

    conditions = [f"{s}_{l}" for s in STAGES for l in LEVELS]

    # Collect all metrics by grouping key
    collectors = {
        "by_model": {},  # model -> [metrics]
        "by_condition": {},  # condition -> [metrics]
        "by_model_condition": {},  # model::condition -> [metrics]
        "by_bug_type": {},  # bug_type::model::condition -> [metrics]
        "by_complexity": {},  # complexity::model::condition -> [metrics]
        "by_leakage": {},  # leakage::model::condition -> [metrics]
    }

    for bug in bugs:
        bt = bug["bug_type"]
        cx = bug["complexity"]
        lk = bug.get("leakage", {}).get("leakage_level", "UNKNOWN")

        for model_key, model_metrics in bug.get("metrics", {}).items():
            display_model = sanitized_to_display.get(model_key, model_key)

            for cond, m in model_metrics.items():
                collectors["by_model"].setdefault(display_model, []).append(m)
                collectors["by_condition"].setdefault(cond, []).append(m)
                mc_key = f"{display_model}::{cond}"
                collectors["by_model_condition"].setdefault(mc_key, []).append(m)

                bt_key = f"{bt}::{display_model}::{cond}"
                collectors["by_bug_type"].setdefault(bt_key, []).append(m)

                cx_key = f"{cx}::{display_model}::{cond}"
                collectors["by_complexity"].setdefault(cx_key, []).append(m)

                lk_key = f"{lk}::{display_model}::{cond}"
                collectors["by_leakage"].setdefault(lk_key, []).append(m)

    def avg_metrics(metric_list):
        if not metric_list:
            return {}
        keys = set()
        for m in metric_list:
            keys.update(m.keys())
        return {
            k: round(sum(m.get(k, 0) for m in metric_list) / len(metric_list), 4)
            for k in sorted(keys)
        }

    for group_name, collector in collectors.items():
        agg[group_name] = {k: avg_metrics(v) for k, v in collector.items()}

    return agg


def main():
    parser = argparse.ArgumentParser(description="Build dashboard data.json")
    parser.add_argument(
        "--results-dir",
        type=str,
        default=None,
        help="Path to results/ directory (optional)",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=str(BASE / "dashboard" / "data.json"),
        help="Output path for data.json",
    )
    args = parser.parse_args()

    print("Loading base data...", file=sys.stderr)
    experiment, ground_truths, class_map, diff_map, patch_map, details_map = (
        load_base_data()
    )

    print("Processing 50 bugs...", file=sys.stderr)
    bugs = []
    for ctx_file in sorted(CONTEXTS_DIR.glob("*.json")):
        with open(ctx_file) as f:
            ctx = json.load(f)
        iid = ctx["instance_id"]
        gt = ground_truths.get(iid, {})
        classification = class_map.get(iid, {})
        difficulty = diff_map.get(iid, {})
        patch = patch_map.get(iid, "")
        details = details_map.get(iid, {})
        entry = build_bug_entry(ctx, gt, classification, difficulty, patch, details)
        bugs.append(entry)

    print(f"  Built {len(bugs)} bug entries", file=sys.stderr)

    # Load results if available
    has_results = False
    if args.results_dir:
        print(f"Loading results from {args.results_dir}...", file=sys.stderr)
        load_results(args.results_dir, bugs, ground_truths, experiment)
        has_results = any(bug["results"] for bug in bugs)

    # Compute aggregations
    aggregated = {}
    if has_results:
        print("Computing aggregations...", file=sys.stderr)
        aggregated = compute_aggregations(bugs, experiment)

    # Build final data.json
    data = {
        "experiment": experiment,
        "bugs": bugs,
        "aggregated": aggregated,
        "has_results": has_results,
        "bug_count": len(bugs),
        "metadata": {
            "models": sorted(
                set(
                    list(experiment.get("models", {}).keys())
                    + [m for b in bugs for m in b.get("results", {}).keys()]
                )
            ),
            "stages": STAGES,
            "levels": LEVELS,
            "conditions": [f"{s}_{l}" for s in STAGES for l in LEVELS],
            "bug_types": sorted(set(b["bug_type"] for b in bugs)),
            "complexities": ["S", "M", "C"],
            "leakage_levels": ["HIGH", "MEDIUM", "LOW", "NONE"],
            "repos": sorted(set(b["repo"] for b in bugs)),
        },
    }

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)

    size_mb = output_path.stat().st_size / (1024 * 1024)
    print(f"\nOutput: {output_path} ({size_mb:.1f} MB)", file=sys.stderr)
    print(f"  Bugs: {len(bugs)}", file=sys.stderr)
    print(f"  Has results: {has_results}", file=sys.stderr)


if __name__ == "__main__":
    main()
