/** Exercise the real PowerShell-to-Node argument boundary, without starting the IDE/model. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

if(process.platform!=='win32') {
  console.log('Launcher: Windows-only argument regression skipped.');
} else {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const source=fs.readFileSync(path.join(root,'scripts/start-ui.ps1'),'utf8');
  const marker='# Keep arrays even for a single value:';
  assert.ok(source.includes(marker),'Native launch argument block missing');
  const nativeLaunch=source.slice(source.indexOf(marker));
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bonsai-launcher-'));
  try {
    const probe=path.join(temp,'argv probe.mjs');
    fs.writeFileSync(probe,'console.log(JSON.stringify(process.argv.slice(2)));');
    const quote=value=>`'${value.replaceAll("'","''")}'`;
    for(const noBrowser of [false,true]) {
      const script=path.join(temp,`check-${noBrowser}.ps1`);
      fs.writeFileSync(script,[
        `$Server=${quote(probe)}`,
        '$UiPort=8787; $Port=8080; $PromptCap=36864',
        "$ThinkArgs=@('--think','4096')",
        "$EnginePreset='8GB-VISION-LONG'",
        `$NoBrowser=$${noBrowser}`,
        nativeLaunch,
      ].join('\n'));
      const run=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script],{encoding:'utf8',windowsHide:true,timeout:10000});
      assert.equal(run.status,0,run.stderr||run.stdout);
      assert.deepEqual(JSON.parse(run.stdout.trim()),[
        '--port','8787','--llama-port','8080','--prompt-cap','36864',
        '--think','4096','--engine-preset','8GB-VISION-LONG',
        ...(!noBrowser?['--open']:[]),
      ]);
    }
    // Acceso directo real, sin GPU ni escritorio del usuario: se crea en %TEMP%.
    const destino = path.join(temp, "Bonsai IDE prueba.lnk");
    const crear = spawnSync("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", path.join(root, "scripts/crear-acceso-directo.ps1"),
      "-Destino", destino,
    ], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    assert.equal(crear.status, 0, crear.stderr || crear.stdout);
    assert.equal(fs.existsSync(destino), true, "el acceso directo debe existir");
    const leer = spawnSync("powershell.exe", ["-NoProfile", "-Command", [
      "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('" + destino.replaceAll("'", "''") + "')",
      "[pscustomobject]@{target=$s.TargetPath;args=$s.Arguments;cwd=$s.WorkingDirectory}|ConvertTo-Json -Compress",
    ].join("; ")], { encoding: "utf8", windowsHide: true, timeout: 10000 });
    assert.equal(leer.status, 0, leer.stderr || leer.stdout);
    const acceso = JSON.parse(leer.stdout.trim());
    assert.match(acceso.target, /powershell\.exe$/i);
    assert.ok(acceso.args.includes("bonsai-rtx4060.ps1"), "el acceso directo usa el lanzador real");
    assert.ok(acceso.args.includes(" launch"), "el acceso directo arranca en modo launch");
    assert.equal(path.resolve(acceso.cwd), root);
    console.log("Launcher: argumentos y acceso directo de Windows verificados sin GPU.");
  } finally {
    assert.equal(path.dirname(temp),os.tmpdir());
    assert.ok(path.basename(temp).startsWith('bonsai-launcher-'));
    fs.rmSync(temp,{recursive:true,force:true});
  }
}
