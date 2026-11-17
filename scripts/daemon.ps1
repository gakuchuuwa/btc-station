# BTC Station 公网后端守护进程
# 职责：常驻 127.0.0.1:8000 的 FastAPI 后端 + Cloudflare 隧道（api.quant-lab.org）
# 由登录启动项 BTC-Station-Public.vbs 拉起；子进程意外退出会自动重启。
# 日志：<项目根>\logs\backend.log、backend.err.log、tunnel.err.log、daemon.log

$ErrorActionPreference = 'Continue'

$Root        = Split-Path -Parent $PSScriptRoot
$Backend     = Join-Path $Root 'backend'
$LogDir      = Join-Path $Root 'logs'
$Python      = Join-Path $Backend 'venv\Scripts\python.exe'
$Cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
$TunnelName  = 'btc-backend'
$Port        = 8000

# 后端冷启动（venv shim → 真 python → import vectorbt/numba）实测需 10~40 秒，
# 冷却期内一律不判死、不重复拉起，否则会起出多个实例互相抢端口。
$StartCooldownSeconds = 90
$WatchdogInterval     = 30

# 状态
$script:LastBackendStart = [datetime]::MinValue
$script:LastTunnelStart  = [datetime]::MinValue

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

function Write-Log([string]$Message) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -Path (Join-Path $LogDir 'daemon.log') -Value $line -Encoding UTF8
}

function Test-PortListening([int]$P) {
    return [bool](netstat -ano | Select-String ":$P\s+0\.0\.0\.0:0\s+LISTENING|:$P\s+\[::\]:0\s+LISTENING|:$P\s+127\.0\.0\.1:0\s+LISTENING")
}

# 只按端口取证，绝不用命令行模糊匹配 —— 本机还有别的程序（VoiceStudio）也跑
# "python -m uvicorn main:app"，模糊匹配会误杀。
function Get-PortOwner([int]$P) {
    $ids = @()
    foreach ($line in (netstat -ano | Select-String ":$P\s+\S+\s+LISTENING")) {
        $id = ($line -split '\s+')[-1]
        if ($id -match '^\d+$') { $ids += [int]$id }
    }
    return ($ids | Sort-Object -Unique)
}

function Stop-BackendProcesses {
    foreach ($id in (Get-PortOwner $Port)) {
        Write-Log "清理占用端口 $Port 的遗留进程 PID $id"
        Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    }
}

function Start-Backend {
    Stop-BackendProcesses
    Start-Sleep -Seconds 2
    Write-Log '启动后端 uvicorn...'
    Start-Process -FilePath $Python `
        -ArgumentList '-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', "$Port" `
        -WorkingDirectory $Backend -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $LogDir 'backend.log') `
        -RedirectStandardError  (Join-Path $LogDir 'backend.err.log')
    $script:LastBackendStart = Get-Date
}

function Start-Tunnel {
    Write-Log '启动 Cloudflare 隧道...'
    Start-Process -FilePath $Cloudflared `
        -ArgumentList 'tunnel', 'run', $TunnelName `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $LogDir 'tunnel.log') `
        -RedirectStandardError  (Join-Path $LogDir 'tunnel.err.log')
    $script:LastTunnelStart = Get-Date
}

function Test-Cooldown($lastStart) {
    return ((Get-Date) - $lastStart).TotalSeconds -lt $StartCooldownSeconds
}

Write-Log '===== 守护进程启动 ====='

# 首次检查：端口空就先等，避免和上一次残留实例抢
if (-not (Test-PortListening $Port)) { Start-Backend } else { Write-Log '端口 8000 已占用，跳过后端启动' }
Start-Sleep -Seconds 5
if (-not (Get-Process cloudflared -ErrorAction SilentlyContinue)) { Start-Tunnel } else { Write-Log 'cloudflared 已在运行' }

while ($true) {
    Start-Sleep -Seconds $WatchdogInterval

    # 后端
    if (Test-PortListening $Port) {
        $script:LastBackendStart = [datetime]::MinValue   # 健康，清空冷却计时
    }
    elseif (Test-Cooldown $script:LastBackendStart) {
        Write-Log '后端启动中（冷却期内），暂不干预'
    }
    else {
        Write-Log "后端端口 $Port 无监听且已过冷却期，重启中..."
        Start-Backend
    }

    # 隧道
    if (Get-Process cloudflared -ErrorAction SilentlyContinue) {
        $script:LastTunnelStart = [datetime]::MinValue
    }
    elseif (Test-Cooldown $script:LastTunnelStart) {
        Write-Log '隧道启动中（冷却期内），暂不干预'
    }
    else {
        Write-Log '隧道已停止，重启中...'
        Start-Tunnel
    }
}
