/** Install official, checksum-pinned CUDA/profiling archives without changing the driver. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32")
  throw new Error("This installer targets Windows x64.");
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packages = JSON.parse(
  fs.readFileSync(
    path.join(root, "config/inference-toolchain-packages.json"),
    "utf8",
  ),
);
const installRoot = path.join(
  os.homedir(),
  ".local",
  "opt",
  "bonsai-inference",
);
const cache = path.join(installRoot, "downloads");
const expanded = path.join(installRoot, "packages");
const cudaRoot = path.join(installRoot, `cuda-${packages.cudaVersion}`);
let installed = {};
try {
  installed = JSON.parse(
    fs.readFileSync(
      path.join(root, "config/inference-toolchain.local.json"),
      "utf8",
    ),
  );
} catch {}
const threadsIndex = process.argv.indexOf("--threads");
const threads = threadsIndex < 0 ? 8 : Number(process.argv[threadsIndex + 1]);
if (!Number.isInteger(threads) || threads < 1 || threads > 16)
  throw new Error("threads must be 1-16 per package");
for (const dir of [cache, expanded, cudaRoot])
  fs.mkdirSync(dir, { recursive: true });
const run = (file, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${file} exited ${code}`)),
    );
  });
async function checksum(file) {
  const hash = crypto.createHash("sha256");
  for await (const data of fs.createReadStream(file)) hash.update(data);
  return hash.digest("hex");
}
async function download(p) {
  const file = path.join(cache, path.basename(new URL(p.url).pathname));
  if (fs.existsSync(file)) {
    if (
      fs.statSync(file).size !== p.size ||
      (await checksum(file)) !== p.sha256
    )
      throw new Error(`Existing archive failed verification: ${file}`);
    return file;
  }
  const partial = file + ".partial";
  // Bounded ranges avoid long unobservable transfers and allow safe resumption.
  const partDir = file + ".parts",
    chunkSize = 4 * 1024 * 1024;
  fs.mkdirSync(partDir, { recursive: true });
  const count = Math.ceil(p.size / chunkSize);
  let next = 0,
    complete = 0;
  const chunks = Array.from({ length: count }, (_, i) =>
    path.join(partDir, String(i).padStart(4, "0")),
  );
  await Promise.all(
    Array.from({ length: threads }, async () => {
      while (next < count) {
        const i = next++,
          start = i * chunkSize,
          end = Math.min(p.size - 1, start + chunkSize - 1),
          expected = end - start + 1;
        for (
          let attempt = 0;
          attempt < 5 &&
          (!fs.existsSync(chunks[i]) || fs.statSync(chunks[i]).size < expected);
          attempt++
        ) {
          const present = fs.existsSync(chunks[i])
            ? fs.statSync(chunks[i]).size
            : 0;
          const tail = chunks[i] + ".tail";
          fs.writeFileSync(tail, "");
          let failure;
          try {
            await run("curl.exe", [
              "--fail",
              "--location",
              "--retry",
              "3",
              "--connect-timeout",
              "20",
              "--max-time",
              "600",
              "--silent",
              "--show-error",
              "--range",
              `${start + present}-${end}`,
              "--output",
              tail,
              p.url,
            ]);
          } catch (error) {
            failure = error;
          }
          const received = fs.statSync(tail).size;
          if (received > expected - present)
            throw new Error(`Server ignored range: ${tail}`);
          if (received) fs.appendFileSync(chunks[i], fs.readFileSync(tail));
          else if (failure && attempt === 4) throw failure;
        }
        if (fs.statSync(chunks[i]).size !== expected)
          throw new Error(`Incorrect range length: ${chunks[i]}`);
        if (++complete % 16 === 0)
          console.log(`${p.name}: ${complete}/${count} chunks`);
      }
    }),
  );
  const assembled = fs.createWriteStream(partial);
  for (const chunk of chunks)
    for await (const data of fs.createReadStream(chunk))
      if (!assembled.write(data))
        await new Promise((r) => assembled.once("drain", r));
  await new Promise((resolve, reject) => {
    assembled.once("error", reject);
    assembled.end(resolve);
  });
  if (
    fs.statSync(partial).size !== p.size ||
    (await checksum(partial)) !== p.sha256
  )
    throw new Error(`Downloaded archive failed verification: ${file}`);
  fs.renameSync(partial, file);
  console.log(`Verified ${p.name} (${Math.round(p.size / 1048576)} MiB)`);
  return file;
}
// Downloads are independent; extraction and configuration are sequential.
const files = [];
for (let i = 0; i < packages.packages.length; i += 3)
  files.push(
    ...(await Promise.all(packages.packages.slice(i, i + 3).map(download))),
  );
const locations = {};
for (let i = 0; i < packages.packages.length; i++) {
  const p = packages.packages[i],
    file = files[i],
    dest = path.join(expanded, path.basename(file, ".zip"));
  if (!fs.existsSync(path.join(dest, ".verified-extraction"))) {
    const entries = execFileSync("tar.exe", ["-tf", file], {
      encoding: "utf8",
      maxBuffer: 8_000_000,
      windowsHide: true,
    })
      .split(/\r?\n/)
      .filter(Boolean);
    for (const entry of entries)
      if (
        path.win32.isAbsolute(entry) ||
        entry.replace(/\\/g, "/").split("/").includes("..")
      )
        throw new Error(`Unsafe archive member: ${entry}`);
    fs.mkdirSync(dest, { recursive: true });
    await run("tar.exe", ["-xf", file, "-C", dest]);
    fs.writeFileSync(path.join(dest, ".verified-extraction"), p.sha256);
  }
  const children = fs
    .readdirSync(dest, { withFileTypes: true })
    .filter((e) => e.isDirectory());
  if (children.length !== 1)
    throw new Error(`Expected a single archive root in ${dest}`);
  const content = path.join(dest, children[0].name);
  if (p.group === "cuda") {
    if (
      !(
        installed.cudaRoot === cudaRoot &&
        installed.packages?.some(
          (previous) =>
            previous.name === p.name && previous.sha256 === p.sha256,
        )
      )
    )
      for (const child of fs.readdirSync(content))
        fs.cpSync(path.join(content, child), path.join(cudaRoot, child), {
          recursive: true,
          force: true,
        });
  } else {
    const canonical = path.join(
      installRoot,
      path.basename(file, "-archive.zip"),
    );
    const receipt = path.join(canonical, ".verified-package");
    if (!fs.existsSync(canonical)) {
      fs.cpSync(content, canonical, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      fs.writeFileSync(receipt, p.sha256);
    } else if (
      !fs.existsSync(receipt) ||
      fs.readFileSync(receipt, "utf8") !== p.sha256
    )
      throw new Error(
        `Profiler directory has no matching installation receipt: ${canonical}`,
      );
    locations[p.group] = canonical;
  }
  console.log(`Installed ${p.name}`);
}
function executable(dir, name) {
  const queue = [dir];
  while (queue.length) {
    const current = queue.shift();
    for (const e of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, e.name);
      if (e.isDirectory()) queue.push(full);
      else if (e.name.toLowerCase() === name.toLowerCase()) {
        const header = fs.readFileSync(full);
        const pe = header.readUInt32LE(0x3c);
        if (header.readUInt16LE(pe + 4) === 0x8664) return full;
      }
    }
  }
  throw new Error(`${name} missing from ${dir}`);
}
const vswhere =
  "C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe";
const vs = execFileSync(
  vswhere,
  [
    "-latest",
    "-products",
    "*",
    "-requires",
    "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
    "-property",
    "installationPath",
  ],
  { encoding: "utf8", windowsHide: true },
).trim();
const manifest = {
  ...(installed.previousUserEnvironment
    ? { previousUserEnvironment: installed.previousUserEnvironment }
    : {}),
  installedAt: new Date().toISOString(),
  installRoot,
  cudaRoot,
  nvcc: path.join(cudaRoot, "bin/nvcc.exe"),
  ncu: executable(locations.compute, "ncu.exe"),
  nsys: executable(locations.systems, "nsys.exe"),
  cmake: path.join(
    vs,
    "Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe",
  ),
  ninja: path.join(
    vs,
    "Common7/IDE/CommonExtensions/Microsoft/CMake/Ninja/ninja.exe",
  ),
  vcvars: path.join(vs, "VC/Auxiliary/Build/vcvars64.bat"),
  packages: packages.packages.map(({ name, url, sha256 }) => ({
    name,
    url,
    sha256,
  })),
};
for (const key of ["nvcc", "ncu", "nsys", "cmake", "ninja", "vcvars"])
  if (!fs.existsSync(manifest[key]))
    throw new Error(`${key} missing: ${manifest[key]}`);
fs.writeFileSync(
  path.join(root, "config/inference-toolchain.local.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(
  `Toolchain: ${path.join(root, "config/inference-toolchain.local.json")}`,
);
for (const key of ["nvcc", "ncu", "nsys"])
  console.log(
    execFileSync(manifest[key], ["--version"], {
      encoding: "utf8",
      windowsHide: true,
    }).trim(),
  );
