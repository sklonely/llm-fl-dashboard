#!/usr/bin/env python3
"""
GPT-4.1 Batch API experiment runner for fault localization.

Usage:
    # Step 1: Generate batch JSONL file
    python run_gpt41_batch.py prepare

    # Step 2: Submit batch job to OpenAI
    python run_gpt41_batch.py submit

    # Step 3: Check batch status
    python run_gpt41_batch.py status

    # Step 4: Collect results and convert to our format
    python run_gpt41_batch.py collect

Requires:
    pip install openai
    export OPENAI_API_KEY="sk-..."
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

MODEL = "gpt-4.1"
MODEL_DISPLAY_NAME = "gpt-4.1"  # Name used in result JSON files
TEMPERATURE = 0
SEED = 42
MAX_TOKENS = 512

BASE_DIR = Path(os.environ.get("FL_BASE_DIR", Path(__file__).parent / "remote-data"))
CONTEXTS_DIR = BASE_DIR / "contexts"
RESULTS_DIR = BASE_DIR / "results" / MODEL_DISPLAY_NAME
BATCH_DIR = Path(os.environ.get("FL_BATCH_DIR", Path(__file__).parent / "batch_gpt41"))

STAGES = ["stage1", "stage2"]
LEVELS = ["L1", "L2", "L3"]

SYSTEM_MESSAGE = (
    "You are a software debugging expert specializing in fault localization."
)

STATE_FILE = BATCH_DIR / "batch_state.json"

# ---------------------------------------------------------------------------
# Prompt rendering (mirrors templates.py exactly)
# ---------------------------------------------------------------------------


def _join_lines(values):
    if not values:
        return ""
    return "\n".join(str(v) for v in values)


def _format_test_code(test_code):
    if not test_code:
        return ""
    if isinstance(test_code, str):
        return test_code
    if isinstance(test_code, list):
        chunks = []
        for entry in test_code:
            if isinstance(entry, dict):
                code = str(entry.get("code", "")).strip()
                if code:
                    chunks.append(code)
            elif entry is not None:
                chunks.append(str(entry))
        return "\n\n".join(c for c in chunks if c)
    return str(test_code)


def render_prompt(context: dict, stage: str, level: str) -> str:
    problem_statement = str(context.get("problem_statement", ""))
    file_list = _join_lines(context.get("file_list", []))
    ast_summary = str(context.get("ast_summary", ""))
    source_code = str(context.get("source_code", ""))
    gt_file = str(context.get("gt_file", ""))
    test_names = _join_lines(context.get("test_names", []))
    test_code = _format_test_code(context.get("test_code", []))

    if stage == "stage1":
        if level == "L1":
            return f"""Given the following bug report and list of source files in the repository, identify the most suspicious files that likely contain the bug.

=== Bug Report ===
{problem_statement}

=== Source Files ===
{file_list}

Rank the top 5 most suspicious files. Output ONLY the ranked list in this exact format:
1. path/to/file.py
2. path/to/file.py
3. path/to/file.py
4. path/to/file.py
5. path/to/file.py"""

        if level == "L2":
            return f"""Given the following bug report and repository structure with class/method signatures, identify the most suspicious files that likely contain the bug.

=== Bug Report ===
{problem_statement}

=== Repository Structure ===
{ast_summary}

Rank the top 5 most suspicious files. Output ONLY the ranked list in this exact format:
1. path/to/file.py
2. path/to/file.py
3. path/to/file.py
4. path/to/file.py
5. path/to/file.py"""

        if level == "L3":
            return f"""Given the following bug report, repository structure, and failing test information, identify the most suspicious files that likely contain the bug.

=== Bug Report ===
{problem_statement}

=== Repository Structure ===
{ast_summary}

=== Failing Tests ===
{test_names}

=== Test Code ===
{test_code}

Rank the top 5 most suspicious files. Output ONLY the ranked list in this exact format:
1. path/to/file.py
2. path/to/file.py
3. path/to/file.py
4. path/to/file.py
5. path/to/file.py"""

    if stage == "stage2":
        if level == "L1":
            return f"""Given the following bug report and source code, identify the most suspicious code regions that likely contain the bug.

=== Bug Report ===
{problem_statement}

=== Source Code: {gt_file} ===
{source_code}

