import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Each test runs as one script: the sources it needs, then the test itself.
const tests = { LegacyState: ['Log', 'LegacyState'], WebOrigin: ['WebOrigin'], ShellEnvironment: ['ShellEnvironment'], ServerManager: ['Log', 'AppFlavor', 'ShellEnvironment', 'OldInstall', 'BundleHome', 'ServerManager'], BundleHome: ['AppFlavor', 'ShellEnvironment', 'OldInstall', 'BundleHome', 'ServerManager'], OldInstall: ['Log', 'AppFlavor', 'OldInstall'], Updater: ['AppFlavor', 'WebOrigin', 'Updater'], LinearLink: ['LinearLink'],
  BrowserAutomation: ['BrowserAutomation'],
  AppKeys: ['AppFlavor', 'Geometry', 'Textures', 'NativeTheme', 'ChromeControls', 'PageBar', 'ConquerTabs', 'ConquerExtras', 'ZenCookies', 'Conquer', 'EditorEmbed', 'AppKeys'],
  EditorEmbed: ['AppFlavor', 'Geometry', 'Textures', 'NativeTheme', 'ChromeControls', 'PageBar', 'ConquerTabs', 'ConquerExtras', 'ZenCookies', 'Conquer', 'EditorEmbed', 'AppKeys'],
  AtlasView: ['Log', 'Geometry', 'Textures', 'NativeTheme', 'ChromeControls', 'MapScene', 'SpriteGlow', 'AtlasScene', 'DungeonScene', 'AtlasView'],
  DungeonScene: ['Log', 'Geometry', 'Textures', 'NativeTheme', 'ChromeControls', 'MapScene', 'SpriteGlow', 'AtlasScene', 'DungeonScene', 'AtlasView'],
  DungeonGlow: ['Log', 'Geometry', 'Textures', 'NativeTheme', 'ChromeControls', 'MapScene', 'SpriteGlow', 'AtlasScene', 'DungeonScene', 'AtlasView'],
  MapHover: ['Log', 'Geometry', 'Textures', 'NativeTheme', 'ChromeControls', 'MapScene', 'SpriteGlow', 'AtlasScene', 'DungeonScene', 'AtlasView'] };
for (const [name, sources] of Object.entries(tests)) {
  const input = [...sources.map(s => `../Sources/PaseoCommandNative/${s}.swift`), `../tests/${name}Tests.swift`]
    .map(path => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');
  process.stdout.write(execFileSync('swift', ['-'], { input, encoding: 'utf8' }));
}

// Tests of code that uses SwiftTerm, which the interpreter can't import: compiled against the app's
// release build of it (built first if it isn't), each run with its arguments.
const native = fileURLToPath(new URL('..', import.meta.url));
const built = join(native, '.build/release');
if (!existsSync(join(built, 'SwiftTerm.o'))) execFileSync('swift', ['build', '-c', 'release'], { cwd: native, stdio: 'inherit' });
const compiled = {
  TerminalFont: { sources: ['Log', 'AppFlavor', 'Geometry', 'Textures', 'NativeTheme', 'ChromeControls', 'TerminalFont', 'TerminalQueries', 'TerminalDrawer', 'EditorEmbed', 'EditorOverlay'],
    args: [join(native, 'fonts/SymbolsNerdFontMono-Regular.ttf')] },
  TerminalQueries: { sources: ['TerminalQueries'], args: [] },
  TerminalTab: { sources: ['Log', 'AppFlavor', 'Geometry', 'Textures', 'NativeTheme', 'ChromeControls', 'TerminalFont', 'TerminalQueries', 'TerminalDrawer'], args: [] },
};
for (const [name, { sources, args }] of Object.entries(compiled)) {
  const dir = mkdtempSync(join(tmpdir(), `paseo-native-${name}-`));
  try {
    writeFileSync(join(dir, 'main.swift'), readFileSync(join(native, `tests/${name}Tests.swift`), 'utf8'));
    execFileSync('swiftc', ['-Onone', '-suppress-warnings', '-I', built, '-o', join(dir, 'test'),
      ...sources.map(s => join(native, `Sources/PaseoCommandNative/${s}.swift`)), join(dir, 'main.swift'), join(built, 'SwiftTerm.o')],
      { stdio: ['ignore', 'inherit', 'inherit'] });
    process.stdout.write(execFileSync(join(dir, 'test'), args, { encoding: 'utf8' }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
