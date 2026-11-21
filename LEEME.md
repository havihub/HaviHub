# Havi Hub: launcher de Minecraft con diseño de CurseForge o de Modrinth (sin anuncios)

Havi Hub es un launcher completo para Windows y Linux:

- Tiene **dos diseños** y tú eliges cuál: el de **CurseForge** o el de **Modrinth**. Los dos tienen todas las funciones (punto 3).
- Tiene **su propia carpeta** de perfiles, cuentas y skins.
- Su **motor de juego** se basa en **Prism Launcher** (código abierto). Havi Hub lo descarga solo desde las versiones oficiales y le pone **el nombre y el ícono de Havi Hub**: sus ventanas (consola, agregar cuenta, etc.) dicen "Havi Hub".
- **Cada vez que abres Havi Hub**, revisa en segundo plano si salió una versión nueva del motor y la instala sola, si ya se probó con tu versión de Havi Hub (una versión de Prism Launcher más nueva espera a una actualización de Havi Hub que la haya probado). Si estás jugando, la nueva versión se activa cuando cierras el juego.
- No necesitas tener Prism Launcher instalado. Si igual lo usas, puedes **sincronizar los perfiles** con él, con CurseForge y con la app de Modrinth, todo desde **Sincronizar perfiles** (punto 11).

---

## 1. Requisitos

1. **Windows 10 u 11** (64 bits) o **Linux** de 64 bits (Ubuntu, Debian, Mint, Fedora, Arch…).
2. Internet la primera vez (Havi Hub descarga su motor, unos 45 MB).
3. Una cuenta de Microsoft que tenga Minecraft Java Edition.

## 2. Instalar o actualizar

### Windows

1. Descarga `HaviHub-1.0.0-Setup.exe` y haz doble clic en él (si aparece "Windows protegió su PC": **Más información** → **Ejecutar de todas formas**).
2. No tienes que elegir nada ni dar permisos de administrador: en unos segundos Havi Hub se abre solo, con la bienvenida (punto 3).
3. Desde ahora está en el **menú Inicio** (escribe "Havi Hub"), en el **escritorio** y en **Aplicaciones instaladas**.

Para actualizar, descarga el instalador nuevo y ábrelo de la misma forma. Si Havi Hub está abierto, el instalador te avisa y lo cierra (presiona **Aceptar**). Se conservan tus perfiles, cuentas, ajustes y el diseño que elegiste.

Para comprobar la versión: abre **Ajustes** y mira abajo a la izquierda. Dice **"v. 1.0.0 · instalada"**.

**Anclar a la barra de tareas (opcional):** menú Inicio → clic derecho en **Havi Hub** → **Anclar a la barra de tareas**.

### Linux: AppImage (sirve en cualquier distribución)

1. Descarga `HaviHub-1.0.0-linux-x86_64.AppImage`.
2. Dale permiso para ejecutarse. Con el mouse: clic derecho → **Propiedades** → **Permisos** → marca **"Permitir ejecutar el archivo como un programa"**. Con la terminal, en la carpeta donde está:
   ```
   chmod +x HaviHub-1.0.0-linux-x86_64.AppImage
   ```
3. Ábrelo con doble clic, o en la terminal:
   ```
   ./HaviHub-1.0.0-linux-x86_64.AppImage
   ```
4. Al abrirlo, Havi Hub se agrega solo a tu **menú de aplicaciones** (`~/.local/share/applications/havihub.desktop`). Desde ahora lo abres como cualquier otra aplicación.
5. Si después mueves el archivo a otra carpeta, ábrelo una vez desde la nueva ubicación y el menú se actualiza solo.

> **Si no abre y dice algo de FUSE o `libfuse.so.2`**: instala FUSE 2. En Ubuntu 24.04: `sudo apt install libfuse2t64`. En Ubuntu 22.04 y Debian: `sudo apt install libfuse2`. En Fedora: `sudo dnf install fuse-libs`. En Arch: `sudo pacman -S fuse2`.

**Para todos los usuarios del PC (opcional):** **Ajustes → Launcher → Menú de aplicaciones → Instalar para todos**. Copia Havi Hub a `/opt/havihub` y lo agrega a `/usr/share/applications`. Te pide la contraseña de administrador.

### Linux: paquete .deb (Ubuntu, Debian, Mint, Pop!_OS)

1. Descarga `HaviHub-1.0.0-linux-amd64.deb`.
2. Abre una terminal en esa carpeta y escribe:
   ```
   sudo apt install ./HaviHub-1.0.0-linux-amd64.deb
   ```
3. Listo: aparece en el menú de aplicaciones (`/usr/share/applications/havihub.desktop`) para todos los usuarios.
4. Para actualizar, instala el `.deb` nuevo de la misma forma. Para desinstalar: `sudo apt remove havihub`.

> En Linux tus perfiles, cuentas y ajustes están en `~/.config/havihub`. Desinstalar no los borra. El paquete se instala en `/opt/havihub`.

### Desinstalar (Windows)

1. Abre **Configuración → Aplicaciones → Aplicaciones instaladas** (en Windows 10: **Aplicaciones y características**).
2. Busca **Havi Hub** → **⋯** → **Desinstalar**, y confirma.
3. Se borran la app y su motor. **Tus perfiles, mundos, cuentas y ajustes se conservan** en `%APPDATA%\havihub`. Si quieres borrar todo, elimina esa carpeta a mano.

### Sin instalar (Windows, opcional)

- `HaviHub-1.0.0-portable.exe`: un solo archivo, se abre con doble clic.
- `HaviHub-1.0.0-win-x64.zip`: clic derecho → **Extraer todo…** → abre **Havi Hub.exe**.

## 3. La bienvenida (la primera vez que lo abres)

La primera vez, Havi Hub muestra una bienvenida que ocupa toda la ventana y te acompaña en unos pocos pasos antes de entrar:

1. **Te damos la bienvenida a Havi Hub**: presiona **Empezar**.
2. **¿Cómo quieres organizar Havi Hub?**: elige el diseño (se explica abajo) y presiona **Continuar**.
3. **¿Qué hace la X de la ventana?**: elige **Dejarlo en la bandeja** o **Cerrarlo del todo** (punto 5) y presiona **Continuar**.
4. **Las redes de Havikun en Inicio**: **Cargarlas solas** (recomendado; apenas abres Havi Hub ves sus últimos videos y si está en vivo) o **Solo cuando abra una** (siguen en Inicio, pero no se conectan a YouTube, Twitch ni Linktree hasta que abras una). Presiona **Continuar**. Mientras no respondas, las redes no se cargan; después puedes cambiarlo en **Ajustes → Privacidad**.
5. **Crea tu primera instancia**:
   - **Crear una instancia**: eliges la versión de Minecraft y, si quieres, un cargador de mods (Fabric, Forge, NeoForge o Quilt), y presionas **Crear**.
   - **Traer mis instancias**: las copia desde CurseForge, Modrinth o Prism Launcher (punto 4). Si Havi Hub encontró alguna en tu PC, te dice cuántas.
