#!/usr/bin/node

import appRoot from "app-root-path";
import config from "config";
import { execSync } from "node:child_process";
import { promises as fs, Dirent, existsSync, rmSync } from "node:fs";
import { buildSite } from "./build.js";

const gitWorkingTree = execSync('git rev-parse --show-superproject-working-tree')
    .toString()
    .trim();
if (gitWorkingTree.length) {
  appRoot.setPath(gitWorkingTree);
}

// Length only applies to logging, never used for anything written to disk which
// always use the full hash.
const SHORT_HASH_LENGTH = 7;
const OUT = `${appRoot}/${config.get('outputDir')}`;
const DEPLOY = `${appRoot}/${config.get("deployDir")}`;
const SNAPSHOTS = `${appRoot}/${config.get('snapshotsDir')}`;
const LOCK_PATH = `${OUT}/deploy.lock`;
const LAST_DEPLOY_HASH_PATH = `${OUT}/latest-deploy.txt`;

doDeploy();

async function doDeploy() {
  for (let source of config.util.getConfigSources()) {
    console.info(`Deploying with config: ${source.name}`);
  }
  fs.mkdir(OUT, { recursive: true });
  const {oldDeployHash, newDeployHash} = await checkIfOutdated();
  await obtainDeployLock();
  fs.mkdir(SNAPSHOTS, { recursive: true });
  const oldSnapshotDir = await getLastSnapshotDir();
  const newSnapshotDir = await buildToSnapshotDir(newDeployHash);
  await deployAndCleanup(oldSnapshotDir, newSnapshotDir);
  await saveDeployVersionInfo(oldDeployHash, newDeployHash);
}

async function checkIfOutdated() {
  const oldDeployHash = existsSync(LAST_DEPLOY_HASH_PATH)
    ? await fs.readFile(LAST_DEPLOY_HASH_PATH, { encoding: "utf8" })
    : "";
  const newDeployHash = execSync('git rev-parse HEAD', { cwd: `${appRoot}` })
    .toString()
    .trim();
  if (oldDeployHash === newDeployHash) {
    console.log('Previous version matches current version ' +
        `(${newDeployHash.substring(0, SHORT_HASH_LENGTH)}). Doing nothing.`);
    process.exit(0);
  } else {
    console.info(
      `Checked revisions ` +
        `(old:${oldDeployHash?.substring(0, SHORT_HASH_LENGTH)}) ` +
        `(new:${newDeployHash.substring(0, SHORT_HASH_LENGTH)}) ` +
        `and continuing to publish...`
    );
    return {oldDeployHash, newDeployHash};
  }
}

async function obtainDeployLock() {
  const startAttempts = 0;
  while (existsSync(LOCK_PATH)) {
    if (startAttempts > config.get("startAttemptsMax")) {
      console.error("Timeout while waiting for publish lock.");
      process.exit(1);
    }
    startAttempts++;
    await new Promise((resolve) =>
      setTimeout(resolve, config.get("startAttemptsDelay"))
    );
  }
  await fs.writeFile(LOCK_PATH, new Date().toISOString());
  // Try to ensure the lock is always removed when this script finishes.
  process.on("exit", () => rmSync(LOCK_PATH));
}

function fileSortComparer(pubRoot) {
  /**
   * @param {Dirent} a
   * @param {Dirent} b
  */
  return (a, b) => {
    if (a == null && b == null) return 0;
    if (a == null && b != null) return -1;
    if (a != null && b == null) return 1;
    if (a.path === b.path && a.name == b.name) return 0;
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    if (a.path === pubRoot && b.path !== pubRoot) return -1;
    if (a.path !== pubRoot && b.path === pubRoot) return 1;
    return `${a.path}/${a.name}`.localeCompare(`${b.path}/${b.name}`);
  }
}

async function getPublicFiles(root) {
  if (!root) {
    return [];
  }
  const pubDirEnts = await fs.readdir(root, {
    recursive: true,
    withFileTypes: true,
  });
  pubDirEnts.sort(fileSortComparer(root));
  return pubDirEnts.map((f) =>
    `${f.path.replace(root, "")}/${f.name}`.replace(/^\//, "")
  );
}

async function getLastSnapshotDir() {
  const snapshotsList = await fs.readdir(SNAPSHOTS);
  if (snapshotsList?.length) {
    const snapshots = snapshotsList.sort();
    return `${SNAPSHOTS}/${snapshots[snapshots.length - 1]}`;
  }
  return undefined;
}

function getNewSnapshotDir(newDeployHash) {
  if (newDeployHash == null) {
    console.error('Deploy hash is undefined. Deploy cannot proceed.');
    process.exit(1);
  }
  // Strip dashes, colons, & milliseconds.
  const filenameSafeTimestamp = new Date()
  .toISOString()
  .replace(/:|-|(\.\d+)/g, '');
  const snapshotBasename = `${filenameSafeTimestamp}-${newDeployHash}`;
  return `${SNAPSHOTS}/${snapshotBasename}`;
}

async function buildToSnapshotDir(newDeployHash) {
  const newSnapshotDir = getNewSnapshotDir(newDeployHash);
  await buildSite(newSnapshotDir);
  console.info(`Built into ${newSnapshotDir.replace(OUT, config.get('outputDir'))}`);
  return newSnapshotDir;
}

async function deployAndCleanup(oldSnapshotDir, newSnapshotDir) {
  const builtFiles = await getPublicFiles(newSnapshotDir);
  await fs.cp(newSnapshotDir, DEPLOY, { recursive: true });
  console.info('Copied build to deploy destination.');

  const oldDeployFiles = await getPublicFiles(oldSnapshotDir);
  const filesToDelete = oldDeployFiles.filter((f) => !builtFiles.includes(f));
  let filesCleanedUp = 0;
  for (let f of builtFiles) {
    const fullPath = `${DEPLOY}/${f}`;
    if (filesToDelete.includes(f)) {
      filesCleanedUp++;
      console.info(`Removed ${f} from deploy dir.`);
      await fs.rm(fullPath, { recursive: true, force: true, maxRetries: 2 });
    }
  }
  if (filesCleanedUp > 0) {
    console.info(`Cleaned up ${filesCleanedUp} files.`);
  }
}

async function saveDeployVersionInfo(oldDeployHash, newDeployHash) {
  // Save the current revision to disk to compare for the next repo change.
  await fs.writeFile(LAST_DEPLOY_HASH_PATH, newDeployHash);
  console.info(`Saved the current revision hash to ${LAST_DEPLOY_HASH_PATH.replace(OUT, config.get('outputDir'))}`);

  console.log('Deploy complete. ' +
        `(old:${oldDeployHash?.substring(0, SHORT_HASH_LENGTH)}) ` +
        `(new:${newDeployHash.substring(0, SHORT_HASH_LENGTH)}) `);
}
