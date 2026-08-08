param(
  [string]$Label = "manual",
  [int]$DurationSeconds = 60,
  [int]$IntervalMilliseconds = 2000,
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"

if ($DurationSeconds -lt 5) {
  throw "DurationSeconds must be at least 5."
}
if ($IntervalMilliseconds -lt 500) {
  throw "IntervalMilliseconds must be at least 500."
}

function Get-NebulaRootProcess {
  $candidate = Get-CimInstance Win32_Process |
    Where-Object { $_.Name -ieq "app.exe" } |
    Sort-Object CreationDate -Descending |
    Select-Object -First 1

  if (-not $candidate) {
    throw "Nebula.exe is not running. Start Nebula first, then run this script."
  }
  return $candidate
}

function Get-ProcessTreeIds([int]$RootPid, $Processes) {
  $children = @{}
  foreach ($process in $Processes) {
    $parent = [int]$process.ParentProcessId
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
      if ($result.Add($child)) {
        $queue.Enqueue($child)
      }
    }
  }

  return @($result)
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $safeLabel = ($Label -replace '[^a-zA-Z0-9._-]', '-')
  $OutputPath = Join-Path (Get-Location) "perf-stress-$safeLabel-$stamp.csv"
}

$root = Get-NebulaRootProcess
$rootPid = [int]$root.ProcessId
$logicalProcessors = [Math]::Max(1, [Environment]::ProcessorCount)
$previousCpu = @{}
$previousSampleAt = Get-Date
$startedAt = Get-Date
$rows = New-Object System.Collections.Generic.List[object]

Write-Host "Nebula performance sampling started."
Write-Host "Root PID: $rootPid"
Write-Host "Label: $Label"
Write-Host "Duration: $DurationSeconds s, interval: $IntervalMilliseconds ms"
Write-Host "Output: $OutputPath"

while (((Get-Date) - $startedAt).TotalSeconds -lt $DurationSeconds) {
  $sampleAt = Get-Date
  $allCim = Get-CimInstance Win32_Process
  $treeIds = Get-ProcessTreeIds -RootPid $rootPid -Processes $allCim
  $treeSet = New-Object System.Collections.Generic.HashSet[int]
  foreach ($pidValue in $treeIds) { [void]$treeSet.Add([int]$pidValue) }

  $workingSetBytes = 0L
  $cpuDeltaSeconds = 0.0
  $processCount = 0
  $webView2Count = 0
  $nextCpu = @{}

  foreach ($pidValue in $treeIds) {
    try {
      $process = Get-Process -Id $pidValue -ErrorAction Stop
      $processCount += 1
      $workingSetBytes += [int64]$process.WorkingSet64
      if ($process.ProcessName -ieq "msedgewebview2") {
        $webView2Count += 1
      }

      $cpuSeconds = [double]$process.CPU
      $nextCpu[$pidValue] = $cpuSeconds
      if ($previousCpu.ContainsKey($pidValue)) {
        $delta = $cpuSeconds - [double]$previousCpu[$pidValue]
        if ($delta -gt 0) { $cpuDeltaSeconds += $delta }
      }
    } catch {
      # Process may exit between the CIM and Get-Process snapshots.
    }
  }

  $elapsedSample = [Math]::Max(0.001, ($sampleAt - $previousSampleAt).TotalSeconds)
  $cpuPercent = [Math]::Round(($cpuDeltaSeconds / $elapsedSample / $logicalProcessors) * 100, 1)
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
    ElapsedSeconds = [Math]::Round(($sampleAt - $startedAt).TotalSeconds, 1)
    SystemRamPercent = $systemRamPercent
    NebulaTreeRamMB = [Math]::Round($workingSetBytes / 1MB, 1)
    NebulaTreeCpuPercent = $cpuPercent
    ProcessCount = $processCount
    WebView2ProcessCount = $webView2Count
    RootPid = $rootPid
  }
  $rows.Add($row)

  Write-Host ("[{0,6:N1}s] RAM {1,8:N1} MB | CPU {2,5:N1}% | system RAM {3,5:N1}% | WebView2 {4}" -f `
    $row.ElapsedSeconds, $row.NebulaTreeRamMB, $row.NebulaTreeCpuPercent, $row.SystemRamPercent, $row.WebView2ProcessCount)

  Start-Sleep -Milliseconds $IntervalMilliseconds
}

$rows | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8

$ramValues = @($rows | ForEach-Object { [double]$_.NebulaTreeRamMB })
$cpuValues = @($rows | ForEach-Object { [double]$_.NebulaTreeCpuPercent })
if ($ramValues.Count -gt 0) {
  $avgRam = [Math]::Round(($ramValues | Measure-Object -Average).Average, 1)
  $peakRam = [Math]::Round(($ramValues | Measure-Object -Maximum).Maximum, 1)
  $avgCpu = [Math]::Round(($cpuValues | Measure-Object -Average).Average, 1)
  $peakCpu = [Math]::Round(($cpuValues | Measure-Object -Maximum).Maximum, 1)
  Write-Host ""
  Write-Host "Finished: avg RAM $avgRam MB, peak RAM $peakRam MB, avg CPU $avgCpu%, peak CPU $peakCpu%."
}
Write-Host "CSV saved to: $OutputPath"