6. **Preparando Minecraft** (solo si hace falta): si en tu PC no hay ningún Minecraft descargado, Havi Hub baja una vez los archivos del juego desde Mojang (unos 30 MB) para mostrar el logo de Minecraft y el bloque de pasto originales. Si no hay internet, presiona **Reintentar** cuando vuelva (también lo intenta solo cada 20 segundos).

Si cierras Havi Hub a mitad de camino, la próxima vez sigue en el paso donde quedaste.

| Diseño | Cómo se ve |
|---|---|
| **Estilo CurseForge** | Pestañas arriba (Mis modpacks, Descubrir, Explorar, Servidores, Capturas, Skins) y la barra de juegos a la izquierda, con el naranjo de CurseForge. |
| **Estilo Modrinth** | Una barra de íconos a la izquierda (Inicio, Descubrir contenido, Skins, Capturas, Servidores y tus perfiles recientes), la página en un panel redondeado y a la derecha tu cuenta, tus descargas y las **redes de Havikun** (Linktree, YouTube, Twitch, Instagram, X y TikTok; cada una se despliega para ver lo último). Usa el verde original de Modrinth. |

Los dos tienen **todas** las funciones; solo cambia dónde está cada cosa. Para cambiarlo después: **Ajustes → Temas → Diseño**. Al cambiar de diseño se pone el tema original de ese diseño (después puedes elegir otro color en **Temas predefinidos**, también hay **Modrinth OLED** y **Modrinth claro**).

**Dónde está cada cosa en el diseño Modrinth:**

- **Inicio** (el botón ▶ de arriba a la izquierda): **Volver a jugar**, **Modpacks populares** y tu **Biblioteca** con grupos, búsqueda, **Ordenar**, **Agrupar**, **Nuevo grupo**, **Importar** y **Crear instancia**.
- **Un perfil**: arriba **Jugar** (la flechita al lado elige mundo o servidor), el engranaje abre sus opciones y **⋮** tiene todo lo demás. Abajo están las pestañas **Contenido**, **Mundos**, **Registros** y **Capturas**.
- **Ajustes**: el engranaje de abajo a la izquierda. Se abren en una ventana encima de la página (ciérrala con la **X** o con **Esc**).
- **Cuenta**: tu avatar abajo a la izquierda, o **Jugando como** en la columna derecha.
- **Descargas**: la flechita de arriba a la derecha.

## 4. Traer tus perfiles de otro launcher (CurseForge, Modrinth o Prism Launcher)

Es **una sola opción** y eliges de dónde: de uno, de dos o de los tres a la vez.

1. Ve a **Importar → Desde otro launcher…** (en CurseForge: **Mis modpacks → Importar**; en Modrinth: **Inicio → Biblioteca → Importar**). También está en Ajustes → Launcher y en la bienvenida del primer inicio.
2. Havi Hub busca solo **CurseForge**, **Modrinth** y **Prism Launcher** en tu PC y muestra cuántos perfiles tiene cada uno.
3. Marca los launchers que quieras (vienen marcados los que encontró).
   - ¿Alguno está en otra carpeta? Usa **"¿Tu … está en otra carpeta?"** y elige su carpeta.
4. Presiona **Continuar**.
5. Marca los perfiles que quieres traer (los que ya tienes con el mismo nombre vienen sin marcar).
6. Revisa las opciones:
   - **Mantener los grupos**.
   - **Importar cuentas**, **skins** y **ajustes** (solo de Prism Launcher): sus ajustes de Java, memoria, argumentos, variables de entorno y comandos pasan a los de Havi Hub.
   - **Reusar los archivos del juego que esos launchers ya descargaron**: el primer inicio es mucho más rápido.
   - **Prism Launcher: mover en vez de copiar**: más rápido, pero los perfiles dejan de estar en Prism Launcher. Si no estás seguro, déjalo sin marcar.
7. Presiona **Importar N perfiles**. Se copian con sus mundos, mods, imagen y tiempo jugado, y con sus ajustes de inicio: memoria, Java, argumentos, variables de entorno, resolución y comandos. Los originales no se tocan.

> Los mods que vienen de CurseForge o Modrinth siguen sabiendo de qué proyecto son, así que puedes actualizarlos desde Havi Hub. Los ajustes generales de la app de Modrinth (memoria, argumentos, variables y comandos) también se traen, dentro de cada perfil. La app de CurseForge no guarda los suyos en un archivo que otros programas puedan leer, así que de ella se traen solo los de cada perfil.

**Si cierras Havi Hub con la X mientras importa, instala o descarga algo**, te pregunta qué hacer:

- **Seguir aquí**: no cierra nada.
- **Seguir en segundo plano** (solo si usas la bandeja): se esconde y termina el trabajo.
- **Detener y cerrar**: detiene el trabajo, borra lo que quedó a medias (por ejemplo, un modpack que se estaba instalando) y cierra Havi Hub.

Lo único que no se puede cortar a medias es mover carpetas (al compartir o sincronizar perfiles): en ese caso Havi Hub espera a que termine y se cierra solo.

## 5. Jugar

1. **CurseForge**: pasa el mouse sobre un perfil: la imagen queda en su lugar con un degradado suave arriba, y abajo aparecen **Jugar** y la **flecha**. **Modrinth**: pasa el mouse sobre la tarjeta y aparece el botón **▶**, o usa **Jugar** en **Volver a jugar**.
2. **Jugar** inicia el juego. Mientras se prepara, el botón dice **"Iniciando…"**.
3. La **flecha** muestra tus mundos y servidores para entrar directo a uno.
4. Las ventanas del motor (inicio de sesión, progreso, consola) se llaman **Havi Hub** y llevan el logo de Havi Hub.

### Variables de entorno (para un perfil o para todos)

Sirven para cosas como usar la tarjeta gráfica NVIDIA en un portátil con Linux o forzar una opción de los drivers.

**Para un perfil:**
1. Clic derecho en el perfil (o su menú **⋮**) → **Opciones del perfil** → **Al iniciar**.
2. En **Variables de entorno**, activa **Personalizado**.
3. Presiona **Añadir variable** y escribe el **nombre** y el **valor**, por ejemplo `__NV_PRIME_RENDER_OFFLOAD` = `1`.
4. Presiona **Guardar**. Se usan la próxima vez que inicies ese perfil.

**Para todos los perfiles:** **Ajustes → Java y memoria** → **Variables de entorno**. Se guardan solas al salir de cada casilla.

