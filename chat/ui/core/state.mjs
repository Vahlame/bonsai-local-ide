/**
 * Estado inicial compartido de la interfaz. No es un framework: solo evita que
 * cada script invente su propia copia de los ajustes y de los temas.
 */

export const AJUSTES_INICIALES = Object.freeze({
  tema: "slate",
  perfil: "codigo",
  pensar: 0,
  reglas: true,
  historial: 0,
  continuarAuto: true,
  saltosTope: 192,
  comandoSegundos: 180,
  preguntarModelo: true,
  editorModerno: true,
});

export const TEMAS_INICIALES = Object.freeze([
  ["slate", "Grafito"],
  ["ocean", "Niebla azul"],
  ["forest", "Bosque"],
  ["sand", "Arena"],
  ["light", "Marfil"],
  ["dark", "Medianoche"],
]);

export function crearEstadoUI() {
  return {
    ajustes: { ...AJUSTES_INICIALES },
    temas: TEMAS_INICIALES.map(([id, nombre]) => [id, nombre]),
  };
}
