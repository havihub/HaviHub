# Auditoría de Havi Hub 1.0.0

Fecha: 20 de noviembre de 2026. Revisado: todo el repositorio en `b7ddee8` (Havi Hub 1.0.0, versión del 19/11 a las 23:38 UTC), comparado con Prism Launcher. Una primera pasada se hizo sobre la versión anterior (`f9aad59`); lo que esa versión nueva ya corrigió está marcado.

**Resumen.** Para un proyecto de una sola persona, Havi Hub está por encima del promedio: el proceso principal está bien separado en módulos y tiene buenas pruebas. La versión `b7ddee8` ya corrige el fallo más grave que encontró la auditoría (`safepath.js`) y suma un instalador de Java y la vuelta atrás del motor. Esta rama trae otros arreglos (de seguridad, de funciones que fallaban en Windows y de las pruebas) y este documento, con lo que queda pendiente por prioridad.

---

## 1. Lo que trae esta rama

Son 23 commits independientes sobre `b7ddee8`, más este documento. Cada mensaje explica qué cambia y por qué, así que se pueden revisar (o descartar) uno por uno.

| Commit | Qué arregla | Gravedad |
|---|---|---|
| `a14420a` | Un `.mrpack` con direcciones `file:` copiaba archivos del PC al importarse; en Windows, `file://servidor/…` filtra el hash NTLM. Ahora: solo HTTPS, todos los espejos en orden, sha512 | Media |
| `b1e9107` | Un `.zip` de Prism importado traía comandos de inicio, `-javaagent`, `LD_PRELOAD`, Java propio, etc. sin mostrarlos: ahora se avisa y se elige | Baja-media |
| `0384234` | `app.openPath` abría (o sea, ejecutaba) cualquier archivo; se quita `app.readFile`, que nada usaba; los iframes se comprueban por su dirección | Baja |
| `3c0814f` | El motor instalaba cualquier versión nueva de Prism; ahora solo hasta `TESTED_VERSION` (11.1.1) | Robustez |
| `a59ad70` | Sin la API de GitHub (página o feed de respaldo), una actualización del motor se instalaba sin comprobar su SHA-256 | Robustez |
| `fec1ad9` | Errores y descargas del proceso principal salían siempre en español. Además, `gen.mjs` borraba las traducciones que no encontraba en el código (31 de la versión nueva, como las del diagnóstico de logs) | Traducción |
| `822ae8f` | Prueba end-to-end del diálogo de importación | Pruebas |
| `309de02` | **Las descargas de CurseForge que pasan por una redirección fallaban siempre** ("Could not connect: https://edge.forgecdn.net/… (Redirect was cancelled)"). El `net.fetch` de Electron no admite `redirect: 'manual'`, que Havi Hub usa para que la clave de CurseForge solo llegue a sus servidores. También fallaban la página de respaldo del motor y la comprobación de `social.js`. Ahora usan `net.request`. Lo encontró Havi al probar la rama en Windows | Alta (funcional) |
| `d0ccac8` | **`safepath.js` rechazaba archivos que sí estaban dentro de su carpeta** cuando la carpeta aún no existía y el camino pasaba por un enlace o por un nombre corto de Windows (`C:\Users\RUNNER~1\…`). Comparaba una ruta resuelta con otra sin resolver. En Windows eso dejaba vacío un perfil importado y hacía fallar instalaciones. Lo mostraron las pruebas en Windows | Alta (funcional, Windows) |
| `6b64541` | **Los perfiles nuevos perdían todas las opciones y teclas de Havi Hub.** Su `options.txt` no tenía línea `version:`, así que Minecraft lo tomaba por uno de antes de la 1.13, intentaba convertir las teclas numéricas antiguas, fallaba con `key.keyboard.…` ("Failed to load options") y descartaba el archivo. De ahí también la pantalla de bienvenida de Minecraft. Lo mostró el log de la prueba de Havi | Alta (funcional) |
| `0a3221c` | Al instalar un modpack que trae sus propias teclas, Havi Hub pregunta si usar las del jugador o las del autor. Antes se perdían sin aviso | Mejora (pedida en la prueba) |
| `523c95b` | En la lista de proyectos del diseño Modrinth quedaba un hueco grande entre la descripción y las etiquetas. Ahora la tarjeta sigue el `ProjectCard.vue` de Modrinth (GPL-3.0): las etiquetas van al pie, como píldoras con el ícono y el color de cada cargador, con 4 como máximo y el resto en "+N"; el título, el autor, la descripción, las cifras y el botón de instalar tienen los tamaños de Modrinth, y la fecha dice solo "Hace 20 días". Los mods muestran además dónde se instalan: "Cliente", "Servidor" o "Cliente y servidor" | Interfaz (pedida en la prueba) |
| `c4d4f81` | `auto-merge.yml` también corría en los forks: al subir esta rama a uno con Actions activo, intentó fusionarla en su `main` y borrarla (solo falló porque ese `main` tenía otra historia). Ahora no corre en forks | Proceso |
| `549c66e` | **Volver al motor anterior podía borrar cuentas.** La vuelta atrás restauraba `accounts.json` desde la copia hecha al actualizar, que puede tener días; una cuenta agregada o un token renovado después se perdían. Ahora se restaura solo si el archivo actual no se puede leer o el motor nuevo cambió su formato | Media (funcional) |
| `2c60ac6` | **El tutorial salía encima de "Preparando Minecraft"** cuando Havi Hub arrancaba sin los archivos del juego (reinstalación, caché borrada). Ahora empieza cuando la bienvenida terminó | Interfaz |
| `b59fb31` | **Compartir un perfil como `.zip` de Prism llevaba los comandos, el Java y las variables de entorno de quien lo exporta** (hallazgo 7): pueden tener un token o la carpeta del usuario. Ahora se dejan afuera, salvo que se marque "Incluir mis comandos y variables de entorno" | Baja-media (privacidad) |
| `9208be3` | La caché de redes (`social.json`) se escribía directamente: quien la leía durante la escritura, o el próximo inicio si Havi Hub se cerraba a la mitad, la encontraba cortada o vacía. Así falló la CI del PR en Ubuntu. Ahora se escribe a un archivo temporal y se renombra | Robustez |
| `a6c94fe` | El informe de "Reparar perfil" y el error "Ruta inválida" salían siempre en español | Traducción |
| `355f1e9` | `auto-merge.yml` fusionaba en `main` y lanzaba una release sin correr las pruebas: ahora corre `npm test` y `npm run build` antes, y si fallan no toca `main` ni la rama. La CI corre también en Windows | Proceso |
| `d037a10` | **12 de las 14 pruebas que fallaban en Windows** no eran fallos de Havi Hub: `make-import-fixtures.mjs` no creaba nada en Windows (comparaba su ruta como `file://D:\…`). Las 2 de los accesos directos de Linux ahora solo corren en Linux. **En Windows ya no falla ninguna** | Pruebas |
| `406ebe6`, `7b6b6eb`, `bc4f75f` | `scripts/e2e.mjs`, `e2e-modrinth.mjs`, `e2e-misc.mjs` y `e2e-welcome.mjs` vuelven a pasar. Fallaban por la hora del día (el filtro "Hoy" de la galería), por Java 25 (ahora el simulador de red responde como Adoptium, así que también se prueba el instalador de Java), por esperas fijas demasiado cortas, por el tutorial tapando la pantalla y por cosas que 1.0.0 cambió (`.mr-prev`, `.ac-filters-btn` repetido) | Pruebas |

