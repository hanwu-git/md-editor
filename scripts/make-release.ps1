# Create/update a GitHub Release for the current version and upload dist assets.
# Token is fetched at runtime from git credential manager (never stored in the repo).
# Usage: powershell -ExecutionPolicy Bypass -File scripts\make-release.ps1 -Version 6.0.30 [-Dist <path-to-dist>]
param(
  [string]$Version = "",
  [string]$Dist = ""
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not $Version) {
  $pkg = Get-Content 'package.json' -Raw | ConvertFrom-Json
  $Version = $pkg.version
}
$tag = "v$Version"
Write-Output "Release target: $tag"

$origin = (git remote get-url origin).ToString()
if ($origin -match 'github\.com[:/](.+?)/(.+?)(\.git)?$') { $owner = $Matches[1]; $repo = $Matches[2] } else { throw "cannot parse origin: $origin" }
Write-Output "Repo: $owner/$repo"

# token from credential manager (same credential git push uses);
# stdin via file redirection is the only reliable way under powershell -File
$tmpIn = [IO.Path]::GetTempFileName(); $tmpOut = [IO.Path]::GetTempFileName(); $tmpErr = [IO.Path]::GetTempFileName()
[IO.File]::WriteAllText($tmpIn, "protocol=https`nhost=github.com`n`n")
$p = Start-Process git -ArgumentList 'credential','fill' -RedirectStandardInput $tmpIn -RedirectStandardOutput $tmpOut -RedirectStandardError $tmpErr -NoNewWindow -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "git credential fill failed: $([IO.File]::ReadAllText($tmpErr))" }
$fill = [IO.File]::ReadAllLines($tmpOut)
Remove-Item $tmpIn, $tmpOut, $tmpErr -Force -ErrorAction SilentlyContinue
$token = (($fill | Where-Object { $_.ToString().StartsWith('password=') }) -join '') -replace '^password=', ''
if (-not $token) { throw 'no token obtained from git credential fill' }
$auth = @{ Authorization = "Bearer $token"; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28' }
$api = "https://api.github.com/repos/$owner/$repo"

# release notes = latest commit message (UTF-8 safe)
$body = (git log -1 --pretty=%B) -join "`n"
$payload = @{
  tag_name         = $tag
  target_commitish = 'main'
  name             = $tag
  body             = $body
  draft            = $false
  prerelease       = $false
} | ConvertTo-Json
$bytes = [Text.Encoding]::UTF8.GetBytes($payload)

# create or update release for the tag (idempotent)
$existing = $null
try { $existing = Invoke-RestMethod -Uri "$api/releases/tags/$tag" -Headers $auth } catch {}
if ($existing) {
  $rel = Invoke-RestMethod -Uri "$api/releases/$($existing.id)" -Method Patch -Headers $auth -Body $bytes -ContentType 'application/json'
  Write-Output "Updated existing release $($rel.id)"
} else {
  $rel = Invoke-RestMethod -Uri "$api/releases" -Method Post -Headers $auth -Body $bytes -ContentType 'application/json'
  Write-Output "Created new release"
}

# upload dist assets matching the version (replace existing)
if (-not $Dist) { $Dist = Join-Path (git rev-parse --show-toplevel) 'dist' }
$files = Get-ChildItem $Dist -File | Where-Object { $_.Name -like "*$Version*" }
if (-not $files) { Write-Output "WARN: no dist files matching *$Version* in $Dist" }
foreach ($f in $files) {
  $old = $rel.assets | Where-Object { $_.name -eq $f.Name }
  if ($old) {
    Invoke-RestMethod -Uri "$api/releases/assets/$($old.id)" -Method Delete -Headers $auth | Out-Null
    Write-Output "Replaced old asset: $($f.Name)"
  }
  $upUrl = ($rel.upload_url -replace '\{\?.*$','') + "?name=$([Uri]::EscapeDataString($f.Name))"
  Invoke-RestMethod -Uri $upUrl -Method Post -Headers $auth -InFile $f.FullName -ContentType 'application/octet-stream' | Out-Null
  Write-Output ("Uploaded asset: {0} ({1} KB)" -f $f.Name, [math]::Round($f.Length/1KB))
}
Write-Output "Release URL: $($rel.html_url)"
