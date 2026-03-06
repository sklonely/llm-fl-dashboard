#!/usr/bin/env python3
"""
Collect detailed bug fix data from cloned repos.
Run this on the remote machine where repos are cloned.

Usage:
    python3 collect_bug_details.py --clone    # Phase 1: clone repos
    python3 collect_bug_details.py --collect  # Phase 2: collect data
    python3 collect_bug_details.py --all      # Both phases
"""

import json
import os
import subprocess
import sys
import time
from pathlib import Path

# === Configuration ===
REPOS_DIR = Path(os.path.expanduser("~/llm-fl-repos"))
OUTPUT_DIR = Path(os.path.expanduser("~/llm-fl-repos/bug_details"))
BUGS_FILE = Path(os.path.expanduser("~/llm-fl-repos/experiment_bugs.json"))
CONTEXT_LINES = 10  # Lines of context for diff


def run(cmd, cwd=None, timeout=120):
    """Run command, return (returncode, stdout, stderr)"""
    try:
        r = subprocess.run(
            cmd, shell=True, cwd=cwd, capture_output=True, text=True, timeout=timeout
        )
        return r.returncode, r.stdout.strip(), r.stderr.strip()
    except subprocess.TimeoutExpired:
        return -1, "", "TIMEOUT"
    except Exception as e:
        return -1, "", str(e)


def parse_instance_id(instance_id):
    """Parse 'owner__repo-NUMBER' into (owner/repo, pr_number)"""
    # instance_id format: owner__repo-NUMBER (e.g., Textualize__textual-5795)
    parts = instance_id.rsplit("-", 1)
    pr_number = parts[1] if len(parts) == 2 else None
    repo_part = parts[0]  # e.g., Textualize__textual
    return pr_number, repo_part


def repo_to_github_url(repo):
    """Convert 'owner/repo' to GitHub clone URL"""
    return f"https://github.com/{repo}.git"


def repo_to_dir_name(repo):
    """Convert 'owner/repo' to directory name 'owner__repo'"""
    return repo.replace("/", "__")


# === Phase 1: Clone Repos ===
def clone_repos(bugs):
    """Clone all unique repos with partial clone"""
    repos = sorted(set(b["repo"] for b in bugs))
    REPOS_DIR.mkdir(parents=True, exist_ok=True)

    print(f"\n{'=' * 60}")
    print(f"Phase 1: Cloning {len(repos)} repos")
    print(f"{'=' * 60}\n")

    for i, repo in enumerate(repos, 1):
        dir_name = repo_to_dir_name(repo)
        repo_path = REPOS_DIR / dir_name

        if repo_path.exists() and (repo_path / ".git").exists():
            print(f"[{i}/{len(repos)}] {repo} — already cloned, fetching updates...")
            run("git fetch --all --quiet", cwd=repo_path, timeout=300)
            continue

        url = repo_to_github_url(repo)
        print(f"[{i}/{len(repos)}] Cloning {repo}...")
        t0 = time.time()

        # Partial clone: download tree objects but not blobs until needed
        rc, out, err = run(
            f'git clone --filter=blob:none "{url}" "{dir_name}"',
            cwd=REPOS_DIR,
            timeout=600,
        )

        elapsed = time.time() - t0
        if rc == 0:
            print(f"  ✓ Done in {elapsed:.1f}s")
        else:
            print(f"  ✗ Failed: {err[:200]}")
            # Fallback: try shallow clone
            print(f"  Retrying with shallow clone...")
            rc2, _, err2 = run(
                f'git clone --depth=1 "{url}" "{dir_name}_shallow"',
                cwd=REPOS_DIR,
                timeout=600,
            )
            if rc2 == 0:
                # Shallow won't work for checkout old commits, unshallow
                shallow_path = REPOS_DIR / f"{dir_name}_shallow"
                run("git fetch --unshallow", cwd=shallow_path, timeout=600)
                # Rename
                shallow_path.rename(repo_path)
                print(f"  ✓ Shallow + unshallow succeeded")
            else:
                print(f"  ✗ All clone attempts failed for {repo}")

    print(f"\nPhase 1 complete.\n")


