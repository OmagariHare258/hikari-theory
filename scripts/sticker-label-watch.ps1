# 表情标签自动巡检：每周一次（计划任务 SurfCore-StickerLabelWatch，周一 04:30）刷新收藏表情列表，发现「新收藏到 10 张」就
#   1) 刷新本地表情索引（让新表情立刻可用）
#   2) 写 state/sticker-label-queue.json 待打标队列（供 Lead 视觉模型批量补标）
#   3) 通知管理员一次（6 小时内最多一条）
# 真正的「看图打标」需要视觉模型，脚本只负责探测、排队、提醒。
$ErrorActionPreference = 'Continue'
$root   = '%SURFCORE%'
$queueFile = Join-Path $root 'state\sticker-label-queue.json'
$logFile   = Join-Path $root 'state\sticker-label.log'
$key    = 'private:10000001'
$now    = Get-Date

$tok = ''
try { $tok = (Get-Content (Join-Path $root 'state\console-token') -Raw).Trim() } catch {}
if (-not $tok) { exit 0 }

# 读取/刷新表情列表
$list = $null
try {
  $list = Invoke-RestMethod "http://127.0.0.1:3100/api/socialV2/sticker-list?token=$tok" -Method Post -Body ([System.Text.Encoding]::UTF8.GetBytes((@{ key = $key; refresh = $true; count = 200 } | ConvertTo-Json -Compress))) -ContentType 'application/json; charset=utf-8' -TimeoutSec 60
} catch { exit 0 }
if (-not $list -or -not $list.stickers) { exit 0 }

$queue = $null
$firstRun = -not (Test-Path $queueFile)
if (Test-Path $queueFile) { try { $queue = Get-Content $queueFile -Raw | ConvertFrom-Json } catch {} }
$known = @{}
if ($queue -and $queue.known) { foreach ($m in @($queue.known)) { $known[[string]$m] = $true } }
$pending = @()
if ($queue -and $queue.pending) { $pending = @($queue.pending) }
$pendingKeys = @{}
foreach ($p in $pending) { $pendingKeys[[string]$p.md5] = $true }
$lastNotify = ''
if ($queue -and $queue.lastNotifyAt) { $lastNotify = [string]$queue.lastNotifyAt }

$all = @($list.stickers)
$newOnes = @()
if ($firstRun) { $known = @{}; foreach ($s in $all) { if ($s.md5) { $known[[string]$s.md5] = $true } } }
foreach ($s in $all) {
  $md5 = [string]$s.md5
  if (-not $md5) { continue }
  if (-not $known.ContainsKey($md5)) { $newOnes += $s }
}

# 把新出现的表情加入待打标队列（去重、最多 60 条）
foreach ($s in $newOnes) {
  $md5 = [string]$s.md5
  if ($pendingKeys.ContainsKey($md5)) { continue }
  $pending += [pscustomobject]@{ no = [int]$s.no; md5 = $md5; url = [string]$s.url; emotion = [string]$s.emotionLabel; content = [string]$s.content; addedAt = (Get-Date -Format 'yyyy-MM-dd HH:mm') }
  $pendingKeys[$md5] = $true
}
if ($pending.Count -gt 60) { $pending = $pending[($pending.Count - 60)..($pending.Count - 1)] }

# 新收藏达到 10 张 → 提醒管理员（6 小时一条）
if ($newOnes.Count -ge 10) {
  $canNotify = $true
  if ($lastNotify) { try { if (($now - [datetime]$lastNotify).TotalHours -lt 6) { $canNotify = $false } } catch {} }
  if ($canNotify) {
    $msg = "收藏表情新增了 $($newOnes.Count) 张，已经有 $($pending.Count) 张排队等打标。对小光说「更新表情标签」，小光就会看完图把它们标好。"
    try {
      Invoke-RestMethod "http://127.0.0.1:3100/api/notify/owner?token=$tok" -Method Post -Body ([System.Text.Encoding]::UTF8.GetBytes((@{ title = '表情标签待更新'; message = $msg } | ConvertTo-Json -Compress))) -ContentType 'application/json; charset=utf-8' -TimeoutSec 25 | Out-Null
      $lastNotify = $now.ToString('yyyy-MM-dd HH:mm:ss')
      Add-Content -Path $logFile -Value ("[{0}] 通知管理员：新增 {1} 张，待打标 {2} 张" -f $now.ToString('yyyy-MM-dd HH:mm:ss'), $newOnes.Count, $pending.Count)
    } catch {}
  }
}

# 全量列表作为下一次的已知基线
$knownAll = @($all | ForEach-Object { [string]$_.md5 } | Where-Object { $_ })
$out = [ordered]@{
  updatedAt = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
  total = $all.Count
  pending = @($pending)
  known = $knownAll
  lastNotifyAt = $lastNotify
}
$out | ConvertTo-Json -Depth 6 | Set-Content $queueFile -Encoding utf8
Add-Content -Path $logFile -Value ("[{0}] 巡检：total={1} new={2} pending={3}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $all.Count, $newOnes.Count, $pending.Count)



