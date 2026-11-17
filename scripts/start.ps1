# BTC Station 本地回测启动器
# 由根目录「启动回测.bat」调用。职责：装依赖（首次）→ 起后端 → 起前端 → 等就绪 → 开浏览器

$ErrorActionPreference = 'Continue'
$Root     = Split-Path -Parent $PSScriptRoot
$Backend  = Join-Path $Root 'backend'
$Frontend = Join-Path $Root 'btc-station'
$Host.UI.RawUI.WindowTitle = 'BTC Station 本地回测启动器'

Write-Host '=========================================='
Write-Host '   BTC Station 本地回测启动器'
Write-Host '   后端 127.0.0.1:8000   前端 localhost:3000'
Write-Host '=========================================='
Write-Host ''

function Test-PortListening([int]$Port) {
    return [bool](netstat -ano | Select-String ":$Port\s.*LISTENING")
}

function Wait-Http([string]$Url, [int]$Seconds, [string]$Label) {
    for ($i = 0; $i -lt $Seconds; $i++) {
        try {
            Invoke-WebRequest -UseBasicParsing $Url -TimeoutSec 5 | Out-Null
            Write-Host "[就绪] $Label OK"
            return $true
        } catch {}
        if ($i -eq 0) { Write-Host "[等待] $Label 启动中..." }
        Start-Sleep -Seconds 1
    }
    Write-Host "[警告] $Label ${Seconds} 秒未就绪，请查看对应窗口里的报错"
    return $false
}

# ---------- 首次运行：依赖检查 ----------
if (-not (Test-Path "$Backend\venv\Scripts\python.exe")) {
    Write-Host '[后端] 未找到 venv，正在创建并安装依赖（首次约 3~5 分钟）...'
    python -m venv "$Backend\venv"
    & "$Backend\venv\Scripts\python.exe" -m pip install -r "$Backend\requirements.txt"
    if ($LASTEXITCODE -ne 0) { Write-Host '[失败] 后端依赖安装出错'; Read-Host '按回车退出'; exit 1 }
}
if (-not (Test-Path "$Frontend\node_modules")) {
    Write-Host '[前端] 未找到 node_modules，正在 npm install...'
    Push-Location $Frontend
    cmd /c 'npm install'
    Pop-Location
    if ($LASTEXITCODE -ne 0) { Write-Host '[失败] 前端依赖安装出错'; Read-Host '按回车退出'; exit 1 }
}

# ---------- 后端 ----------
if (Test-PortListening 8000) {
    Write-Host '[后端] 8000 端口已有服务，跳过启动'
} else {
    Write-Host '[后端] 启动 FastAPI...'
    Start-Process cmd.exe -WorkingDirectory $Backend -ArgumentList '/k', 'title BTC Station 后端（关闭此窗口即停止） && venv\Scripts\uvicorn.exe main:app --host 127.0.0.1 --port 8000'
}

# ---------- 前端（固定 3000 端口，代理指向本地后端）----------
if (Test-PortListening 3000) {
    Write-Host '[前端] 3000 端口已有服务，跳过启动'
} else {
    Write-Host '[前端] 启动 Next.js...'
    $env:BACKEND_URL = 'http://127.0.0.1:8000'
    Start-Process cmd.exe -WorkingDirectory $Frontend -ArgumentList '/k', 'title BTC Station 前端（关闭此窗口即停止） && npm run dev -- -p 3000'
}

# ---------- 等待就绪 ----------
Write-Host ''
Wait-Http 'http://127.0.0.1:8000/api/templates' 60 '后端' | Out-Null
Wait-Http 'http://localhost:3000' 90 '前端' | Out-Null

# ---------- 打开浏览器 ----------
Write-Host ''
Write-Host '[完成] 正在打开 http://localhost:3000/strategy'
Start-Process 'http://localhost:3000/strategy'
Write-Host ''
Write-Host '停止服务：关闭「后端」「前端」两个窗口即可。本窗口 5 秒后自动关闭。'
Start-Sleep -Seconds 5
