// Run against the existing debug Loop build; never edits/builds the Android project.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const adb = process.env.ADB_BINARY || 'adb';
const input = resolve(process.env.COLOUR_OUTPUT_DIR || 'colour-test-output/sps-repair');
const output = join(input, 'android');
mkdirSync(output, { recursive: true });
const serialArgs = process.env.ANDROID_SERIAL ? ['-s', process.env.ANDROID_SERIAL] : [];
const run = (...args) => execFileSync(adb, [...serialArgs, ...args], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024,
});
const app = 'ca.nsitu.loop';
const prefsPath = 'shared_prefs/loop_preferences.xml';
const prefix = `rivvon-sps-${Date.now()}`;
const stage = `/data/local/tmp/${prefix}`;
const files = ['chart', 'ribbon'].flatMap(asset => ['off', 'on'].flatMap(logo =>
    ['before', 'webcodecs-repaired', 'after'].map(method => `${asset}-logo-${logo}-${method}.mp4`)));
for (const file of files) readFileSync(join(input, file));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [];
run('shell', 'am', 'force-stop', app);
// exec-out preserves file bytes; adb shell can translate CR/LF on Windows.
const original = run('exec-out', 'run-as', app, 'cat', prefsPath);
writeFileSync(join(output, 'original-preferences.xml'), original);
const setPreference = (xml, name, value) => {
    const tag = `<string name="${name}">${value}</string>`;
    const pattern = new RegExp(`<string name="${name}">[\\s\\S]*?</string>`);
    return pattern.test(xml) ? xml.replace(pattern, tag) : xml.replace('</map>', `${tag}</map>`);
};
try {
    run('shell', 'run-as', app, 'mkdir', '-p', 'no_backup/rivvon-videos');
    for (const file of files) {
        run('push', join(input, file), `${stage}-${file}`);
        run('shell', 'run-as', app, 'cp', `${stage}-${file}`, `no_backup/rivvon-videos/${prefix}-${file}`);
    }
    for (const file of files) for (const surface of ['SURFACE_VIEW', 'TEXTURE_VIEW']) {
        run('shell', 'am', 'force-stop', app);
        let prefs = setPreference(original, 'video_uri', `file:///data/user/0/${app}/no_backup/rivvon-videos/${prefix}-${file}`);
        prefs = setPreference(prefs, 'surface_type', surface);
        writeFileSync(join(output, 'test-preferences.xml'), prefs);
        run('push', join(output, 'test-preferences.xml'), `${stage}-prefs.xml`);
        run('shell', 'run-as', app, 'cp', `${stage}-prefs.xml`, prefsPath);
        run('shell', 'am', 'start', '-n', `${app}/.MainActivity`);
        await wait(8000);
        const name = `${file.slice(0, -4)}-${surface.toLowerCase()}`;
        run('shell', 'uiautomator', 'dump', `${stage}-ui.xml`);
        run('pull', `${stage}-ui.xml`, join(output, `${name}.xml`));
        const ui = readFileSync(join(output, `${name}.xml`), 'utf8');
        const texts = [...ui.matchAll(/text="([^"]*)"/g)].map(m => m[1]).filter(Boolean)
            .map(s => s.replaceAll('&amp;', '&'));
        run('shell', 'screencap', '-p', `${stage}-screen.png`);
        run('pull', `${stage}-screen.png`, join(output, `${name}.png`));
        results.push({ file, surface, texts });
        console.log(JSON.stringify(results.at(-1)));
        if (file.endsWith('-after.mp4') && (!texts.some(s => s.startsWith('Input colour: BT709/Limited'))
            || !texts.some(s => s.includes('Codec colour: standard BT.709 (1)')
                && s.includes('range limited (2)') && s.includes('transfer SDR (3)')))) {
            throw new Error('The software baseline did not produce the expected Android colour diagnostics.');
        }
    }
} finally {
    run('shell', 'am', 'force-stop', app);
    writeFileSync(join(output, 'restore-preferences.xml'), original);
    run('push', join(output, 'restore-preferences.xml'), `${stage}-prefs.xml`);
    run('shell', 'run-as', app, 'cp', `${stage}-prefs.xml`, prefsPath);
    if (run('exec-out', 'run-as', app, 'cat', prefsPath) !== original) throw new Error('Loop preferences were not restored.');
    for (const file of files) {
        run('shell', 'run-as', app, 'rm', '-f', `no_backup/rivvon-videos/${prefix}-${file}`);
        run('shell', 'rm', '-f', `${stage}-${file}`);
    }
    for (const suffix of ['prefs.xml', 'ui.xml', 'screen.png']) run('shell', 'rm', '-f', `${stage}-${suffix}`);
    run('shell', 'am', 'start', '-n', `${app}/.MainActivity`);
    writeFileSync(join(output, 'android-report.json'), JSON.stringify({
        model: run('shell', 'getprop', 'ro.product.model').trim(),
        android: run('shell', 'getprop', 'ro.build.version.release').trim(),
        originalPreferencesRestored: true, temporaryDeviceFilesRemoved: true, results,
    }, null, 2));
    console.log('Original Loop preferences restored; temporary device files removed.');
}
