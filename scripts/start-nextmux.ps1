[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runRoot = Join-Path $root '.nextmux-run'
$webUrl = 'http://127.0.0.1:4173/'
$platformUrl = 'http://127.0.0.1:4173'
$startedServices = New-Object System.Collections.Generic.List[System.Diagnostics.Process]
$exitCode = 0

function Write-Step {
    param([string]$Message)
    Write-Host "`n[NextMux] $Message" -ForegroundColor Cyan
}

function Resolve-Pnpm {
    $pnpm = Get-Command 'pnpm.cmd' -ErrorAction SilentlyContinue
    if (-not $pnpm) {
        $pnpm = Get-Command 'pnpm' -ErrorAction SilentlyContinue
    }
    if ($pnpm) {
        return [pscustomobject]@{
            Executable = $pnpm.Source
            Prefix = @()
        }
    }

    $corepack = Get-Command 'corepack.cmd' -ErrorAction SilentlyContinue
    if (-not $corepack) {
        $corepack = Get-Command 'corepack' -ErrorAction SilentlyContinue
    }
    if ($corepack) {
        return [pscustomobject]@{
            Executable = $corepack.Source
            Prefix = @('pnpm')
        }
    }

    throw '没有找到 pnpm。请执行：npm install -g pnpm@11.19.0'
}

function Invoke-Pnpm {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $allArguments = @($script:pnpmCommand.Prefix) + @($Arguments)
    Push-Location $script:root
    try {
        & $script:pnpmCommand.Executable @allArguments
        if ($LASTEXITCODE -ne 0) {
            throw "pnpm $($Arguments -join ' ') 执行失败，退出码：$LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}

function Initialize-PnpmEnvironment {
    $shimDirectory = Join-Path $script:runRoot 'bin'
    $shimPath = Join-Path $shimDirectory 'pnpm.cmd'
    New-Item -ItemType Directory -Path $shimDirectory -Force | Out-Null

    $prefix = if ($script:pnpmCommand.Prefix.Count -gt 0) {
        ' ' + ($script:pnpmCommand.Prefix -join ' ')
    }
    else {
        ''
    }
    $command = 'call "' + $script:pnpmCommand.Executable + '"' + $prefix + ' %*'
    Set-Content -LiteralPath $shimPath -Value @('@echo off', $command, 'exit /b %ERRORLEVEL%') -Encoding Default

    $pathEntries = @($env:Path -split ';')
    if ($pathEntries -notcontains $shimDirectory) {
        $env:Path = "$shimDirectory;$env:Path"
    }
}

function Get-FileSha256 {
    param([string]$Path)

    $stream = [System.IO.File]::OpenRead($Path)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = $sha256.ComputeHash($stream)
        return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
    }
    finally {
        $sha256.Dispose()
        $stream.Dispose()
    }
}

function Get-DependencyStamp {
    $lockfile = Join-Path $script:root 'pnpm-lock.yaml'
    $rootPackage = Get-Content -Raw -LiteralPath (Join-Path $script:root 'package.json') | ConvertFrom-Json
    $runtimeJson = (& $script:nodeCommand.Source -p 'JSON.stringify({platform: process.platform, arch: process.arch, modules: process.versions.modules})').Trim()
    $runtime = $runtimeJson | ConvertFrom-Json
    return "lock=$(Get-FileSha256 -Path $lockfile);platform=$($runtime.platform);arch=$($runtime.arch);modules=$($runtime.modules);electron=$($rootPackage.devDependencies.electron)"
}

function Test-DependenciesNeedInstall {
    $modulesManifest = Join-Path $script:root 'node_modules\.modules.yaml'
    $dependencyStamp = Join-Path $script:runRoot 'dependencies.sha256'
    if (-not (Test-Path -LiteralPath $modulesManifest)) {
        return $true
    }
    if (-not (Test-Path -LiteralPath $dependencyStamp)) {
        return $true
    }
    $expectedStamp = Get-DependencyStamp
    $installedStamp = (Get-Content -Raw -LiteralPath $dependencyStamp).Trim()
    return $expectedStamp -ne $installedStamp
}

function Save-DependencyStamp {
    $dependencyStamp = Join-Path $script:runRoot 'dependencies.sha256'
    Set-Content -LiteralPath $dependencyStamp -Value (Get-DependencyStamp) -Encoding ASCII
}

function Test-DesktopBuildRequired {
    $markerPath = Join-Path $script:root 'apps\desktop\lib\frontend\bundle.js'
    $speechHelper = Join-Path $script:root 'apps\desktop\native\speech\windows\NextMuxSpeechHelper.exe'
    if (-not (Test-Path -LiteralPath $markerPath) -or -not (Test-Path -LiteralPath $speechHelper)) {
        return $true
    }

    $markerTime = (Get-Item -LiteralPath $markerPath).LastWriteTimeUtc
    $sourceRoots = @(
        'packages\agent-runtime\src',
        'packages\model-runtime\src',
        'packages\comic-core\src',
        'packages\media-core\src',
        'packages\theia-nextmux-extension\src',
        'apps\desktop\native\speech'
    )
    foreach ($relativeRoot in $sourceRoots) {
        $sourceRoot = Join-Path $script:root $relativeRoot
        if (-not (Test-Path -LiteralPath $sourceRoot)) {
            continue
        }
        $newerSource = Get-ChildItem -LiteralPath $sourceRoot -Recurse -File |
            Where-Object { $_.LastWriteTimeUtc -gt $markerTime } |
            Select-Object -First 1
        if ($newerSource) {
            return $true
        }
    }

    $metadataFiles = @(
        'package.json',
        'pnpm-lock.yaml',
        'apps\desktop\package.json',
        'packages\agent-runtime\package.json',
        'packages\model-runtime\package.json',
        'packages\comic-core\package.json',
        'packages\media-core\package.json',
        'packages\theia-nextmux-extension\package.json'
    )
    foreach ($relativeFile in $metadataFiles) {
        $file = Join-Path $script:root $relativeFile
        if ((Test-Path -LiteralPath $file) -and
            (Get-Item -LiteralPath $file).LastWriteTimeUtc -gt $markerTime) {
            return $true
        }
    }
    return $false
}

function Get-PortOwner {
    param([int]$Port)

    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $listener) {
        return $null
    }
    return Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
}

function Test-TcpPort {
    param([int]$Port)

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $pending = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $pending.AsyncWaitHandle.WaitOne(350)) {
            return $false
        }
        $client.EndConnect($pending)
        return $client.Connected
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Wait-ServicePort {
    param(
        [int]$Port,
        [System.Diagnostics.Process]$Process,
        [string]$Name,
        [string]$ErrorLog
    )

    $deadline = (Get-Date).AddSeconds(25)
    while ((Get-Date) -lt $deadline) {
        if (Test-TcpPort -Port $Port) {
            return
        }
        if ($Process.HasExited) {
            $details = if (Test-Path -LiteralPath $ErrorLog) {
                (Get-Content -LiteralPath $ErrorLog -Tail 20) -join [Environment]::NewLine
            }
            else {
                '没有错误日志。'
            }
            throw "$Name 提前退出。`n$details"
        }
        Start-Sleep -Milliseconds 350
    }
    throw "$Name 未能在 25 秒内监听 127.0.0.1:$Port。请查看 $ErrorLog"
}

# Start-Process joins -ArgumentList with spaces and drops PowerShell's own quotes, so a path such as
# C:\Users\测试 用户\NextMux would reach Node as several arguments. Quote each one by the Windows
# command-line rules (audit A20-03).
function ConvertTo-ProcessArguments {
    param([string[]]$Values)
    $quoted = foreach ($value in $Values) {
        if ($value -and $value -notmatch '[\s"]') { $value; continue }
        $escaped = [regex]::Replace($value, '(\\*)"', { param($m) ($m.Groups[1].Value * 2) + '\"' })
        $escaped = [regex]::Replace($escaped, '(\\+)$', { param($m) $m.Groups[1].Value * 2 })
        '"' + $escaped + '"'
    }
    return ($quoted -join ' ')
}

function Ensure-LocalService {
    param(
        [string]$Name,
        [int]$Port,
        [string[]]$Arguments,
        [string]$ExpectedCommandPattern,
        [string]$LogPrefix,
        [string]$WorkingDirectory = $script:root
    )

    $owner = Get-PortOwner -Port $Port
    if ($owner) {
        $commandLine = [string]$owner.CommandLine
        if ($commandLine -match $ExpectedCommandPattern) {
            Write-Host "  ✓ $Name 已运行（端口 $Port，PID $($owner.ProcessId)）" -ForegroundColor Green
            return
        }
        throw "端口 $Port 已被其他进程占用：$($owner.Name)（PID $($owner.ProcessId)）。`n$commandLine"
    }

    $stdout = Join-Path $script:runRoot "$LogPrefix.out.log"
    $stderr = Join-Path $script:runRoot "$LogPrefix.err.log"
    Set-Content -LiteralPath $stdout -Value '' -Encoding UTF8
    Set-Content -LiteralPath $stderr -Value '' -Encoding UTF8

    $process = Start-Process -FilePath $script:nodeCommand.Source `
        -ArgumentList (ConvertTo-ProcessArguments $Arguments) `
        -WorkingDirectory $WorkingDirectory `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -PassThru
    $script:startedServices.Add($process)
    Wait-ServicePort -Port $Port -Process $process -Name $Name -ErrorLog $stderr
    Write-Host "  ✓ $Name 已启动（端口 $Port，PID $($process.Id)）" -ForegroundColor Green
}

function Stop-StartedServices {
    foreach ($process in $script:startedServices) {
        try {
            if (-not $process.HasExited) {
                Stop-Process -Id $process.Id -Force -ErrorAction Stop
                $process.WaitForExit(5000) | Out-Null
            }
        }
        catch {
            Write-Warning "无法停止本次启动的服务 PID $($process.Id)：$($_.Exception.Message)"
        }
    }
}

function Stop-ProcessTree {
    param([int]$TargetProcessId)

    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$TargetProcessId" -ErrorAction SilentlyContinue
    foreach ($child in $children) {
        Stop-ProcessTree -TargetProcessId $child.ProcessId
    }
    if (Get-Process -Id $TargetProcessId -ErrorAction SilentlyContinue) {
        Stop-Process -Id $TargetProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-LocalMigrations {
    $workingDirectory = Join-Path $script:root 'apps\cloudflare-platform'
    $wrangler = Join-Path $script:root 'node_modules\wrangler\bin\wrangler.js'
    $stdout = Join-Path $script:runRoot 'migrations.out.log'
    $stderr = Join-Path $script:runRoot 'migrations.err.log'
    Set-Content -LiteralPath $stdout -Value '' -Encoding UTF8
    Set-Content -LiteralPath $stderr -Value '' -Encoding UTF8

    $previousCi = $env:CI
    $previousMetrics = $env:WRANGLER_SEND_METRICS
    $env:CI = '1'
    $env:WRANGLER_SEND_METRICS = 'false'
    try {
        $process = Start-Process -FilePath $script:nodeCommand.Source `
            -ArgumentList (ConvertTo-ProcessArguments @($wrangler, 'd1', 'migrations', 'apply', 'nextmux-platform-d1', '--local', '--config', 'wrangler.jsonc')) `
            -WorkingDirectory $workingDirectory `
            -WindowStyle Hidden `
            -RedirectStandardOutput $stdout `
            -RedirectStandardError $stderr `
            -PassThru
    }
    finally {
        $env:CI = $previousCi
        $env:WRANGLER_SEND_METRICS = $previousMetrics
    }

    $migrationNames = @(Get-ChildItem -LiteralPath (Join-Path $workingDirectory 'migrations') -Filter '*.sql' -File -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
    $deadline = (Get-Date).AddSeconds(90)
    $completed = $false
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 200
        $output = if (Test-Path -LiteralPath $stdout) { Get-Content -LiteralPath $stdout -Raw } else { '' }
        if ($output -match 'No migrations to apply!') {
            $completed = $true
            break
        }
        if ($migrationNames.Count -gt 0) {
            $lines = @($output -split "`r?`n")
            $applied = @($migrationNames | Where-Object {
                $name = $_
                $lines | Where-Object { $_ -like "*$name*" -and $_ -match '✅' } | Select-Object -First 1
            })
            if ($applied.Count -eq $migrationNames.Count) {
                $completed = $true
                break
            }
        }
        if ($process.HasExited) {
            if ($process.ExitCode -eq 0) {
                $completed = $true
                break
            }
            $details = ((Get-Content -LiteralPath $stderr -Raw) + "`n" + $output).Trim()
            throw "本地数据库迁移失败，退出码：$($process.ExitCode)`n$details"
        }
    }

    if (-not $process.HasExited) {
        Stop-ProcessTree -TargetProcessId $process.Id
    }
    if (-not $completed) {
        $details = ((Get-Content -LiteralPath $stderr -Raw) + "`n" + (Get-Content -LiteralPath $stdout -Raw)).Trim()
        throw "本地数据库迁移超时。`n$details"
    }
    Write-Host '  ✓ 本地数据库已就绪' -ForegroundColor Green
}

