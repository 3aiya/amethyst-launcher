param(
    [Parameter(Mandatory = $true)]
    [string]$Version,

    [switch]$ForceTag,

    [switch]$AllowDirty,

    [switch]$NoWatch,

    [switch]$BumpOnly
)

$ErrorActionPreference = "Stop"

# ============================================================
# AMETHYST LAUNCHER
# One-command release
#
# Usage:
#   .\build-release.ps1 1.2.0
#   .\build-release.ps1 1.2.0 -ForceTag     (move an existing tag)
#   .\build-release.ps1 1.2.0 -AllowDirty   (ignore uncommitted source changes)
#   .\build-release.ps1 1.2.0 -NoWatch      (don't wait for the CI build)
#   .\build-release.ps1 1.2.0 -BumpOnly     (only edit the version files)
#
# Automatically:
#   1. Bumps the version in package.json, package-lock.json,
#      tauri.conf.json, Cargo.toml and Cargo.lock
#   2. Commits those files and pushes the branch
#   3. Creates and pushes the release tag
#   4. Watches the release workflow, which builds the launcher on a
#      GitHub-hosted runner, has it code signed by SignPath, signs the
#      updater manifest over the signed installer, and publishes the
#      GitHub release with the MSI and latest.json
#
# Nothing is built or signed on this machine on purpose: the code signing
# certificate is only issued to binaries that provably came out of the
# release workflow in this repository. See CODE_SIGNING.md.
#
# For a local test build - unsigned, not published - run:
#   npm run tauri -- build --bundles msi
# ============================================================


Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "          AMETHYST LAUNCHER RELEASE" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""


# ============================================================
# 1. VERSION VALIDATION
# ============================================================

if ($Version -notmatch '^\d+\.\d+\.\d+$') {

    Write-Host ""
    Write-Host "ERROR: Invalid version format." -ForegroundColor Red
    Write-Host ""
    Write-Host "Correct example:" -ForegroundColor Yellow
    Write-Host "1.2.0"
    Write-Host ""

    exit 1
}

$Tag = "v$Version"

Write-Host "Version : $Version" -ForegroundColor Green
Write-Host "Tag     : $Tag" -ForegroundColor Green
Write-Host ""


# ============================================================
# 2. PROJECT PATHS
# ============================================================

$ProjectRoot = $PSScriptRoot

$Repo = "3aiya/amethyst-launcher"

$Workflow = "release.yml"

$PackageJson = Join-Path $ProjectRoot "package.json"
$PackageLock = Join-Path $ProjectRoot "package-lock.json"
$TauriConfig = Join-Path $ProjectRoot "src-tauri\tauri.conf.json"
$CargoToml   = Join-Path $ProjectRoot "src-tauri\Cargo.toml"
$CargoLock   = Join-Path $ProjectRoot "src-tauri\Cargo.lock"

# Everything this script is allowed to change. Staged by path, so a
# half-finished feature in the working tree never rides along into a
# release commit.
$VersionFiles = @(
    "package.json",
    "package-lock.json",
    "src-tauri/tauri.conf.json",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock"
)

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)


# ============================================================
# 3. CHECK TOOLS AND FILES
# ============================================================

Write-Host "[1/8] Checking tools and project files..." -ForegroundColor Cyan

foreach ($Tool in @("git", "gh", "npm")) {

    if (-not (Get-Command $Tool -ErrorAction SilentlyContinue)) {

        Write-Host ""
        Write-Host "ERROR: $Tool is not installed or not on PATH." -ForegroundColor Red
        Write-Host ""

        exit 1
    }
}

$Required = @(
    $PackageJson,
    $PackageLock,
    $TauriConfig,
    $CargoToml,
    $CargoLock,
    (Join-Path $ProjectRoot ".github\workflows\$Workflow")
)

foreach ($File in $Required) {

    if (-not (Test-Path $File)) {

        Write-Host ""
        Write-Host "ERROR: Required file not found:" -ForegroundColor Red
        Write-Host $File -ForegroundColor Yellow
        Write-Host ""

        exit 1
    }
}

$TauriContent = Get-Content $TauriConfig -Raw

try {

    $null = $TauriContent | ConvertFrom-Json

}
catch {

    throw "tauri.conf.json is invalid JSON. Fix it before releasing."
}

