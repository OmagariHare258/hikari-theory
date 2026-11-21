# B站 养号状态巡检（每天跑一次）
#
# 用途：新设备/改密后，B站 会把评论打成 state=17（仅自己可见）。
# 这个脚本每天检查一条「哨兵评论」是否已公开；公开后写 state-ok.json 并（可选）发私信提醒。
#
# 用法：
#   pwsh -File bili-state-watch.ps1 -Rpid <评论rpid> -Oid <视频aid> [-Notify]
#
# 说明：
#   - 需要本机有 surfcore 的 bili.mjs（路径见 $Mjs，可用环境变量覆盖）
#   - 结果追加到 ~/.dsh/surfcore/bili/state-watch.log
#   - 检测到公开后写 state-ok.json，方便插件/人后续处理
param(
  [Parameter(Mandatory = $true)][string]$Rpid,
  [Parameter(Mandatory = $true)][string]$Oid,
  [switch]$Notify,
  [string]$Mjs = (Join-Path $PSScriptRoot '..\plugins\surfcore\tools\bili.mjs'),
  [string]$StateDir = (Join-Path $HOME '.dsh\surfcore\bili')
)

$ErrorActionPreference = 'SilentlyContinue'
$log = Join-Path $StateDir 'state-watch.log'
$okFile = Join-Path $StateDir 'state-ok.json'
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Write-Error '找不到 node'; exit 1 }

$out = & $node $Mjs check-comment --rpid $Rpid --oid $Oid 2>&1 | Out-String
$ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
Add-Content -Path $log -Value "[$ts] $($out.Trim())" -Encoding utf8

$hidden = $out -match '不存在|没找到|查不到|已被删|404'
if (-not $hidden) {
  @{ at = (Get-Date).ToString('o'); rpid = $Rpid; note = '评论已公开（state 不再隐藏）' } |
    ConvertTo-Json | Set-Content $okFile -Encoding utf8
  Add-Content -Path $log -Value "[$ts] OK：评论已公开" -Encoding utf8
  if ($Notify) {
    & $node $Mjs dm --msg "小光的B站评论好像恢复正常了，不再只有自己可见。" --go 2>&1 | Out-Null
  }
} else {
  Add-Content -Path $log -Value "[$ts] still hidden" -Encoding utf8
}
