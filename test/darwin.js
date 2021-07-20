'use strict'

const config = require('./config.json')
const childProcess = require('child_process')
const crypto = require('crypto')
const fs = require('fs-extra')
const mac = require('../src/mac')
const packager = require('..')
const path = require('path')
const plist = require('plist')
const { promisify } = require('util')
const test = require('ava')
const util = require('./_util')

const exec = promisify(childProcess.exec)

const darwinOpts = {
  name: 'darwinTest',
  dir: util.fixtureSubdir('basic'),
  electronVersion: config.version,
  arch: 'x64',
  platform: 'darwin'
}

function testWrapper (extraOpts, testFunction, ...extraArgs) {
  return util.packagerTest((t, baseOpts) => testFunction(t, { ...baseOpts, ...extraOpts }, ...extraArgs))
}

function darwinTest (testFunction, ...extraArgs) {
  return testWrapper(darwinOpts, testFunction, ...extraArgs)
}

function getHelperAppPath (prefix, appName, helperSuffix) {
  const frameworksPath = path.join(prefix, `${appName}.app`, 'Contents', 'Frameworks')
  return path.join(frameworksPath, `${appName} ${helperSuffix}.app`)
}

function getHelperExecutablePath (prefix, appName, helperSuffix) {
  return path.join(getHelperAppPath(prefix, appName, helperSuffix), 'Contents', 'MacOS', `${appName} ${helperSuffix}`)
}

async function parseInfoPlist (t, opts, basePath) {
  return util.parsePlist(t, path.join(basePath, `${opts.name}.app`))
}

async function parseHelperInfoPlist (t, opts, basePath) {
  return util.parsePlist(t, path.join(basePath, `${opts.name}.app`, 'Contents', 'Frameworks', `${opts.name} Helper.app`))
}

async function packageAndParseInfoPlist (t, opts) {
  const finalPath = (await packager(opts))[0]
  return parseInfoPlist(t, opts, finalPath)
}

async function packageAndParseHelperInfoPlist (t, opts) {
  const finalPath = (await packager(opts))[0]
  return parseHelperInfoPlist(t, opts, finalPath)
}

function assertPlistStringValue (t, obj, property, value, message) {
  t.is(obj[property], value, message)
  t.is(typeof obj[property], 'string', `${property} should be a string`)
}

function assertCFBundleIdentifierValue (t, obj, value, message) {
  assertPlistStringValue(t, obj, 'CFBundleIdentifier', value, message)
  t.is(/^[a-zA-Z0-9-.]*$/.test(obj.CFBundleIdentifier), true, 'CFBundleIdentifier should allow only alphanumeric (A-Z,a-z,0-9), hyphen (-), and period (.)')
}

async function assertHelper (t, prefix, appName, helperSuffix) {
  await util.assertDirectory(t, getHelperAppPath(prefix, appName, helperSuffix), `The ${helperSuffix}.app should reflect sanitized opts.name`)
  await util.assertFile(t, getHelperExecutablePath(prefix, appName, helperSuffix), `The ${helperSuffix}.app executable should reflect sanitized opts.name`)
}

async function helperAppPathsTest (t, baseOpts, extraOpts, expectedName) {
  const opts = { ...baseOpts, ...extraOpts }

  if (!expectedName) {
    expectedName = opts.name
  }

  const finalPath = (await packager(opts))[0]
  const helpers = [
    'Helper',
    'Helper EH',
    'Helper NP'
  ]
  await Promise.all(helpers.map(helper => assertHelper(t, finalPath, expectedName, helper)))
}

async function iconTest (t, opts, icon, iconPath) {
  opts.icon = icon

  const resourcesPath = await util.packageAndEnsureResourcesPath(t, opts)
  const outputPath = resourcesPath.replace(`${path.sep}${util.generateResourcesPath(opts)}`, '')
  const plistObj = await parseInfoPlist(t, opts, outputPath)
  await util.assertFilesEqual(t, iconPath, path.join(resourcesPath, plistObj.CFBundleIconFile), 'installed icon file should be identical to the specified icon file')
}

