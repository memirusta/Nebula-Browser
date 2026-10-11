param(
  [string]$Label = "manual",
  [ValidateSet(0, 1, 5, 10, 20)]
  [int]$TabCount = 0,
  [ValidateSet("uncontrolled", "startup", "live", "idle", "suspended", "discarded", "switching")]
  [string]$Phase = "uncontrolled",
  [int]$RootPid = 0,
  [int]$DurationSeconds = 60,
  [int]$IntervalMilliseconds = 2000,
  [string]$OutputPath = "",
  [string]$DetailOutputPath = ""
)

$ErrorActionPreference = "Stop"

if ($DurationSeconds -lt 5) {
  throw "DurationSeconds must be at least 5."
}
if ($IntervalMilliseconds -lt 500) {
  throw "IntervalMilliseconds must be at least 500."
}

function Get-NebulaRootProcess {
  if ($RootPid -gt 0) {
    $selected = Get-CimInstance Win32_Process -Filter "ProcessId=$RootPid"
    if (-not $selected -or $selected.Name -ine "app.exe") {
      throw "RootPid must identify a running Nebula app.exe process."
    }
    return $selected
  }

  $candidates = @(Get-CimInstance Win32_Process |
    Where-Object {
      $_.Name -ieq "app.exe" -and
      $_.ExecutablePath -match '(?i)[\\/]nebula[\\/](?:.*[\\/])?app\.exe$'
    })

  if ($candidates.Count -eq 0) {
    throw "Nebula app.exe was not found. Start Nebula or pass -RootPid."
  }
  if ($candidates.Count -gt 1) {
    throw "Multiple Nebula app.exe processes are running. Pass -RootPid for the exact build."
  }
  return $candidates[0]
}

function Get-ProcessTreeIds([int]$RootPid, $Processes) {
  $children = @{}
  $birthByPid = @{}
  foreach ($process in $Processes) {
    $parent = [int]$process.ParentProcessId
    $birthByPid[[int]$process.ProcessId] = [datetime]$process.CreationDate
    if (-not $children.ContainsKey($parent)) {
      $children[$parent] = New-Object System.Collections.Generic.List[int]
    }
    $children[$parent].Add([int]$process.ProcessId)
  }

  $result = New-Object System.Collections.Generic.HashSet[int]
  $queue = New-Object System.Collections.Generic.Queue[int]
  $queue.Enqueue($RootPid)
  [void]$result.Add($RootPid)

  while ($queue.Count -gt 0) {
    $current = $queue.Dequeue()
    if (-not $children.ContainsKey($current)) { continue }
    foreach ($child in $children[$current]) {
      # ParentProcessId can point to a reused PID after the original parent exits.
      # A genuine child cannot predate its current parent.
      if ($birthByPid[$child] -lt $birthByPid[$current]) { continue }
      if ($result.Add($child)) {
        $queue.Enqueue($child)
      }
    }
  }

  return @($result)
}

function Get-ProcessRole($CimProcess) {
  if ($CimProcess.Name -ieq "app.exe") { return "nebula-host" }
  if ($CimProcess.Name -ine "msedgewebview2.exe") { return "other" }

  $commandLine = [string]$CimProcess.CommandLine
  $typeMatch = [regex]::Match($commandLine, '(?:^|\s)--type=([^\s"]+)')
  if (-not $typeMatch.Success) { return "webview2-browser" }
  $processType = $typeMatch.Groups[1].Value
  if ($processType -eq "utility") {
    $subtypeMatch = [regex]::Match($commandLine, '(?:^|\s)--utility-sub-type=([^\s"]+)')
    if ($subtypeMatch.Success) { return "utility:" + $subtypeMatch.Groups[1].Value }
  }
  if ($processType -eq "renderer" -and $commandLine -match '(?:^|\s)--extension-process(?:\s|$)') {
    return "extension-renderer"
  }
  return $processType
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $safeLabel = ($Label -replace '[^a-zA-Z0-9._-]', '-')
  $OutputPath = Join-Path (Get-Location) "perf-stress-$safeLabel-$stamp.csv"
}
$outputDirectory = Split-Path -Parent $OutputPath
if ($outputDirectory) {
  New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
}
if ($DetailOutputPath) {
  $detailDirectory = Split-Path -Parent $DetailOutputPath
  if ($detailDirectory) {
    New-Item -ItemType Directory -Path $detailDirectory -Force | Out-Null
  }
}