> Un perfil con **Personalizado** usa sus propias variables en lugar de las de todos. El nombre no puede llevar espacios ni `=`; si algo no sirve, lo marca en rojo.

### Java y memoria (para todos los perfiles)

En **Ajustes → Java y memoria** está todo lo que usa el juego al iniciar: la **memoria** (mueve el control o escribe los MB en la casilla), las **versiones de Java**, los **argumentos**, los **comandos personalizados**, las **variables de entorno**, las **librerías nativas** (GLFW y OpenAL del sistema, con la ruta de cada una si no está en el lugar habitual), los arreglos para **versiones antiguas** y, en Linux, **GameMode**, **MangoHud**, la **tarjeta gráfica dedicada** y **Zink**. Cada perfil puede cambiar cualquiera de estos en **Opciones del perfil**.

### Si el juego se cierra por un error

Si el juego se cae o no logra iniciar, Havi Hub vuelve al frente, te avisa y abre el registro del perfil (la pestaña **Logs**; en el diseño de Modrinth, **Registros**) con el archivo que explica el error (el informe de error del juego, si lo hay). Ahí puedes subirlo con un clic para pedir ayuda. Si cierras el juego tú, aunque sea a la fuerza, no pasa nada de esto.

### Acceso directo a un perfil

1. Clic derecho en el perfil (o su menú **⋮**) → **Crear acceso directo**.
2. Se crea con el nombre y el ícono del perfil:
   - **Windows**: en el escritorio.
   - **Linux**: en el escritorio (`~/Desktop` o `~/Escritorio`) y en el menú de aplicaciones (`~/.local/share/applications`).
3. Al abrirlo se abre **Havi Hub** (no Prism Launcher) y **el perfil empieza a jugar solo**. Si Havi Hub ya estaba abierto, usa esa misma ventana.

> En algunos escritorios de Linux, la primera vez que abres el acceso directo del escritorio te pregunta si confías en él: elige **Confiar y ejecutar** (o **Permitir ejecutar**).

### Qué hace la X de la ventana

Se elige en la bienvenida del primer inicio:

- **Dejarlo en la bandeja**: la X esconde Havi Hub junto al reloj. Sigue abierto y vuelve con un clic en su ícono. Para salir del todo: clic derecho en el ícono → **Salir de Havi Hub**.
- **Cerrarlo del todo**: la X cierra Havi Hub como cualquier programa.

Para cambiarlo después: **Ajustes → Launcher → Comportamiento → Al cerrar la ventana → "Al cerrar con la X, dejar Havi Hub en la bandeja"**.

### Qué hace Havi Hub al iniciar el juego (por ejemplo, esconderse de Alt+Tab)

1. Abre **Ajustes → Launcher → Comportamiento → Al iniciar el juego**.
2. En **Havi Hub**, elige una opción:
   - **Sigue abierto**.
   - **Se minimiza**.
   - **Se esconde en la bandeja hasta que cierres el juego**: queda junto al reloj, sin aparecer en Alt+Tab ni en la barra de tareas, y vuelve solo cuando cierras el juego. Si lo necesitas antes, haz clic en su ícono junto al reloj (en Windows, si no lo ves, abre la flechita **^**).
   - **Se cierra**.
3. Tras **un minuto** escondido en la bandeja, Havi Hub guarda su ventana y **le deja esa memoria al juego** (unos 130 MB menos). Al volver tarda un segundo y abre en la misma página. Las descargas y el juego siguen igual. Para apagarlo: **Ajustes → Launcher → Comportamiento → Al cerrar la ventana → "Liberar memoria mientras está en la bandeja"**.

## 6. Los mods, shaders y demás de un perfil

### Mosaico, tabla o lista

1. En el contenido del perfil, presiona el botón **Vista** (a la derecha, junto a la lupa).
2. Elige **Mosaico** (tarjetas con imagen), **Tabla** (columnas que se pueden ordenar) o **Lista** (con descripción, categorías y descargas).
3. La vista que elijas queda para todos los perfiles.

Lo que tiene una **actualización** aparece siempre arriba de la lista. Para buscar, presiona la **lupa**: el buscador se abre hacia la izquierda.

### Abrir la página de un mod

Haz clic en el **nombre** de cualquier mod, resource pack, shader o data pack del perfil: se abre su página (descripción, versiones y galería). Si el archivo lo agregaste a mano y no está en CurseForge ni en Modrinth, Havi Hub te lo dice.

### Cambiar de versión (más nueva o más antigua)

1. En la fila del mod presiona el botón **⇄** (**Cambiar versión**), o clic derecho / **⋮** → **Cambiar versión…**
2. A la izquierda ves las versiones que funcionan con tu perfil (versión de Minecraft y cargador). Arriba puedes buscar por nombre y activar **Mostrar incompatibles** para ver todas.
3. Cada versión dice si es **Release**, **Beta** o **Alpha**, y tiene marcas:
   - **Actual**: la que tienes.
   - **Anterior**: la que usabas **antes de actualizar**.
4. Haz clic en una para ver sus **notas de cambios** a la derecha.
5. Presiona **Cambiar a …**. Si el mod estaba desactivado, sigue desactivado.

> Cuando actualizas un mod, en su fila aparece **"Antes: 1.2.3"** con la versión que tenías. Haz clic ahí para volver a ella.

### Actualizar todo eligiendo qué

1. Presiona **Actualizar todo**.
2. Se abre **Actualizar proyectos** con la lista de lo que tiene versión nueva: **todos vienen marcados**.
3. Desmarca los que **no** quieras actualizar (o vuelve a marcarlos). Con **Ver** lees las notas de cambios de cada uno.
4. Presiona **Actualizar N proyectos**.

## 7. Agregar mods, resource packs, shaders, data packs y mapas a un perfil

1. Abre un perfil → **Agregar contenido** (en Modrinth: **Explorar contenido**).
2. Arriba ves el perfil y una búsqueda grande.
3. **Vienen puestos los filtros de ese perfil**, y puedes quitarlos:

   | Tipo | Filtros que vienen puestos |
   |---|---|
   | **Mods** | La **versión exacta** del perfil y **su cargador** (Fabric, Forge, NeoForge, Quilt). |
   | **Data packs** | La versión exacta del perfil (cambian mucho entre versiones). |
   | **Shaders** | Ninguno de versión; necesitan un perfil con cargador (Iris, Oculus u OptiFine). |
   | **Resource packs** | Ninguno: los antiguos también funcionan. |
   | **Mapas** | La versión del perfil **o anteriores** (el juego actualiza los mundos antiguos). |

