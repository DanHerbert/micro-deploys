#!/usr/bin/node

import appRoot from "app-root-path";
import chokidar from "chokidar";
import config from "config";
import debounce from "debounce";
import { execSync, spawn } from "node:child_process";
import { buildPug, buildStylus, copyRegularFiles, enumerateFiles } from "./build.js";

const SRC = `${appRoot}/${config.get("srcDir")}`;
const BUILD = `${appRoot}/${config.get("buildDir")}`;

await doBuild();
console.log('Finished initial build. Starting http server...');

const httpServer = spawn('npx', ['http-server', `${BUILD}`]);

httpServer.stdout.on('data', (data) => {
  console.log('' + data);
});

httpServer.stderr.on('data', (data) => {
  console.error('' + data);
});

console.log(`Watching ${SRC}`);

const watcher = chokidar.watch(SRC, {ignored: /.+\.css/});

watcher.on('all', debounce(async (event, path) => {
  console.log('event:', event, '    path:', path);
  await doBuild();
  console.log('Rebuild complete.');
}, 100));

async function doBuild() {
  const files = await enumerateFiles();
  await copyRegularFiles(files.regularFiles, BUILD);
  await buildStylus(files.stylusFiles, {compress: true, sourcemap: true}, BUILD);
  if (files.hasTypescriptFiles) {
    execSync('npx tsc', {cwd: appRoot.toString()});
  }
  await buildPug(files.pugFiles, BUILD);
}
