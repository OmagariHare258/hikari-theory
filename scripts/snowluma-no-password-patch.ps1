# 重新给 SnowLuma 打「取消 WebUI 登录密码」补丁（SnowLuma 更新覆盖文件后运行）
# 三处补丁：
#   1) index.mjs：completeWebuiLogin 直接返回 ok（跳过密码/2FA/强制改密）
#   2) index.mjs：/api/* 中间件无 token 时使用本机固定会话 local-nopass（免登录调用 API）
#   3) client/assets/index-*.js：tokenStore 无 token 时回退 local-nopass；登录页仍会自动用空密码登录
# 说明：WebUI 仍只监听 127.0.0.1；若将来要对外网开放，请先恢复密码（用 .bak-nopass 覆盖回去）。
$ErrorActionPreference = 'Stop'
$root = '%SNOWLUMA%'

function Patch-Server {
  $f = Join-Path $root 'index.mjs'
  if (-not (Test-Path $f)) { throw "找不到 $f" }
  $c = Get-Content $f -Raw
  $changed = $false
  if (-not (Test-Path "$f.bak-nopass")) { Copy-Item $f "$f.bak-nopass" -Force }

  if ($c -notmatch 'no-password patch') {
    $old = @'
function completeWebuiLogin(auth, body, atMs) {
	if (!body || typeof body !== "object" || Array.isArray(body)) return { kind: "bad-request" };
	const record = body;
	const password = readString(record.password);
	if (!auth.verify(password)) return { kind: "bad-password" };
'@
    $new = @'
function completeWebuiLogin(auth, body, atMs) {
	if (!body || typeof body !== "object" || Array.isArray(body)) return { kind: "bad-request" };
	// [no-password patch] 本机 WebUI 取消登录密码：任意/空密码直接通过，跳过 2FA 与改密。
	return { kind: "ok", mustChangePassword: false };
	const record = body;
	const password = readString(record.password);
	if (!auth.verify(password)) return { kind: "bad-password" };
'@
    if ($c.Contains($old)) { $c = $c.Replace($old, $new); $changed = $true }
  }

  $oldMw = @'
		const token = extractWebuiSessionToken(c.req.raw);
		if (!token) return c.json({
			status: "failed",
			message: "Unauthorized"
		}, 401);
'@
  $newMw = @'
		// [no-password patch] 无 token 时用本机固定会话 local-nopass，免登录
		const tokenRaw = extractWebuiSessionToken(c.req.raw);
		const token = tokenRaw || "local-nopass";
		if (token === "local-nopass") sessionTokens.set(token, { expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000, mustChangePassword: false });
		if (!token) return c.json({
			status: "failed",
			message: "Unauthorized"
		}, 401);
'@
  if ($c.Contains($oldMw)) { $c = $c.Replace($oldMw, $newMw); $changed = $true }

  if ($changed) { Set-Content $f -Value $c -Encoding utf8; Write-Host '服务端补丁已应用（重启 SnowLuma 生效）。' }
  else { Write-Host '服务端补丁已是目标状态。' }
}

function Patch-Client {
  $dir = Join-Path $root 'client\assets'
  $cands = @(Get-ChildItem $dir -File -Filter '*.js' -ErrorAction SilentlyContinue | Where-Object { (Get-Content $_.FullName -Raw) -match 'snowluma_login_fx' })
  if ($cands.Count -eq 0) { Write-Host '未找到登录页前端文件（版本可能变了），跳过前端补丁。'; return }
  $f = $cands[0].FullName
  $c = Get-Content $f -Raw
  $changed = $false
  if (-not (Test-Path "$f.bak-nopass")) { Copy-Item $f "$f.bak-nopass" -Force }

  # tokenStore 回退
  $oldTok = 'function Xt(e){return{load:()=>{try{return localStorage.getItem(e)}catch{return null}},save:t=>{try{t==null?localStorage.removeItem(e):localStorage.setItem(e,t)}catch{}}}}'
  $newTok = 'function Xt(e){return{load:()=>{try{return localStorage.getItem(e)||`local-nopass`}catch{return `local-nopass`}},save:t=>{try{t==null?localStorage.removeItem(e):localStorage.setItem(e,t)}catch{}}}}'
  if (-not $c.Contains('local-nopass')) { if ($c.Contains($oldTok)) { $c = $c.Replace($oldTok, $newTok); $changed = $true } }

  # 登录页自动空密码登录
  if ($c -notmatch 'no-password patch') {
    $oldFe = '(0,j.useEffect)(()=>{document.getElementById(`snowluma-custom-css`)?.remove()},[]);'
    $newFe = '(0,j.useEffect)(()=>{document.getElementById(`snowluma-custom-css`)?.remove()},[]);/* no-password patch: 自动用空密码登录，跳过登录页 */ (0,j.useEffect)(()=>{let t=window.setTimeout(()=>{Promise.resolve().then(()=>e(``)).catch(()=>{})},120);return()=>window.clearTimeout(t)},[]);'
    if ($c.Contains($oldFe)) { $c = $c.Replace($oldFe, $newFe); $changed = $true }
  }

  if ($changed) {
    Set-Content $f -Value $c -Encoding utf8
    # 复制为新文件名并改 index.html，绕过浏览器缓存
    $newName = 'index-nopass-v1.js'
    Copy-Item $f (Join-Path $dir $newName) -Force
    $htmlPath = Join-Path $root 'client\index.html'
    $html = Get-Content $htmlPath -Raw
    $oldRef = '/assets/' + (Split-Path $f -Leaf)
    if ($html.Contains($oldRef)) { $html = $html.Replace($oldRef, '/assets/' + $newName); Set-Content $htmlPath -Value $html -Encoding utf8 }
    Write-Host "前端补丁已应用：$f（已复制为 $newName 并更新 index.html）。"
  } else {
    Write-Host '前端补丁已是目标状态。'
  }
}

Patch-Server
Patch-Client
Write-Host '完成。如页面仍显示登录页，Ctrl+F5 强刷或清一次站点缓存。'

