#!/usr/bin/env python3
"""Create a report even when setup failed before xcodebuild could run."""
import os
from pathlib import Path

folder = Path(os.environ['RUNNER_TEMP']) / 'ios-build-check'
folder.mkdir(parents=True, exist_ok=True)
sha = os.environ['GITHUB_SHA']
run = f"{os.environ['GITHUB_SERVER_URL']}/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{os.environ['GITHUB_RUN_ID']}"
lines = [f'# iOS build check — {sha[:12]}', '', f'Commit: `{sha}`', f'Run: {run}', '',
         f"Build step outcome: {os.environ.get('BUILD_STEP_OUTCOME', 'unknown')}", '']
for scheme in ['ConstructHUB', 'ConstructHUB CRM']:
    key = scheme.replace(' ', '-')
    status = folder / f'{key}.status'
    log = folder / f'{key}.log'
    result = status.read_text().strip() if status.exists() else 'FAIL — build did not run; see setup steps in Actions'
    lines += [f'## {scheme}: {result}', '']
    if log.exists():
        content = log.read_text(errors='replace').splitlines()
        errors = [line for line in content if 'error:' in line.lower()]
        lines += ['Error lines first (last 60 matches):', '', '```text']
        lines += errors[-60:] or ['(No error: lines.)']
        lines += ['```', '', 'Last 60 log lines:', '', '```text'] + content[-60:] + ['```', '']
    else:
        lines += ['No xcodebuild log was produced.', '']
(folder / f'{sha[:12]}.md').write_text('\n'.join(lines))
