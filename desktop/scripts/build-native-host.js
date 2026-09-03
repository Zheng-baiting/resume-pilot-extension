const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const esbuild = require("esbuild");
const { inject } = require("postject");

const projectRoot = path.resolve(__dirname, "../..");
const tempDirectory = path.join(projectRoot, "tmp", "native-host-build");
const bundlePath = path.join(tempDirectory, "native-host-bundle.cjs");
const blobPath = path.join(tempDirectory, "native-host.blob");
const configPath = path.join(tempDirectory, "sea-config.json");
const executablePath = path.join(projectRoot, "desktop", "build", "resume-pilot-native-host.exe");

async function build() {
  fs.mkdirSync(tempDirectory, { recursive: true });
  esbuild.buildSync({
    entryPoints: [path.join(projectRoot, "desktop", "native-host", "host.js")],
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    sourcemap: false,
    minify: true
  });
  fs.writeFileSync(configPath, JSON.stringify({
    main: bundlePath,
    output: blobPath,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false
  }, null, 2));
  execFileSync(process.execPath, ["--experimental-sea-config", configPath], { stdio: "inherit" });
  fs.copyFileSync(process.execPath, executablePath);
  await inject(executablePath, "NODE_SEA_BLOB", fs.readFileSync(blobPath), {
    sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
  });
  console.log(`native host built: ${executablePath}`);
}

build().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
