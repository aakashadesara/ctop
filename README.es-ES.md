

# CTOP — Panel de Operaciones en Terminal para Agentes de IA

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: macOS | Linux | Windows](https://img.shields.io/badge/Platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg)](#requirements)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](#requirements)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero-brightgreen.svg)](#)

**`htop` para tus agentes de código IA.** Monitorea sesiones de Claude Code, Codex CLI, OpenCode y Devin — CPU, memoria, tokens, ventana de contexto, costos, ramas — desde un único panel en terminal.

![CTOP Demo](assets/hero.gif)

## Características

- **Monitoreo multi-agente** — Claude Code + Codex CLI + OpenCode + Devin, CPU/memoria/estado en tiempo real
- **Seguimiento de ventana de contexto** — barra visual con segmentos de entrada, caché, salida y espacio libre
- **Estimación de costos** — costo de API por sesión y agregado (precios de Claude + OpenAI)
- **Forma de onda de tokens** — línea de actividad en tiempo real que muestra el pulso de tokens
- **Dos modos de vista** — vista de lista (tabla) y vista de paneles (cuadrícula de tarjetas), alterna con `P`
- **Seguimiento en vivo de registros** — transmite la conversación en un panel dividido (`L`)
- **Ordenar, filtrar y buscar** — por CPU, memoria, contexto, rama, modelo o texto completo (`F`)
- **Panel de control e historial** — estadísticas agregadas (`d`), gráficos de uso de 24 horas (`H`)
- **Control de procesos** — finalizar sesiones (grácil o forzada), cierre masivo con selección múltiple, salto rápido al directorio del proyecto
- **Notificaciones de escritorio** — recíbe una notificación cuando las sesiones finalicen
- **5 temas de color** — predeterminado, minimalista, dracula, solarized, monokai (+ personalizado)
- **Sistema de complementos** — amplía con columnas personalizadas vía `~/.ctop/plugins/`
- **Detección de compactación y límites de tasa** — marca eventos de compactación y uso de cuotas
- **Modo CLI para agentes** — `ctop ls`, `ctop whoami`, `ctop alerts`, … (ver [Modo CLI](#cli-mode-for-agents-and-scripts))

![CTOP Features](assets/features.gif)

---

## Instalación

```bash
# Homebrew
brew tap aakashadesara/ctop && brew install ctop-claude

# npm
npm install -g ctop-claude

# npx (sin instalación)
npx ctop-claude

# Desde el código fuente
git clone https://github.com/aakashadesara/ctop.git
chmod +x ctop/claude-manager
ln -s "$(pwd)/ctop/claude-manager" /usr/local/bin/ctop
```

Luego ejecuta `ctop`. Si no hay agentes en ejecución, verás un estado vacío — inicia una sesión de Claude Code, Codex, OpenCode o Devin y aparecerá en la siguiente actualización.

---

## Atajos de teclado

| Tecla | Acción |
|-----|--------|
| `j`/`k` or `↑`/`↓` | Navegar |
| `h`/`l` or `←`/`→` | Navegar (modo panel) |
| `g` / `G` | Ir al primero / último |
| `P` | Alternar vista de lista / panel |
| `p` | Fijar / des fijar sesión (la mantiene arriba) |
| `Space` | Marcar / desmarcar sesión (selección múltiple) |
| `Shift+↑`/`↓` or `V` | Extender / iniciar un rango marcado |
| `a` | Seleccionar todo visible / borrar |
| `s` / `S` | Ciclar orden / invertir |
| `/` | Filtrar |
| `F` | Búsqueda de texto completo en conversaciones |
| `d` | Alternar panel de control |
| `L` | Alternar panel de registros |
| `H` | Alternar historial de 24 horas |
| `W` | Vista de línea de tiempo |
| `T` | Ciclar tema de color |
| `x` / `X` | Finalizar (SIGTERM / SIGKILL) — masivo si hay filas marcadas |
| `K` | Finalizar TODOS los agentes |
| `A` | Finalizar TODOS los agentes detenidos/inactivos |
| `o` / `e` / `t` | Abrir directorio en Finder / editor / terminal |
| `n` | Alternar notificaciones |
| `?` | Ayuda |
| `Esc` | Borrar selección (o filtro / búsqueda) |
| `q` | Salir |

Ratón: haz clic para seleccionar, desplázate para navegar, haz clic en el canal `★` para fijar/desfijar, `Shift`+clic para marcar (funcionará lo mejor posible según la terminal).

### Sesiones fijadas

Mantén las sesiones que te interesen a la vista. Presiona `p` (o haz clic en el `★` del canal de una fila, o en el botón `Fijar` del pie) para fijar la sesión bajo el cursor — saltará a una sección amarilla **★ Fijadas** en la parte superior y se mantendrá ahí independientemente del orden o filtro. El fijado funciona en vistas de lista, grupo y panel. Los fijados se indexan por la identidad de la sesión (no por pid), por lo que sobreviven a las actualizaciones, reinicios de la sesión y al cierre de ctop — se persisten en `~/.ctop/pins.json`. Presiona `p` nuevamente para des fijar.

### Acciones masivas

Marca varias sesiones y actúa sobre ellas de una vez. Presiona `Space` para marcar la sesión bajo el cursor, o mantén `Shift` mientras presionas `↑`/`↓` para extender un rango; presiona `V` para el modo de rango al estilo vim (luego muévete para extender) y `a` para seleccionar todo visible. Con las sesiones marcadas, `x` / `X` cierran todo el conjunto después de un aviso de confirmación; `Esc` borra la selección. Funciona en vistas de lista, panel y grupo.

> **Nota sobre Shift+clic:** muchas terminales (Terminal.app, iTerm2, GNOME Terminal, …) reservan `Shift`+clic para su propia selección de texto y nunca lo reenvían a la aplicación, por lo que el marcado con `Shift`+clic funciona según las capacidades. La ruta por teclado (`Space` / `Shift`+`↑`/`↓` / `V`) funciona en todas partes.

---

## Habilidad para agentes

Este repositorio incluye una [`habilidad ctop`](skills/ctop/SKILL.md) autocontenida. Agrégala a Claude Code para que cualquier agente aprenda cuándo y cómo llamar a `ctop`:

```bash
# Por proyecto
mkdir -p .claude/skills && cp -r skills/ctop .claude/skills/

# O a nivel de usuario
mkdir -p ~/.claude/skills && cp -r skills/ctop ~/.claude/skills/
```

Una vez instalada, pregúntale a cualquier sesión de Claude Code cosas como _"qué otros agentes estoy ejecutando"_, _"cuánto han costado mis sesiones"_, _"está mi contexto a punto de compactarse"_ — el agente recurrirá a `ctop` automáticamente.

Archivos de la habilidad:

- [`SKILL.md`](skills/ctop/SKILL.md) — hoja de activación + patrones comunes
- [`reference.md`](skills/ctop/reference.md) — especificación completa por comando
- [`examples.md`](skills/ctop/examples.md) — recetas listas para copiar y pegar

## Modo CLI (para agentes y scripts)

`ctop` sin argumentos inicia la TUI interactiva. `ctop <subcomando>` ejecuta una consulta única y se cierra, por lo que los agentes de IA pueden introspeccionar sus propias sesiones y sesiones asociadas desde otra terminal.

```bash
ctop ls                          # Tabla de cada agente en ejecución
ctop ls --json                   # Igual, legible por máquina
ctop ls --agent claude           # Filtrar por backend
ctop ls --cwd ~/code/myproj      # Filtrar por directorio

ctop get <pid> --json            # Detalle completo de una sesión
ctop log <pid> --tail 20         # Últimos 20 mensajes de la conversación
ctop search "TODO" --json        # Búsqueda de texto completo entre sesiones
ctop diff <pid>                  # Git diff del directorio de trabajo de la sesión
ctop stats --json                # Costo / tokens / conteos agregados

ctop whoami                      # Detectar en qué sesión estás
ctop whoami --pid-only           # Solo PID, para scripts
ctop alerts                      # Advertencias de bajo contexto / inactividad / sesiones fantasma
ctop alerts --severity critical  # Solo alertas de nivel crítico

ctop kill <pid>                  # SIGTERM (debe ser tu propio usuario)
ctop kill <pid> --force          # SIGKILL
ctop notify "title" "message"    # Notificación de escritorio
```

`whoami` detecta la sesión llamante mediante `$CTOP_PID` → recorrido del PID padre → coincidencia de `$PWD`, con una etiqueta `matchConfidence` (`exact | ppid | cwd-guess | none`) para que los agentes sepan cuánto confiar en la respuesta.

Las herramientas de lectura exponen datos que el usuario podría leer desde el disco de todos modos. `kill` aplica la verificación de propiedad de uid y de sesión de agente antes de enviar la señal — no hay un comando de eliminar todo.

### Ejemplos

```bash
# Buscar sesiones a punto de compactarse
ctop ls --json | jq '.[] | select(.contextPct != null and .contextPct < 20)'

# Compactación con autoconciencia (gancho)
[ "$(ctop whoami --json | jq -r .session.contextPct)" -lt 15 ] && \
  echo "contexto bajo — considera /compact"

# Limpiar sesiones fantasma
ctop alerts --json | jq -r '.[] | select(.kind=="ghost") | .pid' | \
  xargs -I {} ctop kill {} --force
```

## Configuración

### Banderas CLI (modo TUI)

```bash
ctop --refresh 3             # Actualizar cada 3 segundos
ctop --context-limit 128000  # Establecer ventana de contexto a 128k
ctop --pane                  # Iniciar en vista de panel
```

### Archivo de configuración (`~/.ctoprc`)

```json
{
  "refreshInterval": 5000,
  "contextLimit": 200000,
  "defaultView": "list",
  "theme": "default",
  "contextBarStyle": "block",
  "notifications": { "enabled": true, "minDuration": 30 }
}
```

Las banderas CLI anulan los valores del archivo de configuración.

---

## Cómo funciona

Lee la información de procesos de `ps` (PowerShell en Windows), resuelve directorios de trabajo mediante `lsof` y enriquece cada proceso con metadatos de sesión desde archivos JSONL locales (`~/.claude/projects/` para Claude, `~/.codex/sessions/` para Codex) y bases de datos SQLite (`~/.local/share/opencode/` para OpenCode, `~/.local/share/devin/cli/` para Devin). Sin llamadas de red, sin dependencias externas.

## Complementos (Plugins)

Amplía con columnas personalizadas. Crea archivos `.js` en `~/.ctop/plugins/`:

```js
module.exports = {
  name: 'my-plugin',
  column: {
    header: 'CUSTOM',
    width: 10,
    getValue: (proc) => proc.cwd ? 'yes' : 'no',
  },
};
```

Consulta `examples/plugins/` para más ejemplos.

---

## Requisitos

- **Node.js 18+**
- **macOS, Linux o Windows** — Windows usa PowerShell para la detección de procesos; la resolución del CWD es más limitada que en macOS/Linux.
- Sesiones en ejecución de **Claude Code**, **Codex CLI**, **OpenCode** y/o **Devin (terminal)**
- **`sqlite3`** en PATH para lectura de sesiones de OpenCode y Devin (incluido en macOS; disponible vía `apt`/`brew` en Linux)

## Contribuir

¡Las PR son bienvenidas! Haz fork, clona, ejecuta `./claude-manager` para desarrollar y `npm test` para probar. Abre un issue primero para cambios grandes.

## Licencia

[MIT](LICENSE)
