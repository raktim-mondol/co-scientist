/**
 * Supervisor pause/resume — verifies the additive pause flag and queue control
 * without running the full LLM orchestration loop.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DIR = join(tmpdir(), `supervisor-pause-test-${Date.now()}`);
mkdirSync(TEST_DIR, { recursive: true });
process.env.DB_PATH = join(TEST_DIR, "test.db");
process.env.DEEPSEEK_API_KEY = "stub-for-tests";

import { resetConfig } from "../config.js";
import { SupervisorAgent } from "../agents/supervisor.js";

let supervisor: SupervisorAgent;

beforeAll(() => {
  resetConfig();
  supervisor = new SupervisorAgent();
});

describe("SupervisorAgent pause/resume", () => {
  it("starts unpaused", () => {
    expect(supervisor.isPaused()).toBe(false);
  });

  it("reports paused after pause()", () => {
    supervisor.pause();
    expect(supervisor.isPaused()).toBe(true);
  });

  it("reports unpaused after resume()", () => {
    supervisor.resume();
    expect(supervisor.isPaused()).toBe(false);
  });
});
