// Fake CurseForge app and Modrinth App folders (for tests and screenshots).
//   node scripts/make-import-fixtures.mjs <outDir> [--old-modrinth]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

const { encodePng } = require('./png.cjs');

// Simple artwork: a diagonal gradient with a few blocks (real, valid PNGs)
function art(w, h, [r1, g1, b1], [r2, g2, b2]) {
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = (x + y) / (w + h - 2);
      const block = ((x >> 4) + (y >> 4)) % 5 === 0 ? 0.82 : 1;
      const i = (y * w + x) * 4;
      px[i] = Math.round((r1 + (r2 - r1) * t) * block);
      px[i + 1] = Math.round((g1 + (g2 - g1) * t) * block);
      px[i + 2] = Math.round((b1 + (b2 - b1) * t) * block);
      px[i + 3] = 255;
    }
  }
  return encodePng(w, h, px);
}
const PNG = art(128, 128, [64, 170, 90], [20, 60, 120]);
const PNG_ATM = art(128, 128, [230, 120, 40], [90, 20, 60]);

export function makeCurseForge(root) {
  const inst = path.join(root, 'curseforge', 'minecraft', 'Instances');
  const atm = path.join(inst, 'All the Mods 9');
  write(path.join(atm, 'mods', 'jei-1.20.1-forge-15.2.0.27.jar'), 'jar-jei');
  write(path.join(atm, 'mods', 'create-1.20.1-0.5.1.f.jar.disabled'), 'jar-create');
  write(path.join(atm, 'mods', 'my-local-mod.jar'), 'jar-local');
  write(path.join(atm, 'resourcepacks', 'Faithful 32x.zip'), 'zip-faithful');
  write(path.join(atm, 'saves', 'Mi mundo', 'level.dat'), 'level');
  write(path.join(atm, 'config', 'jei.toml'), 'a=1');
  write(path.join(atm, 'options.txt'), 'fov:0.5\n');
  write(path.join(atm, 'logs', 'latest.log'), 'log');
  const image = path.join(root, 'curseforge', 'minecraft', 'Install', 'profileImages', 'atm9.png');
  write(image, PNG_ATM);
  write(path.join(root, 'curseforge', 'minecraft', 'Install', 'assets', 'indexes', '5.json'), '{"objects":{}}');
  write(path.join(root, 'curseforge', 'minecraft', 'Install', 'assets', 'objects', 'ab', 'abcdef'), 'asset');
  const addon = (id, fileId, name, file, site) => ({
    addonID: id,
    name,
    primaryAuthor: 'someone',
    fileNameOnDisk: file,
    webSiteURL: site,
    installedFile: { id: fileId, fileName: file, fileNameOnDisk: file, displayName: file.replace(/\.jar$/, ''), releaseType: 1, gameVersion: ['1.20.1', 'Forge'], Hashes: [] },
  });
  write(
    path.join(atm, 'minecraftinstance.json'),
    '﻿' +
      JSON.stringify({
        name: 'All the Mods 9',
        gameVersion: '1.20.1',
        baseModLoader: { name: 'forge-47.2.0', forgeVersion: '47.2.0', minecraftVersion: '1.20.1', type: 1 },
        installedAddons: [addon(238222, 4712866, 'Just Enough Items (JEI)', 'jei-1.20.1-forge-15.2.0.27.jar', 'https://www.curseforge.com/minecraft/mc-mods/jei'), addon(328085, 4762216, 'Create', 'create-1.20.1-0.5.1.f.jar', 'https://www.curseforge.com/minecraft/mc-mods/create'), addon(291447, 4100000, 'Faithful 32x', 'Faithful 32x.zip', 'https://www.curseforge.com/minecraft/texture-packs/faithful-32x')],
        projectID: 715572,
        fileID: 5123456,
        installedModpack: { name: 'All the Mods 9 - ATM9' },
        manifest: { name: 'All the Mods 9 - ATM9', version: '0.2.60' },
        lastPlayed: '2026-10-20T18:30:00.000Z',
        isMemoryOverride: true,
        allocatedMemory: 8192,
        javaArgsOverride: '-XX:+UseG1GC',
        profileImagePath: image,
        installPath: atm,
      }),
  );
  const fab = path.join(inst, 'Fabulously Optimized');
  write(path.join(fab, 'mods', 'sodium-fabric-0.5.8+mc1.20.4.jar'), 'jar-sodium');
  write(path.join(fab, 'minecraftinstance.json'), JSON.stringify({ name: 'Fabulously Optimized', gameVersion: '1.20.4', baseModLoader: { name: 'fabric-0.15.7-1.20.4', minecraftVersion: '1.20.4', type: 4 }, installedAddons: [], lastPlayed: '0001-01-01T00:00:00' }));
  const van = path.join(inst, 'Vanilla 1.21');
  write(path.join(van, 'saves', 'Survival', 'level.dat'), 'level');
  write(path.join(van, 'minecraftinstance.json'), JSON.stringify({ name: 'Vanilla 1.21', gameVersion: '1.21', baseModLoader: null, isVanilla: true, installedAddons: [] }));
  return inst;
}

