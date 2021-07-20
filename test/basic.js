'use strict'

const common = require('../src/common')
const download = require('../src/download')
const fs = require('fs-extra')
const { getHostArch } = require('@electron/get')
const packager = require('..')
const path = require('path')
const sinon = require('sinon')
const test = require('ava')
const util = require('./_util')

// Generates a path to the generated app that reflects the name given in the options.
// Returns the Helper.app location on darwin since the top-level .app is already tested for the
// resources path; on other OSes, returns the executable.
function generateNamePath (opts) {
  if (common.isPlatformMac(opts.platform)) {
    return path.join(`${opts.name}.app`, 'Contents', 'Frameworks', `${opts.name} Helper.app`)
  }

  return opts.name + (opts.platform === 'win32' ? '.exe' : '')
}

test('setting the quiet option does not print messages', t => {
  util.setupConsoleWarnSpy()
  sinon.spy(console, 'error')

  common.warning('warning', true)
  t.true(console.warn.notCalled, 'quieted common.warning should not call console.warn')
  common.info('info', true)
  t.true(console.error.notCalled, 'quieted common.info should not call console.error')
})

test('download argument: download.{arch,platform,version,artifactName} does not overwrite {arch,platform,version,artifactName}', t => {
  const opts = {
    download: {
      arch: 'ia32',
      platform: 'win32',
      version: '0.30.0',
      artifactName: 'ffmpeg'
    },
    electronVersion: '0.36.0'
  }

  const downloadOpts = download.createDownloadOpts(opts, 'linux', 'x64')
  t.deepEqual(downloadOpts, { arch: 'x64', platform: 'linux', version: '0.36.0', artifactName: 'electron' })
})

test('sanitize app name for use in file/directory names', t => {
  t.is(common.sanitizeAppName('@username/package'), '@username-package', 'slash should be replaced')
})

test('sanitize app name for use in the out directory name', t => {
  const opts = {
    arch: 'x64',
    name: '@username/package-name',
    platform: 'linux'
  }
  t.is(common.generateFinalBasename(opts), '@username-package-name-linux-x64', 'generateFinalBasename output should be sanitized')
})

test('cannot build apps where the name ends in " Helper"', async t => {
  const opts = {
    arch: 'x64',
    dir: util.fixtureSubdir('basic'),
    name: 'Bad Helper',
    platform: 'linux'
  }

  await t.throwsAsync(async () => packager(opts), { message: 'Application names cannot end in " Helper" due to limitations on macOS' })
})

test('deprecatedParameter moves value in deprecated param to new param if new param is not set', (t) => {
  const opts = {
    old: 'value'
  }
  common.deprecatedParameter(opts, 'old', 'new', 'new-value')

  t.false(Object.prototype.hasOwnProperty.call(opts, 'old'), 'old property is not set')
  t.true(Object.prototype.hasOwnProperty.call(opts, 'new'), 'new property is set')

  opts.not_overwritten_old = 'another'
  common.deprecatedParameter(opts, 'not_overwritten_old', 'new', 'new-value')

  t.false(Object.prototype.hasOwnProperty.call(opts, 'not_overwritten_old'), 'not_overwritten_old property is not set')
  t.true(Object.prototype.hasOwnProperty.call(opts, 'new'), 'new property is set')
  t.is(opts.new, 'value', 'new property is not overwritten')
})

