from typing import Optional, Sequence


SYSTEM_MESSAGE = (
    "You are a software debugging expert specializing in fault localization."
)


def get_system_message() -> str:
    return SYSTEM_MESSAGE


def _join_lines(values: Optional[Sequence[str]]) -> str:
    if not values:
        return ""
    return "\n".join(str(value) for value in values)


def _format_test_code(test_code: object) -> str:
    if not test_code:
        return ""

    if isinstance(test_code, str):
        return test_code

    if isinstance(test_code, list):
        chunks: list[str] = []
        for entry in test_code:
            if isinstance(entry, dict):
                code = str(entry.get("code", "")).strip()
                if code:
                    chunks.append(code)
            elif entry is not None:
                chunks.append(str(entry))
        return "\n\n".join(chunk for chunk in chunks if chunk)

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

    raise ValueError(
        f"Unsupported stage/level combination: stage={stage!r}, level={level!r}"
    )