**Cómo se probó** (sobre `b7ddee8`):
- 150 pruebas unitarias en Linux: 148 pasan y 2 se omiten (ya lo estaban).
- El nuevo `scripts/e2e-modpack-keys.mjs` pasa con la app real: la pregunta de las teclas y "Mis teclas".
- `npm run build` compila sin errores.
- El nuevo `scripts/e2e-import-settings.mjs` pasa con la app real en Linux (Electron + Xvfb).
- El nuevo `scripts/e2e-redirects.cjs` comprueba las redirecciones dentro de Electron real: falla con el código anterior y pasa con el arreglo.
- Havi probó una versión portable de esta rama en Windows y encontró el fallo de las redirecciones, ya corregido.
- **Pruebas unitarias en Windows** (GitHub Actions, `windows-latest`): en `b7ddee8` fallan 20 de 137; **con esta rama no falla ninguna**. 6 eran de `safepath.js` (`d0ccac8`) y 14 del script que prepara las pruebas (`d037a10`).
- **Las pruebas con la app real** (`scripts/e2e*.mjs`, Linux con Xvfb): de 22 scripts, en `b7ddee8` fallaban 6; con esta rama pasan todos corriéndolos de a uno. `e2e-blocked.mjs` puede fallar si corren varios a la vez en una máquina cargada (la ventana de CurseForge tarda más de 15 s en abrirse); solo pasa.
- Las pruebas del `.mrpack` y del tope de versiones fallan sin la corrección.
- Lo demás de Windows y del juego real lo está probando Havi.