# === Phase 2: Collect Bug Details ===
def find_fix_commit(repo_path, repo, pr_number, base_commit, patch):
    """
    Find the fix commit using multiple strategies.
    Returns (fix_commit_sha, method_used) or (None, None)
    """
    # Strategy 1: Use gh CLI to get merge commit
    rc, out, err = run(
        f"gh pr view {pr_number} --repo {repo} --json mergeCommit,headRefOid,commits "
        f'--jq ".mergeCommit.oid // .headRefOid // .commits[-1].oid"',
        cwd=repo_path,
        timeout=30,
    )
    if rc == 0 and out and len(out) >= 7:
        # Verify this commit exists in the repo
        sha = out.strip().split("\n")[0]
        rc2, _, _ = run(f"git cat-file -t {sha}", cwd=repo_path)
        if rc2 == 0:
            return sha, "gh_pr_merge"
        else:
            # Fetch the commit
            run(f"git fetch origin {sha}", cwd=repo_path, timeout=60)
            rc3, _, _ = run(f"git cat-file -t {sha}", cwd=repo_path)
            if rc3 == 0:
                return sha, "gh_pr_merge_fetched"

    # Strategy 2: Search git log for PR reference
    rc, out, _ = run(
        f'git log --all --oneline --grep="#{pr_number}" --format="%H" | head -5',
        cwd=repo_path,
        timeout=30,
    )
    if rc == 0 and out:
        candidates = out.strip().split("\n")
        for c in candidates:
            # Check if this commit is AFTER base_commit
            rc2, out2, _ = run(
                f"git merge-base --is-ancestor {base_commit} {c}",
                cwd=repo_path,
            )
            if rc2 == 0:  # c is descendant of base_commit
                return c, "git_log_grep"

    # Strategy 3: Apply patch to base and find matching commit
    # First, get the files changed in the patch
    patch_files = []
    for line in patch.split("\n"):
        if line.startswith("+++ b/"):
            patch_files.append(line[6:])

    if patch_files:
        file_arg = " -- " + " ".join(f'"{f}"' for f in patch_files)
        rc, out, _ = run(
            f'git log --all --oneline --format="%H" {base_commit}..HEAD{file_arg} | head -10',
            cwd=repo_path,
            timeout=30,
        )
        if rc == 0 and out:
            candidates = out.strip().split("\n")
            if candidates and candidates[0]:
                # Return the earliest commit after base that touches these files
                return candidates[-1], "git_log_file"

    # Strategy 4: Just find the immediate child commit(s) of base_commit
    rc, out, _ = run(
        f'git log --all --oneline --format="%H" --ancestry-path {base_commit}..HEAD | tail -5',
        cwd=repo_path,
        timeout=30,
    )
    if rc == 0 and out:
        lines = out.strip().split("\n")
        if lines:
            return lines[-1], "ancestry_path"

    return None, None


def get_file_at_commit(repo_path, commit, filepath):
    """Get file content at a specific commit"""
    rc, out, _ = run(f'git show {commit}:"{filepath}"', cwd=repo_path, timeout=30)
    if rc == 0:
        return out
    return None


def collect_bug_data(bug, contexts_dir=None):
    """Collect detailed data for a single bug"""
    instance_id = bug["instance_id"]
    repo = bug["repo"]
    base_commit = bug["base_commit"]
    patch = bug["patch"]
    pr_number, _ = parse_instance_id(instance_id)

    dir_name = repo_to_dir_name(repo)
    repo_path = REPOS_DIR / dir_name

    if not repo_path.exists():
        return {"instance_id": instance_id, "error": f"Repo not cloned: {dir_name}"}

    result = {
        "instance_id": instance_id,
        "repo": repo,
        "pr_number": int(pr_number) if pr_number else None,
        "pr_url": f"https://github.com/{repo}/pull/{pr_number}" if pr_number else None,
        "base_commit": base_commit,
    }

    # Find fix commit
    fix_commit, method = find_fix_commit(repo_path, repo, pr_number, base_commit, patch)
    result["fix_commit"] = fix_commit
    result["fix_commit_method"] = method

    if fix_commit:
        # Get commit metadata
        rc, out, _ = run(
            f'git log {fix_commit} -1 --format="%H%n%s%n%an%n%ae%n%ad%n%B"',
            cwd=repo_path,
        )
        if rc == 0:
            lines = out.split("\n")
            result["commit_sha"] = lines[0] if len(lines) > 0 else ""
            result["commit_subject"] = lines[1] if len(lines) > 1 else ""
            result["commit_author"] = lines[2] if len(lines) > 2 else ""
            result["commit_email"] = lines[3] if len(lines) > 3 else ""
            result["commit_date"] = lines[4] if len(lines) > 4 else ""
            result["commit_body"] = "\n".join(lines[5:]) if len(lines) > 5 else ""

        # Generate detailed diff with more context
        rc, diff_full, _ = run(
            f"git diff -U{CONTEXT_LINES} {base_commit}..{fix_commit}",
            cwd=repo_path,
            timeout=30,
        )
        result["diff_full"] = diff_full if rc == 0 else None

    # Parse patch to get changed files
    files_changed = []
    current_file = None
    for line in patch.split("\n"):
        if line.startswith("diff --git"):
            parts = line.split(" b/", 1)
            if len(parts) == 2:
                current_file = parts[1]
        elif line.startswith("+++ b/") and current_file:
            files_changed.append(current_file)
            current_file = None

    # Deduplicate
    files_changed = list(dict.fromkeys(files_changed))

    # For each changed file, get before/after content
    result["files"] = []
    for fpath in files_changed:
        file_info = {"path": fpath}

        # Before (buggy version)
        before = get_file_at_commit(repo_path, base_commit, fpath)
        file_info["before_code"] = before

        # After (fixed version)
        if fix_commit:
            after = get_file_at_commit(repo_path, fix_commit, fpath)
            file_info["after_code"] = after

            # Per-file diff with context
            rc, fdiff, _ = run(
                f'git diff -U{CONTEXT_LINES} {base_commit}..{fix_commit} -- "{fpath}"',
                cwd=repo_path,
                timeout=30,
            )
            file_info["diff"] = fdiff if rc == 0 else None
        else:
            file_info["after_code"] = None
            file_info["diff"] = None

        # Extract changed function names using a simple heuristic
        changed_funcs = []
        if file_info.get("diff"):
            for line in file_info["diff"].split("\n"):
                if line.startswith("@@") and "def " in line:
                    # Extract function name from @@ context
                    idx = line.index("def ")
                    func_part = line[idx + 4 :].split("(")[0].strip()
                    if func_part and func_part not in changed_funcs:
                        changed_funcs.append(func_part)
        file_info["changed_functions"] = changed_funcs

        result["files"].append(file_info)

    # Get PR details from GitHub
    if pr_number:
        rc, out, _ = run(
            f"gh pr view {pr_number} --repo {repo} "
            f"--json title,body,labels,state,createdAt,mergedAt,additions,deletions "
            f"--template '{{{{.title}}}}\\n---SEPARATOR---\\n{{{{.body}}}}\\n---SEPARATOR---\\n{{{{.state}}}}\\n---SEPARATOR---\\n{{{{.createdAt}}}}\\n---SEPARATOR---\\n{{{{.mergedAt}}}}\\n---SEPARATOR---\\n{{{{.additions}}}}\\n---SEPARATOR---\\n{{{{.deletions}}}}'",
            cwd=repo_path,
            timeout=30,
        )
        if rc == 0 and out:
            # Simpler: use JSON directly
            pass

        # Use JSON output instead
        rc, out, _ = run(
            f"gh pr view {pr_number} --repo {repo} "
            f"--json title,body,labels,state,createdAt,mergedAt,additions,deletions",
            cwd=repo_path,
            timeout=30,
        )
        if rc == 0 and out:
            try:
                pr_data = json.loads(out)
                result["pr_title"] = pr_data.get("title", "")
                result["pr_body"] = pr_data.get("body", "")
                result["pr_state"] = pr_data.get("state", "")
                result["pr_created_at"] = pr_data.get("createdAt", "")
                result["pr_merged_at"] = pr_data.get("mergedAt", "")
                result["pr_additions"] = pr_data.get("additions", 0)
                result["pr_deletions"] = pr_data.get("deletions", 0)
                result["pr_labels"] = [
                    l.get("name", "") for l in pr_data.get("labels", [])
                ]
            except json.JSONDecodeError:
                result["pr_error"] = "Failed to parse PR JSON"

    return result