async function extendInfoTest (t, baseOpts, extraPathOrParams) {
  const opts = {
    ...baseOpts,
    appBundleId: 'com.electron.extratest',
    appCategoryType: 'public.app-category.music',
    buildVersion: '3.2.1',
    extendInfo: extraPathOrParams
  }

  const obj = await packageAndParseInfoPlist(t, opts)
  assertPlistStringValue(t, obj, 'TestKeyString', 'String data', 'TestKeyString should come from extendInfo')
  t.is(obj.TestKeyInt, 12345, 'TestKeyInt should come from extendInfo')
  t.is(obj.TestKeyBool, true, 'TestKeyBool should come from extendInfo')
  t.deepEqual(obj.TestKeyArray, ['public.content', 'public.data'], 'TestKeyArray should come from extendInfo')
  t.deepEqual(obj.TestKeyDict, { Number: 98765, CFBundleVersion: '0.0.0' }, 'TestKeyDict should come from extendInfo')
  assertPlistStringValue(t, obj, 'CFBundleVersion', opts.buildVersion, 'CFBundleVersion should reflect buildVersion argument')
  assertCFBundleIdentifierValue(t, obj, 'com.electron.extratest', 'CFBundleIdentifier should reflect appBundleId argument')
  assertPlistStringValue(t, obj, 'LSApplicationCategoryType', 'public.app-category.music', 'LSApplicationCategoryType should reflect appCategoryType argument')
  assertPlistStringValue(t, obj, 'CFBundlePackageType', 'APPL', 'CFBundlePackageType should be Electron default')
}

async function extendHelperInfoTest (t, baseOpts, extraPathOrParams) {
  const opts = {
    ...baseOpts,
    appBundleId: 'com.electron.extratest',
    buildVersion: '3.2.1',
    extendHelperInfo: extraPathOrParams,
    electronVersion: '6.0.0'
  }

  const obj = await packageAndParseHelperInfoPlist(t, opts)
  assertPlistStringValue(t, obj, 'TestKeyString', 'String data', 'TestKeyString should come from extendHelperInfo')
  t.is(obj.TestKeyInt, 12345, 'TestKeyInt should come from extendHelperInfo')
  t.is(obj.TestKeyBool, true, 'TestKeyBool should come from extendHelperInfo')
  t.deepEqual(obj.TestKeyArray, ['public.content', 'public.data'], 'TestKeyArray should come from extendHelperInfo')
  t.deepEqual(obj.TestKeyDict, { Number: 98765, CFBundleVersion: '0.0.0' }, 'TestKeyDict should come from extendHelperInfo')
  assertPlistStringValue(t, obj, 'CFBundleVersion', opts.buildVersion, 'CFBundleVersion should reflect buildVersion argument')
  assertCFBundleIdentifierValue(t, obj, 'com.electron.extratest.helper', 'CFBundleIdentifier should reflect appBundleId argument')
  assertPlistStringValue(t, obj, 'CFBundlePackageType', 'APPL', 'CFBundlePackageType should be Electron default')
}

async function binaryNameTest (t, baseOpts, extraOpts, expectedExecutableName, expectedAppName) {
  const opts = { ...baseOpts, ...extraOpts }
  const appName = expectedAppName || expectedExecutableName || opts.name
  const executableName = expectedExecutableName || opts.name

  const finalPath = (await packager(opts))[0]
  await util.assertFile(t, path.join(finalPath, `${appName}.app`, 'Contents', 'MacOS', executableName), 'The binary should reflect a sanitized opts.name')
}

async function appVersionTest (t, opts, appVersion, buildVersion) {
  opts.appVersion = appVersion
  opts.buildVersion = buildVersion || appVersion

  const obj = await packageAndParseInfoPlist(t, opts)
  assertPlistStringValue(t, obj, 'CFBundleVersion', '' + opts.buildVersion, 'CFBundleVersion should reflect buildVersion')
  return assertPlistStringValue(t, obj, 'CFBundleShortVersionString', '' + opts.appVersion, 'CFBundleShortVersionString should reflect appVersion')
}

