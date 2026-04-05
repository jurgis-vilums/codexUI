# nightly-improve.ps1 — Runs the nightly self-improvement agent
# Registered as a Windows Task Scheduler job

$ErrorActionPreference = "Stop"
$RepoDir = "C:\Users\vilum\Documents\dev\codexui"
$MaxMinutes = 60
$LogFile = Join-Path $RepoDir "decisions\nightly-$(Get-Date -Format 'yyyy-MM-dd').log"

Set-Location $RepoDir

# Ensure we're on main and up to date
git checkout main 2>$null
git pull --ff-only 2>$null

# Check if there are unchecked feedback items
$todo = Get-Content "TODO.md" -Raw
if ($todo -notmatch '- \[ \] \[') {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') No unchecked feedback items. Exiting." | Out-File $LogFile -Append
    exit 0
}

"$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Starting nightly improvement agent..." | Out-File $LogFile -Append

# Run Claude Code with RALPH loop
$promptFile = Join-Path $RepoDir "scripts\nightly-improve-prompt.md"
$prompt = Get-Content $promptFile -Raw

$process = Start-Process -FilePath "claude" -ArgumentList @(
    "--print",
    "--dangerously-skip-permissions",
    "-p", $prompt,
    "--max-turns", "100"
) -WorkingDirectory $RepoDir -PassThru -NoNewWindow -RedirectStandardOutput (Join-Path $RepoDir "decisions\nightly-stdout.log") -RedirectStandardError (Join-Path $RepoDir "decisions\nightly-stderr.log")

# Wait with timeout
if (-not $process.WaitForExit($MaxMinutes * 60 * 1000)) {
    $process.Kill()
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Agent timed out after $MaxMinutes minutes." | Out-File $LogFile -Append
}

"$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Nightly agent finished with exit code: $($process.ExitCode)" | Out-File $LogFile -Append