**Cómo se integró con lo nuevo de `b7ddee8`:**
- Las descargas del `.mrpack` usan el `safeRelPath` y el `resolveRelInside` de `safepath.js`.
- El tope de versiones convive con la vuelta atrás: elige qué versión se instala, y la vuelta atrás sigue cubriendo una versión que no arranca.
- El aviso de SHA-256 se agregó a la condición de `skipVersion`.

**Convenciones nuevas que conviene conocer:**
- **Textos del proceso principal:** se escriben como en la interfaz, en español con `{variables}`, mediante `new UserError('…', vars)` y `tr('…', vars)` de `src/shared/usertext.js`. `gen.mjs` los recoge y una prueba falla si alguno queda sin traducción. Ahora `gen.mjs` conserva las traducciones que no encuentra en el código y solo las lista. Está en `CONTRIBUTING.md`.
- **Versión nueva de Prism:** se prueba con `scripts/engine-smoke.mjs` y se sube `TESTED_VERSION` en `src/main/engine.js`. Ya existe `12.0.0-pre1`, así que esto va a hacer falta pronto.

---

## 2. Seguridad

**Lo que está bien:**
- `contextIsolation`, `sandbox` y `nodeIntegration: false` en todas las ventanas.
- Navegación externa bloqueada y webviews de redes sin preload ni permisos.
- CSP estricta (`script-src 'self'`, `frame-src` solo YouTube).
- DOMPurify en las descripciones.
- **`safepath.js`**: nombres planos, sin `..`, unidades, rutas UNC, enlaces simbólicos ni nombres reservados de Windows.
- SHA-1 en los archivos bloqueados de CurseForge y SHA-256 en Java (Adoptium) y en el motor.
- Escape correcto en el script de `pkexec`.

| # | Gravedad | Estado | Hallazgo |
|---|---|---|---|
| 1 | Alta | **Corregido en `b7ddee8`** | El `filename` de los `.pw.toml` se unía a la carpeta sin validar: un modpack con `../` y el id de un mod conocido hacía borrar esa ruta al instalarlo o actualizarlo. `safepath.js` lo resuelve. |
| 2 | Media | Esta rama | `http.download` acepta `file:` (lo necesitan los archivos bloqueados de CurseForge), y las direcciones de un `.mrpack` se le pasaban tal cual. |
| 3 | Baja-media | Esta rama | Un `.zip` de Prism conservaba su `instance.cfg` entero. Los mods de ese zip ya pueden ejecutar código, pero un comando es invisible incluso en un perfil sin mods. |
| 4 | Media | Esta rama, en parte | El motor se actualizaba solo a cualquier versión de Prism, y sin SHA-256 si la API no respondía. `b7ddee8` agrega la vuelta atrás si la versión nueva no arranca; esta rama agrega el tope y la exigencia de SHA-256. El parcheo de `engine-brand.js` sigue quitando la firma de Windows. |
| 5 | Baja | En parte | El IPC no valida argumentos. `app.openPath` y `app.readFile` quedan resueltos en esta rama; **`prism.setSettings` sigue aceptando cualquier ajuste**, incluidos comandos globales. Solo importa si alguien lograra inyectar código en la interfaz. |
| 6 | Baja | Esta rama | El filtro de iframes por expresión regular se podía eludir (`data-src="…youtube.com…"`, `youtube.com.example.net`); la CSP lo bloqueaba igual. |
| 7 | Info | Pendiente | Los tokens de `accounts.json` están en texto plano, como en Prism. La API key de CurseForge se puede extraer del paquete. Exportar un perfil como `.zip` de Prism incluía las variables de entorno y los comandos de quien exporta: **resuelto en esta rama** (`b59fb31`). |
| 8 | Proceso | En parte (`c4d4f81`: ya no corre en forks; `355f1e9`: corre las pruebas antes de fusionar) | **`auto-merge.yml`**: cada push a una rama que no sea `main` se fusiona solo en `main`, borra la rama y lanza `release.yml`, **sin correr las pruebas**. El commit queda con el autor del primer commit de `main`, aunque lo haya escrito otra persona. Los PR desde forks no lo activan; los pushes de cualquiera con escritura en el repositorio sí. **También corría en los forks** con Actions activo, donde fusionaba la rama del colaborador en el `main` del fork y la borraba; `c4d4f81` lo evita. |

