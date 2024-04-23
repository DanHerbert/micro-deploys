#!/usr/bin/node

import {appRootPath, toAbsolute} from "./common.js";
import chokidar from "chokidar";
import config from "config";
import debounce from "debounce";
import { execSync, spawn } from "node:child_process";
import { buildPug, buildStylus, copyRegularFiles, enumerateFiles } from "./build.js";


const SRC = toAbsolute(config.get("srcDir"));
const BUILD = toAbsolute(config.get("buildDir"));

await doBuild();
console.log('Finished initial build. Starting http server...');

const httpServer = spawn('npx', ['http-server', `${BUILD}`], { cwd: `${appRootPath}` });

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
    execSync('npx tsc', { cwd: `${appRoot}` });
  }
  await buildPug(files.pugFiles, BUILD);
}
