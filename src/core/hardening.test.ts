import { describe, expect, it, vi } from "vitest";
import { Session, buildChildEnv, mergeEnv } from "./session.js";
import type { PtyInstance } from "./pty.js";
import { SpecialKeys, parseKeys } from "./keys.js";
import { SecurityPolicyManager } from "../security/manager.js";
import { EventEmitter } from "events";

const testSecurity = () => new SecurityPolicyManager({ workspaceRoot: process.cwd() });

// Mock PtyInstance
class FakePty extends EventEmitter {
  pid = 1234;
  exited = false;
  exitCode = null;
  writes: string[] = [];
  write(data: string) { this.writes.push(data); }
  resize() {}
  dispose() { this.exited = true; }
}

vi.mock("./pty.js", () => ({
  PtyInstance: class {},
  spawnPty: () => new FakePty(),
}));

describe("Hardening Features", () => {
  describe("Transcript Rolling Buffer", () => {
    it("should truncate transcript when it exceeds 1MB", () => {
      const pty = new FakePty();
      const session = new Session("test", pty as unknown as PtyInstance, 80, 24);
      
      // We know MAX_TRANSCRIPT_LENGTH is 1MB (1024 * 1024)
      const data = "a".repeat(1024 * 1024 + 10);
      pty.emit("data", data);
      
      expect(session.transcript.length).toBe(1024 * 1024);
      expect(session.transcript).toBe("a".repeat(1024 * 1024));
    });

    it("should keep the tail of the output when rolling", () => {
      const pty = new FakePty();
      const session = new Session("test", pty as unknown as PtyInstance, 80, 24);
      
      const part1 = "a".repeat(1024 * 1024 - 5);
      const part2 = "bcdefghij";
      
      pty.emit("data", part1);
      pty.emit("data", part2);
      
      // Should keep the last 1MB
      expect(session.transcript.endsWith("bcdefghij")).toBe(true);
      expect(session.transcript.length).toBe(1024 * 1024);
    });

    it("should enforce the transcript cap in UTF-8 bytes for multi-byte output", () => {
      const pty = new FakePty();
      const session = new Session("test", pty as unknown as PtyInstance, 80, 24);

      const data = "🙂".repeat(262144) + "a";
      pty.emit("data", data);

      expect(Buffer.byteLength(session.transcript, "utf8")).toBeLessThanOrEqual(1024 * 1024);
      expect(session.transcript.endsWith("a")).toBe(true);
      expect(session.transcript).not.toContain("\uFFFD");
    });

    it("should cache joined transcript strings until new output arrives", () => {
      const pty = new FakePty();
      const session = new Session("test", pty as unknown as PtyInstance, 80, 24);
      const joinSpy = vi.spyOn(Array.prototype, "join");

      try {
        pty.emit("data", "hello ");
        pty.emit("data", "world");

        expect(session.transcript).toBe("hello world");
        expect(session.transcript).toBe("hello world");
        expect(joinSpy).toHaveBeenCalledTimes(1);

        pty.emit("data", "!");

        expect(session.transcript).toBe("hello world!");
        expect(joinSpy).toHaveBeenCalledTimes(2);
      } finally {
        joinSpy.mockRestore();
      }
    });
  });

  describe("Trace Hardening", () => {
    it("caps trace history and keeps the newest events", () => {
      const pty = new FakePty();
      const session = new Session("test", pty as unknown as PtyInstance, 80, 24);

      for (let i = 0; i < 5000; i += 1) {
        session.recordTraceEvent("wait", { sequence: i });
      }

      expect(session.trace).toHaveLength(4096);
      expect(session.trace[0]?.details).toMatchObject({ sequence: 904 });
      expect(session.trace.at(-1)?.details).toMatchObject({ sequence: 4999 });
    });

    it("records input metadata without storing raw payloads", () => {
      const pty = new FakePty();
      const session = new Session("test", pty as unknown as PtyInstance, 80, 24);

      session.write("secret\n");

      expect(pty.writes).toEqual(["secret\n"]);
      const event = session.trace.at(-1);
      expect(event?.type).toBe("input");
      expect(event?.details).toMatchObject({
        length: 7,
        utf8Bytes: 7,
        newlineCount: 1,
        containsControl: true,
        containsEscape: false,
      });
      expect(event?.details).not.toHaveProperty("data");
      expect(JSON.stringify(event)).not.toContain("secret");
    });
  });

  describe("Environment Preservation", () => {
    it("should preserve PATH even when inherit is false", () => {
      const originalEnv = process.env;
      process.env = { ...originalEnv, PATH: "/test/path" };

      try {
        const env = mergeEnv(testSecurity(), {}, { inherit: false });
        expect(env.PATH).toBe("/test/path");
      } finally {
        process.env = originalEnv;
      }
    });

    it("should provide a fallback PATH if none is present in environment", () => {
      const originalEnv = process.env;
      process.env = {};

      try {
        const env = mergeEnv(testSecurity(), {}, { inherit: false });
        expect(env.PATH).toBe("/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin");
      } finally {
        process.env = originalEnv;
      }
    });

    it("builds a Windows-safe minimal env without inheriting Unix-only shell vars", () => {
      const env = buildChildEnv(
        {
          Path: "C:\\Tools;C:\\Windows\\System32",
          SystemRoot: "C:\\Windows",
          ComSpec: "C:\\Windows\\System32\\cmd.exe",
          PATHEXT: ".COM;.EXE;.BAT;.CMD",
          USERPROFILE: "C:\\Users\\tester",
          HOMEDRIVE: "C:",
          HOMEPATH: "\\Users\\tester",
          TEMP: "C:\\Temp",
          TMP: "C:\\Temp",
          SHELL: "/bin/bash",
        },
        testSecurity(),
        {},
        { inherit: false },
        "win32"
      );

      expect(env.Path).toBe("C:\\Tools;C:\\Windows\\System32");
      expect(env.PATH).toBeUndefined();
      expect(env.ComSpec).toBe("C:\\Windows\\System32\\cmd.exe");
      expect(env.SystemRoot).toBe("C:\\Windows");
      expect(env.PATHEXT).toBe(".COM;.EXE;.BAT;.CMD");
      expect(env.USERPROFILE).toBe("C:\\Users\\tester");
      expect(env.SHELL).toBeUndefined();
    });

    it("provides a Windows fallback Path when inheritance is disabled", () => {
      const env = buildChildEnv(
        { SystemRoot: "C:\\Windows" },
        testSecurity(),
        {},
        { inherit: false },
        "win32"
      );

      expect(env.Path).toBe(
        "C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\Wbem"
      );
      expect(env.PATH).toBeUndefined();
    });

    it("defaults to a minimal env, excluding arbitrary parent vars", () => {
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        PATH: "/test/path",
        HOME: "/home/test",
        MCP_PROBE: "should-not-leak",
        AWS_SECRET_ACCESS_KEY: "should-not-leak",
      };

      try {
        // No environment arg -> inherit defaults to false under the new policy
        const env = mergeEnv(testSecurity());
        expect(env.PATH).toBe("/test/path");
        expect(env.HOME).toBe("/home/test");
        expect(env.MCP_PROBE).toBeUndefined();
        expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      } finally {
        process.env = originalEnv;
      }
    });

    it("copies arbitrary parent vars when security.inheritEnv is true", () => {
      const originalEnv = process.env;
      process.env = { ...originalEnv, MCP_PROBE: "visible" };

      try {
        const security = new SecurityPolicyManager({
          workspaceRoot: process.cwd(),
          inheritEnv: true,
        });
        const env = mergeEnv(security);
        expect(env.MCP_PROBE).toBe("visible");
      } finally {
        process.env = originalEnv;
      }
    });

    it("drops secret patterns even when inheritEnv is true (defense-in-depth)", () => {
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        PATH: "/test/path",
        HOME: "/home/test",
        MCP_PROBE: "visible",
        AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
        AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        GITHUB_TOKEN: "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        DATABASE_URL: "postgresql://user:pass@localhost/db",
        SECRET_KEY: "super-secret-value",
      };

      try {
        const security = new SecurityPolicyManager({
          workspaceRoot: process.cwd(),
          inheritEnv: true, // Explicitly enabled
        });
        const env = mergeEnv(security);

        // Safe vars should be present
        expect(env.PATH).toBe("/test/path");
        expect(env.HOME).toBe("/home/test");
        expect(env.MCP_PROBE).toBe("visible");

        // Secret patterns should be dropped even with inheritEnv: true
        expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
        expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
        expect(env.GITHUB_TOKEN).toBeUndefined();
        expect(env.DATABASE_URL).toBeUndefined();
        expect(env.SECRET_KEY).toBeUndefined();
      } finally {
        process.env = originalEnv;
      }
    });

    it("drops execution-modifying patterns even when inheritEnv is true (defense-in-depth)", () => {
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        NODE_OPTIONS: "--require=evil",
        PYTHONSTARTUP: "evil.py",
        LD_PRELOAD: "evil.so",
        BASH_ENV: "evil.sh",
      };

      try {
        const security = new SecurityPolicyManager({
          workspaceRoot: process.cwd(),
          inheritEnv: true, // Explicitly enabled
        });
        const env = mergeEnv(security);

        // Execution modifiers should be dropped even with inheritEnv: true
        expect(env.NODE_OPTIONS).toBeUndefined();
        expect(env.PYTHONSTARTUP).toBeUndefined();
        expect(env.LD_PRELOAD).toBeUndefined();
        expect(env.BASH_ENV).toBeUndefined();
      } finally {
        process.env = originalEnv;
      }
    });
  });

  describe("Expanded Key Support", () => {
    it("should support function keys in parseKeys", () => {
      expect(parseKeys("f1")).toBe(SpecialKeys.f1);
      expect(parseKeys("<F12>")).toBe(SpecialKeys.f12);
    });

    it("should support navigation keys in parseKeys", () => {
      expect(parseKeys("home")).toBe(SpecialKeys.home);
      expect(parseKeys("<end>")).toBe(SpecialKeys.end);
      expect(parseKeys("pgup")).toBe(SpecialKeys.pageUp);
      expect(parseKeys("<pagedown>")).toBe(SpecialKeys.pageDown);
    });

    it("should support editing keys in parseKeys", () => {
      expect(parseKeys("backspace")).toBe(SpecialKeys.backspace);
      expect(parseKeys("<del>")).toBe(SpecialKeys.delete);
      expect(parseKeys("enter")).toBe(SpecialKeys.enter);
    });
  });
});