export function makeModrinth(root, { old = false } = {}) {
  const app = path.join(root, old ? 'ModrinthAppOld' : 'ModrinthApp');
  const prof = (p) => path.join(app, 'profiles', p);
  write(path.join(prof('Fabric 1.21.1'), 'mods', 'sodium-fabric-0.6.0+mc1.21.1.jar'), 'jar-sodium');
  write(path.join(prof('Fabric 1.21.1'), 'mods', 'iris-1.8.0.jar.disabled'), 'jar-iris');
  write(path.join(prof('Fabric 1.21.1'), 'shaderpacks', 'Complementary.zip'), 'zip');
  write(path.join(prof('Fabric 1.21.1'), 'saves', 'Hardcore', 'level.dat'), 'level');
  write(path.join(prof('Fabric 1.21.1'), 'logs', 'latest.log'), 'log');
  write(path.join(prof('Cobblemon'), 'mods', 'cobblemon.jar'), 'jar-cobblemon');
  write(path.join(app, 'caches', 'icons', 'cobblemon.png'), PNG);
  write(path.join(app, 'meta', 'libraries', 'org', 'x', 'x.jar'), 'lib');
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(app, { recursive: true });
  const db = new DatabaseSync(path.join(app, 'app.db'));
  if (old) {
    db.exec(`CREATE TABLE profiles (path TEXT NOT NULL, install_stage TEXT NOT NULL, name TEXT NOT NULL, icon_path TEXT NULL, game_version TEXT NOT NULL, mod_loader TEXT NOT NULL, mod_loader_version TEXT NULL, groups JSONB NOT NULL, linked_project_id TEXT NULL, linked_version_id TEXT NULL, locked INTEGER NULL, created INTEGER NOT NULL, modified INTEGER NOT NULL, last_played INTEGER NULL, submitted_time_played INTEGER NOT NULL DEFAULT 0, recent_time_played INTEGER NOT NULL DEFAULT 0, override_java_path TEXT NULL, override_extra_launch_args JSONB NOT NULL, override_custom_env_vars JSONB NOT NULL, override_mc_memory_max INTEGER NULL, override_mc_force_fullscreen INTEGER NULL, override_mc_game_resolution_x INTEGER NULL, override_mc_game_resolution_y INTEGER NULL, override_hook_pre_launch TEXT NULL, override_hook_wrapper TEXT NULL, override_hook_post_exit TEXT NULL, PRIMARY KEY (path));
      CREATE TABLE settings (id INTEGER, custom_dir TEXT NULL, extra_launch_args JSONB NOT NULL, custom_env_vars JSONB NOT NULL, mc_memory_max INTEGER NOT NULL DEFAULT 2048, mc_force_fullscreen INTEGER NOT NULL DEFAULT 0, mc_game_resolution_x INTEGER NOT NULL DEFAULT 854, mc_game_resolution_y INTEGER NOT NULL DEFAULT 480, hook_pre_launch TEXT NULL, hook_wrapper TEXT NULL, hook_post_exit TEXT NULL);`);
    const ins = db.prepare('INSERT INTO profiles (path, install_stage, name, icon_path, game_version, mod_loader, mod_loader_version, groups, linked_project_id, linked_version_id, created, modified, last_played, submitted_time_played, recent_time_played, override_extra_launch_args, override_custom_env_vars, override_mc_memory_max, override_java_path, override_mc_game_resolution_x, override_mc_game_resolution_y, override_hook_pre_launch) VALUES (?, ?, ?, ?, ?, ?, ?, jsonb(?), ?, ?, 0, 0, ?, ?, ?, jsonb(?), jsonb(?), ?, ?, ?, ?, ?)');
    ins.run('Fabric 1.21.1', 'installed', 'Fabric 1.21.1', null, '1.21.1', 'fabric', '0.16.5', '["Optimizados"]', null, null, 1760000000, 3600, 120, '["-Dfoo=1"]', '[["SHARED","mine"]]', 6144, '/opt/jdk21/bin/java', 1280, 720, 'echo hi');
    ins.run('Cobblemon', 'installed', 'Cobblemon Official', path.join(app, 'caches', 'icons', 'cobblemon.png'), '1.21.1', 'neoforge', '21.1.66', '[]', 'MdwFAVRL', 'abc123', 0, 0, 0, '[]', '[]', null, null, null, null, null);
    db.prepare("INSERT INTO settings (id, custom_dir, extra_launch_args, custom_env_vars, mc_memory_max, hook_wrapper) VALUES (0, NULL, jsonb('[]'), jsonb('[[\"GLOBAL_VAR\",\"1\"],[\"SHARED\",\"global\"]]'), 3072, 'gamemoderun')").run();
  } else {
    db.exec(`CREATE TABLE instances (id TEXT NOT NULL, path TEXT NOT NULL, applied_content_set_id TEXT NULL, install_stage TEXT NOT NULL, launcher_feature_version TEXT NOT NULL, update_channel TEXT NOT NULL DEFAULT 'release', name TEXT NOT NULL, icon_path TEXT NULL, created INTEGER NOT NULL, modified INTEGER NOT NULL, last_played INTEGER NULL, submitted_time_played INTEGER NOT NULL DEFAULT 0, recent_time_played INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (id), UNIQUE (path));
      CREATE TABLE instance_content_sets (id TEXT NOT NULL, instance_id TEXT NOT NULL, name TEXT NOT NULL, source_kind TEXT NOT NULL, status TEXT NOT NULL, game_version TEXT NOT NULL, protocol_version INTEGER NULL, loader TEXT NOT NULL, loader_version TEXT NULL, created INTEGER NOT NULL, modified INTEGER NOT NULL, PRIMARY KEY (id));
      CREATE TABLE instance_links (instance_id TEXT NOT NULL, link_kind TEXT NOT NULL, modrinth_project_id TEXT NULL, modrinth_version_id TEXT NULL, server_project_id TEXT NULL, content_project_id TEXT NULL, content_version_id TEXT NULL, hosting_server_id TEXT NULL, hosting_instance_ids JSONB NULL, hosting_active_instance_id TEXT NULL, shared_instance_id TEXT NULL, PRIMARY KEY (instance_id));
      CREATE TABLE instance_groups (id TEXT NOT NULL, name TEXT NOT NULL, display_order INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (id));
      CREATE TABLE instance_group_memberships (instance_id TEXT NOT NULL, group_id TEXT NOT NULL, PRIMARY KEY (instance_id, group_id));
      CREATE TABLE instance_launch_overrides (instance_id TEXT NOT NULL, overrides JSONB NOT NULL, PRIMARY KEY (instance_id));
      CREATE TABLE settings (id INTEGER, custom_dir TEXT NULL, extra_launch_args JSONB NOT NULL, custom_env_vars JSONB NOT NULL, mc_memory_max INTEGER NOT NULL DEFAULT 2048, mc_force_fullscreen INTEGER NOT NULL DEFAULT 0, mc_game_resolution_x INTEGER NOT NULL DEFAULT 854, mc_game_resolution_y INTEGER NOT NULL DEFAULT 480, hook_pre_launch TEXT NULL, hook_wrapper TEXT NULL, hook_post_exit TEXT NULL);`);
    const inst = db.prepare('INSERT INTO instances (id, path, applied_content_set_id, install_stage, launcher_feature_version, name, icon_path, created, modified, last_played, submitted_time_played, recent_time_played) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)');
    const set = db.prepare("INSERT INTO instance_content_sets (id, instance_id, name, source_kind, status, game_version, loader, loader_version, created, modified) VALUES (?, ?, 'Default', 'local', 'available', ?, ?, ?, 0, 0)");
    inst.run('legacy:Fabric 1.21.1', 'Fabric 1.21.1', 'legacy:Fabric 1.21.1:default', 'installed', '1', 'Fabric 1.21.1', null, 1760000000, 3600, 120);
    set.run('legacy:Fabric 1.21.1:default', 'legacy:Fabric 1.21.1', '1.21.1', 'fabric', '0.16.5');
    inst.run('legacy:Cobblemon', 'Cobblemon', 'legacy:Cobblemon:default', 'installed', '1', 'Cobblemon Official', path.join(app, 'caches', 'icons', 'cobblemon.png'), 0, 0, 0);
    set.run('legacy:Cobblemon:default', 'legacy:Cobblemon', '1.21.1', 'neoforge', '21.1.66');
    db.prepare("INSERT INTO instance_links (instance_id, link_kind, modrinth_project_id, modrinth_version_id) VALUES ('legacy:Cobblemon', 'modrinth_modpack', 'MdwFAVRL', 'abc123')").run();
    db.prepare("INSERT INTO instance_groups (id, name, display_order) VALUES ('g1', 'Optimizados', 0), ('group:favorites', 'Favorites', -1)").run();
    db.prepare("INSERT INTO instance_group_memberships (instance_id, group_id) VALUES ('legacy:Fabric 1.21.1', 'g1'), ('legacy:Cobblemon', 'group:favorites')").run();
    db.prepare("INSERT INTO instance_launch_overrides (instance_id, overrides) VALUES ('legacy:Fabric 1.21.1', jsonb('{\"java_path\":\"/opt/jdk21/bin/java\",\"extra_launch_args\":[\"-Dfoo=1\"],\"custom_env_vars\":[[\"SHARED\",\"mine\"]],\"memory\":{\"maximum\":6144},\"game_resolution\":[1280,720],\"hooks\":{\"pre_launch\":\"echo hi\",\"wrapper\":\"\",\"post_exit\":\"\"}}'))").run();
    db.prepare("INSERT INTO settings (id, custom_dir, extra_launch_args, custom_env_vars, mc_memory_max, hook_wrapper) VALUES (0, NULL, jsonb('[]'), jsonb('[[\"GLOBAL_VAR\",\"1\"],[\"SHARED\",\"global\"]]'), 3072, 'gamemoderun')").run();
  }
  db.close();
  return app;
}

// run directly (not imported). Compared as URLs: on Windows the path has a drive and back slashes
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = path.resolve(process.argv[2] || 'import-fixtures');
  makeCurseForge(out);
  makeModrinth(out, { old: process.argv.includes('--old-modrinth') });
  console.log(out);
}