Write-Host "Tools and project files OK." -ForegroundColor Green


# ============================================================
# 4. CHECK GIT AND GITHUB
# ============================================================

Write-Host ""
Write-Host "[2/8] Checking git and GitHub..." -ForegroundColor Cyan

Push-Location $ProjectRoot

try {

    $OldPreference = $ErrorActionPreference

    try {

        $ErrorActionPreference = "Continue"

        git rev-parse --is-inside-work-tree *> $null

        $InRepo = ($LASTEXITCODE -eq 0)

    }
    finally {

        $ErrorActionPreference = $OldPreference
    }

    if (-not $InRepo) {

        throw "This folder is not a git repository."
    }

    $Branch = (git rev-parse --abbrev-ref HEAD).Trim()

    if ($Branch -eq "HEAD") {

        throw "HEAD is detached. Check out a branch before releasing."
    }

    if (-not $BumpOnly) {

        $AuthOutput = gh auth status 2>&1

        if ($LASTEXITCODE -ne 0) {

            Write-Host ""
            Write-Host "GitHub authentication failed. Run:" -ForegroundColor Red
            Write-Host ""
            Write-Host "gh auth login"
            Write-Host ""

            exit 1
        }
    }

    if (-not $BumpOnly) {

        # The bundler cannot produce updater artifacts without the signing
        # key, so a missing secret means a guaranteed failure ten minutes
        # into the run. Catch it here instead.
        $Secrets = gh secret list --repo $Repo --json name 2>$null

        if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($Secrets)) {

            $Names = ($Secrets | ConvertFrom-Json).name

        }
        else {

            $Names = @()
        }

        $Missing = @(
            "TAURI_SIGNING_PRIVATE_KEY",
            "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"
        ) | Where-Object { $Names -notcontains $_ }

        if ($Missing.Count -gt 0) {

            Write-Host ""
            Write-Host "ERROR: the release workflow needs these repository secrets:" -ForegroundColor Red
            Write-Host ""

            foreach ($Name in $Missing) {

                Write-Host "  $Name" -ForegroundColor Yellow
            }

            Write-Host ""
            Write-Host "Set them once with:" -ForegroundColor Yellow
            Write-Host ""
            Write-Host "gh secret set TAURI_SIGNING_PRIVATE_KEY --repo $Repo < `"`$env:USERPROFILE\.tauri\amethyst.key`""
            Write-Host "gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo $Repo"
            Write-Host ""

            exit 1
        }
    }

    # An existing tag would make the workflow rebuild an old commit, so
    # it has to be dealt with before anything is written.
    $TagExists = $false

    $OldPreference = $ErrorActionPreference

    try {

        $ErrorActionPreference = "Continue"

        git rev-parse --verify "refs/tags/$Tag" *> $null

        $TagExists = ($LASTEXITCODE -eq 0)

    }
    finally {

        $ErrorActionPreference = $OldPreference
    }

    if ($TagExists -and -not $ForceTag) {

        Write-Host ""
        Write-Host "ERROR: Tag $Tag already exists." -ForegroundColor Red
        Write-Host ""
        Write-Host "Release a new version instead, or re-run with -ForceTag to move it." -ForegroundColor Yellow
        Write-Host ""

        exit 1
    }

    # Only the version files are committed. Anything else that is dirty
    # would be left out of the release, which is almost never intended.
    $Dirty = @(
        git status --porcelain |
            ForEach-Object { $_.Substring(3).Trim('"') } |
            Where-Object { $VersionFiles -notcontains $_ }
    )

    if ($Dirty.Count -gt 0 -and -not $AllowDirty) {

        Write-Host ""
        Write-Host "ERROR: Uncommitted changes that would not be in the release:" -ForegroundColor Red
        Write-Host ""

        foreach ($File in $Dirty) {

            Write-Host "  $File" -ForegroundColor Yellow
        }

        Write-Host ""
        Write-Host "Commit or stash them first, or re-run with -AllowDirty." -ForegroundColor Yellow
        Write-Host ""

        exit 1
    }

}
finally {

    Pop-Location
}

Write-Host "Git OK (branch: $Branch)." -ForegroundColor Green


# ============================================================
# 5. BUMP THE VERSION
#
# All five files have to agree: the release workflow refuses to build
# when they don't, because SignPath requires the version metadata in the
# signed binary to match the release.
# ============================================================

