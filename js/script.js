/* =============================================
   CLOUDVIDEO — script.js
   ============================================= */

/* --------------------------------------------------
   ⚙️  CONFIGURACIÓN — EDITAR ESTOS DOS VALORES
   --------------------------------------------------
   API_KEY   → Tu clave de Google Cloud Console
   FOLDER_ID → El ID de tu carpeta en Google Drive
   -------------------------------------------------- */
const API_KEY   = 'AIzaSyDEid4OE0K8wXenn9LxOwvvjNi0uMtu8zE';
const FOLDER_ID = '1tSRXw35deTcH4yTeJQGrAK69rq0XojwY';

/* --------------------------------------------------
   🖥️  FUENTE LOCAL — servidor local (server.js)
   -------------------------------------------------- */

/* Debe ser EXACTAMENTE el mismo valor que TOKEN_SECRETO en server.js */
const LOCAL_TOKEN = 'cleopatra';

/* IP de tu PC en la red local (la ves con "ipconfig" en Windows,
   buscá "Dirección IPv4"). Se usa solo cuando abrís la página
   desde GitHub Pages; si la abrís en localhost/127.0.0.1 (Live
   Server), se conecta directo a localhost sin que tengas que
   tocar nada. */
const LOCAL_LAN_IP = '192.168.1.36';
const LOCAL_PUERTO = 4000;

const LOCAL_API_BASE = (() => {
  const host = location.hostname;
  const esLocal = host === 'localhost' || host === '127.0.0.1' || host === '';
  return esLocal
    ? `http://localhost:${LOCAL_PUERTO}`
    : `http://${LOCAL_LAN_IP}:${LOCAL_PUERTO}`;
})();

/* --------------------------------------------------
   🎬  TIPOS DE ARCHIVO DE VIDEO SOPORTADOS
   -------------------------------------------------- */
const TIPOS_VIDEO = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'ogv'];

/* --------------------------------------------------
   🔗  URL BASE DE LA API DE GOOGLE DRIVE
   -------------------------------------------------- */
const API_BASE = 'https://www.googleapis.com/drive/v3/files';

/* --------------------------------------------------
   REFERENCIAS AL DOM
   -------------------------------------------------- */
const elCargando    = document.getElementById('estado-cargando');
const elVacio       = document.getElementById('estado-vacio');
const elError       = document.getElementById('estado-error');
const elTextoError  = document.getElementById('texto-error');
const elColeccion   = document.getElementById('coleccion');
const elGrid        = document.getElementById('grid-peliculas');

const elModal       = document.getElementById('modal-reproductor');
const elOverlay     = document.getElementById('modal-overlay');
const elCerrar      = document.getElementById('modal-cerrar');
const elModalTitulo = document.getElementById('modal-titulo');

/* Selector de fuente (Drive / Local) */
const elFuenteDrive = document.getElementById('fuente-drive');
const elFuenteLocal = document.getElementById('fuente-local');

/* Reproductor de emergencia (fallback) */
const elVideoNativo   = document.getElementById('reproductor');
const elIframeFallback = document.getElementById('reproductor-fallback');
const elAvisoFallback  = document.getElementById('aviso-fallback');
let fallbackActivo = false;

/* --------------------------------------------------
   INSTANCIA DE PLYR
   -------------------------------------------------- */
const reproductor = new Plyr('#reproductor', {
  controls: [
    'play-large',
    'play',
    'progress',
    'current-time',
    'duration',
    'mute',
    'volume',
    'settings',
    'pip',
    'fullscreen',
  ],
  settings: ['speed'],
  speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
  keyboard: { focused: true, global: true },
  tooltips: { controls: true, seek: true },
  quality: {
    default: 1080,
    options: [4320, 2880, 2160, 1440, 1080, 720, 576, 480, 360, 240],
    forced: true,
    onChange: (quality) => {
      if (quality < 1080) reproductor.quality = 1080;
    },
  },
  i18n: {
    play:            'Reproducir',
    pause:           'Pausar',
    mute:            'Silenciar',
    unmute:          'Activar sonido',
    enterFullscreen: 'Pantalla completa',
    exitFullscreen:  'Salir de pantalla completa',
    settings:        'Configuración',
    speed:           'Velocidad',
    normal:          'Normal',
  },
});

