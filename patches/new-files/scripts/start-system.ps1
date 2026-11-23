param(
  [switch]$NoStart,
  [switch]$SkipHealth
)
$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$cfgPath = Join-Path $root 'config.json'
$cfg = $null
try { $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json } catch {}

function PortOpen([int]$port) {
  return (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0
}

if (-not $NoStart) {
  # 1) SnowLuma（QQ 客户端需已登录机器人号；hookAutoLoad 自动挂接）
  $slHome = if ($cfg?.snowluma?.homeDir) { [string]$cfg.snowluma.homeDir } else { 'C:\SnowLuma' }
  $slEnsure = Join-Path $slHome 'ensure-snowluma.ps1'
  if (Test-Path $slEnsure) {
    & $slEnsure
    for ($i = 0; $i -lt 24 -and -not (PortOpen 5099); $i++) { Start-Sleep -Seconds 2 }
  }

  # 2) 桥接
  if (-not (PortOpen ([int]($cfg?.consolePort ?? 3100)))) {
    $node = 'node'
    $nodeCandidates = @(
      "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe",
      'C:\Program Files\nodejs\node.exe'
    )
    foreach ($candidate in $nodeCandidates) { if (Test-Path $candidate) { $node = $candidate; break } }
    Start-Process -FilePath $node -ArgumentList (Join-Path $root 'src\bridge.js') -WorkingDirectory $root -WindowStyle Hidden
    for ($i = 0; $i -lt 30 -and -not (PortOpen ([int]($cfg?.consolePort ?? 3100))); $i++) { Start-Sleep -Seconds 2 }
  }

  # 3) 语音
  $voiceEnsure = Join-Path $root 'state\tools\ensure-voice.ps1'
  if (Test-Path $voiceEnsure) { & $voiceEnsure }
}

if (-not $SkipHealth) {
  $health = Join-Path $PSScriptRoot 'system-health.mjs'
  if (Test-Path $health) { & node $health }
}