async function appBundleTest (t, opts, appBundleId) {
  if (appBundleId) {
    opts.appBundleId = appBundleId
  }

  const defaultBundleName = `com.electron.${opts.name.toLowerCase()}`
  const appBundleIdentifier = mac.filterCFBundleIdentifier(opts.appBundleId || defaultBundleName)
  const obj = await packageAndParseInfoPlist(t, opts)
  assertPlistStringValue(t, obj, 'CFBundleDisplayName', opts.name, 'CFBundleDisplayName should reflect opts.name')
  assertPlistStringValue(t, obj, 'CFBundleName', opts.name, 'CFBundleName should reflect opts.name')
  assertCFBundleIdentifierValue(t, obj, appBundleIdentifier, 'CFBundleName should reflect opts.appBundleId or fallback to default')
}

async function appHelpersBundleTest (t, opts, helperBundleId, appBundleId) {
  if (helperBundleId) {
    opts.helperBundleId = helperBundleId
  }
  if (appBundleId) {
    opts.appBundleId = appBundleId
  }
  const defaultBundleName = `com.electron.${opts.name.toLowerCase()}`
  const appBundleIdentifier = mac.filterCFBundleIdentifier(opts.appBundleId || defaultBundleName)
  const helperBundleIdentifier = mac.filterCFBundleIdentifier(opts.helperBundleId || appBundleIdentifier + '.helper')

  const finalPath = (await packager(opts))[0]
  const frameworksPath = path.join(finalPath, `${opts.name}.app`, 'Contents', 'Frameworks')
  const helperObj = await util.parsePlist(t, path.join(frameworksPath, `${opts.name} Helper.app`))
  assertPlistStringValue(t, helperObj, 'CFBundleName', opts.name, 'CFBundleName should reflect opts.name in helper app')
  assertCFBundleIdentifierValue(t, helperObj, helperBundleIdentifier, 'CFBundleIdentifier should reflect opts.helperBundleId, opts.appBundleId or fallback to default in helper app')

  const helperEHObj = await util.parsePlist(t, path.join(frameworksPath, `${opts.name} Helper EH.app`))
  assertPlistStringValue(t, helperEHObj, 'CFBundleName', opts.name + ' Helper EH', 'CFBundleName should reflect opts.name in helper EH app')
  assertPlistStringValue(t, helperEHObj, 'CFBundleDisplayName', opts.name + ' Helper EH', 'CFBundleDisplayName should reflect opts.name in helper EH app')
  assertPlistStringValue(t, helperEHObj, 'CFBundleExecutable', opts.name + ' Helper EH', 'CFBundleExecutable should reflect opts.name in helper EH app')
  assertCFBundleIdentifierValue(t, helperEHObj, `${helperBundleIdentifier}.EH`, 'CFBundleName should reflect opts.helperBundleId, opts.appBundleId or fallback to default in helper EH app')

  const helperNPObj = await util.parsePlist(t, path.join(frameworksPath, `${opts.name} Helper NP.app`))
  assertPlistStringValue(t, helperNPObj, 'CFBundleName', opts.name + ' Helper NP', 'CFBundleName should reflect opts.name in helper NP app')
  assertPlistStringValue(t, helperNPObj, 'CFBundleDisplayName', opts.name + ' Helper NP', 'CFBundleDisplayName should reflect opts.name in helper NP app')
  assertPlistStringValue(t, helperNPObj, 'CFBundleExecutable', opts.name + ' Helper NP', 'CFBundleExecutable should reflect opts.name in helper NP app')
  return assertCFBundleIdentifierValue(t, helperNPObj, helperBundleIdentifier + '.NP', 'CFBundleName should reflect opts.helperBundleId, opts.appBundleId or fallback to default in helper NP app')
}