4. Para quitar un filtro, presiona la **x** de su etiqueta (o **Ver todos**). Para volver a los del perfil: **Restablecer filtros**.
5. Lo que **no sirve en ese perfil no se puede instalar**: su botón dice **No compatible** y, al pasar el mouse, explica por qué (por ejemplo, "Este mod no tiene versión para 1.21.8 con Fabric").
6. Un perfil **vanilla** (sin cargador) **no acepta mods ni shaders**, ni desde el perfil ni desde **Descubrir**: solo resource packs, data packs y mapas.
7. Presiona **Instalar** en el que quieras. Cuando termina, dice **Instalado**. Havi Hub elige la versión que corresponde a tu perfil.
8. Para volver al perfil: en CurseForge, la **X** de arriba a la derecha; en Modrinth, la flecha **←**.

### Instalar desde Descubrir (sin abrir un perfil)

1. Presiona **Instalar** en un mod, shader, etc. En el diseño CurseForge, el botón aparece al pasar el mouse por la tarjeta.
2. Aparece la lista de **tus perfiles compatibles**: elige uno.
3. Los que no sirven están abajo, en **No compatibles**, con el motivo de cada uno.
4. Si ninguno sirve, presiona **Crear un perfil compatible**: Havi Hub propone la versión y el cargador correctos y lo instala ahí.

### Mods que su autor solo deja descargar desde CurseForge

Algunos autores no permiten que otros programas descarguen sus archivos. Havi Hub lo resuelve solo, en este orden:

1. Busca **el mismo archivo** en Modrinth (lo comprueba byte por byte). Si está, lo baja de ahí y no ves nada.
2. Si no, abre **la página oficial de descarga de CurseForge** en una ventana de Havi Hub. La descarga empieza sola en unos segundos y queda instalada en el perfil. Si la página te pide algo (por ejemplo, confirmar que no eres un robot), hazlo ahí.
3. Si prefieres tu navegador, presiona **Usar mi navegador**: se abre la página de cada archivo; lo descargas y Havi Hub **lo encuentra en tu carpeta de Descargas** y lo instala solo.
4. En un modpack con varios archivos así, verás la lista con el avance (**"2 de 5 listos"**). Puedes **Detener** y **Reintentar** después.

> Los **mapas** de CurseForge se instalan directo en el perfil. Los **data packs** te dejan elegir en qué mundo se instalan ("Instalar en:").

## 8. Grupos

En el diseño CurseForge, cada grupo es un mosaico grande con las imágenes de sus perfiles, o con la imagen que le pongas.

### Ponerle una imagen a un grupo

1. Presiona el menú **⋮** del grupo (en Modrinth: **⋯**, a la derecha del nombre del grupo) → **Cambiar imagen…**
2. Elige un **Fondo** y un **Símbolo**, o presiona **Usar una imagen propia…** (igual que los íconos, punto 9).
3. Presiona **Guardar ícono**. Para volver a las imágenes de sus perfiles: **⋮** → **Quitar imagen**.

La imagen se guarda en Havi Hub y se mantiene si cambias el nombre del grupo.

### Mover perfiles entre grupos

1. **Mantén apretado el clic** sobre un perfil y arrástralo.
2. Suéltalo:
   - **sobre otro grupo** para moverlo ahí;
   - en la barra **"Suelta para mover"** que aparece abajo mientras arrastras: **Mis modpacks (sin grupo)** (en Modrinth: **Sin grupo**) lo **saca del grupo**, y cada grupo lo mueve ahí;
   - también sirve soltarlo en la pestaña **Mis modpacks** (CurseForge) o en el botón **Inicio** (▶, Modrinth) para sacarlo del grupo.
3. Un aviso abajo te confirma dónde quedó.

## 9. Íconos e imágenes de tus perfiles

### Cambiar ícono

1. Clic derecho en el perfil (o su menú **⋮**) → **Cambiar ícono…** Al **crear** un perfil: haz clic en el ícono o en **Cambiar ícono**.
2. A la izquierda ves cómo queda en tres tamaños, el botón **Aleatorio** y tus **Recientes**.
3. A la derecha elige un **Fondo** (la fila se desliza con la rueda del mouse) y un **Símbolo**.
4. Presiona **Guardar ícono**. También se ve en Prism Launcher.

Los símbolos son **bloques y objetos de Minecraft** (138: bloque de pasto, dinamita, espadas, perla de ender…), con las texturas del propio juego sobre el fondo de color.

> **De dónde salen las texturas:** Havi Hub las lee del **Minecraft que ya está en tu PC** (el archivo del juego que se descarga para jugar). Si todavía no hay ningún Minecraft descargado (o solo uno anterior a 1.13), baja ese archivo una vez desde los servidores de Mojang (unos 30 MB) antes de entrar, en el paso **Preparando Minecraft** de la bienvenida. Havi Hub no trae texturas de Mojang dentro del instalador.

### Usar tu propia imagen, sin perder calidad

1. En la misma ventana de **Cambiar ícono…**, presiona **Usar una imagen propia…**
2. Elige o arrastra la imagen. Puedes **Recortar** o **Encajar** y hacer zoom.
3. Presiona **Guardar**. Una imagen cuadrada de 3840×3840 se guarda **igual, byte por byte**; si la recortas, se guarda al tamaño real del recorte, sin comprimir.

## 10. Compartir un perfil con tus amigos

1. Clic derecho en el perfil (o **⋮**) → **Compartir perfil**.
2. Elige el formato:
   - **CurseForge (.zip)**: el formato de la app de CurseForge. Tus amigos lo abren en CurseForge con **Crear perfil personalizado → Importar → Archivo .zip**, o en Havi Hub y Prism Launcher. Los mods, resource packs y shaders de CurseForge van como enlaces (el archivo pesa poco); lo demás (configuración y archivos de otras fuentes) va dentro del .zip.
   - **Modrinth (.mrpack)**: se abre en la app de Modrinth, Prism Launcher, Havi Hub y otros launchers.
   - **Prism (.zip)**: una copia completa del perfil para Prism Launcher o Havi Hub.
3. Pon nombre, versión y autor, y marca **Incluir mundos** si quieres que vayan tus mundos.
4. Presiona **Exportar** y elige dónde guardarlo.

> **¿Y el código de CurseForge?** Los códigos de perfil los crea solo la app de CurseForge, con tu cuenta, y duran 7 días; CurseForge no deja que otras apps los creen. Para compartir con código: importa el `.zip` en CurseForge y usa **Compartir perfil** ahí.

## 11. Sincronizar perfiles con Prism Launcher, CurseForge y Modrinth

Todo se hace en una sola ventana: **Ajustes → Launcher → Sincronizar perfiles → Sincronizar perfiles…**