/* --------------------------------------------------
   VARIABLES DE ESTADO
   -------------------------------------------------- */
let todasLasPeliculas = []; // Lista completa ordenada
let indiceActual      = -1; // Índice del video en reproducción
let fuenteActual      = 'drive'; // 'drive' | 'local'

/* =============================================
   FUNCIÓN PRINCIPAL: cargar archivos de Drive
   Ordenados por createdTime ascendente:
   más viejo arriba, más nuevo abajo.
   ============================================= */
async function cargarPeliculas() {
  mostrarEstado('cargando');

  try {
    const campos   = 'files(id,name,mimeType,size,thumbnailLink,createdTime)';
    const consulta = encodeURIComponent(`'${FOLDER_ID}' in parents and trashed = false`);

    /* orderBy=createdTime: el más antiguo primero (arriba en el grid),
       el más nuevo al final (abajo en el grid) */
    const url = `${API_BASE}?q=${consulta}&fields=${campos}&pageSize=100&orderBy=createdTime&key=${API_KEY}`;

    const respuesta = await fetch(url);

    if (!respuesta.ok) {
      const datos = await respuesta.json();
      const msg   = datos?.error?.message || `Error HTTP ${respuesta.status}`;
      throw new Error(msg);
    }

    const datos    = await respuesta.json();
    const archivos = datos.files || [];

    todasLasPeliculas = archivos.filter(archivo => esVideo(archivo));

    if (todasLasPeliculas.length === 0) {
      mostrarEstado('vacio');
      return;
    }

    renderizarGrid(todasLasPeliculas);
    actualizarBarraEspacio(todasLasPeliculas);
    mostrarEstado('coleccion');

  } catch (error) {
    console.error('[CloudVideo] Error al cargar Drive:', error);
    elTextoError.textContent = `Error al cargar: ${error.message}`;
    mostrarEstado('error');
  }
}

/* =============================================
   CARGAR ARCHIVOS DESDE EL SERVIDOR LOCAL
   (carpeta local servida por server.js)
   ============================================= */
async function cargarPeliculasLocal() {
  mostrarEstado('cargando');

  try {
    const respuesta = await fetch(`${LOCAL_API_BASE}/api/videos`, {
      headers: { 'X-CloudVideo-Token': LOCAL_TOKEN },
    });

    if (!respuesta.ok) {
      const datos = await respuesta.json().catch(() => ({}));
      throw new Error(datos.error || `Error HTTP ${respuesta.status}`);
    }

    const datos    = await respuesta.json();
    const archivos = datos.files || [];

    /* Mismo formato que usa la fuente Drive, así todo el resto
       del código (grid, reproductor, progreso) funciona sin cambios */
    todasLasPeliculas = archivos.filter(archivo => esVideo(archivo));

    if (todasLasPeliculas.length === 0) {
      mostrarEstado('vacio');
      return;
    }

    renderizarGrid(todasLasPeliculas);
    actualizarBarraEspacio(todasLasPeliculas);
    mostrarEstado('coleccion');

  } catch (error) {
    console.error('[CloudVideo] Error al cargar servidor local:', error);
    elTextoError.textContent =
      `No se pudo conectar con el servidor local (${LOCAL_API_BASE}). ` +
      `Verificá que esté corriendo "node server.js". Detalle: ${error.message}`;
    mostrarEstado('error');
  }
}

/* =============================================
   CAMBIAR DE FUENTE (Drive / Local)
   ============================================= */
function cambiarFuente(fuente) {
  if (fuente === fuenteActual) return;
  fuenteActual = fuente;

  elFuenteDrive.classList.toggle('fuente-activa', fuente === 'drive');
  elFuenteLocal.classList.toggle('fuente-activa', fuente === 'local');

  if (fuente === 'drive') {
    cargarPeliculas();
  } else {
    cargarPeliculasLocal();
  }
}

elFuenteDrive.addEventListener('click', () => cambiarFuente('drive'));
elFuenteLocal.addEventListener('click', () => cambiarFuente('local'));

/* =============================================
   ¿Es un archivo de video?
   ============================================= */