---

## 3. Arquitectura y calidad del código

**Puntos fuertes:**
- Módulos claros (`prism/`, `platforms/`, `importers/`, `util/`), con dependencias pasadas por el constructor, y por eso se pueden probar.
- La mayoría de los módulos del proceso principal tienen pruebas; `b7ddee8` suma las de `safepath`, el motor y `features`.
- Tareas cancelables, carpetas `.partial`, y ahora integridad y vuelta atrás del motor.
- Usa los mismos formatos de Prism (incluidos los `.pw.toml`), así que las instancias son compatibles en los dos programas.
- Los comentarios explican el porqué. Compensa en parte que la historia se publique comprimida en un solo commit.

**Lo que conviene cambiar:**

1. **Lógica duplicada entre los dos diseños.**
   - `modrinth/MrContent.jsx` y `pages/instance/ContentTab.jsx` repiten las mismas llamadas y el mismo estado (`content.list`, `enrich`, `checkUpdates`, `setEnabled`, `remove`, `update`…). `b7ddee8` las acercó, pero siguen siendo dos.
   - `browseShared.jsx` ya va por buen camino, y la importación quedó compartida en esta rama (`actions.importArchive`).
2. **`main.js` concentra demasiado.**
   - Tiene ~1.850 líneas, ~25 variables globales y los ~150 métodos del IPC escritos ahí mismo, con lógica de negocio adentro.
   - Es el único módulo grande sin pruebas.
3. **Dependencia de detalles no documentados de Prism:**
   - las opciones de línea de comandos y el formato de los archivos;
   - el inicio de sesión, que se detecta por textos del log (`"Setup wizard was not completed"`);
   - los bytes que `engine-brand.js` reemplaza en el ejecutable.

   La vuelta atrás de `b7ddee8` detecta una versión que no arranca, y `TESTED_VERSION` evita las que nadie probó. Aun así, cada versión nueva de Prism hay que probarla.
4. **Las pruebas no cubren la interfaz.**
   - No hay pruebas unitarias del renderer.
   - Las 22 pruebas end-to-end (`scripts/e2e*.mjs`) no corren en la CI. Pasan en Linux con Xvfb (con esta rama, todas): `scripts/e2e.mjs` tarda varios minutos.
5. **Sin herramientas de estilo:** no hay ESLint, Prettier, `.editorconfig` ni tipos, y muchas líneas pasan los 200 caracteres.
6. **Tamaño:**
   - ~3.700 de ~46.000 líneas de JS, JSX y CSS son extras: temas de temporada, sustos, fuegos artificiales y redes.
   - `pages.css` tiene ~5.400 líneas y `mr.css`, ~2.800.

---

## 4. Comparación con Prism Launcher

Usar Prism como motor fue una buena decisión: da gratis lo más difícil (lanzar el juego, cargadores de mods, inicio de sesión de Microsoft). El costo es que la interfaz de Prism está oculta, así que todo lo que Prism hace desde sus ventanas hay que reconstruirlo en Havi Hub.

| Función | Havi Hub | Prism |
|---|---|---|
| Búsqueda unida de CurseForge y Modrinth, sin duplicados | Sí | No |
| Sincronizar carpetas con la app de CurseForge y la de Modrinth | Sí | No |
| Directorio público de servidores con ping | Sí | No |
| Diagnóstico de logs en palabras simples (nuevo) | Sí | No |
| Importar desde la app de CurseForge y la de Modrinth (con ajustes y tiempo jugado) | Sí | Limitado |
| Instalar mods y modpacks, dependencias, actualizaciones, elegir versión | Sí | Sí |
| Java automático por perfil (Temurin, nuevo) | Sí | Sí |
| **Actualizar un modpack instalado** | **No** | Sí (la app de Modrinth y la de CurseForge también) |
| Editor de componentes (jar mods, agentes Java, LWJGL) | No | Sí |
| Modpacks de ATLauncher, FTB y Technic | No | Sí |
| Crear perfiles con LiteLoader | No | Sí |
| macOS | No (`dist:mac` existe, sin probar) | Sí |
| Idiomas | es, en | Muchos (Weblate) |

