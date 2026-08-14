$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$env:PYTHONIOENCODING = "utf-8"
$env:PYTHONUTF8 = "1"
$env:PYTHONPATH = $root
$env:VIRTUAL_ENV = Join-Path $root "YouTube_env"
$env:CONDA_DEFAULT_ENV = $null
$env:CONDA_EXE = $null
$env:CONDA_PREFIX = $null
$env:CONDA_PROMPT_MODIFIER = $null
$env:CONDA_PYTHON_EXE = $null
$env:CONDA_SHLVL = $null
$env:_CONDA_EXE = $null
$env:_CONDA_ROOT = $null
$env:Path = "$(Join-Path $root 'YouTube_env\Scripts');$env:SystemRoot\system32;$env:SystemRoot;$env:SystemRoot\System32\Wbem;$env:SystemRoot\System32\WindowsPowerShell\v1.0"

$proxySettings = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
if ($proxySettings.ProxyEnable -eq 1 -and $proxySettings.ProxyServer) {
    $proxy = $proxySettings.ProxyServer
    if ($proxy -notmatch "^[a-zA-Z][a-zA-Z0-9+.-]*://") {
        $proxy = "http://$proxy"
    }
    $env:HTTP_PROXY = $proxy
    $env:HTTPS_PROXY = $proxy
}

& ".\YouTube_env\Scripts\python.exe" "-m" "avtdl.avtdl" "--config" "config.youtube.yml"