function esVideo(archivo) {
  if (archivo.mimeType && archivo.mimeType.startsWith('video/')) return true;
  const extension = archivo.name.split('.').pop().toLowerCase();
  return TIPOS_VIDEO.includes(extension);
}

/* =============================================
   RENDERIZAR GRID
   ============================================= */
function renderizarGrid(peliculas) {
  elGrid.innerHTML = '';
  peliculas.forEach((pelicula, indice) => {
    elGrid.appendChild(crearTarjeta(pelicula, indice));
  });
}

/* =============================================
   CREAR TARJETA
   ============================================= */
function crearTarjeta(pelicula, indice) {
  const nombreLimpio = pelicula.name.replace(/\.[^/.]+$/, '');
  const tamano = pelicula.size ? formatearTamano(Number(pelicula.size)) : 'Video';

  const tieneThumbnail = !!pelicula.thumbnailLink;
  const thumbUrl = tieneThumbnail
    ? pelicula.thumbnailLink.replace('=s220', '=s800')
    : null;

  const tarjeta = document.createElement('article');
  tarjeta.className = 'tarjeta';
  tarjeta.style.animationDelay = `${indice * 0.06}s`;
  tarjeta.setAttribute('role', 'button');
  tarjeta.setAttribute('tabindex', '0');
  tarjeta.setAttribute('aria-label', `Reproducir ${nombreLimpio}`);
  tarjeta.setAttribute('data-id', pelicula.id);

  /* Verificamos si hay progreso guardado para este video */
  const progreso   = obtenerProgreso(pelicula.id);
  const tieneProgreso = progreso && progreso.duracion > 0;
  const porcentaje = tieneProgreso
    ? Math.min((progreso.tiempo / progreso.duracion) * 100, 100)
    : 0;

  tarjeta.innerHTML = `
    <div class="tarjeta-poster">
      ${tieneThumbnail
        ? `<img class="poster-thumb" src="${thumbUrl}" alt="${nombreLimpio}" loading="lazy" />`
        : `<svg class="poster-icono" xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
              aria-hidden="true">
              <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/>
              <line x1="7" y1="2" x2="7" y2="22"/>
              <line x1="17" y1="2" x2="17" y2="22"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <line x1="2" y1="7" x2="7" y2="7"/>
              <line x1="2" y1="17" x2="7" y2="17"/>
              <line x1="17" y1="7" x2="22" y2="7"/>
              <line x1="17" y1="17" x2="22" y2="17"/>
            </svg>
            <span class="poster-tipo">Video</span>`
      }
      <div class="poster-overlay">
        <p class="overlay-titulo">${nombreLimpio}</p>
        <p class="overlay-meta">${tamano}</p>
      </div>
      <div class="poster-play" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
      </div>
    </div>

    <!-- Barra de progreso: visible solo si hay progreso guardado -->
    <div class="progreso-contenedor ${tieneProgreso ? '' : 'oculto'}">
      <div class="progreso-barra" style="width: ${porcentaje}%"></div>
    </div>
  `;

  tarjeta.addEventListener('click', () => abrirReproductor(indice));
  tarjeta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      abrirReproductor(indice);
    }
  });

  return tarjeta;
}

/* =============================================
   PROGRESO DE VIDEOS — localStorage
   Clave: "cv_progreso_{fileId}"
   Valor: { tiempo: segundos, duracion: segundos }
   ============================================= */

/* Guarda el progreso del video actual cada 5 segundos */
const INTERVALO_GUARDADO = 5000;
let intervaloProgreso = null;

function guardarProgreso() {
  const pelicula = todasLasPeliculas[indiceActual];
  if (!pelicula) return;

  const tiempo   = reproductor.currentTime;
  const duracion = reproductor.duration;

  /* No guardamos si aún no hay duración válida */
  if (!duracion || duracion === 0) return;

  const datos = { tiempo, duracion };
  localStorage.setItem(`cv_progreso_${pelicula.id}`, JSON.stringify(datos));

  /* Actualizamos la barra de progreso en la tarjeta visualmente */
  actualizarBarraTarjeta(pelicula.id, tiempo, duracion);
}

