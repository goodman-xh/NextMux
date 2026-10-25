$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$request = $env:NEXTMUX_WINDOWS_APPS_REQUEST | ConvertFrom-Json

if ($request.action -eq 'windows') {
    Add-Type -Path (Join-Path $PSScriptRoot 'windows-apps-native.cs')
    ConvertTo-Json -InputObject @([NextMuxAppWindows]::Snapshot()) -Compress -Depth 8
    exit
}

if ($request.action -eq 'processes') {
    Add-Type -Path (Join-Path $PSScriptRoot 'windows-apps-native.cs')
    ConvertTo-Json -InputObject @([NextMuxAppWindows]::ProcessSnapshot()) -Compress -Depth 5
    exit
}

if ($request.action -eq 'resolveShortcut') {
    if ([IO.Path]::GetExtension([string]$request.path) -ne '.lnk') { throw 'computer_app_required' }
    $link = (New-Object -ComObject WScript.Shell).CreateShortcut([string]$request.path)
    @{ executable=[string]$link.TargetPath; appId='' } | ConvertTo-Json -Compress
    exit
}

if ($request.action -eq 'launch') {
    # Use Shell activation for both registered desktop AUMIDs and packaged apps.
    # https://learn.microsoft.com/windows/configuration/store/find-aumid
    $shell = New-Object -ComObject Shell.Application
    if ($request.path -and ([IO.Path]::GetExtension($request.path) -in @('.exe', '.lnk')) -and (Test-Path -LiteralPath $request.path -PathType Leaf) -and (!$request.appId -or !$request.appId.Contains('!'))) {
        $dir = [IO.Path]::GetDirectoryName([string]$request.path)
        $shell.ShellExecute([string]$request.path, '', $dir, 'open', 1)
    } elseif ($request.appId) {
        $shell.ShellExecute(('shell:AppsFolder\' + [string]$request.appId), '', '', 'open', 1)
    } elseif ($request.path -and ([IO.Path]::GetExtension($request.path) -in @('.exe', '.lnk'))) {
        $shell.ShellExecute([string]$request.path, '', '', 'open', 1)
    } else { throw 'computer_app_required' }
    '{"ok":true}'
    exit
}

if ($request.action -ne 'discover') { throw 'computer_app_action_invalid' }
# Get-StartApps supplies localized names as shown in Start, never ms-resource aliases.
# https://learn.microsoft.com/powershell/module/startlayout/get-startapps
# https://learn.microsoft.com/powershell/module/appx/get-appxpackagemanifest
# https://learn.microsoft.com/windows/win32/properties/props-system-link-targetparsingpath
$shell = New-Object -ComObject Shell.Application
$folder = $shell.NameSpace('shell:AppsFolder')
$shellItems = @{}
foreach ($item in $folder.Items()) {
    $id = [string]$item.ExtendedProperty('System.AppUserModel.ID')
    if (!$id) { $id = [string]$item.Path }
    if ($id) { $shellItems[$id] = $item }
}
$shortcuts = @{}
foreach ($root in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('CommonPrograms'))) {
    if (!$root) { continue }
    foreach ($file in @(Get-ChildItem -LiteralPath $root -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue)) {
        try {
            $item = $shell.NameSpace($file.DirectoryName).ParseName($file.Name)
            $id = [string]$item.ExtendedProperty('System.AppUserModel.ID')
            $target = [string]$item.ExtendedProperty('System.Link.TargetParsingPath')
            if (!$target) { $target = [string]$item.GetLink.Path }
            $record = @{ path = $file.FullName; target = $target }
            if ($id) { $shortcuts[$id] = $record }
            # Names are only a last resort for icon resolution, never window ownership.
            if (!$shortcuts.ContainsKey($file.BaseName)) { $shortcuts[$file.BaseName] = $record }
        } catch { }
    }
}
$packages = @{}
foreach ($package in @(Get-AppxPackage -ErrorAction SilentlyContinue)) { $packages[$package.PackageFamilyName] = $package }
$manifestCache = @{}
function Find-Logo($location, $relative) {
    if (!$relative -or !$location) { return '' }
    $root = [IO.Path]::GetFullPath($location).TrimEnd('\') + '\'
    $file = [IO.Path]::GetFullPath((Join-Path $root $relative))
    if (!$file.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { return '' }
    if (Test-Path -LiteralPath $file -PathType Leaf) { return $file }
    # App package resources commonly ship only scale/targetsize variants.
    $directory = [IO.Path]::GetDirectoryName($file)
    $stem = [IO.Path]::GetFileNameWithoutExtension($file)
    $extension = [IO.Path]::GetExtension($file)
    $found = Get-ChildItem -LiteralPath $directory -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name.StartsWith(($stem + '.'), [StringComparison]::OrdinalIgnoreCase) -and $_.Extension -eq $extension } |
        Sort-Object @{ Expression = { if ($_.Name -match 'targetsize-64') { 0 } elseif ($_.Name -match 'scale-200') { 1 } else { 2 } } }, Name | Select-Object -First 1
    if ($found) { return $found.FullName }
    return ''
}
$results = foreach ($start in @(Get-StartApps)) {
    $id = [string]$start.AppID
    if (!$id) { continue }
    $target = ''; $shortcut = ''; $logo = ''; $family = ''; $packaged = $false
    $item = $shellItems[$id]
    if ($item) { $target = [string]$item.ExtendedProperty('System.Link.TargetParsingPath') }
    $link = $shortcuts[$id]
    if (!$link) { $link = $shortcuts[[string]$start.Name] }
    if ($link) { $shortcut = $link.path; if (!$target) { $target = $link.target } }
    if (!$target -and [IO.Path]::IsPathRooted($id) -and [IO.Path]::GetExtension($id) -eq '.exe') { $target = $id }
    if ($id.Contains('!')) {
        $family = $id.Split('!')[0]; $applicationId = $id.Substring($family.Length + 1)
        $package = $packages[$family]
        if ($package) {
            $packaged = $true
            try {
                if (!$manifestCache.ContainsKey($family)) { $manifestCache[$family] = Get-AppxPackageManifest -Package $package.PackageFullName }
                $manifest = $manifestCache[$family]
                $application = @($manifest.Package.Applications.Application) | Where-Object { $_.Id -eq $applicationId } | Select-Object -First 1
                if ($application.Executable) { $target = Join-Path $package.InstallLocation ([string]$application.Executable) }
                $visual = $application.SelectSingleNode("*[local-name()='VisualElements']")
                foreach ($relative in @($visual.Square44x44Logo, $visual.Square150x150Logo, $manifest.Package.Properties.Logo)) {
                    $logo = Find-Logo $package.InstallLocation ([string]$relative)
                    if ($logo) { break }
                }
            } catch { }
        }
    }
    @{ name = [string]$start.Name; appId = $id; executable = $target; shortcut = $shortcut;
        logo = $logo; packaged = $packaged; packageFamilyName = $family }
}
ConvertTo-Json -InputObject @($results) -Compress -Depth 5
