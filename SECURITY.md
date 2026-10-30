# Seguridad

Bonsai Local IDE ejecuta un agente con acceso al proyecto, a la terminal y a un
navegador controlado. Está diseñado para uso local en `127.0.0.1`, no para exponerse a
Internet.

## Versiones soportadas

| Versión | Soporte |
| --- | --- |
| 1.2.x | Sí |
| 1.1.x y anteriores | No |

## Cómo informar de una vulnerabilidad

No publiques un fallo de seguridad en una incidencia abierta. Usa el
[aviso privado de seguridad de GitHub](https://github.com/Vahlame/bonsai-local-ide/security/advisories/new)
e incluye:

- versión y sistema operativo;
- pasos mínimos para reproducirlo;
- impacto observado (lectura/escritura fuera del proyecto, ejecución no autorizada,
  fuga de datos, bloqueo del servidor, etc.);
- logs o capturas **sin secretos ni rutas personales**.

Se acusará recibo y se coordinará la corrección y la divulgación.

## Modelo de seguridad

- La API (`8080`) y la interfaz (`8787`) escuchan en local y **no tienen autenticación**.
  No las expongas a una red no confiable ni a Internet.
- El agente conserva los permisos del usuario de Windows. Las comprobaciones de comandos
  no son un sandbox del sistema operativo.
- Las herramientas de archivos rechazan rutas fuera del proyecto, enlaces y junctions.
  Las escrituras usan temporales y comprobación de cambios previos.
- El navegador MCP usa un perfil efímero, bloquea los puertos del IDE y del modelo y no
  habilita evaluación arbitraria de código.
- La memoria global y los chats se guardan en el estado local, fuera de Git. No se
  publican con el repositorio.
- Los logs pueden contener rutas y fragmentos de código: revísalos antes de compartirlos.

## Alcance

Quedan fuera del alcance los fallos de `llama.cpp`, del modelo, de las dependencias de
npm o del navegador instalado que no tengan un impacto específico en Bonsai Local IDE.
