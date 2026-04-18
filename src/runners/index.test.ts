import { describe, expect, it } from "vitest";
import { runCommand } from "./index.js";

describe("runCommand", () => {
  it("terminates and marks stdout when the output cap is exceeded", async () => {
    const result = await runCommand(
      {
        command: process.execPath,
        args: ["-e", "process.stdout.write('x'.repeat(256)); setTimeout(() => {}, 5000);"],
      },
      undefined,
      128
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("[stdout truncated after 128 bytes, process terminated]");
    expect(result.stderr).toBe("");
  });

  it("terminates and marks stderr when the output cap is exceeded", async () => {
    const result = await runCommand(
      {
        command: process.execPath,
        args: ["-e", "process.stderr.write('y'.repeat(256)); setTimeout(() => {}, 5000);"],
      },
      undefined,
      128
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("[stderr truncated after 128 bytes, process terminated]");
    expect(result.stdout).toBe("");
  });
});