Un perfil sincronizado usa **una sola carpeta** en todos los launchers: juegas en Prism Launcher, CurseForge, Modrinth o Havi Hub y los mundos, mods y ajustes son los mismos. Cada launcher conserva sus cuentas y su configuración.

### Prism Launcher (todos los perfiles a la vez)

Havi Hub y Prism Launcher usan **la misma carpeta de perfiles**. **El motor, las cuentas y los ajustes de cada launcher siguen separados.**

1. En **Sincronizar perfiles…**, en la parte de **Prism Launcher**, presiona **Compartir**.
2. Elige tu Prism Launcher (Havi Hub lo busca solo; si no aparece, **Elegir carpeta…**).
3. Marca los perfiles de Havi Hub que quieres pasar a la carpeta compartida. Los que no marques quedan guardados en Havi Hub y vuelven si dejas de compartir.
4. Presiona **Compartir perfiles**.

> No abras **el mismo perfil** en Havi Hub y en Prism Launcher al mismo tiempo.

Para dejar de compartir: **Dejar de compartir**, en la misma ventana. Los perfiles compartidos siguen en Prism Launcher.

### CurseForge y la app de Modrinth (perfil por perfil)

1. **Cierra CurseForge y la app de Modrinth** (si están abiertos, Havi Hub te avisa).
2. En **Sincronizar perfiles…** verás tres listas:
   - **Parecen el mismo perfil**: el mismo nombre, versión y cargador en dos o más launchers. Marca los que quieres juntar, elige cuál pone **sus mods y ajustes** y presiona **Sincronizar**. Los mundos, capturas y paquetes de recursos de todos se juntan; nada se borra (lo que no quepa queda en una copia de respaldo dentro de la carpeta compartida).
   - **Perfiles de CurseForge y Modrinth**: presiona **Traer a Havi Hub sincronizado** y el perfil aparece en Havi Hub **sin copiarlo** (usa la misma carpeta).
   - **Sincronizados**: lo que ya está unido. **Dejar de sincronizar** le devuelve a ese launcher su propia copia completa.
3. Para que un perfil de Havi Hub aparezca en CurseForge o Modrinth: crea ahí un perfil con la **misma versión y cargador**, y vuelve a **Sincronizar perfiles…** para unirlos.

> Los perfiles sincronizados con CurseForge y Modrinth viven en la carpeta de datos de Havi Hub (`%APPDATA%\havihub\launcher\synced` en Windows, `~/.config/havihub/launcher/synced` en Linux). Desinstalar Havi Hub **no** la borra. Si borras un perfil en un launcher, solo se quita su enlace: los demás siguen teniendo todo.

En **Ajustes → Launcher → Sincronizar perfiles** ves un resumen de lo que está sincronizado.

## 12. Capturas de todos tus perfiles

1. Abre **Capturas** (CurseForge: pestaña de arriba; Modrinth: el ícono de imagen a la izquierda).
2. Están todas tus capturas (F2 en el juego), agrupadas por día: **Hoy**, **Ayer**, y luego la fecha.
3. Filtra con los menús de arriba: **instancia**, **grupo**, **versión de Minecraft**, **fecha** (hoy, últimos 7 o 30 días, este año o un mes en particular) y **orden** (más recientes o más antiguas primero).
4. Haz clic en una para verla en grande. Muévete con **← →** (o las flechas de los lados).
5. Arriba, a la derecha, están los botones con su nombre: **Copiar** (la deja en el portapapeles para pegarla con Ctrl+V), **Carpeta** (la muestra en su carpeta), **Abrir** (con el visor de fotos del sistema), **Eliminar** (también con **Supr**) y **Cerrar** (también con **Esc**). A la izquierda, el nombre del perfil te lleva a él.

## 13. Servidores

### Descubrir servidores
1. Abre **Servidores → Descubrir**. Arriba están los servidores más conocidos (Hypixel, CubeCraft, UniversoCraft, LibreCraft y otros; con Havi Hub en español, los de habla hispana primero) y después la lista de servidores de Modrinth. Un servidor que está en las dos aparece **una sola vez**.
2. Cada servidor muestra jugadores conectados, la **latencia medida desde tu PC** (verde, amarilla o roja) y, si los tiene, cuántas veces se jugó en 2 semanas, región, categorías y su **modpack**. En los conocidos, el ícono junto a la dirección **copia la IP**.
3. Filtra a la izquierda: solo en línea, orden, tipo (vanilla o con modpack), versión, región, idioma y categorías. Los servidores conocidos no dicen su versión, región ni categorías: con esos filtros puestos no aparecen.
4. **Jugar**:
   - servidor vanilla: eliges con qué perfil entrar o creas uno nuevo con la versión que recomienda el servidor (en los conocidos, una versión reciente de Minecraft);
   - servidor con modpack: Havi Hub instala ese modpack (o usa el que ya tienes).
   Antes de empezar, Havi Hub te dice qué va a pasar (qué modpack instala y con qué perfil se abre el juego). El servidor queda en la lista de multijugador de ese perfil y el juego entra directo.
5. **+** agrega el servidor a la lista de multijugador del perfil que elijas, sin abrir el juego.

Las direcciones de los servidores pueden cambiar con el tiempo: si uno aparece sin conexión durante días, revisa la dirección en su página web.

### Mis servidores
Los servidores guardados en todos tus perfiles, con **Entrar**, editar y quitar.

## 14. Temas

### Tamaño de la interfaz
**Ajustes → Temas → Tamaño de la interfaz**: mueve el control y **suelta**. El tamaño nuevo se aplica al soltar (mientras arrastras, solo ves el número).

### OLED
**Ajustes → Temas → OLED** (o **Modrinth OLED** en el diseño Modrinth): negro puro donde no hay contenido (en pantallas OLED esos píxeles se apagan).

### Temas de temporada (se ponen solos, en los dos diseños)
| Tema | Cuándo | Qué trae |
|---|---|---|
| **Halloween** | 25 de octubre al 1 de noviembre | Colores de noche, **calabazas y murciélagos de Minecraft**, la luna del juego y un paisaje de bloques |
| **Navidad** | 19 al 26 de diciembre | Luces, **la nevada de Minecraft**, un **trineo con renos** que cruza la ventana y pinos nevados |
| **Año Nuevo** | 27 de diciembre al 2 de enero | Cuenta regresiva, **el reloj de Minecraft marcando tu hora** y **fuegos artificiales del juego al llegar las 00:00** (sus chispas, su cohete y sus sonidos) |