try {
    if (-not (Test-Path -LiteralPath (Join-Path $root 'package.json'))) {
        throw "项目根目录无效：$root"
    }

    $nodeCommand = Get-Command 'node.exe' -ErrorAction SilentlyContinue
    if (-not $nodeCommand) {
        $nodeCommand = Get-Command 'node' -ErrorAction SilentlyContinue
    }
    if (-not $nodeCommand) {
        throw '没有找到 Node.js。请先安装 Node.js 22.12 或更高版本。'
    }
    $nodeVersion = (& $nodeCommand.Source -p 'process.versions.node').Trim()
    if ([System.Version]$nodeVersion -lt [System.Version]'22.12.0') {
        throw "Node.js $nodeVersion 不受支持。请安装 Node.js 22.12 或更高版本。"
    }
    $osArchitecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
    $expectedNodeArchitecture = switch ($osArchitecture) {
        'arm64' { 'arm64' }
        'x64' { 'x64' }
        default { throw "不支持的 Windows CPU 架构：$osArchitecture（仅支持 ARM64 与 x64）。" }
    }
    $nodeArchitecture = (& $nodeCommand.Source -p 'process.arch').Trim()
    if ($nodeArchitecture -ne $expectedNodeArchitecture) {
        throw "当前 Windows 是 $expectedNodeArchitecture，但 Node.js 是 $nodeArchitecture。请安装与系统架构一致的 Node.js 22.12 或更高版本，以免复用错误架构的原生模块。"
    }
    $pnpmCommand = Resolve-Pnpm
    New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
    Initialize-PnpmEnvironment

    Write-Step '检查开发环境'
    Write-Host "  ✓ Node v$nodeVersion · $nodeArchitecture"
    $pnpmVersionArgs = @($pnpmCommand.Prefix) + @('--version')
    Write-Host "  ✓ pnpm $(& $pnpmCommand.Executable @pnpmVersionArgs)"

    $dependenciesUpdated = $false
    if (Test-DependenciesNeedInstall) {
        Write-Step '安装或同步项目依赖（首次运行可能需要几分钟）'
        Invoke-Pnpm -Arguments @('install', '--frozen-lockfile', '--force')
        $dependenciesUpdated = $true
    }
    else {
        Write-Host '  ✓ 项目依赖已就绪' -ForegroundColor Green
    }

    Write-Step '检查 Windows ARM64 媒体组件'
    & $nodeCommand.Source (Join-Path $root 'scripts\prepare-windows-arm64-ffmpeg.mjs')
    if ($LASTEXITCODE -ne 0) {
        throw "Windows ARM64 FFmpeg 准备失败，退出码：$LASTEXITCODE"
    }

    if ($dependenciesUpdated -or (Test-DesktopBuildRequired)) {
        Write-Step '桌面构建不存在或源码较新，正在重新构建'
        Invoke-Pnpm -Arguments @('desktop:build')
        if ($dependenciesUpdated) {
            Save-DependencyStamp
        }
    }
    else {
        Write-Host '  ✓ 桌面构建已是最新' -ForegroundColor Green
    }

    Write-Step '准备商家门户本地数据库'
    Invoke-LocalMigrations

    Write-Step '启动 NextMux 网页与平台 API'
    Ensure-LocalService `
        -Name '商家门户' `
        -Port 4173 `
        -Arguments @((Join-Path $root 'node_modules\wrangler\bin\wrangler.js'), 'dev', '--config', 'wrangler.jsonc', '--ip', '127.0.0.1', '--port', '4173') `
        -ExpectedCommandPattern '(wrangler|workerd)' `
        -LogPrefix 'web' `
        -WorkingDirectory (Join-Path $root 'apps\cloudflare-platform')
    Write-Step '打开 NextMux 门户'
    Write-Host "  $webUrl"
    try {
        Start-Process $webUrl | Out-Null
    }
    catch {
        Write-Warning "无法自动打开浏览器，请手动访问：$webUrl"
    }

    if (-not $env:NEXTMUX_PLATFORM_API_URL) {
        $env:NEXTMUX_PLATFORM_API_URL = $platformUrl
    }
    Write-Step '启动 Windows 桌面应用'
    Write-Host '  关闭桌面应用后，本窗口会自动结束。'
    Invoke-Pnpm -Arguments @('--filter', '@nextmux/desktop', 'start')
}
catch {
    $exitCode = 1
    Write-Host "`n[启动失败] $($_.Exception.Message)" -ForegroundColor Red
}
finally {
    if ($startedServices.Count -gt 0) {
        Write-Step '关闭本次启动器创建的后台服务'
        Stop-StartedServices
    }
}

exit $exitCode