async function appHelpersBundleElectron6Test (t, opts) {
  opts.electronVersion = '6.0.0'
  const defaultBundleName = `com.electron.${opts.name.toLowerCase()}`
  const appBundleIdentifier = mac.filterCFBundleIdentifier(opts.appBundleId || defaultBundleName)
  const helperBundleIdentifier = mac.filterCFBundleIdentifier(opts.helperBundleId || appBundleIdentifier + '.helper')

  const finalPath = (await packager(opts))[0]
  const frameworksPath = path.join(finalPath, `${opts.name}.app`, 'Contents', 'Frameworks')
  const helperObj = await util.parsePlist(t, path.join(frameworksPath, `${opts.name} Helper.app`))
  assertPlistStringValue(t, helperObj, 'CFBundleName', opts.name, 'CFBundleName should reflect opts.name in helper app')
  assertCFBundleIdentifierValue(t, helperObj, helperBundleIdentifier, 'CFBundleIdentifier should reflect opts.helperBundleId, opts.appBundleId or fallback to default in helper app')

  const helperPluginObj = await util.parsePlist(t, path.join(frameworksPath, `${opts.name} Helper (Plugin).app`))
  assertPlistStringValue(t, helperPluginObj, 'CFBundleName', `${opts.name} Helper (Plugin)`, 'CFBundleName should reflect opts.name in helper app')
  assertPlistStringValue(t, helperPluginObj, 'CFBundleExecutable', `${opts.name} Helper (Plugin)`, 'CFBundleExecutable should reflect opts.name in helper app')
  assertCFBundleIdentifierValue(t, helperPluginObj, helperBundleIdentifier, 'CFBundleIdentifier should reflect opts.helperBundleId, opts.appBundleId or fallback to default in helper app')

  const helperRendererObj = await util.parsePlist(t, path.join(frameworksPath, `${opts.name} Helper (Renderer).app`))
  assertPlistStringValue(t, helperRendererObj, 'CFBundleName', `${opts.name} Helper (Renderer)`, 'CFBundleName should reflect opts.name in helper app')
  assertPlistStringValue(t, helperRendererObj, 'CFBundleExecutable', `${opts.name} Helper (Renderer)`, 'CFBundleExecutable should reflect opts.name in helper app')
  assertCFBundleIdentifierValue(t, helperRendererObj, helperBundleIdentifier, 'CFBundleIdentifier should reflect opts.helperBundleId, opts.appBundleId or fallback to default in helper app')

  const helperGPUObj = await util.parsePlist(t, path.join(frameworksPath, `${opts.name} Helper (GPU).app`))
  assertPlistStringValue(t, helperGPUObj, 'CFBundleName', `${opts.name} Helper (GPU)`, 'CFBundleName should reflect opts.name in helper app')
  assertPlistStringValue(t, helperGPUObj, 'CFBundleExecutable', `${opts.name} Helper (GPU)`, 'CFBundleExecutable should reflect opts.name in helper app')
  assertCFBundleIdentifierValue(t, helperGPUObj, helperBundleIdentifier, 'CFBundleIdentifier should reflect opts.helperBundleId, opts.appBundleId or fallback to default in helper app')
}

