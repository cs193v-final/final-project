import { describe, expect, it } from "vitest";

import { expandIpv6, rateLimitAddress } from "./rate-limit-address";

describe("expandIpv6", () => {
  it("fills in `::` wherever it appears", () => {
    expect(expandIpv6("2001:db8::1")).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]);
    expect(expandIpv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(expandIpv6("2001:db8::")).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 0]);
    expect(expandIpv6("::")).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(expandIpv6("1:2:3:4:5:6:7:8")).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("reads a trailing dotted IPv4 part as the last two hextets", () => {
    expect(expandIpv6("::ffff:203.0.113.7")).toEqual([0, 0, 0, 0, 0, 0xffff, 0xcb00, 0x7107]);
    expect(expandIpv6("::203.0.113.7")).toEqual([0, 0, 0, 0, 0, 0, 0xcb00, 0x7107]);
    expect(expandIpv6("1:2:3:4:5:6:1.2.3.4")).toEqual([1, 2, 3, 4, 5, 6, 0x102, 0x304]);
    expect(expandIpv6("64:ff9b::192.0.2.1")).toEqual([0x64, 0xff9b, 0, 0, 0, 0, 0xc000, 0x201]);
  });
});

describe("rateLimitAddress", () => {
  it("counts two IPv6 addresses in the same /64 as one", () => {
    const a = rateLimitAddress("2001:db8:1234:5678::1");
    expect(a).toBe("2001:db8:1234:5678::/64");
    expect(rateLimitAddress("2001:db8:1234:5678:dead:beef:cafe:f00d")).toBe(a);
    expect(rateLimitAddress("2001:db8:1234:5678:ffff:ffff:ffff:ffff")).toBe(a);
  });

  it("counts different /64s separately", () => {
    const a = rateLimitAddress("2001:db8:1234:5678::1");
    expect(rateLimitAddress("2001:db8:1234:5679::1")).not.toBe(a);
    expect(rateLimitAddress("2001:db9:1234:5678::1")).not.toBe(a);
    expect(rateLimitAddress("2001:db8::1")).toBe("2001:db8:0:0::/64");
  });

  it("gives the same answer for compressed, expanded and uppercase forms", () => {
    const forms = ["2001:db8::1", "2001:0db8:0000:0000:0000:0000:0000:0001", "2001:DB8:0:0:0:0:0:1", "2001:db8:0::0:1", " 2001:db8::1 "];
    for (const form of forms) expect(rateLimitAddress(form), form).toBe("2001:db8:0:0::/64");
  });

  it("ignores brackets and zone ids", () => {
    expect(rateLimitAddress("[2001:db8::1]")).toBe("2001:db8:0:0::/64");
    expect(rateLimitAddress("2001:db8::1%eth0")).toBe("2001:db8:0:0::/64");
    expect(rateLimitAddress("[fe80::1%25en0]")).toBe("fe80:0:0:0::/64");
  });

  it("counts an IPv4-mapped address as the IPv4 address it carries", () => {
    expect(rateLimitAddress("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitAddress("::FFFF:203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitAddress("::ffff:cb00:7107")).toBe("203.0.113.7");
    expect(rateLimitAddress("0:0:0:0:0:ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("leaves IPv4 addresses unchanged", () => {
    for (const ip of ["203.0.113.7", "198.51.100.1", "10.0.0.1", "127.0.0.1"]) expect(rateLimitAddress(ip)).toBe(ip);
    expect(rateLimitAddress("203.0.113.8")).not.toBe(rateLimitAddress("203.0.113.7"));
  });

  it("returns anything that isn't an IP address unchanged, without throwing", () => {
    for (const junk of ["", "localhost", "not an ip", "1.2.3", "2001:db8::1::2", "[]", "%", "gggg::1", "999.1.1.1"]) {
      expect(rateLimitAddress(junk), junk).toBe(junk);
    }
  });
});
