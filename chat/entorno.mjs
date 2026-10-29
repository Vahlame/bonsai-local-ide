/** Contexto y shell compartidos por el agente, comandos y terminal integrado. */
import os from "node:os";
import path from "node:path";

export function shellPredeterminada(env = process.env, plataforma = process.platform) {
  return plataforma === "win32" ? env.ComSpec || env.COMSPEC || "cmd.exe" : "/bin/sh";
}

export function nombreSistema(plataforma = process.platform, version = os.release()) {
  if (plataforma !== "win32") return `${plataforma} ${version}`;
  const build = Number(version.split(".")[2]);
  return `Windows ${build >= 22000 ? "11" : "10"} (build ${version})`;
}

export function contextoEntorno({ root = process.cwd(), python = "python", permiso = "ask", timeoutMs = 180000 } = {}) {
  return [
    `Entorno real: ${nombreSistema()}; arquitectura ${os.arch()}; Node ${process.version}.`,
    `Proyecto seleccionado y cwd de cada comando: ${JSON.stringify(path.resolve(root))}. No es necesariamente la carpeta del IDE.`,
    `Shell predeterminada: ${JSON.stringify(shellPredeterminada())}${process.platform === "win32" ? " (/d /s /c; sintaxis cmd.exe, NO PowerShell ni bash). PowerShell 5.1 se invoca explícitamente con powershell.exe -NoProfile -Command; no presupongas pwsh ni funciones de Windows 11. En cmd usa dir, type, findstr y curl.exe; las tuberías y && están disponibles. En un .bat usa %% para variables FOR; en un comando directo usa %." : " (sintaxis POSIX)."}`,
    `Python: ${python}. Tiempo máximo de comando en primer plano: ${Math.round(timeoutMs / 1000)} s.`,
    `Permisos: ${permiso === "all" ? "autonomía local autorizada" : "confirmación de comandos"}. Las herramientas de archivos se limitan al proyecto; aceptan rutas relativas y absolutas dentro de él. La ejecución usa los permisos del usuario del sistema, NO un sandbox de archivos.`,
  ].join("\n");
}
