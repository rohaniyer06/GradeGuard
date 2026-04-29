const major = Number.parseInt(process.versions.node.split(".")[0], 10);

if (Number.isNaN(major)) {
  console.error("Unable to detect Node.js version.");
  process.exit(1);
}

if (major >= 25) {
  console.error(
    [
      `Node.js ${process.versions.node} is not supported for this project runtime.`,
      "Use Node 22 LTS (recommended) or Node 20 LTS, then run npm install again."
    ].join("\n")
  );
  process.exit(1);
}