Write-Host ""
Write-Host "[3/8] Updating package.json and package-lock.json..." -ForegroundColor Cyan

Push-Location $ProjectRoot

try {

    npm version $Version --no-git-tag-version --allow-same-version | Out-Null

    if ($LASTEXITCODE -ne 0) {

        throw "npm version failed."
    }

}
finally {

    Pop-Location
}

Write-Host "package.json and package-lock.json updated." -ForegroundColor Green


Write-Host ""
Write-Host "[4/8] Updating tauri.conf.json..." -ForegroundColor Cyan

$VersionPattern = '"version"\s*:\s*"[^"]+"'

if ($TauriContent -notmatch $VersionPattern) {

    throw "Could not find the version field in tauri.conf.json."
}

$TauriContent = [regex]::Replace(
    $TauriContent,
    $VersionPattern,
    '"version": "' + $Version + '"',
    1
)

# The updater needs these artifacts; without them the workflow has
# nothing to generate latest.json from.
if ($TauriContent -notmatch '"createUpdaterArtifacts"\s*:') {

    $TargetsPattern = '("targets"\s*:\s*"[^"]+"\s*,?)'

    if ($TauriContent -notmatch $TargetsPattern) {

        throw "Could not find bundle.targets in tauri.conf.json."
    }

    $TauriContent = [regex]::Replace(
        $TauriContent,
        $TargetsPattern,
        '$1' + [Environment]::NewLine + '    "createUpdaterArtifacts": true,',
        1
    )
}

[System.IO.File]::WriteAllText($TauriConfig, $TauriContent, $Utf8NoBom)

try {

    $null = Get-Content $TauriConfig -Raw | ConvertFrom-Json

}
catch {

    throw "tauri.conf.json became invalid after modification."
}

Write-Host "tauri.conf.json updated." -ForegroundColor Green


Write-Host ""
Write-Host "[5/8] Updating Cargo.toml and Cargo.lock..." -ForegroundColor Cyan

$CargoContent = Get-Content $CargoToml -Raw

$CargoVersionPattern = '(?m)^version\s*=\s*"[^"]+"'

if ($CargoContent -notmatch $CargoVersionPattern) {

    throw "Could not find the package version in Cargo.toml."
}

$CargoContent = [regex]::Replace(
    $CargoContent,
    $CargoVersionPattern,
    'version = "' + $Version + '"',
    1
)

[System.IO.File]::WriteAllText($CargoToml, $CargoContent, $Utf8NoBom)

# Cargo.lock records the version of this crate too. Leaving it behind
# makes `cargo check --locked` in CI fail on the very next push.
$LockContent = Get-Content $CargoLock -Raw

$LockPattern = '(?m)(^name = "amethyst-launcher"\r?\nversion = ")[^"]+(")'

if ($LockContent -notmatch $LockPattern) {

    throw "Could not find the amethyst-launcher entry in Cargo.lock."
}

$LockContent = [regex]::Replace(
    $LockContent,
    $LockPattern,
    '${1}' + $Version + '${2}',
    1
)

[System.IO.File]::WriteAllText($CargoLock, $LockContent, $Utf8NoBom)

Write-Host "Cargo.toml and Cargo.lock updated." -ForegroundColor Green


if ($BumpOnly) {

    Write-Host ""
    Write-Host "-BumpOnly: version files written, nothing committed or pushed." -ForegroundColor Yellow
    Write-Host ""

    exit 0
}


# ============================================================
# 6. COMMIT AND PUSH
# ============================================================

Write-Host ""
Write-Host "[6/8] Committing and pushing the version bump..." -ForegroundColor Cyan

Push-Location $ProjectRoot

try {

    git add -- $VersionFiles

    if ($LASTEXITCODE -ne 0) {

        throw "git add failed."
    }

    $Staged = git diff --cached --name-only

    if ([string]::IsNullOrWhiteSpace($Staged)) {

        Write-Host "Version files already at $Version - nothing to commit." -ForegroundColor Yellow

    }
    else {

        git commit -m "chore(release): v$Version"

        if ($LASTEXITCODE -ne 0) {

            throw "git commit failed."
        }
    }

    git push origin "HEAD:refs/heads/$Branch"

    if ($LASTEXITCODE -ne 0) {

        throw "git push failed. Pull the remote first:`ngit pull --rebase origin $Branch"
    }

    Write-Host "Pushed to $Branch." -ForegroundColor Green

}
finally {

    Pop-Location
}