- Cada uno se adapta al diseño que uses: en Modrinth los colores salen de la paleta de Modrinth, y los adornos van en su barra de arriba y en su barra de íconos.
- El primer día te aparece un aviso que dice dónde apagarlo: **Ajustes → Temas → Temas de temporada**. Ahí cada uno tiene su interruptor y **Vista previa** para verlo cuando quieras.
- Fuegos artificiales: los mismos tipos del juego (bola pequeña con destello, explosión con color que se desvanece, explosión con destello, estrella con estela) más bola grande; la de forma de creeper es un **corazón**. Si tienes Minecraft descargado en tu PC, suenan con **los sonidos del propio juego**; si no, con sonidos parecidos.
- **Aviso de los sustos**: cuando empieza la semana de Halloween (no al abrir Havi Hub), aparece un aviso que explica los sustos (una figura salta a la pantalla, con un sonido fuerte y la imagen parpadeando). Si tienes epilepsia fotosensible, un problema del corazón o ansiedad, o no te gustan los sustos, pulsa **Desactivar los sustos**. Sale una vez al año, antes de cualquier susto, y no aparece si ya los desactivaste.
- **Sustos ocultos** (solo en Halloween): al abrir Havi Hub hay **1 posibilidad en 40** y en cada clic **1 en 1.500**, como máximo **una vez al día**. Nunca aparece con **Reducir animaciones**. Puedes probarlo o apagarlo en **Temas de temporada → Sustos ocultos**.

## 15. Teclas de Minecraft (todas, personalizables)

1. Abre **Ajustes → Minecraft → Teclas**. Están todas las del menú de Controles de Minecraft: movimiento, juego, inventario, creativo, multijugador, varios, espectador y depuración.
2. Haz clic en una tecla y presiona la nueva. También sirven **todos los botones del mouse**, incluidos los laterales (**atrás** y **adelante**): mientras eliges una tecla, esos botones solo sirven para asignarla y no te cambian de página. Cuando no estás asignando, el botón **atrás** del mouse vuelve a la página anterior como siempre. **Esc** deja la tecla sin asignar.
3. Si una tecla ya la usa otra acción, aparece un **⚠** rojo (pasa el mouse para ver cuál).
4. El ícono del reloj (a la derecha) la devuelve a la de Minecraft.
5. Se aplican solas a los perfiles nuevos. Para los que ya tienes: **Aplicar las teclas a todos los perfiles** (cierra el juego antes). Funciona también con versiones antiguas (1.12 y anteriores).

## 16. Cuentas

- **Si importaste tus cuentas de Prism Launcher**, tienen que iniciar sesión una vez: en **Ajustes → Cuentas** aparecen con **"tiene que iniciar sesión de nuevo"** y un botón **Iniciar sesión**. Si te toca jugar antes, Havi Hub te lo pide al presionar **Jugar**.
- **Para agregar otra cuenta de Microsoft:**
  1. Abre tu cuenta (CurseForge: arriba a la derecha; Modrinth: abajo a la izquierda o **Jugando como**) → **Agregar cuenta**.
  2. Presiona **Iniciar sesión con Microsoft**.
  3. Se abre la ventana de inicio de sesión (se llama **Havi Hub**). Inicia sesión ahí.
  4. Cuando termines, la cuenta aparece sola y el navegador muestra la página **"Cuenta conectada"** de Havi Hub.

### El nombre que muestra la página de Microsoft

Havi Hub inicia sesión con **su propia aplicación de Microsoft**, aprobada por Mojang, así que la página de permisos de Microsoft dice **Havi Hub**. Esa misma aplicación aparece en la lista de aplicaciones con acceso a tu cuenta de Microsoft, por si algún día quieres quitarle el permiso.

Si prefieres usar una aplicación tuya:

1. Registra una aplicación en **Microsoft Entra (Azure)** → **Registros de aplicaciones → Nuevo registro**, con cuentas personales de Microsoft y el nombre **Havi Hub**.
2. Pide a Mojang que apruebe esa aplicación para usar los servicios de Minecraft (tienen un formulario de revisión en su página de ayuda; puede tardar varios días). Sin esa aprobación, el inicio de sesión falla.
3. Copia su **Id. de aplicación (cliente)**.
4. En Havi Hub: **Ajustes → Launcher → Avanzado → Inicio de sesión de Microsoft**, pégalo y presiona **Guardar**.
5. **Vuelve a agregar tus cuentas de Microsoft** (las anteriores quedaron unidas a la aplicación antigua). Para volver a la de Havi Hub, deja el campo vacío y presiona **Guardar**.

### Cuenta offline (como en Prism Launcher)

Solo se puede agregar si **ya tienes una cuenta de Microsoft con Minecraft** en Havi Hub (igual que en Prism Launcher).

1. Abre tu cuenta → **Agregar cuenta offline** (también en **Ajustes → Cuentas**).
2. Escribe el nombre de jugador: de 3 a 16 caracteres, solo letras, números y guion bajo.
3. Presiona **Agregar**. Para jugar con ella, elígela en el menú de tu cuenta.

Sirve para jugar sin internet, en LAN o en servidores en modo offline. No entra a servidores que verifican la cuenta y no puede cambiar su skin online.

## 17. Activar CurseForge (API key gratuita)

Modrinth funciona sin configurar nada. CurseForge exige que cada app use su propia API key. Havi Hub ya pidió la suya: cuando CurseForge la apruebe, las versiones que se publiquen la traerán incluida y este paso dejará de ser necesario (si pegas una key tuya, se sigue usando la tuya). Mientras tanto:

1. Entra a https://console.curseforge.com/ e inicia sesión.
2. Si te lo pide, crea una organización (cualquier nombre sirve).
3. Ve a **API Keys** y copia tu key (empieza con `$2a$10$…`).
4. En Havi Hub: **Ajustes → Addons → API key de CurseForge**, pégala y presiona **Guardar**.

## 18. Skins: tu skin en un mundo de Minecraft

1. Abre **Skins** (CurseForge: pestaña de arriba; Modrinth: el ícono de la izquierda).
2. Tu skin está **parada sobre bloques de pasto**, al tamaño real del juego (el jugador mide casi 2 bloques), con colinas, pasto, flores y robles alrededor.
3. El botón del **sol** cambia el fondo: **Cielo de día** (sol y nubes del juego), **Cielo de noche** (luna y estrellas) o **Sin fondo**.
4. El botón de **animación** elige el movimiento. **Quieto**, **Caminar** y **Correr** se mueven como en el juego (el mismo balanceo de brazos y piernas, a su ritmo); al caminar o correr, el mundo pasa bajo los pies a la velocidad real. Con una élitra puesta, al correr se abre un poco, como en el juego.
5. **Arrastra** para girar la cámara y usa la **rueda** para acercarte o alejarte.

### Tus skins y las del juego

