import { registerAs } from "@nestjs/config";
import { dirname, join } from "path";
import { existsSync } from "fs";

/**
 * Path Configuration
 *
 * Resolves the project root directory once and makes it available
 * through ConfigService.
 */
export default registerAs("paths", () => {
  // Start from the current directory and traverse up to find package.json
  let root = __dirname;

  while (root !== dirname(root)) {
    if (existsSync(join(root, "package.json"))) {
      break;
    }
    root = dirname(root);
  }

  // Fallback: if package.json not found (shouldn't happen in a proper project)
  // use process.cwd() as a reasonable alternative
  if (!existsSync(join(root, "package.json"))) {
    root = process.cwd();
  }

  return {
    projectRoot: root,
  };
});