def collect_all(bugs):
    """Collect data for all bugs"""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"\n{'=' * 60}")
    print(f"Phase 2: Collecting data for {len(bugs)} bugs")
    print(f"{'=' * 60}\n")

    results = []
    for i, bug in enumerate(bugs, 1):
        iid = bug["instance_id"]
        outfile = OUTPUT_DIR / f"{iid}.json"

        # Skip if already collected
        if outfile.exists():
            print(f"[{i}/{len(bugs)}] {iid} — already collected, skipping")
            with open(outfile) as f:
                results.append(json.load(f))
            continue

        print(f"[{i}/{len(bugs)}] {iid}...", end=" ", flush=True)
        t0 = time.time()

        data = collect_bug_data(bug)
        elapsed = time.time() - t0

        # Save individual file
        with open(outfile, "w") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        results.append(data)

        fix = data.get("fix_commit", "???")
        method = data.get("fix_commit_method", "none")
        nfiles = len(data.get("files", []))
        has_diff = any(f.get("diff") for f in data.get("files", []))
        status = "✓" if fix and has_diff else "⚠" if fix else "✗"
        print(
            f"{status} fix={fix[:8] if fix else 'N/A'}.. method={method} files={nfiles} [{elapsed:.1f}s]"
        )

    # Save combined file
    combined_file = OUTPUT_DIR / "_all_bug_details.json"
    with open(combined_file, "w") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    # Print summary
    print(f"\n{'=' * 60}")
    print(f"Summary")
    print(f"{'=' * 60}")
    with_fix = sum(1 for r in results if r.get("fix_commit"))
    with_diff = sum(
        1 for r in results if any(f.get("diff") for f in r.get("files", []))
    )
    with_pr = sum(1 for r in results if r.get("pr_title"))
    print(f"  Total bugs: {len(results)}")
    print(f"  Fix commit found: {with_fix}")
    print(f"  Diff collected: {with_diff}")
    print(f"  PR info collected: {with_pr}")
    print(f"  Output: {OUTPUT_DIR}")
    print(f"  Combined: {combined_file}")


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 collect_bug_details.py [--clone|--collect|--all]")
        sys.exit(1)

    mode = sys.argv[1]

    if not BUGS_FILE.exists():
        print(
            f"Error: {BUGS_FILE} not found. Copy experiment_bugs.json to {REPOS_DIR}/"
        )
        sys.exit(1)

    with open(BUGS_FILE) as f:
        bugs = json.load(f)

    print(f"Loaded {len(bugs)} bugs from {BUGS_FILE}")

    if mode in ("--clone", "--all"):
        clone_repos(bugs)

    if mode in ("--collect", "--all"):
        collect_all(bugs)


if __name__ == "__main__":
    main()
