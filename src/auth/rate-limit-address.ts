// The address a per-address rate limit counts against (#150, audit L1).
//
// One ordinary IPv6 connection is usually given a whole /64, about 2^64
// addresses, so a client could rotate within it and look like a new address
// every request. IPv6 addresses therefore count by their /64 prefix, the
// smallest block one subscriber normally holds. IPv4 addresses count as
// themselves, and an IPv4-mapped IPv6 address (`::ffff:203.0.113.7`) counts as
// the IPv4 address it carries.
//
// No React, Next or database imports, so any server code that keys on an
// address can use it.
import { isIP } from "node:net";

/**
 * The 8 hextets of a valid IPv6 address (no brackets or zone id), as numbers.
 * Handles `::` compression and a trailing dotted IPv4 part.
 */
export function expandIpv6(address: string): number[] {
  let text = address;
  const tailV4: number[] = [];
  const lastColon = text.lastIndexOf(":");
  const last = text.slice(lastColon + 1);
  if (last.includes(".")) {
    const [a = 0, b = 0, c = 0, d = 0] = last.split(".").map(Number);
    tailV4.push((a << 8) | b, (c << 8) | d);
    // Keep the colon so a trailing `::` stays a `::`.
    text = text.slice(0, lastColon + 1);
    if (text.endsWith(":") && !text.endsWith("::")) text = text.slice(0, -1);
  }
  const parse = (part: string) => (part === "" ? [] : part.split(":").map((h) => parseInt(h, 16)));
  const gap = text.indexOf("::");
  const head = parse(gap === -1 ? text : text.slice(0, gap));
  const tail = [...(gap === -1 ? [] : parse(text.slice(gap + 2))), ...tailV4];
  const zeros = 8 - head.length - tail.length;
  return [...head, ...Array<number>(Math.max(zeros, 0)).fill(0), ...tail];
}

/**
 * What a per-address limit counts `ip` as:
 * - IPv4: the address itself, unchanged (`203.0.113.7`).
 * - IPv4-mapped IPv6 (`::ffff:203.0.113.7`): that IPv4 address.
 * - Any other IPv6: its /64, in one canonical form whatever way it was written
 *   (`2001:db8:0:0::/64` for `2001:DB8::1`, `[2001:db8::abcd]` or
 *   `2001:db8:0:0:1:2:3:4%eth0`).
 * - Anything that isn't an IP address: returned unchanged, so it still gets a
 *   count of its own.
 */
export function rateLimitAddress(ip: string): string {
  let text = ip.trim();
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);
  text = text.toLowerCase();

  const version = isIP(text);
  if (version === 4) return text;
  if (version !== 6) return ip;

  const hextets = expandIpv6(text);
  const isMapped = hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0xffff;
  if (isMapped) {
    const [, , , , , , hi = 0, lo = 0] = hextets;
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
  }
  return `${hextets
    .slice(0, 4)
    .map((h) => h.toString(16))
    .join(":")}::/64`;
}
