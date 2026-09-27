/**
 * THE CORPUS, in both directions (CLAUDE.md guards rule 1): every address here
 * must be refused, AND every range in the classifier's tables must refuse at
 * least one address here. The first half catches a hole; the second catches a
 * range nobody exercises. The first eight entries are the bypasses the
 * 2026-09 audit walked past the old string-prefix guard with.
 */
export const MUST_BLOCK: readonly string[] = [
  "::ffff:127.0.0.1", // audit: IPv4-mapped loopback
  "::", // audit: unspecified
  "fd00::1", // audit: ULA
  "100.100.100.200", // audit: CGNAT (Alibaba metadata)
  "100.64.0.1", // audit
  "0.0.0.1", // audit
  "fe80::1", // audit
  "::ffff:169.254.169.254", // audit: mapped metadata
  "127.0.0.1",
  "127.255.255.254",
  "10.0.0.5",
  "172.16.0.1",
  "172.31.255.255",
  "192.168.1.10",
  "169.254.169.254",
  "0.0.0.0",
  "192.0.0.170",
  "192.0.2.1",
  "192.88.99.1",
  "198.18.0.1",
  "198.51.100.7",
  "203.0.113.9",
  "224.0.0.251",
  "255.255.255.255",
  "::1",
  "ff02::1",
  "fc00::1",
  "64:ff9b::a9fe:a9fe", // NAT64 of 169.254.169.254
  "2001:0:4136:e378::1", // Teredo
  "2001:db8::1",
  "2002:7f00:1::1", // 6to4 of 127.0.0.1
  "3fff::1",
];

/** Positive control: a classifier that refuses everything passes MUST_BLOCK. */
export const MUST_ALLOW: readonly string[] = [
  "93.184.215.14",
  "1.1.1.1",
  "8.8.8.8",
  "172.32.0.1", // just past 172.16/12
  "100.128.0.1", // just past 100.64/10
  "169.253.255.255",
  "2606:4700:4700::1111",
  "2a00:1450:4001:80b::200e",
  "::ffff:93.184.215.14", // mapped, but the IPv4 it carries is public
  "64:ff9b::101:101", // NAT64 of 1.1.1.1
];