test.serial('defaults', util.testSinglePlatform(async (t, opts) => {
  opts.name = 'defaultsTest'
  opts.dir = util.fixtureSubdir('basic')
  delete opts.platform
  delete opts.arch

  const defaultOpts = {
    arch: getHostArch(),
    name: opts.name,
    platform: process.platform
  }

  const paths = await packager(opts)
  t.true(Array.isArray(paths), 'packager call should resolve to an array')
  t.is(paths.length, 1, 'Single-target run should resolve to a 1-item array')

  const finalPath = paths[0]
  t.is(finalPath, path.join(t.context.workDir, common.generateFinalBasename(defaultOpts)),
       'Path should follow the expected format and be in the cwd')
  await util.assertDirectory(t, finalPath, 'The expected output directory should exist')
  const resourcesPath = path.join(finalPath, util.generateResourcesPath(defaultOpts))
  const appPath = path.join(finalPath, generateNamePath(defaultOpts))

  if (common.isPlatformMac(defaultOpts.platform)) {
    await util.assertDirectory(t, appPath, 'The Helper.app should reflect opts.name')
  } else {
    await util.assertFile(t, appPath, 'The executable should reflect opts.name')
  }
  await util.assertDirectory(t, resourcesPath, 'The output directory should contain the expected resources subdirectory')
  await util.assertPathNotExists(t, path.join(resourcesPath, 'app', 'node_modules', 'run-waterfall'), 'The output directory should NOT contain devDependencies by default (prune=true)')
  await util.assertFilesEqual(t, path.join(opts.dir, 'main.js'), path.join(resourcesPath, 'app', 'main.js'), 'File under packaged app directory should match source file')
  await util.assertFilesEqual(t, path.join(opts.dir, 'ignore', 'this.txt'), path.join(resourcesPath, 'app', 'ignore', 'this.txt'), 'File under subdirectory of packaged app directory should match source file and not be ignored by default')
  await util.assertPathNotExists(t, path.join(resourcesPath, 'default_app'), 'The output directory should not contain the Electron default_app directory')
  await util.assertPathNotExists(t, path.join(resourcesPath, 'default_app.asar'), 'The output directory should not contain the Electron default_app.asar file')
}))

test.serial('out', util.testSinglePlatform(async (t, opts) => {
  opts.name = 'outTest'
  opts.dir = util.fixtureSubdir('basic')
  opts.out = 'dist'

  const finalPath = (await packager(opts))[0]
  t.is(finalPath, path.join('dist', common.generateFinalBasename(opts)),
       'Path should follow the expected format and be under the folder specified in `out`')
  await util.assertDirectory(t, finalPath, 'The expected output directory should exist')
  await util.assertDirectory(t, path.join(finalPath, util.generateResourcesPath(opts)), 'The output directory should contain the expected resources subdirectory')
}))

test.serial('overwrite', util.testSinglePlatform(async (t, opts) => {
  opts.name = 'overwriteTest'
  opts.dir = util.fixtureSubdir('basic')

  const finalPath = (await packager(opts))[0]
  await util.assertDirectory(t, finalPath, 'The expected output directory should exist')
  // Create a dummy file to detect whether the output directory is replaced in subsequent runs
  const testPath = path.join(finalPath, 'test.txt')
  await fs.writeFile(testPath, 'test')
  await packager(opts) // Run again, defaulting to overwrite false
  await util.assertFile(t, testPath, 'The existing output directory should exist as before (skipped by default)')
  // Run a third time, explicitly setting overwrite to true
  await packager({ ...opts, overwrite: true })
  await util.assertPathNotExists(t, testPath, 'The output directory should be regenerated when overwrite is true')
}))

test.serial('overwrite sans platform/arch set', util.testSinglePlatform(async (t, opts) => {
  delete opts.platfrom
  delete opts.arch
  opts.dir = util.fixtureSubdir('basic')
  opts.overwrite = true

  const roundOnePaths = await packager(opts)
  await util.assertPathExists(t, roundOnePaths[0], 'The output directory exists')
  const roundTwoPaths = await packager(opts)
  await util.assertPathExists(t, roundTwoPaths[0], 'The output directory exists')
}))

test.serial('tmpdir', util.testSinglePlatform(async (t, opts) => {
  opts.name = 'tmpdirTest'
  opts.dir = path.join(__dirname, 'fixtures', 'basic')
  opts.out = 'dist'
  opts.tmpdir = path.join(t.context.workDir, 'tmp')

  await packager(opts)
  await util.assertDirectory(t, path.join(opts.tmpdir, 'electron-packager'), 'The expected temp directory should exist')
}))

