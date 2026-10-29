/** A fixed, explicitly owned benchmark cwd; archive each result before reusing it. */
import fs from "node:fs";
import path from "node:path";
const owner = "bonsai-coder-evaluation-v1";
export function espacioCoder(directory) {
  const root = path.resolve(directory);
  fs.mkdirSync(root, { recursive: true });
  if (
    fs.lstatSync(root).isSymbolicLink() ||
    fs.realpathSync(root).toLowerCase() !== root.toLowerCase()
  )
    throw new Error("Benchmark root must be a real directory");
  const marker = path.join(root, ".bonsai-evaluation-owner.json");
  if (!fs.existsSync(marker)) {
    if (fs.readdirSync(root).length)
      throw new Error(
        "Refusing to reuse a nonempty directory without an evaluation ownership marker",
      );
    fs.writeFileSync(marker, JSON.stringify({ owner, root }));
  }
  const metadata = JSON.parse(fs.readFileSync(marker, "utf8"));
  if (metadata.owner !== owner || metadata.root !== root)
    throw new Error("Benchmark ownership marker does not match");
  const taskPath = (id) => {
    if (!/^[a-z][a-z0-9-]*$/.test(id))
      throw new Error("Invalid benchmark task id");
    const target = path.resolve(root, id);
    if (target === root || path.dirname(target) !== root)
      throw new Error("Benchmark target escaped its root");
    return target;
  };
  return {
    root,
    prepare(id) {
      const target = taskPath(id);
      if (fs.existsSync(target)) {
        if (fs.lstatSync(target).isSymbolicLink())
          throw new Error("Benchmark task directory is a link");
        // Only this immediate, marker-owned task path can be recursively cleared.
        fs.rmSync(target, { recursive: true });
      }
      fs.mkdirSync(target);
      return target;
    },
    archive(id, destination) {
      const target = taskPath(id);
      if (fs.existsSync(destination))
        throw new Error("Benchmark archive already exists");
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.cpSync(target, destination, {
        recursive: true,
        errorOnExist: true,
        force: false,
        dereference: false,
      });
    },
  };
}
