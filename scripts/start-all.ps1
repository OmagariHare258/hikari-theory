# 一键启动（电脑重启后使用）：QQ → SnowLuma → DSH → 桥接 → 语音状态检查
# 用法：双击桌面「一键启动.bat」，或在 pwsh7 里运行本脚本。
# 特点：幂等——已经在跑的服务不会重复启动；桥接优先等插件自启，避免双实例。
$ErrorActionPreference = 'SilentlyContinue'
$logFile = '%SURFCORE%\state\startup.log'
$problems = New-Object System.Collections.Generic.List[string]

function Log([string]$msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $logFile -Value $line -Encoding utf8
  Write-Host $msg
}
function Test-Port([int]$port) {
  return ((Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0)
}
function Wait-Port([int]$port, [int]$seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Port $port) { return $true }
    Start-Sleep -Milliseconds 800
  }
  return (Test-Port $port)
}
function Has-Process([string]$name) {
  return [bool](Get-Process -Name $name -ErrorAction SilentlyContinue)
}

Log '========== 一键启动开始 =========='

# ---------- 1. QQ（小光号所在实例）----------
if (Has-Process 'QQ') {
  Log 'QQ 已在运行'
} else {
  Log 'QQ 未运行 → 启动默认实例（请确认它登录的是小光号 10000000）'
  Start-Process 'C:\Program Files\Tencent\QQNT\QQ.exe'
  Start-Sleep -Seconds 10
}

# ---------- 2. SnowLuma（QQ 网关）----------
if ((Test-Port 3000) -and (Test-Port 3001)) {
  Log 'SnowLuma 已在运行（3000/3001）'
} else {
  Log '启动 SnowLuma…'
  Start-Process -FilePath '%SNOWLUMA%\node\node.exe' -ArgumentList '%SNOWLUMA%\index.mjs' -WorkingDirectory '%SNOWLUMA%' -WindowStyle Hidden
  if (Wait-Port 3000 60) {
    Log 'SnowLuma 已就绪（3000/3001）'
  } else {
    Log '⚠️ SnowLuma 60 秒内未监听 3000：请确认 QQ 已登录小光号 10000000（WebUI http://127.0.0.1:5099）'
    $problems.Add('SnowLuma 未就绪')
  }
}

# ---------- 3. DSH 桌面端 ----------
if (Has-Process 'DeepSeek Harness') {
  Log 'DSH 已在运行'
} else {
  Log '启动 DSH 桌面端…'
  Start-Process '%USERPROFILE%\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe'
}
if (Wait-Port 14608 180) {
  Log 'DSH Web 已就绪（14608）'
} else {
  Log '⚠️ DSH Web 180 秒内未就绪；桥接可能连不上，请检查 DSH 窗口'
  $problems.Add('DSH Web 未就绪')
}

# ---------- 4. 桥接（优先等插件自启，避免双实例）----------
if (Test-Port 3100) {
  Log '桥接已在运行（3100）'
} else {
  Log '等待 SurfCore 插件自启桥接（最多 45 秒）…'
  if (Wait-Port 3100 45) {
    Log '桥接已由插件启动（3100）'
  } else {
    Log '插件未自启桥接 → 手动启动'
    Start-Process -FilePath '%USERPROFILE%\AppData\Local\Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe' `
      -ArgumentList '%SURFCORE%\src\bridge.js' -WorkingDirectory '%SURFCORE%' -WindowStyle Hidden
    if (Wait-Port 3100 90) {
      Log '桥接已启动（3100）'
    } else {
      Log '⚠️ 桥接 90 秒内未监听 3100，请查看 %SURFCORE%\state\bridge.log'
      $problems.Add('桥接未就绪')
    }
  }
}

# ---------- 4.5 去重：只保留一个桥接进程 ----------
$bridges = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'bridge\.js' } | Sort-Object CreationDate)
if ($bridges.Count -gt 1) {
  Log ("发现 {0} 个桥接进程 → 保留最早启动的那个，清理多余实例" -f $bridges.Count)
  foreach ($extra in ($bridges | Select-Object -Skip 1)) {
    try { Stop-Process -Id $extra.ProcessId -Force; Log ("已停止重复桥接进程 {0}" -f $extra.ProcessId) } catch {}
  }
}

# ---------- 5. 语音（由插件管理，仅报告）----------
$voxd = Test-Port 8765
$gsv = Test-Port 9880
Log ("语音：voxd 8765 = {0}；GPT-SoVITS 9880 = {1}（由 SurfCore 插件拉起；未就绪时在 设置 → SurfCore → 语音 里启用/预热）" -f $voxd, $gsv)
if (-not $voxd -or -not $gsv) { Log '提示：语音端口未就绪不影响文字聊天，稍等或在插件里点一次语音预热' }

# ---------- 汇总 ----------
Log '========== 一键启动结束 =========='
Write-Host ''
Write-Host '当前状态：'
$rows = @(
  @{ name = 'SnowLuma(3000/3001)'; ok = (Test-Port 3000) -and (Test-Port 3001) },
  @{ name = 'DSH Web(14608)';       ok = Test-Port 14608 },
  @{ name = '桥接(3100)';           ok = Test-Port 3100 },
  @{ name = 'QQ';                   ok = Has-Process 'QQ' },
  @{ name = 'voxd(8765)';           ok = $voxd },
  @{ name = 'GPT-SoVITS(9880)';     ok = $gsv }
)
foreach ($r in $rows) {
  $mark = if ($r.ok) { '✓' } else { '✗' }
  Write-Host ("  {0} {1}" -f $mark, $r.name)
}
Write-Host ''
if ($problems.Count -eq 0) {
  Write-Host '全部就绪。' -ForegroundColor Green
  exit 0
} else {
  Write-Host ('需要处理：' + ($problems -join '；')) -ForegroundColor Yellow
  Write-Host ('日志：' + $logFile)
  exit 1
}

