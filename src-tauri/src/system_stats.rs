use serde::Serialize;
use std::{sync::Mutex, time::Instant};
use sysinfo::{Networks, Pid, ProcessRefreshKind, ProcessesToUpdate, System};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStatsPayload {
    pub ram_percent: u32,
    pub ram_used_gb: f64,
    pub ram_total_gb: f64,
    pub cpu_percent: u32,
}

static SYSTEM: Mutex<Option<System>> = Mutex::new(None);
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkStatsPayload {
    pub interface_name: String,
    pub connection_type: String,
    pub download_mbps: f64,
    pub upload_mbps: f64,
    pub available: bool,
}

struct NetworkSampler {
    networks: Networks,
    sampled_at: Instant,
    active_interface: Option<String>,
}

static NETWORK_SAMPLER: Mutex<Option<NetworkSampler>> = Mutex::new(None);

fn should_ignore_network_interface(name: &str) -> bool {
    let normalized = name.to_ascii_lowercase();

    [
        "loopback",
        "vethernet",
        "virtual",
        "vmware",
        "virtualbox",
        "hyper-v",
        "wsl",
        "docker",
        "bluetooth",
        "teredo",
        "isatap",
        "tunnel",
        "npcap",
        "tailscale",
        "zerotier",
    ]
    .iter()
    .any(|needle| normalized.contains(needle))
}

fn network_connection_type(name: &str) -> &'static str {
    let normalized = name.to_ascii_lowercase();

    if normalized.contains("wi-fi")
        || normalized.contains("wifi")
        || normalized.contains("wlan")
        || normalized.contains("wireless")
    {
        "Wi-Fi"
    } else if normalized.contains("ethernet") || normalized.starts_with("eth") {
        "Ethernet"
    } else if normalized.contains("cellular")
        || normalized.contains("mobile")
        || normalized.contains("wwan")
    {
        "Cellular"
    } else if normalized.contains("vpn") {
        "VPN"
    } else {
        "Network"
    }
}

fn choose_network_interface(networks: &Networks, previous: Option<&str>) -> Option<String> {
    let mut active = networks
        .iter()
        .filter(|(name, _)| !should_ignore_network_interface(name))
        .map(|(name, data)| (name, data.received().saturating_add(data.transmitted())))
        .collect::<Vec<_>>();

    active.sort_by_key(|(_, bytes)| std::cmp::Reverse(*bytes));

    if let Some((name, bytes)) = active.first() {
        if *bytes > 0 {
            return Some((*name).clone());
        }
    }

    if let Some(previous) = previous {
        if networks.contains_key(previous) && !should_ignore_network_interface(previous) {
            return Some(previous.to_string());
        }
    }

    networks
        .iter()
        .filter(|(name, _)| !should_ignore_network_interface(name))
        .max_by_key(|(_, data)| {
            data.total_received()
                .saturating_add(data.total_transmitted())
        })
        .map(|(name, _)| name.clone())
}

fn round_network_mbps(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

#[tauri::command]
pub fn get_network_stats() -> Result<NetworkStatsPayload, String> {
    let mut guard = NETWORK_SAMPLER
        .lock()
        .map_err(|error| format!("network stats lock failed: {error}"))?;

    if guard.is_none() {
        let networks = Networks::new_with_refreshed_list();
        let active_interface = choose_network_interface(&networks, None);

        let payload = if let Some(name) = active_interface.as_deref() {
            NetworkStatsPayload {
                interface_name: name.to_string(),
                connection_type: network_connection_type(name).to_string(),
                download_mbps: 0.0,
                upload_mbps: 0.0,
                available: true,
            }
        } else {
            NetworkStatsPayload {
                interface_name: String::new(),
                connection_type: String::new(),
                download_mbps: 0.0,
                upload_mbps: 0.0,
                available: false,
            }
        };

        *guard = Some(NetworkSampler {
            networks,
            sampled_at: Instant::now(),
            active_interface,
        });

        return Ok(payload);
    }

    let sampler = guard
        .as_mut()
        .ok_or_else(|| "network stats unavailable".to_string())?;

    let now = Instant::now();
    let elapsed_seconds = now
        .duration_since(sampler.sampled_at)
        .as_secs_f64()
        .max(0.001);

    sampler.networks.refresh(true);
    sampler.sampled_at = now;

    let selected = choose_network_interface(&sampler.networks, sampler.active_interface.as_deref());

    sampler.active_interface = selected.clone();

    let Some(interface_name) = selected else {
        return Ok(NetworkStatsPayload {
            interface_name: String::new(),
            connection_type: String::new(),
            download_mbps: 0.0,
            upload_mbps: 0.0,
            available: false,
        });
    };

    let Some(data) = sampler.networks.get(&interface_name) else {
        return Ok(NetworkStatsPayload {
            interface_name,
            connection_type: String::new(),
            download_mbps: 0.0,
            upload_mbps: 0.0,
            available: false,
        });
    };

    let bits_per_megabit = 1_000_000.0;

    let download_mbps = data.received() as f64 * 8.0 / elapsed_seconds / bits_per_megabit;

    let upload_mbps = data.transmitted() as f64 * 8.0 / elapsed_seconds / bits_per_megabit;

    Ok(NetworkStatsPayload {
        connection_type: network_connection_type(&interface_name).to_string(),
        interface_name,
        download_mbps: round_network_mbps(download_mbps),
        upload_mbps: round_network_mbps(upload_mbps),
        available: true,
    })
}

fn bytes_to_gb(bytes: u64) -> f64 {
    bytes as f64 / (1024.0 * 1024.0 * 1024.0)
}

fn round_one_decimal(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

fn current_pid() -> Pid {
    Pid::from_u32(std::process::id())
}

fn system_memory_percent(sys: &System) -> u32 {
    let total = sys.total_memory();
    if total == 0 {
        return 0;
    }

    ((sys.used_memory() as f64 / total as f64) * 100.0)
        .round()
        .clamp(0.0, 100.0) as u32
}

#[tauri::command]
pub fn get_system_memory_pressure() -> Result<u32, String> {
    let mut guard = SYSTEM
        .lock()
        .map_err(|error| format!("system stats lock failed: {error}"))?;

    if guard.is_none() {
        *guard = Some(System::new());
    }

    let sys = guard
        .as_mut()
        .ok_or_else(|| "system stats unavailable".to_string())?;
    sys.refresh_memory();
    Ok(system_memory_percent(sys))
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
    for (pid, process) in sys.processes() {
        if !is_in_app_tree(sys, *pid, root) {
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
        let mut system = System::new();
        system.refresh_memory();
        *guard = Some(system);
    }

    let sys = guard
        .as_mut()
        .ok_or_else(|| "system stats unavailable".to_string())?;

    let root_pid = current_pid();

    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_memory().with_cpu(),
    );

    let system_total_bytes = sys.total_memory();
    let (app_memory_bytes, app_cpu_usage) = nebula_process_usage(sys, root_pid);

    let ram_percent = if system_total_bytes > 0 {
        ((app_memory_bytes as f64 / system_total_bytes as f64) * 100.0).round() as u32
    } else {
        0
    };

    let cpu_cores = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(1) as f32;
    let cpu_percent = ((app_cpu_usage / cpu_cores).clamp(0.0, 100.0)).round() as u32;

    Ok(SystemStatsPayload {
        ram_percent,
        ram_used_gb: round_one_decimal(bytes_to_gb(app_memory_bytes)),
        ram_total_gb: round_one_decimal(bytes_to_gb(system_total_bytes)),
        cpu_percent,
    })
}
