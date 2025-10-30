const { spawn } = require("child_process");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const { syncMarketJson } = require("../../scripts/sync-market-json");

const getPythonExecutable = () => {
  if (process.env.MIFANTASY_PYTHON) {
    return process.env.MIFANTASY_PYTHON;
  }
  if (process.env.PYTHON) {
    return process.env.PYTHON;
  }
  return process.platform === "win32" ? "python" : "python3";
};

const runPythonScript = (scriptName, args = []) =>
  new Promise((resolve, reject) => {
    const pythonExecutable = getPythonExecutable();
    const commandArgs = [scriptName, ...(Array.isArray(args) ? args : [])];
    const commandLabel = `${pythonExecutable} ${commandArgs.join(" ")}`.trim();
    const child = spawn(pythonExecutable, commandArgs, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      env: {
        ...process.env,
        PYTHONIOENCODING:
          process.env.PYTHONIOENCODING &&
          /utf-?8/i.test(process.env.PYTHONIOENCODING)
            ? process.env.PYTHONIOENCODING
            : "utf-8",
        PYTHONUTF8: process.env.PYTHONUTF8 ?? "1",
      },
    });

    let stdout = "";
    let stderr = "";

    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.on("error", (error) => {
      const wrapped = new Error(`No se pudo iniciar ${commandLabel}: ${error.message}`);
      wrapped.stdout = stdout;
      wrapped.stderr = stderr;
      wrapped.originalError = error;
      reject(wrapped);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ code, stdout, stderr, command: commandLabel });
        return;
      }
      const failure = new Error(
        `${commandLabel} terminó con código ${code}.\n${stderr || stdout}`
      );
      failure.code = code;
      failure.stdout = stdout;
      failure.stderr = stderr;
      reject(failure);
    });
  });

const respondWithError = (res, type, error) => {
  console.error(`[sniffer:${type}]`, error);
  const payload = {
    success: false,
    error: error?.message ?? "Error desconocido",
    stdout: error?.stdout ?? "",
    stderr: error?.stderr ?? "",
  };
  res.status(500).json(payload);
};

const handleSnifferRequest = (res, type, scriptName, args = []) =>
  runPythonScript(scriptName, args)
    .then((result) =>
      syncMarketJson({ quiet: true }).then(() =>
        res.json({
          success: true,
          command: result.command,
          stdout: result.stdout,
          stderr: result.stderr,
        })
      )
    )
    .catch((error) => respondWithError(res, type, error));

module.exports = function setupProxy(app) {
  app.post("/api/sniff/market", (req, res) => {
    handleSnifferRequest(res, "market", "sniff_market_json_v3_debug.py", [
      "--mode",
      "market",
    ]);
  });

  app.post("/api/sniff/points/:playerId", (req, res) => {
    const rawId = typeof req.params.playerId === "string" ? req.params.playerId : "";
    const playerId = rawId.trim();
    if (!playerId) {
      res.status(400).json({
        success: false,
        error: "ID de jugador no válido",
        stdout: "",
        stderr: "",
      });
      return;
    }

    handleSnifferRequest(res, "points", "sniff_market_json_v3_debug.py", [
      "--mode",
      "points",
      "--player-id",
      playerId,
    ]);
  });
};