test.serial('tmpdir disabled', util.testSinglePlatform(async (t, opts) => {
  opts.name = 'disableTmpdirTest'
  opts.dir = util.fixtureSubdir('basic')
  opts.out = 'dist'
  opts.tmpdir = false

  const finalPath = (await packager(opts))[0]
  await util.assertDirectory(t, finalPath, 'The expected out directory should exist')
}))

test.serial('deref symlink', util.testSinglePlatform(async (t, opts) => {
  opts.name = 'disableSymlinkDerefTest'
  opts.dir = util.fixtureSubdir('basic')
  opts.derefSymlinks = false

  const src = path.join(opts.dir, 'main.js')
  const dest = path.join(opts.dir, 'main-link.js')

  await fs.ensureSymlink(src, dest)
  const finalPath = (await packager(opts))[0]
  const destLink = path.join(finalPath, 'resources', 'app', 'main-link.js')
  await util.assertSymlink(t, destLink, 'The expected file should still be a symlink')
  await fs.remove(dest)
}))

async function createExtraResourceStringTest (t, opts, platform, relative) {
  const extra1Base = 'data1.txt'
  const extra1AbsPath = path.join(__dirname, 'fixtures', extra1Base)
  const extra1RelPath = path.join('..', extra1Base)

  opts.name = 'extraResourceStringTest' + (relative ? '-relative' : '')
  opts.dir = util.fixtureSubdir('basic')
  opts.out = 'dist'
  opts.platform = platform
  opts.extraResource = relative ? extra1RelPath : extra1AbsPath

  const resourcesPath = await util.packageAndEnsureResourcesPath(t, opts)
  await util.assertFilesEqual(t, extra1AbsPath, path.join(resourcesPath, extra1Base), 'resource file data1.txt should match')
}

async function createExtraResourceArrayTest (t, opts, platform, relative) {
  const extra1Base = 'data1.txt'
  const extra1AbsPath = path.join(__dirname, 'fixtures', extra1Base)
  const extra1RelPath = path.join('..', extra1Base)
  const extra2Base = 'extrainfo.plist'
  const extra2AbsPath = path.join(__dirname, 'fixtures', extra2Base)
  const extra2RelPath = path.join('..', extra2Base)

  opts.name = 'extraResourceArrayTest' + (relative ? '-relative' : '')
  opts.dir = util.fixtureSubdir('basic')
  opts.out = 'dist'
  opts.platform = platform
  opts.extraResource = relative ? [extra1RelPath, extra2RelPath] : [extra1AbsPath, extra2AbsPath]

  const resourcesPath = await util.packageAndEnsureResourcesPath(t, opts)
  const extra1DistPath = path.join(resourcesPath, extra1Base)
  const extra2DistPath = path.join(resourcesPath, extra2Base)
  await util.assertPathExists(t, extra1DistPath, 'resource file data1.txt exists')
  await util.assertFilesEqual(t, extra1AbsPath, extra1DistPath, 'resource file data1.txt should match')
  await util.assertPathExists(t, extra2DistPath, 'resource file extrainfo.plist exists')
  await util.assertFilesEqual(t, extra2AbsPath, extra2DistPath, 'resource file extrainfo.plist should match')
}

for (const platform of ['darwin', 'linux']) {
  test.serial(`extraResource: string (${platform})`, util.testSinglePlatform(createExtraResourceStringTest, platform))
  test.serial(`extraResource: array (${platform})`, util.testSinglePlatform(createExtraResourceArrayTest, platform))
  const relativePaths = true
  test.serial(`extraResource (relative): string (${platform})`, util.testSinglePlatform(createExtraResourceStringTest, platform, relativePaths))
  test.serial(`extraResource (relative): array (${platform})`, util.testSinglePlatform(createExtraResourceArrayTest, platform, relativePaths))
}

test.serial('building for Linux target sanitizes binary name', util.testSinglePlatform(async (t, opts) => {
  opts.name = '@username/package-name'
  opts.dir = util.fixtureSubdir('basic')

  const paths = await packager(opts)
  t.is(paths.length, 1, '1 bundle created')
  await util.assertFile(t, path.join(paths[0], '@username-package-name'), 'The sanitized binary filename should exist')
}))

