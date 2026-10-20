# サーバーが動いていなければ裏で起動して、Chrome のアプリ窓（アドレスバーなし）で開く。start.cmd から呼ばれる
# 窓を出さずに動くので、起動できなかったときはメッセージボックスで知らせる
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$port = if ($env:AVC_PORT) { $env:AVC_PORT } else { 4790 }
$url = "http://127.0.0.1:$port/"

function Test-Up {
    try { (Invoke-RestMethod "$($url)healthz" -TimeoutSec 1).app -eq 'agentview-chat' } catch { $false }
}

function Show-Error([string]$message) {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show($message, 'Agent View Chat', 'OK', 'Error')
}

if (-not (Test-Up)) {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Show-Error 'Node.js が見つかりません。Node.js（20 以降）を入れてから、もう一度 start.cmd を実行してください。'
        exit 1
    }
    $data = Join-Path $root 'data'
    New-Item -ItemType Directory -Force $data | Out-Null
    $errorLog = Join-Path $data 'server-error.log'
    Start-Process $node.Source -ArgumentList 'server.mjs' -WorkingDirectory $root -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $data 'server.log') -RedirectStandardError $errorLog
    for ($i = 0; $i -lt 80 -and -not (Test-Up); $i++) { Start-Sleep -Milliseconds 250 }
    if (-not (Test-Up)) {
        $tail = if (Test-Path $errorLog) { (Get-Content $errorLog -Tail 10) -join "`n" } else { '' }
        Show-Error "サーバーが起動しませんでした。`n`n$tail`n`n（記録: $errorLog）"
        exit 1
    }
}

# AVC_NO_OPEN があれば窓は開かない（サーバーだけ起動する）
if ($env:AVC_NO_OPEN) { exit 0 }
$chrome = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($chrome) { Start-Process $chrome -ArgumentList "--app=$url", '--start-maximized' } else { Start-Process $url }
