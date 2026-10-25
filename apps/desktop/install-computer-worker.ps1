# Invoked only by NextMux's fixed Electron permission action after OS elevation.
# This installs a bundled signed component, never downloads or runs model code.
param(
    [Parameter(Mandatory=$true)][string]$Source,
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedSha256,
    [Parameter(Mandatory=$true)][ValidateSet('0.20.9')][string]$Version
)
$ErrorActionPreference = 'Stop'
try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 20 }
    $sourceFile = Get-Item -LiteralPath $Source -Force
    if ($sourceFile.PSIsContainer -or ($sourceFile.Attributes -band [IO.FileAttributes]::ReparsePoint)) { exit 21 }
    if ((Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash -ne $ExpectedSha256) { exit 22 }
    if ((Get-AuthenticodeSignature -LiteralPath $Source).Status -ne 'Valid') { exit 23 }
    $root = [Environment]::GetFolderPath('ProgramFiles')
    $directory = $root
    foreach ($part in @('Qwen', 'CuaDriver', $Version)) {
        $directory = Join-Path $directory $part
        if (Test-Path -LiteralPath $directory) {
            $item = Get-Item -LiteralPath $directory -Force
            if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { exit 24 }
            # UIAccess requires a secure path; refuse pre-existing writable ACLs.
            foreach ($entry in (Get-Acl -LiteralPath $directory).Access) {
                $sid = $entry.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
                if ($sid -in @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545') -and $entry.AccessControlType -eq 'Allow' -and
                    ($entry.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Write)) { exit 24 }
            }
        } else { New-Item -ItemType Directory -Path $directory | Out-Null }
    }
    $destination = Join-Path $directory 'qwen-cua-driver-uia.exe'
    if (Test-Path -LiteralPath $destination) {
        $existing = Get-Item -LiteralPath $destination -Force
        if ($existing.PSIsContainer -or ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint)) { exit 24 }
        # Never replace an existing Qwen or another application's helper.
        if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $ExpectedSha256) { exit 25 }
        if ((Get-AuthenticodeSignature -LiteralPath $destination).Status -ne 'Valid') { exit 23 }
        exit 0
    }
    $staging = Join-Path $directory ('nextmux-' + [Guid]::NewGuid().ToString() + '.tmp')
    try {
        Copy-Item -LiteralPath $Source -Destination $staging
        if ((Get-FileHash -LiteralPath $staging -Algorithm SHA256).Hash -ne $ExpectedSha256) { exit 22 }
        if ((Get-AuthenticodeSignature -LiteralPath $staging).Status -ne 'Valid') { exit 23 }
        # File.Move does not overwrite a competing installation.
        [IO.File]::Move($staging, $destination)
    } finally {
        if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging }
    }
    exit 0
} catch { exit 26 }
