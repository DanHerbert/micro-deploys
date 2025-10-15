# Microsite Deploys

Collection of deployment/development scripts for microsites I manage.

Assumes projects follow a few rules:

* The micro-deploys repo exists as a git submodule within the project.
* Pug is used for HTML templating, Stylus is used as a CSS preprocessor, and Typescript is used as a JS preprocessor. Git is also assumed for source control.
* Pug, Stylus, and Typescript files all use their standard extensions (`.pug`, `.styl`, & `.ts`)
* tsconfig's `outDir` is a `/js/` folder at the root of the build output directory.
* Include files (files referenced by stylus/pug files but not intended to be built into the output directory) begin with an underscore.
* The following packages must be installed:

  * `imagemagick` (available in most package managers)
  * `svgo` ([Available through npm](https://www.npmjs.com/package/svgo), must be installed as a global package)
  * `rsvg-convert` (Available as "`librsvg`" in [Homebrew](https://formulae.brew.sh/formula/librsvg)/[Arch Linux](https://archlinux.org/packages/extra/x86_64/librsvg/), [`librsvg2-bin`](https://packages.debian.org/stable/librsvg2-bin) in Debian, and [`librsvg2-tools`](https://packages.fedoraproject.org/pkgs/librsvg2/librsvg2-tools/) in RedHat)

## Usage

1. Clone this repo as a submodule within the micro site that needs it.
1. Ensure your site follows the assumptions listed above.
1. Create a `config` directory in your project root and add a default.json which matches the format of the one in this repo.
1. Finally, add the following block to your package.json:

```json
"scripts": {
  "build": "micro-deploys/tools/build.js",
  "watch": "micro-deploys/tools/watch.js",
  "deploy": "micro-deploys/tools/deploy.js"
}
```
Once you've done the above, you can run the tasks using `build`, `watch`, `deploy` as `npm` scripts.
