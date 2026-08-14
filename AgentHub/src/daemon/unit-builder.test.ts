import { test, expect, describe } from "bun:test";
import { buildSystemdUnit, buildLaunchdPlist } from "./unit-builder";

describe("buildSystemdUnit", () => {
  test("generates valid systemd unit", () => {
    const unit = buildSystemdUnit({
      description: "OpenCrow Service",
      programArguments: ["/usr/bin/bun", "run", "src/index.ts"],
      workingDirectory: "/home/opencrow/opencrow",
    });
    expect(unit).toContain("[Unit]");
    expect(unit).toContain("[Service]");
    expect(unit).toContain("[Install]");
    expect(unit).toContain("Description=OpenCrow Service");
    expect(unit).toContain("ExecStart=/usr/bin/bun run src/index.ts");
    expect(unit).toContain("WorkingDirectory=/home/opencrow/opencrow");
    expect(unit).toContain("Restart=always");
    expect(unit).toContain("RestartSec=5");
  });

  test("includes environment file when provided", () => {
    const unit = buildSystemdUnit({
      description: "Test",
      programArguments: ["bun", "run", "test.ts"],
      workingDirectory: "/app",
      environmentFile: "/app/.env",
    });
    expect(unit).toContain("EnvironmentFile=-/app/.env");
  });

  test("excludes environment file when not provided", () => {
    const unit = buildSystemdUnit({
      description: "Test",
      programArguments: ["bun"],
      workingDirectory: "/app",
    });
    expect(unit).not.toContain("EnvironmentFile");
  });

  test("includes environment variables", () => {
    const unit = buildSystemdUnit({
      description: "Test",
      programArguments: ["bun"],
      workingDirectory: "/app",
      environment: { NODE_ENV: "production", PORT: "3000" },
    });
    expect(unit).toContain("Environment=NODE_ENV=production");
    expect(unit).toContain("Environment=PORT=3000");
  });

  test("escapes arguments with spaces", () => {
    const unit = buildSystemdUnit({
      description: "Test",
      programArguments: ["bun", "run", "file with spaces.ts"],
      workingDirectory: "/app",
    });
    expect(unit).toContain('"file with spaces.ts"');
  });

  test("includes after and requires directives", () => {
    const unit = buildSystemdUnit({
      description: "Test",
      programArguments: ["bun"],
      workingDirectory: "/app",
      after: ["postgresql.service"],
      requires: ["postgresql.service"],
    });
    expect(unit).toContain("After=network-online.target postgresql.service");
    expect(unit).toContain("Requires=postgresql.service");
  });

  test("uses custom restartSec", () => {
    const unit = buildSystemdUnit({
      description: "Test",
      programArguments: ["bun"],
      workingDirectory: "/app",
      restartSec: 10,
    });
    expect(unit).toContain("RestartSec=10");
  });

  test("always includes network-online.target in After", () => {
    const unit = buildSystemdUnit({
      description: "Test",
      programArguments: ["bun"],
      workingDirectory: "/app",
    });
    expect(unit).toContain("After=network-online.target");
  });
});

describe("buildLaunchdPlist", () => {
  test("generates valid plist XML", () => {
    const plist = buildLaunchdPlist({
      label: "com.opencrow.service",
      programArguments: ["/usr/local/bin/bun", "run", "src/index.ts"],
      workingDirectory: "/Users/opencrow/project",
      stdoutPath: "/tmp/opencrow.log",
      stderrPath: "/tmp/opencrow.err",
    });
    expect(plist).toContain('<?xml version="1.0"');
    expect(plist).toContain("<plist");
    expect(plist).toContain("<string>com.opencrow.service</string>");
    expect(plist).toContain("<string>/usr/local/bin/bun</string>");
    expect(plist).toContain("<string>run</string>");
    expect(plist).toContain("<string>src/index.ts</string>");
    expect(plist).toContain("<string>/Users/opencrow/project</string>");
    expect(plist).toContain("<true/>");
    expect(plist).toContain("<string>/tmp/opencrow.log</string>");
    expect(plist).toContain("<string>/tmp/opencrow.err</string>");
  });

  test("includes environment file block when provided", () => {
    const plist = buildLaunchdPlist({
      label: "test",
      programArguments: ["bun"],
      workingDirectory: "/app",
      environmentFile: "/app/.env",
      stdoutPath: "/tmp/out.log",
      stderrPath: "/tmp/err.log",
    });
    expect(plist).toContain("OPENCROW_ENV_FILE");
    expect(plist).toContain("<string>/app/.env</string>");
  });

  test("excludes environment block when not provided", () => {
    const plist = buildLaunchdPlist({
      label: "test",
      programArguments: ["bun"],
      workingDirectory: "/app",
      stdoutPath: "/tmp/out.log",
      stderrPath: "/tmp/err.log",
    });
    expect(plist).not.toContain("OPENCROW_ENV_FILE");
  });
});
