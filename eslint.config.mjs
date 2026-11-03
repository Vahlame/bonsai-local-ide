/**
 * ESLint gradual para los módulos de frontera. No pretende reformatear el
 * repositorio histórico: cubre las rutas donde un error tiene impacto de
 * seguridad o de integridad y deja el resto para una migración por dominios.
 */
export default [
  {
    files: [
      "chat/rutas-sensibles.mjs",
      "chat/retencion.mjs",
      "chat/red-segura.mjs",
      "chat/server/security-headers.mjs",
      "chat/server/observability.mjs",
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-debugger": "error",
      "no-dupe-keys": "error",
      "no-unreachable": "error",
      "no-constant-condition": "error",
    },
  },
];