Rank the top 5 most suspicious code regions by line range. For a single suspicious line N, write N-N. Output ONLY the ranked list in this exact format:
1. {{start_line}}-{{end_line}}
2. {{start_line}}-{{end_line}}
3. {{start_line}}-{{end_line}}
4. {{start_line}}-{{end_line}}
5. {{start_line}}-{{end_line}}"""

        if level == "L2":
            return f"""Given the following bug report, source code, and failing test names, identify the most suspicious code regions that likely contain the bug.

=== Bug Report ===
{problem_statement}

=== Source Code: {gt_file} ===
{source_code}

=== Failing Tests ===
{test_names}

Rank the top 5 most suspicious code regions by line range. For a single suspicious line N, write N-N. Output ONLY the ranked list in this exact format:
1. {{start_line}}-{{end_line}}
2. {{start_line}}-{{end_line}}
3. {{start_line}}-{{end_line}}
4. {{start_line}}-{{end_line}}
5. {{start_line}}-{{end_line}}"""

        if level == "L3":
            return f"""Given the following bug report, source code, and failing test code, identify the most suspicious code regions that likely contain the bug.

=== Bug Report ===
{problem_statement}

=== Source Code: {gt_file} ===
{source_code}

=== Failing Tests ===
{test_names}

=== Test Code ===
{test_code}