test.serial('executableName honored when building for Linux target', util.testSinglePlatform(async (t, opts) => {
  opts.name = 'PackageName'
  opts.executableName = 'my-package'
  opts.dir = util.fixtureSubdir('basic')

  const paths = await packager(opts)
  t.is(paths.length, 1, '1 bundle created')
  await util.assertFile(t, path.join(paths[0], 'my-package'), 'The executableName-based filename should exist')
}))

test('fails with invalid version', util.invalidOptionTest({
  name: 'invalidElectronTest',
  electronVersion: '0.0.1',
  arch: 'x64',
  platform: 'linux',
  download: {
    quiet: !!process.env.CI
  }
}))

test.serial('dir: relative path', util.testSinglePlatform(async (t, opts) => {
  opts.name = 'ElectronTest'
  opts.dir = path.join('..', 'fixtures', 'basic')

  const finalPath = (await packager(opts))[0]
  t.is(path.join(t.context.workDir, 'ElectronTest-linux-x64'), finalPath, 'paths returned')
}))

test.serial('electronZipDir success', util.testSinglePlatform(async (t, opts) => {
  const customDir = path.join(t.context.tempDir, 'download')
  opts.dir = util.fixtureSubdir('basic')
  opts.electronZipDir = customDir
  await fs.ensureDir(customDir)
  const zipPath = await download.downloadElectronZip(download.createDownloadOpts(opts, 'linux', 'x64'))
  await fs.copy(zipPath, path.join(customDir, path.basename(zipPath)))

  const paths = await packager(opts)
  t.is(paths.length, 1, '1 bundle created')
}))

test.serial('electronZipDir does not exist', util.testSinglePlatform(async (t, opts) => {
  const customDir = path.join(t.context.tempDir, 'does-not-exist')
  opts.dir = util.fixtureSubdir('basic')
  opts.electronZipDir = customDir

  await t.throwsAsync(async () => packager(opts), { message: /Electron ZIP directory does not exist/ })
}))

test.serial('electronZipDir: ZIP file does not exist', util.testSinglePlatform(async (t, opts) => {
  const customDir = path.join(t.context.tempDir, 'download')
  opts.dir = util.fixtureSubdir('basic')
  opts.electronZipDir = customDir
  await fs.ensureDir(customDir)

  await t.throwsAsync(async () => packager(opts), { message: /Electron ZIP file does not exist/ })
}))

test('validateElectronApp succeeds on a well-formed Electron app containing a main field', async t => {
  await t.notThrowsAsync(async () => await common.validateElectronApp('original-dir', util.fixtureSubdir('validate-success-with-main')))
})

test('validateElectronApp succeeds on a well-formed Electron app without a main field', async t => {
  await t.notThrowsAsync(async () => await common.validateElectronApp('original-dir', util.fixtureSubdir('validate-success-without-main')))
})

test('validateElectronApp fails on an Electron app without package.json', async t => {
  await t.throwsAsync(async () => await common.validateElectronApp('original-dir', util.fixtureSubdir('validate-failure-without-package-json')), {
    message: `Application manifest was not found. Make sure "${path.join('original-dir', 'package.json')}" exists and does not get ignored by your ignore option`
  })
})

test('validateElectronApp fails on an Electron app with a package.json with a main field missing main entry point', async t => {
  await t.throwsAsync(async () => await common.validateElectronApp('original-dir', util.fixtureSubdir('validate-failure-without-main-or-index')), {
    message: `The main entry point to your app was not found. Make sure "${path.join('original-dir', 'index.js')}" exists and does not get ignored by your ignore option`
  })
})

test('validateElectronApp fails on an Electron app with a package.json without a main field missing main entry point', async t => {
  await t.throwsAsync(async () => await common.validateElectronApp('original-dir', util.fixtureSubdir('validate-failure-with-main-without-entry-point')), {
    message: `The main entry point to your app was not found. Make sure "${path.join('original-dir', 'main.js')}" exists and does not get ignored by your ignore option`
  })
})
