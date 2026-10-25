$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not $global:nmxPipeElevated -and -not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -and (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -EA 0).ConsentPromptBehaviorAdmin -eq 0) {
    $pipeName = 'nmx-svc-' + [Guid]::NewGuid().ToString('N')
    $srv = [IO.Pipes.NamedPipeServerStream]::new($pipeName, [IO.Pipes.PipeDirection]::InOut, 1, [IO.Pipes.PipeTransmissionMode]::Byte, [IO.Pipes.PipeOptions]::Asynchronous)
    $scriptPath = $MyInvocation.MyCommand.Path
    $cmd = '$c=[IO.Pipes.NamedPipeClientStream]::new(''.'',''' + $pipeName + ''',[IO.Pipes.PipeDirection]::InOut,[IO.Pipes.PipeOptions]::Asynchronous);$c.Connect(10000);$r=[IO.StreamReader]::new($c,[Text.UTF8Encoding]::new($false));$w=[IO.StreamWriter]::new($c,[Text.UTF8Encoding]::new($false));$w.AutoFlush=$true;[Console]::SetIn($r);[Console]::SetOut($w);$global:nmxPipeElevated=$true;$global:nmxParentPid=' + $PID + ';& ''' + $scriptPath.Replace("'","''") + ''''
    $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmd))
    $proc = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',$enc
    try {
        $srv.WaitForConnection()
        $out = [Console]::OpenStandardOutput()
        $in = [Console]::OpenStandardInput()
        $tOut = $srv.CopyToAsync($out)
        $tIn = $in.CopyToAsync($srv)
        [Threading.Tasks.Task]::WaitAny($tOut, $tIn) | Out-Null
    } finally {
        try { $srv.Dispose() } catch {}
        try { if ($proc -and !$proc.HasExited) { if (!$proc.WaitForExit(1500)) { Stop-Process -Id $proc.Id -Force -EA 0 } } } catch {}
    }
    exit 0
}
if (-not $global:nmxPipeElevated) {
    [Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
}
Add-Type -Path (Join-Path $PSScriptRoot 'computer-services-windows.cs') -ReferencedAssemblies System.Drawing
Add-Type -Path (Join-Path $PSScriptRoot 'computer-audio-windows.cs')
$parentPid = if ($global:nmxParentPid) { [int]$global:nmxParentPid } elseif ($env:NEXTMUX_PARENT_PID) { [int]$env:NEXTMUX_PARENT_PID } else { 0 }
try { [NextMuxServices.Host]::RecoverDesktops() } catch { }
[NextMuxServices.Host]::WatchParent($parentPid, [NextMuxAudio.Mixer]::ParentCleanup)
$lock = [NextMuxServices.Host]::Start()
$ocr = $false; $languages = @()
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
    $null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType=WindowsRuntime]
    $null = [Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime]
    $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapPixelFormat, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapAlphaMode, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
    $null = [Windows.Security.Cryptography.CryptographicBuffer, Windows.Security.Cryptography, ContentType=WindowsRuntime]
    $languages = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object { $_.LanguageTag })
    $ocr = $languages.Count -gt 0
} catch { }
# WinRT OCR is local and uses only languages installed on this Windows account.
# https://learn.microsoft.com/uwp/api/windows.media.ocr.ocrengine.availablerecognizerlanguages
# https://learn.microsoft.com/uwp/api/windows.media.ocr.ocrengine.recognizeasync
# https://learn.microsoft.com/uwp/api/windows.graphics.imaging.softwarebitmap.createcopyfrombuffer
function Await-Ocr($operation) {
    $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and
        $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
    $task = $method.MakeGenericMethod([Windows.Media.Ocr.OcrResult]).Invoke($null, @($operation))
    if (!$task.Wait(15000)) { throw 'ocr_timeout' }
    return $task.Result
}
function Read-FrameText($request) {
    if (!$ocr) { throw 'ocr_language_unavailable' }
    $engine = $null
    if (@($request.languages).Count -gt 0) {
        foreach ($tag in $request.languages) {
            try {
                $language = [Windows.Globalization.Language]::new([string]$tag)
                if ([Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($language)) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language); if ($engine) { break } }
            } catch {}
        }
    }
    if (!$engine) {
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
        if (!$engine -and $languages.Count -gt 0) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new($languages[0])) }
    }
    if (!$engine) { throw 'ocr_language_unavailable' }
    $framePath = [IO.Path]::GetFullPath([string]$request.path)
    if (![IO.Path]::GetDirectoryName($framePath).Equals($PSScriptRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'ocr_request_invalid' }
    $bytes = [IO.File]::ReadAllBytes($framePath)
    $texts = [Collections.Generic.List[string]]::new()
    $boxes = [Collections.Generic.List[object]]::new()
    foreach ($rect in $request.rects) {
        $rx = [double]$rect[0]; $ry = [double]$rect[1]; $rw = [double]$rect[2]; $rh = [double]$rect[3]
        $x = [int][Math]::Floor($rx * $request.width); $y = [int][Math]::Floor($ry * $request.height)
        $width = [int][Math]::Max(1,[Math]::Min($request.width-$x,[Math]::Round($rw*$request.width)))
        $height = [int][Math]::Max(1,[Math]::Min($request.height-$y,[Math]::Round($rh*$request.height)))
        $maxDim = [int][Windows.Media.Ocr.OcrEngine]::MaxImageDimension
        if ($width -gt $maxDim -or $height -gt $maxDim) { throw 'ocr_frame_too_large' }
        $outW = 0; $outH = 0; $singleH = 0; $gapH = 0
        $pixels = [NextMuxServices.Host]::PrepareOcrCrop($bytes, [int]$request.width, [int]$request.height, [int]$request.stride, $x, $y, $width, $height, $maxDim, [ref]$outW, [ref]$outH, [ref]$singleH, [ref]$gapH)
        $buffer = [System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions]::AsBuffer($pixels)
        $bitmap = [Windows.Graphics.Imaging.SoftwareBitmap]::CreateCopyFromBuffer($buffer, [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, $outW, $outH, [Windows.Graphics.Imaging.BitmapAlphaMode]::Ignore)
        $items = [Collections.Generic.List[object]]::new()
        try {
            $result = Await-Ocr ($engine.RecognizeAsync($bitmap))
            $texts.Add([string]$result.Text)
            foreach ($line in @($result.Lines)) {
                $words = @($line.Words)
                if ($words.Count -gt 0) {
                    $minX = ($words | ForEach-Object { $_.BoundingRect.X } | Measure-Object -Minimum).Minimum
                    $minY = ($words | ForEach-Object { $_.BoundingRect.Y } | Measure-Object -Minimum).Minimum
                    $maxX = ($words | ForEach-Object { $_.BoundingRect.X + $_.BoundingRect.Width } | Measure-Object -Maximum).Maximum
                    $maxY = ($words | ForEach-Object { $_.BoundingRect.Y + $_.BoundingRect.Height } | Measure-Object -Maximum).Maximum
                    $rawCy = ($minY + $maxY) / 2.0
                    $normY = if ($gapH -gt 0 -and $rawCy -ge ($singleH + $gapH / 2.0)) { ($rawCy - ($singleH + $gapH)) / $singleH } else { $rawCy / $singleH }
                    $cx = [Math]::Min(1.0, [Math]::Max(0.0, $rx + (($minX + $maxX) / 2.0 / $outW) * $rw))
                    $cy = [Math]::Min(1.0, [Math]::Max(0.0, $ry + [Math]::Min(1.0, [Math]::Max(0.0, $normY)) * $rh))
                    $items.Add(@{ text = [string]$line.Text; x = [Math]::Round($cx, 4); y = [Math]::Round($cy, 4) })
                    foreach ($w in $words) {
                        $wRawCy = $w.BoundingRect.Y + $w.BoundingRect.Height / 2.0
                        $wNormY = if ($gapH -gt 0 -and $wRawCy -ge ($singleH + $gapH / 2.0)) { ($wRawCy - ($singleH + $gapH)) / $singleH } else { $wRawCy / $singleH }
                        $wcx = [Math]::Min(1.0, [Math]::Max(0.0, $rx + (($w.BoundingRect.X + $w.BoundingRect.Width / 2.0) / $outW) * $rw))
                        $wcy = [Math]::Min(1.0, [Math]::Max(0.0, $ry + [Math]::Min(1.0, [Math]::Max(0.0, $wNormY)) * $rh))
                        $items.Add(@{ text = [string]$w.Text; x = [Math]::Round($wcx, 4); y = [Math]::Round($wcy, 4) })
                    }
                }
            }
        } finally { $bitmap.Dispose() }
        $boxes.Add($items.ToArray())
    }
    return @{ texts = $texts.ToArray(); boxes = $boxes.ToArray() }
}
try {
    while ($null -ne ($line = [Console]::ReadLine())) {
        $request = $null
        try {
            $request = $line | ConvertFrom-Json
            $reply = @{ id=$request.id; ok=$true }
            switch ($request.op) {
                'capability' {
                    $canPark = [NextMuxServices.Host]::CanPark()
                    $reply.capability=@{lock=$lock;sound=$true;ocr=$ocr;ocrLanguages=$languages;canPark=$canPark;parkReason=$(if ($canPark) { '' } else { 'foreground_input_required' })}
                }
                'windowCapability' {
                    $reason=[NextMuxServices.Host]::WindowReason([uint32]$request.pid,[long]$request.windowId)
                    if ($reason -eq 'ok') {
                        $reply.canPark=$true; $reply.parkReason=''
                    } else {
                        $reply.canPark=$false; $reply.parkReason=$reason
                        if ($reason -eq 'window_not_found') {$reply.ok=$false;$reply.error=$reason}
                    }
                }
                'park' {
                    $group = if ($request.group) { [string]$request.group } else { '' }
                    if (![NextMuxServices.Host]::ParkWindow([uint32]$request.pid,[long]$request.windowId,$group)) { throw 'park_failed' }
                    $reply.placement='tab'
                }
                'unpark' {
                    $hostWin = if ($null -ne $request.hostWindow) { [long]$request.hostWindow } else { 0L }
                    $act = [bool]$request.activate
                    if (![NextMuxServices.Host]::UnparkWindow([uint32]$request.pid,[long]$request.windowId,$hostWin,$act)) { throw 'unpark_failed' }
                    $reply.placement='desktop'
                }
                'shield' {
                    if (!$lock) { throw 'lock_unavailable' }
                    [long[]]$handles=@($request.windows | ForEach-Object {$_.windowId})
                    [uint32[]]$pids=@($request.windows | ForEach-Object {$_.pid})
                    [NextMuxServices.Host]::Shield($handles,$pids)
                }
                'closeWindow' { if (![NextMuxServices.Host]::CloseWindow([uint32]$request.pid,[long]$request.windowId)) { throw 'window_not_found' } }
                'terminateProcess' {
                    $targetPid = [uint32]$request.pid
                    $winId = if ($null -ne $request.windowId) { [long]$request.windowId } else { 0L }
                    if ($winId -gt 0) {
                        [void][NextMuxServices.Host]::CloseWindow($targetPid, $winId)
                    }
                    $proc = Get-Process -Id ([int]$targetPid) -EA 0
                    if ($proc -and $proc.ProcessName -ieq 'ApplicationFrameHost') {
                        $audioPid = if ($null -ne $request.audioPid) { [int]$request.audioPid } else { 0 }
                        if ($audioPid -gt 0 -and $audioPid -ne [int]$targetPid) {
                            $audioProc = Get-Process -Id $audioPid -EA 0
                            if ($audioProc -and $audioProc.ProcessName -ine 'ApplicationFrameHost') {
                                Start-Sleep -Milliseconds 120
                                Stop-Process -Id $audioPid -Force -EA 0
                            }
                        }
                    } elseif ($proc) {
                        Start-Sleep -Milliseconds 150
                        Stop-Process -Id ([int]$targetPid) -Force -EA 0
                    }
                    if ($winId -gt 0) {
                        [void][NextMuxServices.Host]::UnparkWindow($targetPid, $winId, 0L, $false)
                    }
                }
                'restoreDesktops' { [NextMuxServices.Host]::RestoreDesktops() }
                'captureWindow' {
                    $framePath = ''
                    if ($request.path) {
                        $framePath = [IO.Path]::GetFullPath([string]$request.path)
                        if (![IO.Path]::GetDirectoryName($framePath).Equals($PSScriptRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'capture_request_invalid' }
                    }
                    $cap=[NextMuxServices.Host]::CaptureWindow([uint32]$request.pid,[long]$request.windowId,[int]($request.maxSize),$framePath)
                    foreach ($kv in $cap.GetEnumerator()) { $reply[$kv.Key] = $kv.Value }
                }
                'topWindows' { $reply.windows=@([NextMuxServices.Host]::TopWindows()) }
                'mute' { $reply.sessions=[NextMuxAudio.Mixer]::SetMute([uint32]$request.pid,[bool]$request.muted) }
                'ocr' { $ocrOut = Read-FrameText $request; $reply.texts = $ocrOut.texts; $reply.boxes = $ocrOut.boxes; $reply.ocrLanguages = $languages }
                'restore' { [NextMuxServices.Host]::Shield(@(),@()); [NextMuxServices.Host]::RestoreDesktops(); [NextMuxAudio.Mixer]::RestoreAll() }
                default { throw 'windows_services_operation_invalid' }
            }
        } catch {
            $code=[string]$_.Exception.Message
            if ($code -notmatch '^(ocr_[a-z_]+|capture_[a-z_]+|window_[a-z_]+|park_[a-z_]+|unpark_[a-z_]+|lock_unavailable|shield_request_invalid|windows_services_operation_invalid)$') { $code='windows_services_failed' }
            $reply=@{id=$request.id;ok=$false;error=$code;ocrLanguages=$languages}
        }
        [NextMuxServices.Host]::Write(($reply | ConvertTo-Json -Depth 8 -Compress))
    }
} finally {
    [NextMuxServices.Host]::Stop()
    [NextMuxAudio.Mixer]::RestoreAll()
}