function obtenerProgreso(fileId) {
  try {
    const raw = localStorage.getItem(`cv_progreso_${fileId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function iniciarGuardadoProgreso() {
  detenerGuardadoProgreso();
  intervaloProgreso = setInterval(guardarProgreso, INTERVALO_GUARDADO);
}

function detenerGuardadoProgreso() {
  if (intervaloProgreso) {
    clearInterval(intervaloProgreso);
    intervaloProgreso = null;
  }
}

/* Actualiza la barra de progreso visible en la tarjeta */
function actualizarBarraTarjeta(fileId, tiempo, duracion) {
  const barra = document.querySelector(`[data-id="${fileId}"] .progreso-barra`);
  if (!barra) return;
  const porcentaje = Math.min((tiempo / duracion) * 100, 100);
  barra.style.width = `${porcentaje}%`;
  barra.closest('.progreso-contenedor').classList.remove('oculto');
}

/* =============================================
   REPRODUCTOR DE EMERGENCIA (FALLBACK)
   Se activa cuando el reproductor principal (Plyr)
   dispara un error de carga/reproducción.
   Usa el iframe embebido de Google Drive, que no
   depende de la API Key ni de restricciones de referrer.
   ============================================= */
function activarFallback(fileId) {
  if (fallbackActivo) return; // Evitar activarlo más de una vez por video
  fallbackActivo = true;

  console.warn('[CloudVideo] Reproductor principal falló, activando modo de emergencia (Drive embed).');

  /* Detenemos el guardado de progreso: el iframe de Drive
     no expone eventos de tiempo/duración que podamos leer. */
  detenerGuardadoProgreso();

  /* Ocultamos el reproductor Plyr y mostramos el iframe */
  const contenedorPlyr = document.querySelector('.modal-contenido .plyr');
  if (contenedorPlyr) contenedorPlyr.classList.add('oculto');
  elVideoNativo.classList.add('oculto');

  elIframeFallback.src = `https://drive.google.com/file/d/${fileId}/preview`;
  elIframeFallback.classList.remove('oculto');
  elAvisoFallback.classList.remove('oculto');
}

/* Restablece el estado visual para el próximo video que se abra */
function reiniciarFallback() {
  fallbackActivo = false;
  elIframeFallback.src = '';
  elIframeFallback.classList.add('oculto');
  elAvisoFallback.classList.add('oculto');

  const contenedorPlyr = document.querySelector('.modal-contenido .plyr');
  if (contenedorPlyr) contenedorPlyr.classList.remove('oculto');
  elVideoNativo.classList.remove('oculto');
}

/* Escuchamos errores del elemento <video> nativo.
   Plyr no intercepta este evento, así que lo tomamos directo del DOM. */
elVideoNativo.addEventListener('error', () => {
  if (fuenteActual === 'local') return; // El fallback usa el embed de Drive, no aplica a Local
  const pelicula = todasLasPeliculas[indiceActual];
  if (pelicula) activarFallback(pelicula.id);
});

/* =============================================
   ABRIR REPRODUCTOR
   Recibe el índice del video en la lista.
   ============================================= */
function abrirReproductor(indice, mantenerPantallaCompleta = false) {
  indiceActual = indice;
  reiniciarFallback();

  const pelicula     = todasLasPeliculas[indice];
  const nombreLimpio = pelicula.name.replace(/\.[^/.]+$/, '');
  const urlVideo = fuenteActual === 'local'
    ? `${LOCAL_API_BASE}/video/${pelicula.id}?token=${encodeURIComponent(LOCAL_TOKEN)}`
    : `${API_BASE}/${pelicula.id}?alt=media&key=${API_KEY}`;

  elModalTitulo.textContent = nombreLimpio;

  reproductor.source = {
    type: 'video',
    sources: [{ src: urlVideo, type: pelicula.mimeType || 'video/mp4' }],
  };

  elModal.classList.remove('oculto');
  document.body.style.overflow = 'hidden';

  reproductor.once('ready', () => {
    reproductor.play();

    /* Retomamos desde donde se dejó, si hay progreso guardado */
    const progreso = obtenerProgreso(pelicula.id);
    if (progreso && progreso.tiempo > 0) {
      reproductor.currentTime = progreso.tiempo;
    }

    /* Iniciamos el guardado periódico */
    iniciarGuardadoProgreso();

    if (!mantenerPantallaCompleta) {
      reproductor.fullscreen.enter();
    }
  });
}

/* =============================================
   REPRODUCCIÓN AUTOMÁTICA AL TERMINAR
   ============================================= */
reproductor.on('ended', () => {
  /* Guardamos progreso final (100%) al terminar */
  guardarProgreso();
  detenerGuardadoProgreso();

  const siguiente = indiceActual + 1;
  if (siguiente < todasLasPeliculas.length) {
    abrirReproductor(siguiente, true);
  }
});

/* =============================================
   CERRAR REPRODUCTOR
   ============================================= */
function cerrarReproductor() {
  /* Guardamos el progreso al cerrar manualmente */
  guardarProgreso();
  detenerGuardadoProgreso();
  reproductor.pause();

  /* Si estaba activo el fallback, cortamos el iframe para que no
     siga sonando de fondo (los iframes no se pausan con .pause()) */
  if (fallbackActivo) {
    elIframeFallback.src = '';
  }

  elModal.classList.add('oculto');
  document.body.style.overflow = '';
  indiceActual = -1;
}

/* =============================================
   OCULTAR CURSOR AUTOMÁTICAMENTE
   Si el mouse no se mueve por 3 segundos dentro
   del reproductor, el cursor desaparece.
   Se reactiva al mover el mouse.
   ============================================= */
let temporizadorCursor = null;

function ocultarCursor() {
  document.body.classList.add('cursor-oculto');
}

function mostrarCursor() {
  document.body.classList.remove('cursor-oculto');
  clearTimeout(temporizadorCursor);
  /* Solo ocultamos el cursor si el reproductor está abierto */
  if (!elModal.classList.contains('oculto')) {
    temporizadorCursor = setTimeout(ocultarCursor, 3000);
  }
}

document.addEventListener('mousemove', mostrarCursor);
document.addEventListener('mousedown', mostrarCursor);

/* =============================================
   EVENTOS DEL MODAL
   ============================================= */
elCerrar.addEventListener('click', cerrarReproductor);
elOverlay.addEventListener('click', cerrarReproductor);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !elModal.classList.contains('oculto')) {
    cerrarReproductor();
  }
});