$root = Get-NebulaRootProcess
$rootPid = [int]$root.ProcessId
$rootStartedAt = (Get-Process -Id $rootPid -ErrorAction Stop).StartTime.ToString("o")
$rootExecutablePath = [string]$root.ExecutablePath
$logicalProcessors = [Math]::Max(1, [Environment]::ProcessorCount)
$previousCpu = @{}
$previousSampleAt = Get-Date
$startedAt = Get-Date
$rows = New-Object System.Collections.Generic.List[object]
$detailRows = New-Object System.Collections.Generic.List[object]

Write-Host "Nebula performance sampling started."
Write-Host "Root PID: $rootPid"
Write-Host "Executable: $rootExecutablePath"
Write-Host "Label: $Label"
Write-Host "Tabs: $TabCount, phase: $Phase"
Write-Host "Duration: $DurationSeconds s, interval: $IntervalMilliseconds ms"
Write-Host "Output: $OutputPath"
if ($DetailOutputPath) { Write-Host "Per-process output: $DetailOutputPath" }

while (((Get-Date) - $startedAt).TotalSeconds -lt $DurationSeconds) {
  $sampleAt = Get-Date
  $allCim = Get-CimInstance Win32_Process
  $treeIds = Get-ProcessTreeIds -RootPid $rootPid -Processes $allCim
  $cimByPid = @{}
  foreach ($cimProcess in $allCim) { $cimByPid[[int]$cimProcess.ProcessId] = $cimProcess }
  $treeSet = New-Object System.Collections.Generic.HashSet[int]
  foreach ($pidValue in $treeIds) { [void]$treeSet.Add([int]$pidValue) }

  $workingSetBytes = 0L
  $privateBytes = 0L
  $webView2WorkingSetBytes = 0L
  $webView2PrivateBytes = 0L
  $cpuDeltaSeconds = 0.0
  $processCount = 0
  $webView2Count = 0
  $nextCpu = @{}

  foreach ($pidValue in $treeIds) {
    try {
      $cimProcess = $cimByPid[[int]$pidValue]
      if (-not $cimProcess) { continue }
      $process = Get-Process -Id $pidValue -ErrorAction Stop
      $createdAt = $cimProcess.CreationDate.ToString("o")
      $cpuKey = "$pidValue|$createdAt"
      $processCount += 1
      $workingSetBytes += [int64]$process.WorkingSet64
      $privateBytes += [int64]$process.PrivateMemorySize64
      if ($process.ProcessName -ieq "msedgewebview2") {
        $webView2Count += 1
        $webView2WorkingSetBytes += [int64]$process.WorkingSet64
        $webView2PrivateBytes += [int64]$process.PrivateMemorySize64
      }

      $cpuSeconds = [double]$process.CPU
      $nextCpu[$cpuKey] = $cpuSeconds
      $delta = $null
      if ($previousCpu.ContainsKey($cpuKey)) {
        $delta = [Math]::Max(0.0, $cpuSeconds - [double]$previousCpu[$cpuKey])
        if ($delta -gt 0) { $cpuDeltaSeconds += $delta }
      }

      if ($DetailOutputPath) {
        $detailRows.Add([pscustomobject]@{
          Timestamp = $sampleAt.ToString("o")
          Label = $Label
          Phase = $Phase
          TabCount = $TabCount
          Pid = [int]$pidValue
          ParentPid = [int]$cimProcess.ParentProcessId
          CreatedAt = $createdAt
          Executable = [string]$cimProcess.Name
          Role = Get-ProcessRole $cimProcess
          PrivateMB = [Math]::Round([int64]$process.PrivateMemorySize64 / 1MB, 1)
          WorkingSetMB = [Math]::Round([int64]$process.WorkingSet64 / 1MB, 1)
          CpuTotalSeconds = [Math]::Round($cpuSeconds, 3)
          CpuDeltaSeconds = if ($null -eq $delta) { $null } else { [Math]::Round($delta, 3) }
        })
      }
    } catch {
      # Process may exit between the CIM and Get-Process snapshots.
    }
  }

  $elapsedSample = [Math]::Max(0.001, ($sampleAt - $previousSampleAt).TotalSeconds)
  $cpuPercent = if ($previousCpu.Count -eq 0) {
    $null
  } else {
    [Math]::Round(($cpuDeltaSeconds / $elapsedSample / $logicalProcessors) * 100, 1)
  }
  $previousCpu = $nextCpu
  $previousSampleAt = $sampleAt

  $os = Get-CimInstance Win32_OperatingSystem
  $totalKb = [double]$os.TotalVisibleMemorySize
  $freeKb = [double]$os.FreePhysicalMemory
  $systemRamPercent = if ($totalKb -gt 0) {
    [Math]::Round((($totalKb - $freeKb) / $totalKb) * 100, 1)
  } else { 0 }

  $row = [pscustomobject]@{
    Timestamp = $sampleAt.ToString("o")
    Label = $Label
    TabCount = $TabCount
    Phase = $Phase
    RootStartedAt = $rootStartedAt
    RootExecutablePath = $rootExecutablePath
    ElapsedSeconds = [Math]::Round(($sampleAt - $startedAt).TotalSeconds, 1)
    SystemRamPercent = $systemRamPercent
    NebulaTreeRamMB = [Math]::Round($workingSetBytes / 1MB, 1)
    NebulaTreePrivateMB = [Math]::Round($privateBytes / 1MB, 1)
    WebView2TreeRamMB = [Math]::Round($webView2WorkingSetBytes / 1MB, 1)
    WebView2TreePrivateMB = [Math]::Round($webView2PrivateBytes / 1MB, 1)
    NebulaTreeCpuPercent = $cpuPercent
    ProcessCount = $processCount
    WebView2ProcessCount = $webView2Count
    RootPid = $rootPid
  }
  $rows.Add($row)

  Write-Host ("[{0,6:N1}s] WS {1,8:N1} MB | Private {2,8:N1} MB | CPU {3,5:N1}% | WebView2 {4}" -f `
    $row.ElapsedSeconds, $row.NebulaTreeRamMB, $row.NebulaTreePrivateMB, $row.NebulaTreeCpuPercent, $row.WebView2ProcessCount)

  Start-Sleep -Milliseconds $IntervalMilliseconds
}

$rows | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
if ($DetailOutputPath) {
  $detailRows | Export-Csv -Path $DetailOutputPath -NoTypeInformation -Encoding UTF8
}

$ramValues = @($rows | ForEach-Object { [double]$_.NebulaTreeRamMB })
$cpuValues = @($rows | Where-Object { $null -ne $_.NebulaTreeCpuPercent } | ForEach-Object { [double]$_.NebulaTreeCpuPercent })
if ($ramValues.Count -gt 0) {
  $avgRam = [Math]::Round(($ramValues | Measure-Object -Average).Average, 1)
  $peakRam = [Math]::Round(($ramValues | Measure-Object -Maximum).Maximum, 1)
  $avgCpu = if ($cpuValues.Count -gt 0) { [Math]::Round(($cpuValues | Measure-Object -Average).Average, 1) } else { 0 }
  $peakCpu = if ($cpuValues.Count -gt 0) { [Math]::Round(($cpuValues | Measure-Object -Maximum).Maximum, 1) } else { 0 }
  Write-Host ""
  Write-Host "Finished: avg RAM $avgRam MB, peak RAM $peakRam MB, avg CPU $avgCpu%, peak CPU $peakCpu%."
}
Write-Host "CSV saved to: $OutputPath"
if ($DetailOutputPath) { Write-Host "Per-process CSV saved to: $DetailOutputPath" }
