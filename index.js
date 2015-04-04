var os = require('os')
var path = require('path')
var fs = require('fs')
var child = require('child_process')

var nugget = require('nugget')
var plist = require('plist')
var unzip = require('extract-zip')
var mkdirp = require('mkdirp')
var rimraf = require('rimraf')
var ncp = require('ncp').ncp

var latest = '0.22.3'

module.exports = function packager (opts, cb) {
  if (!opts.version) opts.version = latest
    
  var names = {
    mac: 'atom-shell-v' + opts.version + '-darwin-x64'
  }
  
  var macUrl = 'https://github.com/atom/atom-shell/releases/download/v' + opts.version + '/' + names.mac + '.zip'
  var localFile = path.join(__dirname, 'downloaded', names.mac + '.zip')
  var tmpDir = path.join(os.tmpdir(), names.mac)
  
  rimraf(tmpDir, function rmrfd () {
    // ignore errors
    mkdirp(tmpDir, function mkdirpd () {
      // ignore errors
      if (opts.zip) extractZip(opts.zip)
      else downloadZip()
    })
  })
  
  function downloadZip () {
    nugget(macUrl, {target: localFile, dir: path.join(__dirname, 'downloaded'), resume: true, verbose: true}, function downloaded (err) {
      if (err) return cb(err)
      extractZip(localFile)
    })
  }
  
  function extractZip (filename) {
    unzip(filename, {dir: tmpDir}, function extracted (err) {
      if (err) return cb(err)
      buildApp()
    })
  }
  
  function buildApp () {
    var newApp = path.join(tmpDir, opts.name + '.app')
    
    // rename .app folder (this is exactly what Atom editor does)
    fs.renameSync(path.join(tmpDir, 'Atom.app'), newApp)
    
    var paths = {
      info1: path.join(newApp, 'Contents', 'Info.plist'),
      info2: path.join(newApp, 'Contents', 'Frameworks', 'Atom Helper.app', 'Contents', 'Info.plist'),
      app: path.join(newApp, 'Contents', 'Resources', 'app')
    }
    
    // update plist files
    var pl1 = plist.parse(fs.readFileSync(paths.info1).toString())
    var pl2 = plist.parse(fs.readFileSync(paths.info2).toString())
    
    var bundleId = opts['app-bundle-id'] || 'com.atom-shell.' + opts.name.toLowerCase()
    var bundleHelperId = opts['helper-bundle-id'] || 'com.atom-shell.' + opts.name.toLowerCase() + '.helper'
    
    pl1.CFBundleDisplayName = opts.name
    pl1.CFBundleIdentifier = bundleId
    pl1.CFBundleName = opts.name
    pl2.CFBundleIdentifier = bundleHelperId
    pl2.CFBundleName = opts.name
    
    fs.writeFileSync(paths.info1, plist.build(pl1))
    fs.writeFileSync(paths.info2, plist.build(pl2))
    
    function filter(file) {
      var ignore = opts.ignore || []
      if (!Array.isArray(ignore)) ignore = [ignore]
      for (var i = 0; i < ignore.length; i++) {
        if (file.match(ignore[i])) {
          return false
        }
      }
      return true
    }
    
    // copy users app into .app
    ncp(opts.dir, paths.app, {filter: filter}, function copied (err) {
      if (err) return cb(err)

      if (opts.prune) {
        prune(function pruned (err) {
          if (err) return cb(err)
          moveApp()
        })
      } else {
        moveApp()
      }

      function prune (cb) {
        child.exec('npm prune --production', { cwd: paths.app }, cb)
      }

      function moveApp () {
        // finally, move app into cwd
        var finalPath = path.join(opts.out || process.cwd(), opts.name + '.app')

        fs.rename(newApp, finalPath, function moved (err) {
          cb(err, finalPath)
        })
      }
    })
  }
}
