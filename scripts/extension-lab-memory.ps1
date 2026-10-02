# Records how much memory the Extension Lab uses, so a spike can be traced to a process.
#
# Started by `extension-lab.ps1 run` next to the lab app; it stops when that app exits.
# Every few seconds it writes one line: system memory in use, the size of the lab's
# process tree (the app plus every WebView2 process it started), and the largest
# processes in that tree with the extension they serve when the command line says so.
#
#   .\scripts\extension-lab-memory.ps1 -AppPid 1234 -Log C:\path\lab-memory.log
param(
  [Parameter(Mandatory)][int]$AppPid,
  [Parameter(Mandatory)][string]$Log,
  [int]$IntervalSeconds = 10,
  # Stop after this long even if the app is still running (0 = until it exits).
  [int]$MaxSeconds = 0
)

$ErrorActionPreference = 'SilentlyContinue'
$started = Get-Date
"# time | system used GB | tree processes | tree MB | largest in tree (name pid MB [extension])" | Set-Content -Path $Log -Encoding utf8

function Get-Tree([int]$root, $all) {
  $byParent = $all | Group-Object ParentProcessId -AsHashTable -AsString
  $found = New-Object System.Collections.Generic.List[object]
  $queue = New-Object System.Collections.Generic.Queue[int]
  $queue.Enqueue($root)
  $seen = @{}
  while ($queue.Count) {
    $current = $queue.Dequeue()
    if ($seen.ContainsKey($current)) { continue }
    $seen[$current] = $true
    $self = $all | Where-Object { $_.ProcessId -eq $current } | Select-Object -First 1
    if ($self) { $found.Add($self) }
    foreach ($child in @($byParent["$current"])) { if ($child) { $queue.Enqueue([int]$child.ProcessId) } }
  }
  return $found
}

while ($true) {
  if (-not (Get-Process -Id $AppPid -ErrorAction SilentlyContinue)) {
    "# the app exited at $(Get-Date -Format 'HH:mm:ss')" | Add-Content -Path $Log -Encoding utf8
    break
  }
  if ($MaxSeconds -gt 0 -and ((Get-Date) - $started).TotalSeconds -ge $MaxSeconds) { break }
  $os = Get-CimInstance Win32_OperatingSystem
  $usedGb = [math]::Round(($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / 1MB, 1)
  $all = @(Get-CimInstance Win32_Process)
  $tree = @(Get-Tree $AppPid $all)
  $mb = [math]::Round((($tree | Measure-Object WorkingSetSize -Sum).Sum) / 1MB)
  $top = $tree | Sort-Object WorkingSetSize -Descending | Select-Object -First 4 | ForEach-Object {
    $extension = if ($_.CommandLine -match 'chrome-extension://([a-p]{32})') { " [$($Matches[1])]" } else { '' }
    '{0} {1} {2}MB{3}' -f $_.Name, $_.ProcessId, [math]::Round($_.WorkingSetSize / 1MB), $extension
  }
  '{0} | {1} GB | {2} | {3} MB | {4}' -f (Get-Date -Format 'HH:mm:ss'), $usedGb, $tree.Count, $mb, ($top -join '; ') | Add-Content -Path $Log -Encoding utf8
  Start-Sleep -Seconds $IntervalSeconds
}