- Todas las skins que agregas quedan **en una sola lista** y se guardan entre sesiones. La que tienes puesta lleva la marca **En uso**.
- Si cambiaste tu skin en otro lugar (en el juego o en minecraft.net), Havi Hub la agrega a la lista sola.
- Debajo están las **Skins por defecto** de Minecraft (Steve, Alex, Ari, Efe, Kai, Makena, Noor, Sunny y Zuri). Haz clic en una para verla y presiona **Aplicar**.

Las texturas y las skins por defecto salen del Minecraft de tu PC, igual que las de los íconos (punto 9).

## 19. Havi Hub 1.0.0

La primera versión. Esto es todo lo que trae:

### Diseño y temas

| Qué | Dónde |
|---|---|
| **Dos diseños**: el de CurseForge o el de Modrinth, los dos con todas las funciones | Bienvenida; Ajustes → Temas → Diseño (punto 3) |
| **Bienvenida al primer inicio**: el diseño, qué hace la X, las redes de Havikun y tu primera instancia (nueva o traída de otro launcher) | Primer inicio (punto 3) |
| **Temas predefinidos**: CurseForge, Modrinth (original, OLED y claro), OLED y de colores | Ajustes → Temas |
| **Temas de temporada** con arte de Minecraft y el estilo de cada diseño: Halloween (calabazas, murciélagos, la luna y sustos ocultos en 3D, con un aviso al empezar la semana para desactivarlos), Navidad (nevada, luces y un trineo con renos) y Año Nuevo (cuenta regresiva y fuegos artificiales del juego a las 00:00) | Se ponen solos; Ajustes → Temas → Temas de temporada (punto 14) |
| **Tamaño de la interfaz** a tu gusto, y ajuste automático al tamaño de la ventana | Ajustes → Temas |

### Perfiles

| Qué | Dónde |
|---|---|
| **Importar** desde CurseForge, Modrinth y Prism Launcher, con grupos, imagen, tiempo jugado y ajustes de inicio (memoria, Java, argumentos, variables de entorno, resolución y comandos). De Prism Launcher también se traen las cuentas, las skins y sus ajustes generales | Importar → Desde otro launcher (punto 4) |
| **Sincronizar perfiles** con Prism Launcher, CurseForge y la app de Modrinth (los cuatro a la vez), desde una sola ventana | Ajustes → Launcher → Sincronizar perfiles (punto 11) |
| **Grupos** en mosaicos grandes, con una imagen propia o las de sus perfiles, que se ordenan arrastrando | Mis modpacks / Biblioteca (punto 8) |
| **Editor de ícono** con 138 bloques y objetos de Minecraft sobre un fondo de color, y tus propias imágenes sin perder calidad | Clic derecho → Cambiar ícono… (punto 9) |
| **Compartir un perfil** como .zip de CurseForge, .mrpack de Modrinth o .zip de Prism | Clic derecho → Compartir perfil (punto 10) |
| **Accesos directos** que abren Havi Hub y empiezan a jugar ese perfil | Clic derecho → Crear acceso directo (punto 5) |
| **Capturas de todos tus perfiles**, con filtros y un visor para copiarlas, abrirlas o borrarlas | Capturas (punto 12) |

### Mods y demás contenido

| Qué | Dónde |
|---|---|
| **Mods, modpacks, resource packs, shaders, data packs y mapas** de CurseForge y Modrinth, con los filtros del perfil puestos (se pueden quitar). Lo que no sirve en el perfil no se instala, y Havi Hub dice por qué | Agregar contenido y Descubrir (punto 7) |
| **Cambiar de versión** cualquier mod, con sus notas de cambios y la marca de la que usabas antes de actualizar | Botón ⇄ en cada fila (punto 6) |
| **Actualizar todo eligiendo qué**, con lo que tiene actualización arriba de la lista | Contenido del perfil (punto 6) |
| **Tres vistas** para el contenido del perfil: mosaico, tabla y lista | Contenido del perfil → Vista (punto 6) |
| **Mods que su autor solo deja bajar desde CurseForge**: Havi Hub los busca en Modrinth o los baja desde la página oficial de CurseForge | Automático (punto 7) |
| **La página de cada mod** (descripción, versiones, galería y videos) con un clic en su nombre | Contenido del perfil (punto 6) |

### Jugar

| Qué | Dónde |
|---|---|
| **Java y memoria en una sola sección**: memoria (con el control o escribiendo los MB), Java, argumentos, comandos, variables de entorno, librerías nativas (GLFW y OpenAL, con su ruta), arreglos para versiones antiguas y, en Linux, GameMode, MangoHud, tarjeta gráfica dedicada y Zink. Cada perfil puede cambiar cualquiera de estos | Ajustes → Java y memoria; Opciones del perfil (punto 5) |
| **Teclas de Minecraft**, todas, con un aviso si una se repite, y **opciones del juego por defecto** para los perfiles nuevos | Ajustes → Minecraft (punto 15) |
| **Si el juego se cierra por un error o no logra iniciar**, Havi Hub vuelve al frente y abre el registro del perfil con el archivo que explica el error | Automático (punto 5) |
| **Qué hace Havi Hub al iniciar el juego**: sigue abierto, se minimiza, se esconde en la bandeja hasta que cierras el juego o se cierra. La X puede dejarlo junto al reloj, y libera memoria mientras está escondido | Ajustes → Launcher → Comportamiento (punto 5) |
| **El motor de juego** (Prism Launcher) se descarga de sus versiones oficiales, se verifica con su huella SHA-256 y se actualiza solo. Sus ventanas llevan el nombre y el logo de Havi Hub | Automático |

### Servidores

| Qué | Dónde |
|---|---|
| **Descubrir servidores**: los más conocidos (internacionales y en español) y la lista de Modrinth en una sola lista, sin repetidos, con la latencia medida desde tu PC, filtros y **Jugar** (antes de entrar te dice qué va a pasar) | Servidores → Descubrir (punto 13) |
| **Mis servidores**: los de todos tus perfiles en una lista | Servidores → Mis servidores (punto 13) |

### Cuentas y skins

| Qué | Dónde |
|---|---|
| **Inicio de sesión con la aplicación propia de Havi Hub**, aprobada por Mojang | Cuentas (punto 16) |
| **Cuenta offline** para jugar sin internet o en LAN (si tienes una cuenta de Microsoft con Minecraft) | Cuenta → Agregar cuenta offline (punto 16) |
| **Skins en un mundo de Minecraft**: bloques de pasto a escala, cielo de día o de noche y las animaciones del juego; con élitra, se abre un poco al correr | Skins (punto 18) |
| **Tus skins en una sola lista**, con la que usas marcada, y las **skins por defecto** del juego | Skins (punto 18) |

### Lo demás

