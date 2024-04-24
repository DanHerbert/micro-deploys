import appRoot from "app-root-path";
import { execSync } from "node:child_process";
import { join as pathJoin, normalize } from "node:path";

function getAppRootPath() {
  let superprojectRoot = execSync('git rev-parse --show-superproject-working-tree')
      .toString()
      .trim();
  if (superprojectRoot.length) {
    appRoot.setPath(superprojectRoot);
  } else {
    appRoot.setPath(execSync('git rev-parse --show-toplevel')
          .toString()
          .trim());
  }
  process.env.NODE_CONFIG_DIR = pathJoin(appRootPath, 'config');
  return appRoot.toString();
}

export const appRootPath = getAppRootPath();

export function toAbsolute(path) {
  if (path && path.startsWith('/')) {
    return normalize(path);
  }
  return pathJoin(getAppRootPath(), path);
}
