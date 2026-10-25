# Deploy Torimitor to a linked Supabase cloud project. Run manually from the repo root:
#   powershell -File scripts/deploy.ps1
# Requires: Supabase CLI logged in, Docker not required for this script.
# Compatible with Windows PowerShell 5.1 (the host of `powershell -File`).
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $repoRoot

if ($env:TORIMITOR_ENV_FILE) {
  $envFile = $env:TORIMITOR_ENV_FILE
} else {
  # Nested Join-Path: PowerShell 5.1 accepts only one child path per call.
  $envFile = Join-Path (Join-Path (Split-Path $repoRoot -Parent) "book-discovery-plan") ".env.local"
}

if (-not (Test-Path -LiteralPath $envFile)) {
  Write-Error "Secrets file not found: $envFile. Set TORIMITOR_ENV_FILE to the file holding HARDCOVER_API_KEY."
}

function Get-HardcoverApiKey([string]$path) {
  foreach ($line in Get-Content -LiteralPath $path) {
    $trimmed = $line.Trim()
    if ($trimmed.Length -eq 0) { continue }
    if ($trimmed.StartsWith("#")) { continue }
    $eq = $trimmed.IndexOf("=")
    if ($eq -lt 1) { continue }
    $name = $trimmed.Substring(0, $eq).Trim()
    if ($name -ne "HARDCOVER_API_KEY") { continue }
    $value = $trimmed.Substring($eq + 1).Trim()
    if (
      ($value.Length -ge 2) -and (
        ($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'"))
      )
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    return $value
  }
  return $null
}

$hardcoverKey = Get-HardcoverApiKey $envFile
if ([string]::IsNullOrWhiteSpace($hardcoverKey)) {
  Write-Error "HARDCOVER_API_KEY not found in $envFile."
}

$functions = @("add-book", "book-details", "invite-user", "link-edition", "recommendations")

Write-Host "Linking Supabase project (choose the cloud project if prompted)..."
supabase link
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Pushing database migrations..."
supabase db push
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

foreach ($name in $functions) {
  Write-Host "Deploying function: $name"
  supabase functions deploy $name
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "Setting HARDCOVER_API_KEY from $envFile (this key only)..."
supabase secrets set "HARDCOVER_API_KEY=$hardcoverKey"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Supabase deploy finished. Continue with docs/deploy.md (Pages, Auth URLs, then invite users)."
