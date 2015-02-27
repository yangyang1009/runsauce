import _ from 'lodash';
import util from 'util';
import Q from 'q';
import yiewd from 'yiewd';
import { sleep } from 'asyncbox';
import { tests } from './tests';
import { testsMap } from './parser';
import { run as runLocalServer,
         stop as stopLocalServer } from './localserver.js';

const APPS = {
  'iOS7': 'http://appium.s3.amazonaws.com/TestApp7.0.app.zip',
  'iOS71': 'http://appium.s3.amazonaws.com/TestApp7.1.app.zip',
  'iOSHybrid6': 'http://appium.s3.amazonaws.com/WebViewApp6.1.app.zip',
  'iOSHybrid7': 'http://appium.s3.amazonaws.com/WebViewApp7.1.app.zip',
  'Android': 'http://appium.s3.amazonaws.com/ContactManager.apk',
  'AndroidHybrid': 'http://appium.s3.amazonaws.com/ApiDemos-debug-2014-08.apk',
  'Selendroid': 'http://appium.s3.amazonaws.com/selendroid-test-app-0.7.0.apk'
};

const NATIVE_TESTS = ["appium", "ios", "android", "android_long",
                      "selendroid", "android_hybrid", "ios_hybrid",
                      "ios_loc_serv"];

function getTestByType (testType) {
  switch (testType) {
    case 'https': return tests.webTestHttps;
    case 'selfsigned': return tests.webTestHttpsSelfSigned;
    case 'connect': return tests.webTestConnect;
    case 'localname': return tests.webTestLocalName;
    case 'appium': case 'ios': return tests.iosTest;
    case 'ios_hybrid': return tests.iosHybridTest;
    case 'ios_loc_serv': return tests.iosLocServTest;
    case 'android': return tests.androidTest;
    case 'android_long': return tests.androidLongTest;
    case 'android_hybrid': return tests.androidHybridTest;
    case 'selendroid': return tests.selendroidTest;
    case 'js': return tests.jsTest;
    case 'web_long': return tests.longWebTest;
    default: return tests.webTest;
  }
}

function getCaps (testSpec) {
  let caps = {
    browserName: testSpec.browser
    , device: testSpec.device
    , version: testSpec.version.toString()
    , platform: testSpec.platform
    , name: testsMap[testSpec.test]
  };
  if (testSpec.orientation) {
    caps['device-orientation'] = testSpec.orientation;
  }
  return fixCaps(testSpec, caps);
}

function fixCaps (testSpec, caps) {
  if (caps.version && caps.version.toString().length === 1) {
    caps.version = caps.version.toString() + ".0";
  }
  if (caps.device ||
      _.contains(NATIVE_TESTS, testSpec.test)) {
    caps = fixAppiumCaps(testSpec, caps);
  } else {
    delete caps.device;
  }
  let tt = testSpec.test.toLowerCase();
  if (tt === "selfsigned") {
    caps.keepKeyChains = true;
  }
  caps['prevent-requeue'] = true;
  return caps;
}

function fixAppium18Caps (testSpec, caps) {
  if (caps.browserName === 'Safari') {
    caps.app = 'safari';
  } else if (caps.browserName === 'Chrome') {
    caps.app = 'chrome';
  }
  delete caps.browserName;
  if (!caps.device) {
    caps.device = 'iPhone Simulator';
  }
  if (!testSpec.onSauce) {
    caps.launchTimeout = 15000;
  }
  if (caps.device[0].toLowerCase() === 'i') {
    caps.app = APPS.iOS;
    if (!caps.platform) {
      caps.platform = "Mac 10.9";
    }
    if (!caps.version) {
      caps.version = caps.platform === "Mac 10.9" ? '7.0' : '6.1';
    }
  } else {
    caps.app = APPS.Android;
    caps['app-package'] = 'com.example.android.contactmanager';
    caps['app-activity'] = '.ContactManager';
    if (!caps.platform) {
      caps.platform = "Linux";
    }
    if (!caps.version) {
      caps.version = '4.2';
    }
    if (testSpec.test.toLowerCase() === 'selendroid') {
      caps.app = APPS.Selendroid;
      caps['app-package'] = 'io.selendroid.testapp';
      caps['app-activity'] = '.HomeScreenActivity';
      caps.webviewSupport = true;
    }
  }
  return caps;
}

