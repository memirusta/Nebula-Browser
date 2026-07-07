use serde::Serialize;
use std::collections::HashSet;
use std::sync::Mutex;
use sysinfo::{Pid, ProcessesToUpdate, System};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStatsPayload {
  pub ram_percent: u32,
  pub ram_used_gb: f64,
  pub ram_total_gb: f64,
  pub cpu_percent: u32,
}

static SYSTEM: Mutex<Option<System>> = Mutex::new(None);

fn bytes_to_gb(bytes: u64) -> f64 {
  bytes as f64 / (1024.0 * 1024.0 * 1024.0)
}

fn round_one_decimal(value: f64) -> f64 {
  (value * 10.0).round() / 10.0
}

fn current_pid() -> Pid {
  Pid::from_u32(std::process::id())
}

fn is_in_app_tree(sys: &System, pid: Pid, root: Pid) -> bool {
  if pid == root {
    return true;
  }

  let mut current = sys.process(pid).and_then(|process| process.parent());
  let mut depth = 0;

  while let Some(parent) = current {
    if parent == root {
      return true;
    }
    if depth > 16 {
      return false;
    }
    current = sys.process(parent).and_then(|process| process.parent());
    depth += 1;
  }

  false
}

/// Sum memory and CPU for Nebula and processes spawned under it (incl. WebView2).
fn nebula_process_usage(sys: &System, root: Pid) -> (u64, f32) {
  let mut memory_bytes = 0u64;
  let mut cpu_usage = 0f32;
  let mut counted = HashSet::new();

  for (pid, process) in sys.processes() {
    if !is_in_app_tree(sys, *pid, root) {
      continue;
    }
    if !counted.insert(*pid) {
      continue;
    }

    memory_bytes += process.memory();
    cpu_usage += process.cpu_usage();
  }

  (memory_bytes, cpu_usage)
}

#[tauri::command]
pub fn get_system_stats() -> Result<SystemStatsPayload, String> {
  let mut guard = SYSTEM
    .lock()
    .map_err(|error| format!("system stats lock failed: {error}"))?;

  if guard.is_none() {
    *guard = Some(System::new());
  }

  let sys = guard
    .as_mut()
    .ok_or_else(|| "system stats unavailable".to_string())?;

  let root_pid = current_pid();

  sys.refresh_cpu_all();
  sys.refresh_processes(ProcessesToUpdate::All, false);
  sys.refresh_memory();

  let system_total_bytes = sys.total_memory();
  let (app_memory_bytes, app_cpu_usage) = nebula_process_usage(sys, root_pid);

  let ram_percent = if system_total_bytes > 0 {
    ((app_memory_bytes as f64 / system_total_bytes as f64) * 100.0).round() as u32
  } else {
    0
  };

  let cpu_cores = sys.cpus().len().max(1) as f32;
  let cpu_percent = ((app_cpu_usage / cpu_cores).clamp(0.0, 100.0)).round() as u32;

  Ok(SystemStatsPayload {
    ram_percent,
    ram_used_gb: round_one_decimal(bytes_to_gb(app_memory_bytes)),
    ram_total_gb: round_one_decimal(bytes_to_gb(system_total_bytes)),
    cpu_percent,
  })
}
