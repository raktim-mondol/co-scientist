import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useInput } from "../../ink.js";
import { Spinner } from "../Spinner.js";
import {
  getConsensusAccessToken,
  clearConsensusTokens,
} from "../../../tools/consensusAuth.js";
import {
  getSciteAccessToken,
  clearSciteTokens,
} from "../../../tools/sciteAuth.js";
import { resetMCPManager } from "../../../tools/mcpClient.js";

type Provider = "consensus" | "scite" | "all";

interface LoginModalProps {
  provider: Provider;
  onDone: (lines: string[], success: boolean) => void;
}

// Drives the OAuth login flow *inside* the Ink tree instead of console.log-ing
// to raw stdout (which corrupts the live frame and leaves a ghost prompt). The
// underlying token functions open the browser and log only through the muted
// logger, so all user-visible progress is surfaced here. Mirrors x_code's
// local-jsx ConsoleOAuthFlow: render → run → report → onDone.
export function LoginModal({ provider, onDone }: LoginModalProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let mounted = true;
    const log = (line: string) =>
      mounted && setLines((prev) => [...prev, line]);

    (async () => {
      let anySucceeded = false;
      const wantConsensus = provider === "consensus" || provider === "all";
      const wantScite = provider === "scite" || provider === "all";

      if (wantConsensus) {
        log("Consensus — opening browser for authorization…");
        clearConsensusTokens();
        try {
          const token = await getConsensusAccessToken();
          if (token) {
            log("✓ Consensus login successful.");
            anySucceeded = true;
          } else {
            log("✗ Consensus login failed — no token returned.");
          }
        } catch (err) {
          log(`✗ Consensus login failed: ${(err as Error).message}`);
        }
      }

      if (wantScite) {
        log("Scite — opening browser for authorization…");
        clearSciteTokens();
        try {
          const token = await getSciteAccessToken();
          if (token) {
            log("✓ Scite login successful.");
            anySucceeded = true;
          } else {
            log("✗ Scite login failed — no token returned.");
          }
        } catch (err) {
          log(`✗ Scite login failed: ${(err as Error).message}`);
        }
      }

      // Pick up the new tokens on the next session.
      resetMCPManager();

      if (mounted) {
        setSuccess(anySucceeded);
        setDone(true);
      }
    })();

    return () => {
      mounted = false;
    };
    // Run exactly once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useInput((_input, key) => {
    // While running, Esc aborts the wait and dismisses; when done, Enter/Esc
    // dismisses. The summary persists in the transcript either way.
    if (key.escape || (done && key.return)) {
      onDone(lines, success);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
      <Text color="claude" bold>PROVIDER LOGIN</Text>
      {lines.map((line, i) => (
        <Text key={i} color="text">{line}</Text>
      ))}
      {!done ? (
        <Box>
          <Spinner />
          <Text dimColor> Waiting for browser authorization…  [esc] cancel</Text>
        </Box>
      ) : (
        <Text color={success ? "success" : "error"}>
          {success ? "Login complete." : "Login failed."}  <Text dimColor>[enter] dismiss</Text>
        </Text>
      )}
    </Box>
  );
}