if (!(process.env.CI && process.platform === 'win32')) {
  test.serial('helper app paths', darwinTest(helperAppPathsTest))
  test.serial('helper app paths with app name needing sanitization', darwinTest(helperAppPathsTest, { name: '@username/package-name' }, '@username-package-name'))

  const iconBase = path.join(__dirname, 'fixtures', 'monochrome')
  const icnsPath = `${iconBase}.icns`

  test.serial('macOS icon: .icns specified', darwinTest(iconTest, icnsPath, icnsPath))
  test.serial('macOS icon: .ico specified (should replace with .icns)', darwinTest(iconTest, `${iconBase}.ico`, icnsPath))
  test.serial('macOS icon: basename only (should add .icns)', darwinTest(iconTest, iconBase, icnsPath))
  test.serial('macOS icon: invalid icon path should skip copy', darwinTest(async (t, opts) => {
    let expectedChecksum
    opts.icon = path.join(__dirname, 'fixtures', 'nonexistent')
    opts.afterExtract = [
      async (extractPath, _electronVersion, _platform, _arch, callback) => {
        const hash = crypto.createHash('sha256')
        hash.update(await fs.readFile(path.join(extractPath, 'Electron.app', 'Contents', 'Resources', 'electron.icns')))
        expectedChecksum = hash.digest('hex')
        callback()
      }
    ]

    const finalPath = (await packager(opts))[0]
    const hash = crypto.createHash('sha256')
    hash.update(await fs.readFile(path.join(finalPath, `${opts.name}.app`, 'Contents', 'Resources', 'electron.icns')))
    return t.is(hash.digest('hex'), expectedChecksum, 'Icon should not have been overwritten')
  }))

  const extraInfoPath = path.join(__dirname, 'fixtures', 'extrainfo.plist')
  const extraInfoParams = plist.parse(fs.readFileSync(extraInfoPath).toString())

  test.serial('extendInfo: filename', darwinTest(extendInfoTest, extraInfoPath))
  test.serial('extendInfo: params', darwinTest(extendInfoTest, extraInfoParams))

  const extraHelperInfoPath = path.join(__dirname, 'fixtures', 'extrainfo.plist')
  const extraHelperInfoParams = plist.parse(fs.readFileSync(extraHelperInfoPath).toString())

  test.serial('extendHelperInfo: filename', darwinTest(extendHelperInfoTest, extraHelperInfoPath))
  test.serial('extendHelperInfo: params', darwinTest(extendHelperInfoTest, extraHelperInfoParams))

  test.serial('darwinDarkModeSupport: should enable dark mode in macOS Mojave', darwinTest(async (t, opts) => {
    opts.darwinDarkModeSupport = true

    const obj = await packageAndParseInfoPlist(t, opts)
    t.false(obj.NSRequiresAquaSystemAppearance, 'NSRequiresAquaSystemAppearance should be set to false')
  }))

  test.serial('protocol/protocol-name', darwinTest(async (t, opts) => {
    opts.protocols = [
      {
        name: 'Foo',
        schemes: ['foo']
      },
      {
        name: 'Bar',
        schemes: ['bar', 'baz']
      }
    ]

    const expected = [{
      CFBundleURLName: 'Foo',
      CFBundleURLSchemes: ['foo']
    }, {
      CFBundleURLName: 'Bar',
      CFBundleURLSchemes: ['bar', 'baz']
    }]

    const obj = await packageAndParseInfoPlist(t, opts)
    t.deepEqual(obj.CFBundleURLTypes, expected, 'CFBundleURLTypes did not contain specified protocol schemes and names')
  }))

  test('osxNotarize: missing appleIdPassword', t => {
    util.setupConsoleWarnSpy()
    const notarizeOpts = mac.createNotarizeOpts({ appleId: '' })
    t.falsy(notarizeOpts, 'does not generate options')
    util.assertWarning(t, 'WARNING: Failed validation, notarization will not run: The appleId property is required when using notarization with appleIdPassword')
  })

  test('osxNotarize: appBundleId not overwritten', t => {
    const args = { appleId: '1', appleIdPassword: '2', appBundleId: 'no' }
    const notarizeOpts = mac.createNotarizeOpts(args, 'yes', 'appPath', true)
    t.is(notarizeOpts.appBundleId, 'yes', 'appBundleId is taken from arguments')
  })

  test('osxNotarize: appPath not overwritten', t => {
    const args = { appleId: '1', appleIdPassword: '2', appPath: 'no' }
    const notarizeOpts = mac.createNotarizeOpts(args, 'appBundleId', 'yes', true)
    t.is(notarizeOpts.appPath, 'yes', 'appPath is taken from arguments')
  })

  test('osxSign: default args', t => {
    const args = true
    const signOpts = mac.createSignOpts(args, 'darwin', 'out', 'version')
    t.deepEqual(signOpts, { identity: null, app: 'out', platform: 'darwin', version: 'version' })
  })

  test('osxSign: identity=true sets autodiscovery mode', t => {
    const args = { identity: true }
    const signOpts = mac.createSignOpts(args, 'darwin', 'out', 'version')
    t.deepEqual(signOpts, { identity: null, app: 'out', platform: 'darwin', version: 'version' })
  })

  test('osxSign: entitlements passed to electron-osx-sign', t => {
    const args = { entitlements: 'path-to-entitlements' }
    const signOpts = mac.createSignOpts(args, 'darwin', 'out', 'version')
    t.deepEqual(signOpts, { app: 'out', platform: 'darwin', version: 'version', entitlements: args.entitlements })
  })

  test('osxSign: app not overwritten', t => {
    const args = { app: 'some-other-path' }
    const signOpts = mac.createSignOpts(args, 'darwin', 'out', 'version')
    t.deepEqual(signOpts, { app: 'out', platform: 'darwin', version: 'version' })
  })

  test('osxSign: platform not overwritten', t => {
    const args = { platform: 'mas' }
    const signOpts = mac.createSignOpts(args, 'darwin', 'out', 'version')
    t.deepEqual(signOpts, { app: 'out', platform: 'darwin', version: 'version' })
  })

  test('osxSign: binaries not set', t => {
    const args = { binaries: ['binary1', 'binary2'] }
    const signOpts = mac.createSignOpts(args, 'darwin', 'out', 'version')
    t.deepEqual(signOpts, { app: 'out', platform: 'darwin', version: 'version' })
  })

  test('force osxSign.hardenedRuntime when osxNotarize is set', t => {
    const signOpts = mac.createSignOpts({}, 'darwin', 'out', 'version', true)
    t.true(signOpts.hardenedRuntime, 'hardenedRuntime forced to true')
  })

  if (process.platform === 'darwin') {
    test.serial('end-to-end codesign', darwinTest(async (t, opts) => {
      opts.osxSign = { identity: 'codesign.electronjs.org' }

      const finalPath = (await packager(opts))[0]
      const appPath = path.join(finalPath, opts.name + '.app')
      await util.assertDirectory(t, appPath, 'The expected .app directory should exist')
      await exec(`codesign --verify --verbose ${appPath}`)
      t.pass('codesign should verify successfully')
    }))
  }

  test.serial('macOS: binary naming', darwinTest(binaryNameTest))
  test.serial('macOS: sanitized binary naming', darwinTest(binaryNameTest, { name: '@username/package-name' }, '@username-package-name'))
  test.serial('executableName', darwinTest(binaryNameTest, { executableName: 'app-name', name: 'MyAppName' }, 'app-name', 'MyAppName'))

  test.serial('CFBundleName is the sanitized app name and CFBundleDisplayName is the non-sanitized app name', darwinTest(async (t, opts) => {
    const appBundleIdentifier = 'com.electron.username-package-name'
    const expectedSanitizedName = '@username-package-name'

    opts.name = '@username/package-name'

    const finalPath = (await packager(opts))[0]
    const obj = await util.parsePlist(t, path.join(finalPath, `${expectedSanitizedName}.app`))
    assertPlistStringValue(t, obj, 'CFBundleDisplayName', opts.name, 'CFBundleDisplayName should reflect opts.name')
    assertPlistStringValue(t, obj, 'CFBundleName', expectedSanitizedName, 'CFBundleName should reflect a sanitized opts.name')
    assertCFBundleIdentifierValue(t, obj, appBundleIdentifier, 'CFBundleIdentifier should reflect the sanitized opts.name')
  }))

  test.serial('app version', darwinTest(appVersionTest, '1.1.0'))
  test.serial('app and build versions are strings', darwinTest(appVersionTest, '1.1.0', '1.1.0.1234'))
  test.serial('app and build version are integers', darwinTest(appVersionTest, 12, 1234))
  test.serial('infer app version from package.json', darwinTest(async (t, opts) => {
    const obj = await packageAndParseInfoPlist(t, opts)
    assertPlistStringValue(t, obj, 'CFBundleVersion', '4.99.101', 'CFBundleVersion should reflect package.json version')
    assertPlistStringValue(t, obj, 'CFBundleShortVersionString', '4.99.101', 'CFBundleShortVersionString should reflect package.json version')
  }))

  test.serial('app categoryType', darwinTest(async (t, opts) => {
    const appCategoryType = 'public.app-category.developer-tools'
    opts.appCategoryType = appCategoryType

    const obj = await packageAndParseInfoPlist(t, opts)
    assertPlistStringValue(t, obj, 'LSApplicationCategoryType', appCategoryType, 'LSApplicationCategoryType should reflect opts.appCategoryType')
  }))

  test.serial('app bundle', darwinTest(appBundleTest, 'com.electron.basetest'))
  test.serial('app bundle (w/ special characters)', darwinTest(appBundleTest, 'com.electron."bãśè tëßt!@#$%^&*()?\''))
  test.serial('app bundle app-bundle-id fallback', darwinTest(appBundleTest))

  test.serial('app bundle framework symlink', darwinTest(async (t, opts) => {
    const finalPath = (await packager(opts))[0]
    const frameworkPath = path.join(finalPath, `${opts.name}.app`, 'Contents', 'Frameworks', 'Electron Framework.framework')
    await util.assertDirectory(t, frameworkPath, 'Expected Electron Framework.framework to be a directory')
    await Promise.all([
      util.assertSymlink(t, path.join(frameworkPath, 'Electron Framework'), 'Expected Electron Framework.framework/Electron Framework to be a symlink'),
      util.assertSymlink(t, path.join(frameworkPath, 'Versions', 'Current'), 'Expected Electron Framework.framework/Versions/Current to be a symlink')
    ])
  }))

  test.serial('app helpers bundle', darwinTest(appHelpersBundleTest, 'com.electron.basetest.helper'))
  test.serial('app helpers bundle (w/ special characters)', darwinTest(appHelpersBundleTest, 'com.electron."bãśè tëßt!@#$%^&*()?\'.hęłpėr'))
  test.serial('app helpers bundle helper-bundle-id fallback to app-bundle-id', darwinTest(appHelpersBundleTest, null, 'com.electron.basetest'))
  test.serial('app helpers bundle helper-bundle-id fallback to app-bundle-id (w/ special characters)', darwinTest(appHelpersBundleTest, null, 'com.electron."bãśè tëßt!!@#$%^&*()?\''))
  test.serial('app helpers bundle helper-bundle-id & app-bundle-id fallback', darwinTest(appHelpersBundleTest))

  test.serial('app helpers bundle with renderer/plugin helpers', darwinTest(appHelpersBundleElectron6Test))

  test.serial('EH/NP helpers do not exist', darwinTest(async (t, baseOpts) => {
    const helpers = [
      'Helper EH',
      'Helper NP'
    ]
    const opts = {
      ...baseOpts,
      afterExtract: [(buildPath, electronVersion, platform, arch, cb) => {
        return Promise.all(helpers.map(async helper => {
          await fs.remove(getHelperAppPath(buildPath, 'Electron', helper))
          cb()
        }))
      }]
    }

    const finalPath = (await packager(opts))[0]
    await Promise.all(helpers.map(helper => util.assertPathNotExists(t, getHelperAppPath(finalPath, opts.name, helper), `${helper} should not exist`)))
  }))

  test.serial('appCopyright maps to NSHumanReadableCopyright', darwinTest(async (t, baseOpts) => {
    const copyright = 'Copyright © 2003–2015 Organization. All rights reserved.'
    const opts = { ...baseOpts, appCopyright: copyright }

    const info = await packageAndParseInfoPlist(t, opts)
    t.is(info.NSHumanReadableCopyright, copyright, 'NSHumanReadableCopyright should reflect opts.appCopyright')
  }))

  test.serial('usageDescription fills the correct keys', darwinTest(async (t, baseOpts) => {
    const description = 'I am a Karaoke app'
    const opts = { ...baseOpts, usageDescription: { Microphone: description } }
    const info = await packageAndParseInfoPlist(t, opts)
    t.is(info.NSMicrophoneUsageDescription, description, 'NSMicrophoneUsageDescription should reflect opts.usageDescription.Microphone')
  }))

  test.serial('app named Electron packaged successfully', darwinTest(async (t, baseOpts) => {
    const opts = { ...baseOpts, name: 'Electron' }
    const finalPath = (await packager(opts))[0]
    const appPath = path.join(finalPath, 'Electron.app')
    await util.assertDirectory(t, appPath, 'The Electron.app folder exists')
    await util.assertFile(t, path.join(appPath, 'Contents', 'MacOS', 'Electron'), 'The Electron.app/Contents/MacOS/Electron binary exists')
  }))
}
