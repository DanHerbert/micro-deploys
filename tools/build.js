#!/usr/bin/node

import {appRootPath, toAbsolute} from "./common.js";
import config from "config";
import pug from "pug";
import stylus from "stylus";
import { exec, execSync } from "node:child_process";
import { promisify } from "node:util";
import { Dirent, promises as fs } from "node:fs";
import { dirname } from "node:path";
import PathLike from "node:fs";
import { pathToFileURL } from 'url';

const execPromise = promisify(exec);

const SRC = toAbsolute(config.get("srcDir"));
const BUILD = toAbsolute(config.get("buildDir"));

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
    if (files.favicon) {
      await generateFavicons(files.favicon, destDir);
    }
    cssToCleanup = await buildStylus(files.stylusFiles, {}, destDir);
    if (files.hasTypescriptFiles) {
      let tscOpts = '';
      if (destDir !== BUILD) {
        tscOpts = `--outDir "${destDir}/js/"`;
      }
      try {
        execSync(`npx tsc ${tscOpts}`, { cwd: `${appRootPath}`});
      } catch (err) {
        console.error('tsc command failed:\n');
        for (let outSource of err.output) {
          console.log(outSource.toString());
        }
        process.exit(1);
      }
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
  let favicon;
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
      } else if (dirEnt.name === 'favicon.svg') {
        favicon = dirEnt;
      } else {
        regularFiles.push(dirEnt);
      }
    }
  }
  return {
    favicon,
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
    const srcPath = `${dirEnt.parentPath}/${dirEnt.name}`;
    const buildDir = `${dirEnt.parentPath.replace(SRC, destDir)}`
    const buildPath = `${dirEnt.parentPath.replace(SRC, destDir)}/${dirEnt.name}`;
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
    const stylPath = `${stylEnt.parentPath}/${stylEnt.name}`;
    const stylStr = await fs.readFile(stylPath, { encoding: "utf8" });
    const srcDir = stylEnt.parentPath
      .replace(/\/styl$/g, "/style")
      .replace(/\/styl\//g, "/style/");
    const outDir = stylEnt.parentPath
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
    const htmlStr = await renderPugFile(`${pugEnt.parentPath}/${pugEnt.name}`, {
      basedir: SRC,
      pretty: true,
    });
    const buildDir = `${pugEnt.parentPath.replace(SRC, destDir)}`
    const buildPath = `${buildDir}/${pugEnt.name.replace(/\.pug$/, ".html")}`;
    await fs.mkdir(buildDir, { recursive: true });
    await fs.writeFile(buildPath, htmlStr);
  }
}

/** @param {Dirent} favicon */
async function generateFavicons(favicon, destDir) {
  const inFile = `${favicon.parentPath}/${favicon.name}`;
  const outDir = `${favicon.parentPath.replace(SRC, destDir)}`;
  const outFile = `${outDir}/${favicon.name}`;
  await fs.mkdir(outDir, { recursive: true });
  optimizeSvg(inFile, outFile);
  // Sizes based on Apple's recommendations:
  // https://developer.apple.com/design/human-interface-guidelines/app-icons
  for (let size of [1024,512,256,192,180,167,152,128,120,114,87,80,64,32,16]) {
    await svgConvert(inFile, outDir, size);
    optimizePng(outDir, size);
  }
  await createIco(outDir, destDir);
}

function optimizeSvg(inFile, outFile) {
  try {
    execSync(`svgo --output ${outFile} --input ${inFile}`, { cwd: `${appRootPath}`});
  } catch (err) {
    console.error('svgo command failed:\n');
    console.log('inFile: ', inFile);
    console.log('outfile: ', outFile);
    process.exit(1);
  }
}

async function svgConvert(infile, outDir, size) {
  try {
    const pngBuffer = execSync(`rsvg-convert -h "${size}" -w "${size}" "${infile}"`, { cwd: `${appRootPath}`});
    const pngPath = `${outDir}/favicon-${size}.png`;
    await fs.writeFile(pngPath, pngBuffer);
  } catch (err) {
    console.error('rsvg-convert failed: \n');
    console.error(err);
    console.log('size: ', size);
    console.log('infile: ', infile);
    process.exit(1);
  }
}

function optimizePng(outDir, size) {
  const pngPath = `${outDir}/favicon-${size}.png`;
  try {
    execSync(`optipng "${pngPath}"`, { cwd: `${appRootPath}`, stdio: []});
  } catch (err) {
    console.error('optipng failed: \n');
    console.log('pngPath: ', pngPath);
    process.exit(1);
  }
}

async function createIco(outDir, destDir) {
  await execPromise(`magick -background transparent "${outDir}/favicon-1024.png" -compress none -define icon:auto-resize=16,32,48,64,256 "${outDir}/favicon.ico"`, { cwd: `${appRootPath}`});
  await fs.copyFile(`${outDir}/favicon.ico`, `${destDir}/favicon.ico`);
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