---

## 5. Recomendaciones pendientes, por prioridad

Ya resueltas en esta rama, de la primera versión de esta lista: la vuelta atrás que pisaba `accounts.json` (`549c66e`), las pruebas antes de fusionar en `main` (`355f1e9`), las variables y comandos al exportar (`b59fb31`), las pruebas que fallaban en Windows y las de la app real (`d037a10`, `406ebe6`, `7b6b6eb`, `bc4f75f`), y los textos sin traducir (`a6c94fe`).

1. **Actualizar modpacks instalados**, de CurseForge y Modrinth. La información ya se guarda en `instance.cfg` (`ManagedPack*`). Es la carencia más visible frente a Prism y a las apps oficiales.
2. **Compartir la lógica entre diseños:** un hook como `useInstanceContent` para `ContentTab` y `MrContent`, y lo mismo para Inicio, Biblioteca e Instancia. Conviene hacerlo antes de agregar funciones grandes.
3. **Dividir `main.js`** en archivos `ipc/<tema>.js` y validar los argumentos de cada método (cierra el hallazgo 5, `prism.setSettings`).
4. **Cuentas mientras el juego corre:** el motor guarda sus cuentas desde memoria y podría pisar una cuenta agregada en Havi Hub en ese rato. Hay que probarlo con el juego real.
5. **CI:** correr al menos `scripts/e2e.mjs` con Xvfb (ahora pasa entero) y agregar ESLint y Prettier. `auto-merge.yml` sigue poniendo como autor del commit al dueño del primer commit de `main`, aunque lo haya escrito otra persona.
6. **Funciones que faltan frente a Prism:** editor de versión avanzado, ATLauncher, FTB y Technic, y macOS.

**Lo que salió de la prueba de Havi en Windows:**

- **Teclas que no se aplicaban y la pantalla "Welcome to Minecraft… Narrator":** eran la misma causa, el `options.txt` sin `version:`. Corregido en `6b64541`. Los perfiles creados antes conservan las opciones por defecto que guardó Minecraft; para ellos sirve "Aplicar las teclas a todos los perfiles" (Ajustes → Minecraft → Teclas). En perfiles nuevos la pantalla de bienvenida sigue saliendo una vez, como en cualquier instalación nueva de Minecraft, salvo que el `options.txt` ya diga `onboardAccessibility:false`.
- **Teclas en modpacks que traen su propio `options.txt`:** ahora se pregunta (`0a3221c`).
- **La skin no se ve en un mundo de un jugador, pero sí en Hypixel:** en el log, Minecraft pidió el perfil a `sessionserver.mojang.com` y Mojang respondió **429** ("Service unavailable", demasiadas peticiones). Sin esa respuesta el juego usa la skin por defecto; en un servidor se ve porque la manda el servidor. Havi Hub no consulta ese servidor al lanzar el juego (solo al importar la skin de otro jugador por nombre), así que no viene de Havi Hub. Conviene probar con un perfil sin mods y sin VPN, y esperar un minuto entre lanzamientos.
- **La prueba del error en inglés con una cuenta offline no sirve:** el campo no deja escribir menos de 3 caracteres. El error de CurseForge que vio Havi sí salió en inglés.

**A considerar (opinión, no errores):**
- Los sustos de Halloween (sonido fuerte y destellos) tienen aviso y se pueden desactivar, pero siguen siendo un riesgo para personas fotosensibles.
- El diseño "estilo CurseForge" imita de cerca una app propietaria (Overwolf). Basarse en la de Modrinth (GPL-3.0) tiene menos riesgo de imagen.

---

## 6. Lo que falta comprobar

- Todo lo de esta rama en **Windows**: los junctions de la sincronización, el instalador y el ayudante `havihub-windows.exe`.
- Con el **juego real**: el inicio de sesión de Microsoft, el lanzamiento y el punto 4 de las recomendaciones.
- Que `TESTED_VERSION = '11.1.1'` es la versión con la que se probó `b7ddee8`. Si se probó con otra, hay que ajustarla.
