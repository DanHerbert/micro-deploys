#!/usr/bin/node

import appRoot from "app-root-path";
import config from "config";
import pug from "pug";
import stylus from "stylus";
import { execSync } from "node:child_process";
import { promisify } from "node:util";
import { Dirent, promises as fs } from "node:fs";
import { dirname } from "node:path";
import PathLike from "node:fs";
import { pathToFileURL } from 'url'

const SRC = `${appRoot}/${config.get("srcDir")}`;
const BUILD = `${appRoot}/${config.get("buildDir")}`;

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // If running as a node.js script (not an ES module) then build the app.
  buildSite();
}

export async function buildSite(destDir = BUILD) {
  let cssToCleanup = [];
  try {
    await fs.mkdir(destDir, { recursive: true });
    const files = await enumerateFiles();
    await copyRegularFiles(files.regularFiles, destDir);
    cssToCleanup = await buildStylus(files.stylusFiles, {}, destDir);
    if (files.hasTypescriptFiles) {
      const tscOpts = { cwd: appRoot.toString() };
      if (destDir !== BUILD) {
        tscOpts.outDir = `${destDir}/js`;
      }
      execSync('npx tsc', tscOpts);
    }
    await buildPug(files.pugFiles, destDir);
  } finally {
    await doCssCleanup(cssToCleanup);
  }
}

export async function enumerateFiles() {
  const directoryTree = await fs.readdir(SRC, {
    recursive: true,
    withFileTypes: true,
  });
  /** @type {Dirent} */
  const stylusFiles = [];
  /** @type {Dirent} */
  const pugFiles = [];
  /** @type {Dirent} */
  const regularFiles = [];
  let hasTypescriptFiles = false;
  for (let dirEnt of directoryTree) {
    if (dirEnt.isFile()) {
      if (dirEnt.name.startsWith('_')) {
        // Underscore prefixed files are treated as includes and are ignored.
        continue;
      } else if (dirEnt.name.endsWith('.styl')) {
        stylusFiles.push(dirEnt);
      } else if (dirEnt.name.endsWith('.ts')) {
        hasTypescriptFiles = true;
      } else if (dirEnt.name.endsWith('.pug')) {
        pugFiles.push(dirEnt);
      } else {
        regularFiles.push(dirEnt);
      }
    }
  }
  return {
    regularFiles,
    stylusFiles,
    pugFiles,
    hasTypescriptFiles
  }
}

/**
 * @param {Dirent[]} regularFiles
 */
export async function copyRegularFiles(regularFiles, destDir) {
  for (const dirEnt of regularFiles) {
    const srcPath = `${dirEnt.path}/${dirEnt.name}`;
    const buildDir = `${dirEnt.path.replace(SRC, destDir)}`
    const buildPath = `${dirEnt.path.replace(SRC, destDir)}/${dirEnt.name}`;
    await fs.mkdir(buildDir, { recursive: true });
    await fs.copyFile(srcPath, buildPath);
  }
}

/**
 * @param {Dirent[]} stylusFiles
 * @param {undefined|{compress: boolean, sourcemap: boolean}}
 * @return {string[]}
 */
export async function buildStylus(stylusFiles, optionsOverride = {}, destDir) {
  const cssToCleanup = [];
  let compress = config.get("stylus.compress");
  let sourcemap = config.get("stylus.sourcemap");
  if ('compress' in optionsOverride) {
    compress = optionsOverride.compress;
  }
  if ('sourcemap' in optionsOverride) {
    sourcemap = optionsOverride.sourcemap;
  }
  for (let stylEnt of stylusFiles) {
    const stylPath = `${stylEnt.path}/${stylEnt.name}`;
    const stylStr = await fs.readFile(stylPath, { encoding: "utf8" });
    const srcDir = stylEnt.path
      .replace(/\/styl$/g, "/style")
      .replace(/\/styl\//g, "/style/");
    const outDir = stylEnt.path
      .replace(SRC, destDir)
      .replace(/\/styl$/g, "/style")
      .replace(/\/styl\//g, "/style/");
    const outFile = stylEnt.name.replace(/\.styl$/, '.css');
    const style = stylus(stylStr)
      .set('filename', stylPath.replace(SRC, '.'))
      .set('inline', config.get("stylus.inline"))
      .set('compress', compress)
      .set('sourcemap', sourcemap);
    let cssStr = style.render();
    await fs.mkdir(outDir, { recursive: true });
    const srcFile = `${srcDir}/${outFile}`;
    await fs.mkdir(srcDir, { recursive: true });
    if (sourcemap) {
      // Ensure URL in compiled CSS points to the correct directory.
      const srcmapUrl = `${config.get("srcDir").replace(/\//g, '\\/')}\\/`;
      cssStr = cssStr
        .replace(new RegExp(srcmapUrl, 'g'), '/')
        .replace(/styl\//g, "/style/");
      await fs.writeFile(`${outDir}/${outFile}.map`, JSON.stringify(style.sourcemap));
    }
    // Pug templates expect includes files to exist in the same directory as the
    // one they're compiled from, so stylus files are written to 2 locations.
    // Files written to the srcDir are cleaned up after compilation.
    await fs.writeFile(`${outDir}/${outFile}`, cssStr);
    await fs.writeFile(srcFile, cssStr);
    cssToCleanup.push(srcFile);
  }
  return cssToCleanup;
}

/** @param {Dirent[]} pugFiles */
export async function buildPug(pugFiles, destDir) {
  for (let pugEnt of pugFiles) {
    const renderPugFile = promisify(pug.renderFile);
    const htmlStr = await renderPugFile(`${pugEnt.path}/${pugEnt.name}`, {
      basedir: SRC,
      pretty: true,
    });
    const buildDir = `${pugEnt.path.replace(SRC, destDir)}`
    const buildPath = `${buildDir}/${pugEnt.name.replace(/\.pug$/, ".html")}`;
    await fs.mkdir(buildDir, { recursive: true });
    await fs.writeFile(buildPath, htmlStr);
  }
}

/** @param {PathLike[]} cssToCleanup */
async function doCssCleanup(cssToCleanup) {
  for (let cssPath of cssToCleanup) {
    fs.unlink(cssPath);
    // If the /style/ folder is now empty, remove it and any empty parents.
    let parentDir = cssPath;
    let files;
    do {
      parentDir = dirname(parentDir);
      files = await fs.readdir(parentDir);
      if (!files.length) {
        fs.rmdir(parentDir);
      }
    } while (parentDir != SRC && !files.length);
  }
}
