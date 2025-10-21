const { spawn } = require("child_process");
const fs = require("fs/promises");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const marketJsonSource = path.join(repoRoot, "market.json");
const marketJsonDestination = path.join(repoRoot, "frontend", "public", "market.json");

const getPythonExecutable = () => {
  if (process.env.MIFANTASY_PYTHON) {
    return process.env.MIFANTASY_PYTHON;
  }
  if (process.env.PYTHON) {
    return process.env.PYTHON;
  }
  return process.platform === "win32" ? "python" : "python3";
};

const copyMarketJson = async () => {
  await fs.mkdir(path.dirname(marketJsonDestination), { recursive: true });
  await fs.copyFile(marketJsonSource, marketJsonDestination);
  return marketJsonDestination;
};

const runPythonScript = (scriptName) =>
  new Promise((resolve, reject) => {
    const pythonExecutable = getPythonExecutable();
    const commandLabel = `${pythonExecutable} ${scriptName}`.trim();
    const child = spawn(pythonExecutable, [scriptName], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
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

const handleSnifferRequest = (app, type, scriptName) => {
  app.post(`/api/sniff/${type}`, (req, res) => {
    runPythonScript(scriptName)
      .then((result) =>
        copyMarketJson().then(() =>
          res.json({
            success: true,
            command: result.command,
            stdout: result.stdout,
            stderr: result.stderr,
          })
        )
      )
      .catch((error) => respondWithError(res, type, error));
  });
};

module.exports = function setupProxy(app) {
  handleSnifferRequest(app, "market", "sniff_market_json_v3_debug.py");
  handleSnifferRequest(app, "points", "sniff_puntos_json_v3_debug.py");
};
