use std::net::IpAddr;

pub(crate) fn is_local_network_host(host: &str) -> bool {
    let normalized = host
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_ascii_lowercase();

    if normalized == "localhost"
        || normalized.ends_with(".localhost")
        || normalized.ends_with(".local")
    {
        return true;
    }

    match normalized.parse::<IpAddr>() {
        Ok(IpAddr::V4(address)) => {
            address.is_private()
                || address.is_loopback()
                || address.is_link_local()
                || address.is_unspecified()
        }
        Ok(IpAddr::V6(address)) => {
            let octets = address.octets();
            let is_unique_local = octets[0] & 0xfe == 0xfc;
            let is_unicast_link_local = octets[0] == 0xfe && octets[1] & 0xc0 == 0x80;
            address.is_loopback()
                || is_unique_local
                || is_unicast_link_local
                || address.is_unspecified()
        }
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::is_local_network_host;

    #[test]
    fn recognizes_loopback_private_link_local_and_mdns_hosts() {
        for host in [
            "localhost",
            "app.localhost",
            "router.local",
            "127.12.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "172.31.255.254",
            "192.168.1.1",
            "169.254.10.20",
            "[::1]",
            "[fd12:3456::1]",
            "[fe80::1]",
        ] {
            assert!(is_local_network_host(host), "{host} should be local");
        }
    }

    #[test]
    fn does_not_treat_public_or_documentation_addresses_as_local() {
        for host in [
            "example.com",
            "172.15.0.1",
            "172.32.0.1",
            "192.0.2.1",
            "8.8.8.8",
            "2001:4860:4860::8888",
        ] {
            assert!(!is_local_network_host(host), "{host} should not be local");
        }
    }
}