function fixAppium1Caps (testSpec, caps) {
  caps.appiumVersion = testSpec.backendVersion.toString();
  if (/^\d$/.test(caps.appiumVersion)) {
    caps.appiumVersion += ".0";
  }
  let tt = testSpec.test.toLowerCase();
  if (_.contains(NATIVE_TESTS, tt)) {
    caps.browserName = '';
  }
  delete caps.platform;
  caps.deviceName = caps.device;
  delete caps.device;
  caps.platformVersion = caps.version;
  delete caps.version;
  if (!caps.deviceName) {
    caps.deviceName = 'iPhone Simulator';
  }
  if (!testSpec.onSauce) {
    caps.launchTimeout = 15000;
  }
  if (caps.deviceName[0].toLowerCase() === 'i') {
    caps.platformName = 'iOS';
    if (!caps.platformVersion) {
      caps.platformVersion = '7.1';
    }
    if (_.contains(["ios", "ios_loc_serv"], tt)) {
      if (parseFloat(caps.platformVersion < 7.1)) {
        caps.app = APPS.iOS7;
      } else {
        caps.app = APPS.iOS71;
      }
    } else if (tt === "ios_hybrid") {
      if (parseFloat(caps.platformVersion) < 7) {
        caps.app = APPS.iOSHybrid6;
      } else {
        caps.app = APPS.iOSHybrid7;
      }
    }
  } else {
    caps.platformName = 'Android';
    if (_.contains(["android", "android_long"], tt)) {
      caps.app = APPS.Android;
    } else if (tt === 'android_hybrid') {
      caps.appActivity = '.view.WebView1';
      caps.app = APPS.AndroidHybrid;
      if (parseFloat(caps.platformVersion < 4.4)) {
        caps.automationName = 'Selendroid';
      }
    }
    if (!caps.platformVersion) {
      caps.platformVersion = '4.3';
    }
    if (tt === 'selendroid') {
      caps.automationName = 'Selendroid';
      caps.app = APPS.Selendroid;
    }
  }
  return caps;
}

function fixAppiumCaps (testSpec, caps, onSauce) {
  let appiumVer = parseFloat(testSpec.backendVersion) || null;
  if (appiumVer >= 0.18) {
    return fixAppium1Caps(testSpec, caps, onSauce);
  } else {
    return fixAppium18Caps(testSpec, caps, onSauce);
  }
}

export async function runTest (testSpec, opts, multiRun) {
  let start = Date.now();
  let result = {caps: testSpec.caps, test: testSpec.testName};
  let driver;
  let log = msg => {
    if (!multiRun) console.log(msg);
  };
  if (testSpec.onSauce) {
    driver = yiewd.sauce(opts.userName, opts.accessKey, opts.server,
                         opts.port);
  } else {
    driver = yiewd.remote(opts.server, opts.port);
  }
  try {
    result.startupTime = await testSpec.test(driver, testSpec.caps, opts);
    if (testSpec.wait) {
      log(" - Waiting around for 120s...");
      await sleep(120000);
    }
    if (testSpec.onSauce) {
      log(" - Reporting pass");
      await driver.reportPass();
    } else {
      log(" - Test passed");
    }
    result.stack = null;
  } catch(e) {
    log("");
    log(e.stack);
    log("");
    result.stack = e.stack;
    if (driver.sessionID && testSpec.onSauce) {
      log(" - Reporting failure");
      await driver.reportFail();
      result.sessionId = driver.sessionID;
    } else {
      log(" - Test failed");
    }
  }
  if (driver.sessionID) {
    log(" - Ending session");
    await driver.quit();
  }
  if (multiRun) {
    if (result.stack) {
      process.stdout.write('F');
    } else {
      process.stdout.write('.');
    }
  }
  result.time = (Date.now() - start);
  let testTime = result.time - result.startupTime;
  log(" - Session finished in " + (result.time / 1000).toFixed(2) + "s");
  if (!result.stack) {
    log("   - Startup time: " + (result.startupTime / 1000).toFixed(2) +
        "s, " + (result.startupTime / result.time * 100).toFixed(2) + "%");
    log("   - Test time: " + (testTime / 1000).toFixed(2) +
        "s, " + (testTime / result.time * 100).toFixed(2) + "%");
  } else {
    log("   - No timing information available since test failed");
    if (result.sessionId) {
      log("   - Sauce link: https://saucelabs.com/tests/" + result.sessionId);
    }
  }
  return result;
}

