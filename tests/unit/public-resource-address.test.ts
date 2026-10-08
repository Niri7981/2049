import { expect, it } from 'vitest';
import { isPublicResourceAddress } from '../../src/modules/resources/public-resource-address';

// IANA Special-Purpose registries checked 2026-10-08. Yosh conservatively
// excludes purpose-specific allocations even when IANA marks them global.
it.each([
  '0.0.0.0', '0.255.255.255', '10.0.0.0', '10.255.255.255',
  '100.64.0.0', '100.127.255.255', '127.0.0.0', '127.255.255.255',
  '169.254.0.0', '169.254.255.255', '172.16.0.0', '172.31.255.255',
  '192.0.0.0', '192.0.0.9', '192.0.0.10', '192.0.0.255',
  '192.0.2.0', '192.0.2.255', '192.31.196.0', '192.31.196.255',
  '192.52.193.0', '192.52.193.255', '192.88.99.0', '192.88.99.2',
  '192.88.99.255', '192.168.0.0', '192.168.255.255',
  '192.175.48.0', '192.175.48.255', '198.18.0.0', '198.19.255.255',
  '198.51.100.0', '198.51.100.255', '203.0.113.0', '203.0.113.255',
  '224.0.0.0', '239.255.255.255', '240.0.0.0', '255.255.255.255',
])('rejects special-purpose IPv4 %s', address => {
  expect(isPublicResourceAddress(address)).toBe(false);
});

it.each([
  '::', '::1', '::ffff:8.8.8.8', '::ffff:127.0.0.1',
  '64:ff9b::', '64:ff9b:1::', '100::', '100:0:0:1::',
  '2001::', '2001:1::1', '2001:1::2', '2001:1::3', '2001:2::',
  '2001:3::', '2001:4:112::', '2001:10::', '2001:20::', '2001:30::',
  '2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff',
  '2001:db8::', '2001:db8:ffff:ffff:ffff:ffff:ffff:ffff',
  '2002::', '2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
  '2620:4f:8000::', '2620:4f:8000:ffff:ffff:ffff:ffff:ffff',
  '3fff::', '3fff::1', '3fff:0fff:ffff:ffff:ffff:ffff:ffff:ffff',
  '1fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', '4000::', '5f00::', 'fc00::', 'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
  'fe80::', 'febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'ff00::',
])('rejects special-purpose or non-global IPv6 %s', address => {
  expect(isPublicResourceAddress(address)).toBe(false);
});

it.each([
  '8.8.8.8', '1.1.1.1', '100.63.255.255', '100.128.0.0',
  '172.15.255.255', '172.32.0.0', '192.88.98.255', '192.88.100.0',
  '198.17.255.255', '198.20.0.0', '223.255.255.255',
  '2000:ffff:ffff:ffff:ffff:ffff:ffff:ffff', '2001:200::',
  '2001:db7:ffff:ffff:ffff:ffff:ffff:ffff', '2001:db9::',
  '2003::', '2606:4700:4700::1111', '2620:4f:7fff:ffff:ffff:ffff:ffff:ffff',
  '2620:4f:8001::', '3ffe:ffff:ffff:ffff:ffff:ffff:ffff:ffff', '3fff:1000::',
])('allows ordinary public unicast outside special ranges %s', address => {
  expect(isPublicResourceAddress(address)).toBe(true);
});

it.each(['', 'localhost', '999.1.1.1', '127.1', '0x7f000001', '2130706433', '[::1]', '8.8.8.8%lo0', '2606:4700::1%en0'])
('rejects non-canonical addresses and interface scopes %s', address => {
  expect(isPublicResourceAddress(address)).toBe(false);
});