| Qué | Dónde |
|---|---|
| **Redes de Havikun** en Inicio (Linktree, YouTube, Twitch, Instagram, X y TikTok). Tú eliges si se cargan solas o solo al abrir una | Inicio; Ajustes → Privacidad |
| **Apoyar a Havikun** en Ko-fi | Inicio, debajo de las redes |
| **Privacidad**: la política nombra cada servicio al que se conecta Havi Hub, y el tiempo de juego se registra solo si quieres | Ajustes → Privacidad |
| **Al cerrar con algo a medias** (una descarga, una instalación, una importación), Havi Hub pregunta si seguir o detenerlo | Al cerrar con la X (punto 4) |
| **Gasta poco**: las texturas del juego quedan guardadas para abrir rápido, y las animaciones se detienen cuando usas otra ventana | Automático |
| **Windows y Linux**: instalador, portable y .zip para Windows; AppImage y .deb para Linux, en el menú de aplicaciones | Punto 2 |
| **Español e inglés** | Ajustes → Idiomas |
| **Licencias** de todo lo que va dentro de Havi Hub, con sus textos completos | Ajustes → Licencias |
| **Código abierto**, con licencia GPL-3.0 | https://github.com/havihub/HaviHub |

## 20. Preguntas frecuentes

**¿Dónde quedan mis perfiles?**
Todas las carpetas de Havi Hub se llaman `havihub`:
- Windows: perfiles en `%APPDATA%\havihub\launcher` (o en la carpeta de Prism Launcher si compartes los perfiles), motor en `%LOCALAPPDATA%\havihub\engine` y la app en `%LOCALAPPDATA%\Programs\havihub`.
- Linux: perfiles en `~/.config/havihub/launcher` y motor en `~/.config/havihub/engine`. El paquete `.deb` se instala en `/opt/havihub`.

**¿Cambiar de diseño borra algo?**
No. El diseño solo cambia cómo se ordenan las cosas. Tus perfiles, grupos, cuentas y ajustes son los mismos en los dos.

**¿Por qué no me aparecen mods en un perfil?**
Si el perfil es **vanilla** (sin Fabric, Forge, NeoForge ni Quilt), no lleva mods ni shaders. Crea un perfil con cargador o cambia la versión del perfil en sus opciones. Si tiene cargador, solo aparecen los mods que tienen versión para esa versión exacta de Minecraft.

**No encuentro Havi Hub en el menú de aplicaciones de Linux.**
Abre el AppImage una vez y revisa **Ajustes → Launcher → Menú de aplicaciones → Mostrar Havi Hub en mi menú de aplicaciones**. Algunos escritorios tardan unos segundos en mostrarlo, o lo muestran después de cerrar sesión y volver a entrar.

**¿Puedo desinstalar Prism Launcher?**
Sí, después de importar (si no compartes los perfiles con él). Si compartes, déjalo: los perfiles compartidos están en su carpeta.

**El juego se cerró con un error.**
Havi Hub se pone al frente solo y te lleva al **registro** (log) del perfil, con el archivo que explica el error. Ahí puedes subirlo con un clic para pedir ayuda.

**¿Dónde reporto un error o propongo una mejora?**
En los [issues de Havi Hub en GitHub](https://github.com/havihub/HaviHub/issues/new/choose): elige **Reportar un error** o **Proponer una mejora** (necesitas una cuenta de GitHub). Si el problema es con el juego, sube el log como en la pregunta anterior y pega el enlace en el reporte. Los problemas de seguridad no se publican ahí: se reportan en privado, como explica la [política de seguridad](https://github.com/havihub/HaviHub/security/policy).

**No puedo aplicar mi skin.**
El permiso para cambiar la skin dura 24 horas. Juega una vez o usa **Renovar sesión** y vuelve a intentarlo.

**Un mod de CurseForge no se descarga.**
Algunos autores no permiten descargas desde otras apps. Havi Hub lo busca en Modrinth o lo baja desde la página oficial de CurseForge, y si prefieres, desde tu navegador (punto 7).

**No me sale el tema de Halloween / Navidad / Año Nuevo.**
Revisa que esté encendido en **Ajustes → Temas → Temas de temporada** y que la fecha del PC sea la correcta. Con **Vista previa** lo ves en cualquier momento.

**¿Qué es `havihub-windows.exe` en el Administrador de tareas?**
Es el ayudante que pone el nombre y el logo de Havi Hub en las ventanas del motor (solo en Windows). Solo funciona mientras juegas y se cierra solo.

## 21. Compilar desde el código (opcional)

1. Instala Node.js 22 o superior (https://nodejs.org).
2. Abre una terminal en la carpeta del código.
3. `npm install`
4. `npm start` para probarlo.
5. `npm run dist:win` crea en la carpeta `release` el instalador (`Setup.exe`), la versión portable y el .zip. Funciona en Windows y también en Linux (sin Wine).
6. `npm run dist:linux` crea el `.AppImage` y el `.deb` (en Linux).
7. `npm test` corre las pruebas.
8. El ayudante de ventanas de Windows (`build/helper/havihub-windows.exe`) se compila desde su código con Zig: `pip install ziglang` y `npm run build:helper` (`npm run dist:win` lo compila solo si falta).
9. Para que la compilación incluya una API key de CurseForge, define la variable de entorno `HAVIHUB_CF_KEY` antes de `npm run build`.

El código está en https://github.com/havihub/HaviHub (licencia GPL-3.0).

---

El ícono de Havi Hub, el trineo, las luces y los regalos de Navidad son dibujos hechos para Havi Hub. Los bloques, objetos, murciélagos, chispas, sonidos y la skin del susto son de Minecraft: Havi Hub los lee del juego instalado en tu PC y no los incluye en su instalador (también el logo de Minecraft del encabezado y el bloque de pasto de la barra lateral; si en el PC no hay ningún Minecraft, Havi Hub descarga una vez los archivos del juego desde Mojang antes de mostrarlos). La lista de servidores viene de Modrinth. Las redes de Havikun muestran datos públicos de cada red (y sus páginas incrustables oficiales). El diseño "Estilo Modrinth" está inspirado en la app de Modrinth (licencia GPL-3.0). El logo de Prism Launcher es de sus autores y tiene licencia CC BY-SA 4.0; los logos de CurseForge y Modrinth son marcas de sus dueños y se usan solo para indicar de dónde viene cada cosa. Havi Hub no está afiliado a Prism Launcher, CurseForge, Modrinth, Mojang ni Microsoft. Minecraft es una marca de Mojang AB. El motor es Prism Launcher (licencia GPL-3.0), descargado desde sus versiones oficiales: https://github.com/PrismLauncher/PrismLauncher. Havi Hub solo le cambia el nombre, el logo y la página que se abre al iniciar sesión; el cambio completo está en `src/main/engine-brand.js`.