export async function runTestSet (testSpecs, opts) {
  let results = [];
  let numTests = testSpecs.length;
  let procs = opts.processes > numTests ? numTests : opts.processes;
  const multiRun = testSpecs.length > 1;
  if (multiRun) {
    console.log("");
  }

  // keep a map of tests in progress, this will be as long as our processes.
  // As we add and remove tests slots will be filled and emptied in this map.
  let testsInProgress = {};
  for (let i = 0; i < procs; i++) {
    testsInProgress[i] = null;
  }

  // Create a promise that we will resolve when all tests are done
  let setCb = Q.defer();

  // Helper to get the number of currently-executing tests
  let numTestsInProgress = () => {
    return _.filter(testsInProgress, x => x !== null).length;
  };

  // checkRuns periodically polls which tests are in progress and starts
  // new tests whenever a concurrency slot is free. Once all tests are done
  // it resolves the setCb that we deferred above.
  let checkRuns = () => {
    // if we have completed fewer tests than our total, see if we can start
    // more tests
    if (results.length < numTests) {
      // if completed + in progress is still less than all the tests, we can
      // start more
      if (results.length + numTestsInProgress() < numTests) {
        // loop through our possibly-available test slots
        _.each(testsInProgress, (testPromise, slot) => {
          let testSpec = testSpecs.shift(); // get the next test
          if (testPromise === null) {
            // if testPromise is null, that means the slot is free and
            // we can start a new test! So we start it and put the promise
            // in the slot to keep track
            testsInProgress[slot] = Q(runTest(testSpec, opts, multiRun));

            // Once we're done with this particular test, handle any
            // unexpected errors and update the results array
            testsInProgress[slot].nodeify((err, res) => {
              if (err) {
                if (!res || !res.stack) {
                  res = res || {};
                  res.stack = err.stack;
                }
                if (multiRun) {
                  process.stdout.write('E');
                }
              }
              testsInProgress[slot] = null;
              results.push(res);
            });
          }
        });
      }
      // whether we started more or not, set the function to poll again
      setTimeout(checkRuns, 75);
    } else {
      // if we've completed all the tests, resolve the deferred
      setCb.resolve();
    }
  };

  checkRuns();
  await setCb.promise; // wait till we're done with all the tests
  return results;
}

function buildTestSuite (opts) {
  let testSpecs = [];
  let numTests = 0, numCaps = 0, needsLocalServer = false;
  const onSauce = opts.userName && opts.accessKey;
  for (let optSpec of opts.tests) {
    let testSpec = {};
    let runs = optSpec.runs || 1;
    if (_.contains(["localname", "connect"], optSpec.test)) {
      needsLocalServer = true;
    }
    testSpec.test = getTestByType(optSpec.test);
    testSpec.testName = optSpec.test;
    optSpec.onSauce = onSauce && optSpec.test !== 'js';
    testSpec.caps = getCaps(optSpec);
    if (testSpec.test.extraCaps) {
      _.extend(testSpec.caps, testSpec.test.extraCaps);
    }
    let build = opts.build;
    if (build) {
      build = build.replace("%t", Date.now());
    } else if (optSpec.onSauce && (opts.tests.length > 1 || runs > 1)) {
      build = `runsauce-${opts.userName}-${Date.now()}`;
    }
    if (build) {
      testSpec.caps.build = build;
    }
    testSpec.onSauce = optSpec.onSauce;
    numTests += runs;
    numCaps++;
    for (let i = 0; i < runs; i++) {
      testSpecs.push(testSpec);
    }
  }
  return [testSpecs, numTests, numCaps, needsLocalServer];
}

function reportSuite (results) {
  let cleanResults = results.filter(r => !r.stack);
  console.log("\n");
  console.log("RAN: " + results.length + " // PASSED: " +
              cleanResults.length + " // FAILED: " + (results.length -
              cleanResults.length));
  if (cleanResults.length) {
    let sum = _.reduce(_.pluck(cleanResults, 'time'), function(m, n) { return m + n; }, 0);
    let avg = sum / cleanResults.length;
    let startSum = _.reduce(_.pluck(cleanResults, 'startupTime'), function(m, n) { return m + n; }, 0);
    let startAvg = startSum / cleanResults.length;
    console.log("Average successful test run time: " + (avg / 1000).toFixed(2) + "s");
    console.log("Average successful test startup time: " + (startAvg / 1000).toFixed(2) +
        "s (" + (startAvg / avg * 100).toFixed(2) + "% of total)");
  } else {
    console.log("No statistics available since every test failed");
  }

  let errs = 0;
  for (let res of results) {
    errs++;
    if (res.stack) {
      console.log("");
      console.log("----------------");
      console.log("Error #" + errs );
      console.log("----------------");
      if (res.sessionId) {
        console.log("SAUCE URL: https://saucelabs.com/tests/" + res.sessionId);
      }
      console.log("TEST: " + res.test);
      console.log("CAPS: " + util.inspect(res.caps));
      console.log("----------------");
      console.log(res.stack);
    }
  }
}

export async function run (opts) {
  let [testSpecs, numTests, numCaps, needsLocalServer] = buildTestSuite(opts);
  const testStr = numTests + " test" + (numTests !== 1 ? "s" : "");
  const pStr = opts.processes + " process" + (opts.processes !== 1 ? "es": "");
  console.log("Running " + testStr + " in up to " + pStr + " against " +
              opts.configName + " with " + numCaps + " sets of caps");
  if (needsLocalServer) {
    runLocalServer();
  }
  if (opts.verbose || numTests === 1) {
    console.log(util.inspect(_.pluck(testSpecs, 'caps')));
  }
  let results = await runTestSet(testSpecs, opts);
  if (numTests > 1) {
    reportSuite(results);
  }
  if (needsLocalServer) {
    await stopLocalServer();
  }
}
