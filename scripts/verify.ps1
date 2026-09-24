$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$projects = @('backend (updated)', 'help_backend', 'frontend', 'helpdesk_frontend', 'contract')

foreach ($project in $projects) {
  $path = Join-Path $root $project
  Write-Host "Testing $project"
  Push-Location $path
  try { npm test } finally { Pop-Location }
}

foreach ($project in @('frontend', 'helpdesk_frontend', 'contract')) {
  $path = Join-Path $root $project
  Write-Host "Building $project"
  Push-Location $path
  try { npm run build } finally { Pop-Location }
}

Write-Host 'All tests and builds completed.'