/* =============================================
   BARRA DE ESPACIO DISPONIBLE
   ============================================= */
function actualizarBarraEspacio(peliculas) {
  const TOTAL_BYTES   = 15 * 1024 * 1024 * 1024;
  const usadoBytes    = peliculas.reduce((acc, p) => acc + (Number(p.size) || 0), 0);
  const porcentaje    = Math.min((usadoBytes / TOTAL_BYTES) * 100, 100);
  const usadoTexto    = formatearTamano(usadoBytes);
  const disponible    = formatearTamano(Math.max(TOTAL_BYTES - usadoBytes, 0));

  const barraProgreso = document.getElementById('espacio-usado');
  const textoUsado    = document.getElementById('espacio-usado-texto');
  const textoDetalle  = document.getElementById('espacio-detalle');

  barraProgreso.style.width    = `${porcentaje}%`;
  textoUsado.textContent       = usadoTexto;
  textoDetalle.textContent     = `${disponible} disponibles de 15 GB`;
}

/* =============================================
   MOSTRAR ESTADO
   ============================================= */
function mostrarEstado(estado) {
  elCargando.classList.add('oculto');
  elVacio.classList.add('oculto');
  elError.classList.add('oculto');
  elColeccion.classList.add('oculto');

  switch (estado) {
    case 'cargando':  elCargando.classList.remove('oculto');  break;
    case 'vacio':     elVacio.classList.remove('oculto');     break;
    case 'error':     elError.classList.remove('oculto');     break;
    case 'coleccion': elColeccion.classList.remove('oculto'); break;
  }
}

/* =============================================
   FORMATEAR TAMAÑO
   ============================================= */
function formatearTamano(bytes) {
  if (bytes < 1024)               return `${bytes} B`;
  if (bytes < 1024 * 1024)        return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/* =============================================
   INICIO
   ============================================= */
document.addEventListener('DOMContentLoaded', cargarPeliculas);
