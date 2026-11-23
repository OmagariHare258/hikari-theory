# 可引导安装脚本（自动部分）
# 用法：
#   pwsh -File scripts/bootstrap.ps1                     # 默认装到 $HOME\surfcore
#   pwsh -File scripts/bootstrap.ps1 -TargetDir D:\srv\surfcore
#   pwsh -File scripts/bootstrap.ps1 -SkipDeps           # 只准备代码，不装依赖
# 说明：这个脚本只做"检查 + 拉代码 + 复制文件 + 尝试打补丁 + 装依赖"。
#      登录 QQ、填 token、扫码、发消息验证这些必须人工完成，见 BOOTSTRAP.md。

[CmdletBinding()]
param(
  [string]$TargetDir = (Join-Path $HOME 'surfcore'),
  [string]$UpstreamUrl = 'https://github.com/Mieksido/surfcore.git',
  [string]$BaseCommit = '0deb826',
  [switch]$SkipDeps,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$repoDir = Split-Path -Parent $PSScriptRoot

function Info($msg) { Write-Host "[bootstrap] $msg" }
function Warn($msg) { Write-Host "[bootstrap] $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "[bootstrap] $msg" -ForegroundColor Red; exit 1 }

# ---------- 0. 环境检查 ----------
Info "检查基础环境"
if ($PSVersionTable.PSVersion.Major -lt 7) { Warn '建议使用 PowerShell 7，旧版本可能不兼容脚本语法。' }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail '找不到 git，请先安装 Git。' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail '找不到 node，请先安装 Node.js 20+。' }
$nodeVersion = (& node -v)
Info "Node: $nodeVersion"
if ([int](($nodeVersion -replace '^v','') -split '\.')[0] -lt 20) { Warn 'Node 版本低于 20，可能缺少需要的 API。' }
try {
  $api = Invoke-WebRequest 'https://api.github.com' -TimeoutSec 10 -UseBasicParsing
  Info "GitHub API 可达：$($api.StatusCode)"
} catch {
  Warn 'GitHub API 不可达。后续 clone 可能失败；可以先把仓库下载成 zip 再运行本脚本。'
}

# ---------- 1. 仓库完整性 ----------
foreach ($needed in @('README.md','AGENTS.md','patches','character','examples')) {
  if (-not (Test-Path (Join-Path $repoDir $needed))) { Fail "仓库不完整，缺少 $needed。请确认脚本位于仓库的 scripts/ 目录下。" }
}
Info "仓库目录：$repoDir"

# ---------- 2. 准备 SurfCore ----------
if (Test-Path $TargetDir) {
  if (-not (Test-Path (Join-Path $TargetDir '.git'))) {
    Fail "目标目录已存在且不是 git 仓库：$TargetDir。换一个 -TargetDir，或手动处理后再试。"
  }
  Info "目标目录已存在，按增量继续：$TargetDir"
} else {
  Info "克隆上游 SurfCore 到 $TargetDir"
  & git clone $UpstreamUrl $TargetDir
  if ($LASTEXITCODE -ne 0) { Fail '克隆 SurfCore 失败。检查网络，或手动 clone 后重跑（保留 -TargetDir）。' }
}

Push-Location $TargetDir
try {
  $head = (& git rev-parse --short HEAD).Trim()
  Info "当前 HEAD：$head"
  if ($head -ne $BaseCommit) {
    Warn "HEAD 与补丁基准 $BaseCommit 不一致，尝试检出基准版本（失败就继续按当前版本打补丁）"
    & git checkout $BaseCommit 2>$null
    if ($LASTEXITCODE -ne 0) { Warn "检出 $BaseCommit 失败，继续在当前版本上尝试。" }
  }

  # ---------- 3. 打补丁（先补丁，后复制新文件） ----------
  # 顺序很重要：全量补丁里包含 new-files 的新增文件；先复制再打补丁会报
  # "does not exist in index"。先把补丁应用到干净基准，再补 new-files 缺的文件。
  $patch = Join-Path $repoDir 'patches\surfcore-local-updates.patch'
  $corePatch = Join-Path $repoDir 'patches\surfcore-tracked-changes.patch'
  $applied = $false
  if (Test-Path $patch) {
    Info '尝试应用全量补丁（surfcore-local-updates.patch）'
    & git apply --check --whitespace=nowarn $patch 2>$null
    if ($LASTEXITCODE -eq 0) {
      & git apply --whitespace=nowarn $patch
      if ($LASTEXITCODE -eq 0) { $applied = $true; Info '全量补丁应用成功。' }
    } else {
      Warn '直接应用失败，尝试 --3way 合并。'
      & git apply --check --3way --whitespace=nowarn $patch 2>$null
      if ($LASTEXITCODE -eq 0) {
        & git apply --3way --whitespace=nowarn $patch
        if ($LASTEXITCODE -eq 0) { $applied = $true; Info '全量补丁（--3way）应用成功。' }
      }
    }
  } else { Warn '没有找到全量补丁，跳过。' }

  if (-not $applied -and (Test-Path $corePatch)) {
    Warn '全量补丁未应用，退回核心子集（surfcore-tracked-changes.patch）。新增功能可能缺失。'
    & git apply --check --3way --whitespace=nowarn $corePatch 2>$null
    if ($LASTEXITCODE -eq 0) {
      & git apply --3way --whitespace=nowarn $corePatch
      if ($LASTEXITCODE -eq 0) { Info '核心子集补丁应用成功。' }
    } else {
      Warn '核心补丁也有冲突。请按 patches/README.md 手工移植。'
      & git status --short | Select-Object -First 20 | ForEach-Object { Write-Host "  $_" }
    }
  }

  # ---------- 4. 复制新增文件 ----------
  $newFilesDir = Join-Path $repoDir 'patches\new-files'
  if (Test-Path $newFilesDir) {
    Info '复制 patches/new-files 中补丁未覆盖的新文件'
    Get-ChildItem $newFilesDir -Recurse -File | ForEach-Object {
      $rel = $_.FullName.Substring($newFilesDir.Length + 1)
      $dst = Join-Path $TargetDir $rel
      $dstDir = Split-Path $dst -Parent
      if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Force -Path $dstDir | Out-Null }
      if (Test-Path $dst) { Info "已存在，跳过：$rel" }
      else { Copy-Item $_.FullName $dst -Force }
    }
  } else { Warn '没有找到 patches/new-files，跳过复制。' }

  # ---------- 5. 安装依赖 ----------
  if (-not $SkipDeps) {
    Info '安装 npm 依赖（可能较慢）'
    & npm install
    if ($LASTEXITCODE -ne 0) { Warn 'npm install 失败，请检查 Node 版本与网络后手动重试。' }
  } else { Info '已跳过依赖安装（-SkipDeps）。' }

  # ---------- 6. 配置骨架 ----------
  $configPath = Join-Path $TargetDir 'config.json'
  $example = Join-Path $repoDir 'examples\config.example.json'
  if (-not (Test-Path $configPath)) {
    Copy-Item $example $configPath
    Info "已生成配置骨架：$configPath（需要填 QQ、token、端口、白名单）"
  } else { Info "配置已存在，未覆盖：$configPath" }

  # 隐私词表骨架（只在本机；不含真实信息）
  $stateDir = Join-Path $TargetDir 'state'
  if (-not (Test-Path $stateDir)) { New-Item -ItemType Directory -Force -Path $stateDir | Out-Null }
  $privacyExample = Join-Path $repoDir 'examples\privacy.example.json'
  $privacyPath = Join-Path $stateDir 'privacy.json'
  if ((Test-Path $privacyExample) -and -not (Test-Path $privacyPath)) {
    Copy-Item $privacyExample $privacyPath
    Info "已生成隐私词表骨架：$privacyPath（把示例姓名/学校/路径换成你自己的）"
  } else { Info "隐私词表已存在或缺少示例，未覆盖：$privacyPath" }
} finally {
  Pop-Location
}

# ---------- 7. 人工步骤提示 ----------
Write-Host ''
Write-Host '========== 自动部分完成 ==========' -ForegroundColor Green
Write-Host '接下来需要人工/AI 配合完成：'
Write-Host '1) 安装并登录 SnowLuma（机器人 QQ），开启 OneBot HTTP/WS，记下端口与 token。'
Write-Host '2) 在 DSH 里配好模型 provider / API key。'
Write-Host '3) 填写 config.json：机器人 QQ、SnowLuma 地址与 token、DSH 地址、允许的群/私聊。'
Write-Host '4) 按 AGENTS.md 阶段 4 放置角色卡与状态层。'
Write-Host '5) 编辑 state/privacy.json，把示例姓名/学校/路径换成你自己的（只在本机）。'
Write-Host '6) 前台启动桥接并看日志；用另一个 QQ 发消息验证。'
Write-Host '7) 重启一次 DSH，让新的 MCP 工具（跨会话读取、隐私、管理工具）出现在工具列表。'
Write-Host ''
Write-Host "详细清单见 BOOTSTRAP.md；给 AI 的流程见 AGENTS.md。" -ForegroundColor Cyan
Write-Host '提示：token 只写进本机 config.json，不要提交到仓库。'
