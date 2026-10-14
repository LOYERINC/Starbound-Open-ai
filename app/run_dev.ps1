param(
    [int]$Port = 8000,
    [switch]$NoReload
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
$pythonArgs = @()
if (-not $pythonCommand) {
    $pythonCommand = Get-Command py -ErrorAction SilentlyContinue
    if ($pythonCommand) {
        $pythonArgs = @('-3')
    }
}

if (-not $pythonCommand) {
    throw 'Python was not found. Install Python 3 and make sure python or py is on PATH.'
}

$pythonExe = $pythonCommand.Source
& $pythonExe @pythonArgs -c 'import fastapi, uvicorn' 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Installing project requirements...'
    & $pythonExe @pythonArgs -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) {
        throw 'Dependency installation failed.'
    }
}

$listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -First 1
if ($listener) {
    throw "Port $Port is already in use (process $($listener.OwningProcess)). Stop that process or run .\run_dev.ps1 -Port 8001."
}

$uvicornArgs = @('-m', 'uvicorn', 'server.main:app', '--host', '0.0.0.0', '--port', "$Port")
if (-not $NoReload) {
    $uvicornArgs += '--reload'
}

Write-Host "Starting Starbound Run at http://127.0.0.1:$Port"
Write-Host 'Press Ctrl+C to stop the development server.'
$allArgs = @($pythonArgs) + @($uvicornArgs)
& $pythonExe @allArgs
exit $LASTEXITCODE