Rank the top 5 most suspicious code regions by line range. For a single suspicious line N, write N-N. Output ONLY the ranked list in this exact format:
1. {{start_line}}-{{end_line}}
2. {{start_line}}-{{end_line}}
3. {{start_line}}-{{end_line}}
4. {{start_line}}-{{end_line}}
5. {{start_line}}-{{end_line}}"""

    raise ValueError(f"Unsupported: stage={stage!r}, level={level!r}")


# ---------------------------------------------------------------------------
# Result parsing (mirrors Ollama runner)
# ---------------------------------------------------------------------------


def parse_stage1_output(raw: str) -> list[str]:
    """Parse ranked file list from model output."""
    predictions = []
    for line in raw.strip().split("\n"):
        line = line.strip()
        m = re.match(r"^\d+\.\s*(.+)$", line)
        if m:
            path = m.group(1).strip().strip("`").strip('"').strip("'")
            if path:
                predictions.append(path)
    return predictions[:5]


def parse_stage2_output(raw: str) -> list[list[int]]:
    """Parse ranked line ranges from model output."""
    predictions = []
    for line in raw.strip().split("\n"):
        line = line.strip()
        m = re.match(r"^\d+\.\s*(\d+)\s*-\s*(\d+)$", line)
        if m:
            start, end = int(m.group(1)), int(m.group(2))
            predictions.append([start, end])
    return predictions[:5]


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


def cmd_prepare(args):
    """Generate JSONL batch file for OpenAI Batch API."""
    BATCH_DIR.mkdir(parents=True, exist_ok=True)

    # Load all context files
    context_files = sorted(CONTEXTS_DIR.glob("*.json"))
    print(f"Found {len(context_files)} context files")

    requests = []
    for ctx_path in context_files:
        with open(ctx_path) as f:
            context = json.load(f)
        instance_id = context["instance_id"]

        for stage in STAGES:
            for level in LEVELS:
                prompt = render_prompt(context, stage, level)
                custom_id = f"{instance_id}|{stage}|{level}"

                request = {
                    "custom_id": custom_id,
                    "method": "POST",
                    "url": "/v1/chat/completions",
                    "body": {
                        "model": MODEL,
                        "messages": [
                            {"role": "system", "content": SYSTEM_MESSAGE},
                            {"role": "user", "content": prompt},
                        ],
                        "temperature": TEMPERATURE,
                        "seed": SEED,
                        "max_tokens": MAX_TOKENS,
                    },
                }
                requests.append(request)

    # Write JSONL
    jsonl_path = BATCH_DIR / "batch_input.jsonl"
    with open(jsonl_path, "w") as f:
        for req in requests:
            f.write(json.dumps(req, ensure_ascii=False) + "\n")

    file_size_mb = jsonl_path.stat().st_size / (1024 * 1024)
    print(f"\nGenerated: {jsonl_path}")
    print(f"Total requests: {len(requests)}")
    print(f"File size: {file_size_mb:.1f} MB")
    print(f"  Stage 1: {len(context_files) * 3} requests")
    print(f"  Stage 2: {len(context_files) * 3} requests")

    # Estimate cost (GPT-4.1: $2/M input, $8/M output)
    # Rough estimate: ~2K tokens avg input, ~100 tokens avg output per request
    est_input_tokens = len(requests) * 2000
    est_output_tokens = len(requests) * 100
    est_cost = (est_input_tokens / 1_000_000 * 2) + (est_output_tokens / 1_000_000 * 8)
    # Batch API is 50% off
    est_cost_batch = est_cost * 0.5
    print(f"\nEstimated cost (batch 50% off): ~${est_cost_batch:.2f}")
    print("  (actual cost depends on prompt lengths, Stage 2 prompts are much longer)")

    print(f"\nNext step: python {sys.argv[0]} submit")


def cmd_submit(args):
    """Upload JSONL and submit batch job to OpenAI."""
    try:
        from openai import OpenAI
    except ImportError:
        print("Error: pip install openai")
        sys.exit(1)

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("Error: export OPENAI_API_KEY='sk-...'")
        sys.exit(1)

    client = OpenAI(api_key=api_key)

    jsonl_path = BATCH_DIR / "batch_input.jsonl"
    if not jsonl_path.exists():
        print(f"Error: {jsonl_path} not found. Run 'prepare' first.")
        sys.exit(1)

    # Upload file
    print(f"Uploading {jsonl_path}...")
    with open(jsonl_path, "rb") as f:
        file_obj = client.files.create(file=f, purpose="batch")
    print(f"Uploaded: file_id={file_obj.id}")

    # Create batch
    print("Creating batch job...")
    batch = client.batches.create(
        input_file_id=file_obj.id,
        endpoint="/v1/chat/completions",
        completion_window="24h",
        metadata={"description": f"FL experiment - {MODEL} - 300 requests"},
    )
    print(f"Batch created: batch_id={batch.id}")
    print(f"Status: {batch.status}")

    # Save state
    BATCH_DIR.mkdir(parents=True, exist_ok=True)
    state = {
        "batch_id": batch.id,
        "input_file_id": file_obj.id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "model": MODEL,
    }
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)
    print(f"State saved to {STATE_FILE}")

    print(f"\nNext step: python {sys.argv[0]} status")


def cmd_status(args):
    """Check batch job status."""
    try:
        from openai import OpenAI
    except ImportError:
        print("Error: pip install openai")
        sys.exit(1)

    if not STATE_FILE.exists():
        print(f"Error: {STATE_FILE} not found. Run 'submit' first.")
        sys.exit(1)

    with open(STATE_FILE) as f:
        state = json.load(f)

    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    batch = client.batches.retrieve(state["batch_id"])

    print(f"Batch ID:    {batch.id}")
    print(f"Status:      {batch.status}")
    print(f"Created:     {state['created_at']}")

    if batch.request_counts:
        rc = batch.request_counts
        print(f"Completed:   {rc.completed}/{rc.total}")
        print(f"Failed:      {rc.failed}")

    if batch.status == "completed":
        # Save output file id
        state["output_file_id"] = batch.output_file_id
        if batch.error_file_id:
            state["error_file_id"] = batch.error_file_id
        with open(STATE_FILE, "w") as f:
            json.dump(state, f, indent=2)
        print(f"\n✅ Batch completed! Output file: {batch.output_file_id}")
        print(f"Next step: python {sys.argv[0]} collect")
    elif batch.status == "failed":
        print(f"\n❌ Batch failed!")
        if batch.errors:
            for err in batch.errors.data:
                print(f"  Error: {err.code} - {err.message}")
    elif batch.status in ("in_progress", "validating", "finalizing"):
        print(f"\n⏳ Still running... Check again later.")
    else:
        print(f"\nStatus: {batch.status}")


def cmd_collect(args):
    """Download batch results and convert to our result format."""
    try:
        from openai import OpenAI
    except ImportError:
        print("Error: pip install openai")
        sys.exit(1)

    if not STATE_FILE.exists():
        print(f"Error: {STATE_FILE} not found. Run 'submit' first.")
        sys.exit(1)

    with open(STATE_FILE) as f:
        state = json.load(f)

    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

    # Check status first
    batch = client.batches.retrieve(state["batch_id"])
    if batch.status != "completed":
        print(f"Batch not completed yet. Status: {batch.status}")
        sys.exit(1)

    output_file_id = batch.output_file_id
    if not output_file_id:
        print("Error: No output file ID found.")
        sys.exit(1)

    # Download output
    print(f"Downloading results from {output_file_id}...")
    content = client.files.content(output_file_id)
    raw_output_path = BATCH_DIR / "batch_output.jsonl"
    with open(raw_output_path, "wb") as f:
        f.write(content.read())
    print(f"Saved raw output to {raw_output_path}")

    # Download errors if any
    if batch.error_file_id:
        error_content = client.files.content(batch.error_file_id)
        error_path = BATCH_DIR / "batch_errors.jsonl"
        with open(error_path, "wb") as f:
            f.write(error_content.read())
        print(f"Saved errors to {error_path}")

    # Parse and convert results
    print("\nConverting to experiment result format...")
    _convert_results(raw_output_path)

    print(f"\nNext step: rebuild data.json with build_dashboard_data.py")


def _convert_results(jsonl_path: Path):
    """Convert OpenAI batch output JSONL to our per-bug result files."""
    success = 0
    failed = 0
    parse_errors = 0

    with open(jsonl_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue

            result = json.loads(line)
            custom_id = result["custom_id"]
            response = result.get("response", {})
            error = result.get("error")

            # Parse custom_id: "instance_id|stage|level"
            parts = custom_id.split("|")
            if len(parts) != 3:
                print(f"  ⚠️ Bad custom_id: {custom_id}")
                failed += 1
                continue

            instance_id, stage, level = parts

            body = {}

            if error:
                print(f"  ❌ {custom_id}: API error - {error}")
                raw_output = ""
                predictions = []
                parse_success = False
                failed += 1
            else:
                status_code = response.get("status_code", 0)
                body = response.get("body", {})

                if status_code != 200:
                    print(f"  ❌ {custom_id}: HTTP {status_code}")
                    raw_output = json.dumps(body)
                    predictions = []
                    parse_success = False
                    failed += 1
                else:
                    choices = body.get("choices", [])
                    if choices:
                        raw_output = choices[0]["message"]["content"]
                    else:
                        raw_output = ""

                    # Parse predictions
                    if stage == "stage1":
                        predictions = parse_stage1_output(raw_output)
                    else:
                        predictions = parse_stage2_output(raw_output)

                    parse_success = len(predictions) > 0
                    if not parse_success:
                        parse_errors += 1
                        print(
                            f"  ⚠️ {custom_id}: Parse failed. Output: {raw_output[:100]}"
                        )

                    success += 1

            # Get usage info
            usage = body.get("usage", {}) if not error else {}

            # Build result in our format
            our_result = {
                "instance_id": instance_id,
                "model": MODEL_DISPLAY_NAME,
                "stage": stage,
                "level": level,
                "raw_output": raw_output,
                "predictions": predictions,
                "parse_success": parse_success,
                "total_duration_ms": 0,  # Batch API doesn't provide per-request timing
                "eval_count": usage.get("completion_tokens", 0),
                "prompt_tokens": usage.get("prompt_tokens", 0),
                "completion_tokens": usage.get("completion_tokens", 0),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

            # Save to results directory
            out_dir = RESULTS_DIR / f"{stage}_{level}"
            out_dir.mkdir(parents=True, exist_ok=True)
            out_path = out_dir / f"{instance_id}.json"
            with open(out_path, "w") as f:
                json.dump(our_result, f, indent=2, ensure_ascii=False)

    print(f"\n=== Conversion Summary ===")
    print(f"Success:      {success}")
    print(f"API errors:   {failed}")
    print(f"Parse errors: {parse_errors}")
    print(f"Results dir:  {RESULTS_DIR}")

    # Count files per condition
    for stage in STAGES:
        for level in LEVELS:
            d = RESULTS_DIR / f"{stage}_{level}"
            if d.exists():
                count = len(list(d.glob("*.json")))
                print(f"  {stage}_{level}: {count} files")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(
        description="GPT-4.1 Batch API experiment for fault localization"
    )
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("prepare", help="Generate batch JSONL file")
    sub.add_parser("submit", help="Upload and submit batch job")
    sub.add_parser("status", help="Check batch job status")
    sub.add_parser("collect", help="Download and convert results")

    args = parser.parse_args()

    if args.command == "prepare":
        cmd_prepare(args)
    elif args.command == "submit":
        cmd_submit(args)
    elif args.command == "status":
        cmd_status(args)
    elif args.command == "collect":
        cmd_collect(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