# ============================================================
# 7. TAG - THIS IS WHAT STARTS THE RELEASE
# ============================================================

Write-Host ""
Write-Host "[7/8] Tagging $Tag..." -ForegroundColor Cyan

Push-Location $ProjectRoot

try {

    if ($ForceTag) {

        git tag -f -a $Tag -m "Amethyst Launcher $Version"

    }
    else {

        git tag -a $Tag -m "Amethyst Launcher $Version"
    }

    if ($LASTEXITCODE -ne 0) {

        throw "git tag failed."
    }

    if ($ForceTag) {

        git push --force origin "refs/tags/$Tag"

    }
    else {

        git push origin "refs/tags/$Tag"
    }

    if ($LASTEXITCODE -ne 0) {

        throw "Failed to push the tag. The release workflow was not started."
    }

}
finally {

    Pop-Location
}

Write-Host "Tag pushed - the release workflow is starting." -ForegroundColor Green


# ============================================================
# 8. WATCH THE WORKFLOW
#
# The run is identified by the tag: for a tag push GitHub reports the
# tag name as the run's head branch.
# ============================================================

Write-Host ""
Write-Host "[8/8] Waiting for the release workflow..." -ForegroundColor Cyan

if ($NoWatch) {

    Write-Host "-NoWatch: not waiting." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Follow it here:" -ForegroundColor Cyan
    Write-Host "https://github.com/$Repo/actions/workflows/$Workflow"
    Write-Host ""

    exit 0
}

$RunId = $null

foreach ($Attempt in 1..30) {

    $Runs = gh run list `
        --repo $Repo `
        --workflow $Workflow `
        --limit 10 `
        --json databaseId,headBranch,createdAt 2>$null

    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($Runs)) {

        $Match = $Runs |
            ConvertFrom-Json |
            Where-Object { $_.headBranch -eq $Tag } |
            Sort-Object createdAt -Descending |
            Select-Object -First 1

        if ($Match) {

            $RunId = $Match.databaseId
            break
        }
    }

    Start-Sleep -Seconds 4
}

if (-not $RunId) {

    Write-Host ""
    Write-Host "The run did not appear within two minutes." -ForegroundColor Yellow
    Write-Host "Check it by hand:" -ForegroundColor Yellow
    Write-Host "https://github.com/$Repo/actions/workflows/$Workflow"
    Write-Host ""

    exit 1
}

Write-Host "Run #$RunId started: https://github.com/$Repo/actions/runs/$RunId" -ForegroundColor Green
Write-Host ""
Write-Host "Once SignPath is live, the build pauses until a maintainer" -ForegroundColor DarkGray
Write-Host "approves the signing request at https://app.signpath.io." -ForegroundColor DarkGray
Write-Host ""

gh run watch $RunId --repo $Repo --exit-status

$Failed = ($LASTEXITCODE -ne 0)

Write-Host ""

if ($Failed) {

    Write-Host "==================================================" -ForegroundColor Red
    Write-Host "          RELEASE FAILED" -ForegroundColor Red
    Write-Host "==================================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Logs:" -ForegroundColor Yellow
    Write-Host "https://github.com/$Repo/actions/runs/$RunId"
    Write-Host ""
    Write-Host "The tag is already pushed, so after fixing the problem" -ForegroundColor Yellow
    Write-Host "re-run the same build from the Actions tab, or:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "gh workflow run $Workflow --repo $Repo -f tag=$Tag"
    Write-Host ""

    exit 1
}

Write-Host "==================================================" -ForegroundColor Green
Write-Host "          RELEASE PUBLISHED" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Release :" -ForegroundColor Cyan
Write-Host "https://github.com/$Repo/releases/tag/$Tag"
Write-Host ""
Write-Host "Updater :" -ForegroundColor Cyan
Write-Host "https://github.com/$Repo/releases/latest/download/latest.json"
Write-Host ""
Write-Host "Uploaded:" -ForegroundColor Cyan
Write-Host "  - Amethyst Launcher_${Version}_x64_en-US.msi"
Write-Host "  - latest.json"
Write-Host ""
