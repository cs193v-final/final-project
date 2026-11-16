// Every database connection requires TLS (#60). Pure string checks, no network.
import { describe, expect, it } from "vitest";

import { assertDatabaseUrlRequiresTls, InsecureDatabaseUrlError } from "./tls";

// Placeholder credentials only (the gitleaks allowlist accepts USER:PASSWORD).
const neonHost = "ep-example-123456-pooler.us-east-2.aws.neon.tech";
const url = (host: string, query = "") => `postgresql://USER:PASSWORD@${host}/neondb${query}`;

const check = (u: string) => () => assertDatabaseUrlRequiresTls(u, "DATABASE_URL");

describe("assertDatabaseUrlRequiresTls", () => {
  it.each(["require", "verify-ca", "verify-full"])("accepts sslmode=%s", (mode) => {
    expect(check(url(neonHost, `?sslmode=${mode}`))).not.toThrow();
  });

  it("accepts Neon's own string, with channel_binding=require, and the postgres:// scheme", () => {
    expect(check(url(neonHost, "?sslmode=require&channel_binding=require"))).not.toThrow();
    expect(check(url(neonHost, "?channel_binding=require&sslmode=verify-full"))).not.toThrow();
    expect(check(`postgres://USER:PASSWORD@${neonHost}/neondb?sslmode=require`)).not.toThrow();
  });

  it("rejects a remote host with no sslmode", () => {
    expect(check(url(neonHost))).toThrow(InsecureDatabaseUrlError);
    expect(check(url(neonHost))).toThrow(/DATABASE_URL must require TLS: sslmode is missing/);
    expect(check(url(neonHost, "?channel_binding=require"))).toThrow(/sslmode is missing/);
  });

  it.each(["disable", "allow", "prefer", "no-verify", "REQUIRE", ""])("rejects sslmode=%s on a remote host", (mode) => {
    expect(check(url(neonHost, `?sslmode=${mode}`))).toThrow(InsecureDatabaseUrlError);
  });

  it("rejects a weak sslmode even when a strong one is also given", () => {
    expect(check(url(neonHost, "?sslmode=require&sslmode=disable"))).toThrow(/sslmode=disable/);
  });

  it.each(["localhost", "localhost:5432", "127.0.0.1", "127.0.0.1:5432", "[::1]", "[::1]:5432", "LOCALHOST"])(
    "allows a loopback host (%s) without TLS, e.g. the CI Postgres container",
    (host) => {
      expect(check(`postgres://USER:PASSWORD@${host}/app`)).not.toThrow();
      expect(check(`postgres://USER:PASSWORD@${host}/app?sslmode=disable`)).not.toThrow();
    },
  );

  it.each(["localhost.evil.com", "127.0.0.1.nip.io", "evil.com", "10.0.0.5", "127.0.0.2"])(
    "does not treat %s as loopback",
    (host) => {
      expect(check(`postgres://USER:PASSWORD@${host}/app`)).toThrow(/sslmode is missing/);
    },
  );

  it("checks the host query parameter, which overrides the URL's host", () => {
    expect(check(`postgres://USER:PASSWORD@localhost/app?host=${neonHost}`)).toThrow(/sslmode is missing/);
    expect(check(`postgres://USER:PASSWORD@localhost/app?host=localhost,${neonHost}`)).toThrow(/sslmode is missing/);
    expect(check(`postgres://USER:PASSWORD@${neonHost}/app?host=127.0.0.1`)).not.toThrow();
    // A Unix socket directory is not one of the loopback hosts: TLS still required.
    expect(check("postgres:///app?host=/var/run/postgresql")).toThrow(/sslmode is missing/);
  });

  it("rejects strings that aren't postgres URLs", () => {
    expect(check("")).toThrow(/not a valid postgres/);
    expect(check(`host=${neonHost} sslmode=require`)).toThrow(/not a valid postgres/);
    expect(check(`mysql://USER:PASSWORD@${neonHost}/db?sslmode=require`)).toThrow(/not a postgres/);
  });

  it("never puts the connection string, password, user or host in the message", () => {
    // Built at run time so the secret scanner doesn't see a credential-shaped URL.
    const secret = ["s3cr3t", "Pa55", "w0rd"].join("-");
    const user = "alice_db_owner";
    const cases = [
      ["postgresql://", user, ":", secret, "@", neonHost, "/neondb"],
      ["postgresql://", user, ":", secret, "@", neonHost, "/neondb?sslmode=", secret],
      ["postgresql://", user, ":", secret, "@", neonHost, "/neondb?sslmode=disable"],
      ["postgresql://", user, ":", secret, "@", neonHost, ":not-a-port/neondb"],
      ["mysql://", user, ":", secret, "@", neonHost, "/neondb"],
    ].map((parts) => parts.join(""));

    for (const bad of cases) {
      let message = "";
      try {
        assertDatabaseUrlRequiresTls(bad, "DATABASE_URL_UNPOOLED");
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/^DATABASE_URL_UNPOOLED must require TLS/);
      for (const part of [bad, secret, user, neonHost, "neondb"]) {
        expect(message).not.toContain(part);
      }
    }
  });
});
