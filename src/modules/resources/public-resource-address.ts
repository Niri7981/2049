import { BlockList, isIP } from 'node:net';

// IANA special-purpose registry snapshots, checked 2026-10-08 (registry update
// 2025-10-09). On registry updates, review these tables and their boundary tests:
// https://www.iana.org/assignments/iana-ipv4-special-registry/
// https://www.iana.org/assignments/iana-ipv6-special-registry/
// Merchant endpoints must use ordinary public unicast. Conservatively exclude
// all special-purpose entries, including deprecated/unknown reachability and
// purpose-specific global exceptions, rather than making those SSRF exceptions.
const excludedIpv4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.31.196.0', 24], ['192.52.193.0', 24], ['192.88.99.0', 24],
  ['192.168.0.0', 16], ['192.175.48.0', 24], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24],
  // Multicast, reserved, and limited broadcast are not merchant unicast.
  ['224.0.0.0', 3],
] as const) excludedIpv4.addSubnet(address, prefix, 'ipv4');

const globalIpv6 = new BlockList();
globalIpv6.addSubnet('2000::', 3, 'ipv6');
const excludedIpv6 = new BlockList();
// Other IANA IPv6 special-purpose allocations are outside 2000::/3 and already
// denied, including translation, mapped IPv4, local, discard, and SRv6 prefixes.
for (const [address, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16],
  ['2620:4f:8000::', 48], ['3fff::', 20],
] as const) excludedIpv6.addSubnet(address, prefix, 'ipv6');

export function isPublicResourceAddress(ip: string): boolean {
  // DNS answers must identify an address, never a host-local interface scope.
  if (ip.includes('%')) return false;
  const family = isIP(ip);
  if (family === 4) return !excludedIpv4.check(ip, 'ipv4');
  return family === 6 && globalIpv6.check(ip, 'ipv6') && !excludedIpv6.check(ip, 'ipv6');
}
