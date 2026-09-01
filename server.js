/* =============================================
   CLOUDVIDEO — server.js
   Mini servidor local para servir la carpeta de
   películas por HTTP (fuente "Local"), sin depender
   de ningún paquete externo: solo Node nativo.

   Uso:
     node server.js
   Por defecto escucha en http://localhost:4000
   ============================================= */

const http = require('http');
const fs   = require('fs');
const path = require('path');

/* --------------------------------------------------
   ⚙️  CONFIGURACIÓN
   -------------------------------------------------- */
const PUERTO      = process.env.PORT || 4000;
const CARPETA     = 'C:\\Users\\franc\\OneDrive\\Escritorio\\Peliculas en Pendrive\\Cloudvideo';
const TIPOS_VIDEO = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'ogv'];

/* --------------------------------------------------
   🔒  SEGURIDAD
   -------------------------------------------------- */

/* TOKEN: clave secreta que el frontend debe enviar en cada
   petición (?token=... o header X-CloudVideo-Token).
   CAMBIÁ este valor por uno propio antes de exponer el
   servidor en la red local. */
const TOKEN_SECRETO = 'cleopatra';

/* ORÍGENES PERMITIDOS: solo estas páginas pueden hacer
   fetch al servidor. Cualquier otro origen es rechazado
   antes de tocar el filesystem. */
const ORIGENES_PERMITIDOS = [
  'https://francramirez.github.io',
  'http://localhost:5500',       // Live Server (VSC) por defecto
  'http://127.0.0.1:5500',
  'null',                        // por si se abre el .html directo con doble clic
];

const MIME_POR_EXT = {
  mp4:  'video/mp4',
  webm: 'video/webm',
  ogv:  'video/ogg',
  mkv:  'video/x-matroska',
  avi:  'video/x-msvideo',
  mov:  'video/quicktime',
};

/* --------------------------------------------------
   Cabeceras CORS — solo se habilita el origen puntual
   que hizo la petición, si está en la lista permitida.
   -------------------------------------------------- */
function setCors(req, res) {
  const origen = req.headers.origin;
  if (origen && ORIGENES_PERMITIDOS.includes(origen)) {
    res.setHeader('Access-Control-Allow-Origin', origen);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, X-CloudVideo-Token');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
}

/* --------------------------------------------------
   Verifica origen + token antes de procesar cualquier
   petición real (no OPTIONS).
   -------------------------------------------------- */
function peticionAutorizada(req, url) {
  const origen = req.headers.origin;

  /* El origen debe estar en la whitelist. Peticiones sin
     header Origin (ej. curl, o video servido en <video src>
     que a veces no lo manda) se evalúan solo por token. */
  if (origen && !ORIGENES_PERMITIDOS.includes(origen)) {
    return false;
  }

  const tokenHeader = req.headers['x-cloudvideo-token'];
  const tokenQuery  = url.searchParams.get('token');
  const token       = tokenHeader || tokenQuery;

  return token === TOKEN_SECRETO;
}

/* --------------------------------------------------
   ¿Es un archivo de video soportado?
   -------------------------------------------------- */
function esVideo(nombreArchivo) {
  const ext = path.extname(nombreArchivo).slice(1).toLowerCase();
  return TIPOS_VIDEO.includes(ext);
}

/* --------------------------------------------------
   Convierte el nombre de archivo en un "id" seguro
   para usar en la URL (y de vuelta).
   -------------------------------------------------- */
function nombreAId(nombre) {
  return Buffer.from(nombre, 'utf8').toString('base64url');
}
function idANombre(id) {
  return Buffer.from(id, 'base64url').toString('utf8');
}

/* --------------------------------------------------
   GET /api/videos
   Lista los videos de la carpeta configurada.
   -------------------------------------------------- */
function manejarListado(req, res) {
  fs.readdir(CARPETA, { withFileTypes: true }, (err, entradas) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `No se pudo leer la carpeta: ${err.message}` }));
      return;
    }

    const archivos = entradas
      .filter(e => e.isFile() && esVideo(e.name))
      .map(e => {
        const rutaCompleta = path.join(CARPETA, e.name);
        const stats = fs.statSync(rutaCompleta);
        return {
          id: nombreAId(e.name),
          name: e.name,
          size: stats.size,
          mimeType: MIME_POR_EXT[path.extname(e.name).slice(1).toLowerCase()] || 'video/mp4',
          createdTime: stats.birthtime.toISOString(),
          thumbnailLink: null,
        };
      })
      .sort((a, b) => new Date(a.createdTime) - new Date(b.createdTime));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ files: archivos }));
  });
}

/* --------------------------------------------------
   GET /video/:id
   Sirve el archivo de video con soporte de Range
   (necesario para poder adelantar/atrasar el video).
   -------------------------------------------------- */
function manejarVideo(req, res, id) {
  let nombre;
  try {
    nombre = idANombre(decodeURIComponent(id));
  } catch {
    res.writeHead(400);
    res.end('ID inválido');
    return;
  }

  const rutaCompleta = path.join(CARPETA, nombre);

  // Evita path traversal: la ruta resuelta debe seguir dentro de CARPETA
  if (!rutaCompleta.startsWith(path.resolve(CARPETA))) {
    res.writeHead(403);
    res.end('Acceso denegado');
    return;
  }

  fs.stat(rutaCompleta, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404);
      res.end('Video no encontrado');
      return;
    }

    const mime = MIME_POR_EXT[path.extname(nombre).slice(1).toLowerCase()] || 'video/mp4';
    const rango = req.headers.range;

    if (!rango) {
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': stats.size,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(rutaCompleta).pipe(res);
      return;
    }

    // Ej: "bytes=0-1023"
    const [inicioStr, finStr] = rango.replace(/bytes=/, '').split('-');
    const inicio = parseInt(inicioStr, 10);
    const fin    = finStr ? parseInt(finStr, 10) : stats.size - 1;

    if (isNaN(inicio) || inicio >= stats.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stats.size}` });
      res.end();
      return;
    }

    const finReal = Math.min(fin, stats.size - 1);
    const largo   = finReal - inicio + 1;

    res.writeHead(206, {
      'Content-Type': mime,
      'Content-Range': `bytes ${inicio}-${finReal}/${stats.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': largo,
    });

    fs.createReadStream(rutaCompleta, { start: inicio, end: finReal }).pipe(res);
  });
}

/* --------------------------------------------------
   SERVIDOR
   -------------------------------------------------- */
const servidor = http.createServer((req, res) => {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (!peticionAutorizada(req, url)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No autorizado' }));
    return;
  }

  if (url.pathname === '/api/videos' && req.method === 'GET') {
    manejarListado(req, res);
    return;
  }

  if (url.pathname.startsWith('/video/') && req.method === 'GET') {
    const id = url.pathname.replace('/video/', '');
    manejarVideo(req, res, id);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Ruta no encontrada' }));
});

/* Bind explícito: '0.0.0.0' escucha en todas las interfaces
   (necesario para que la LAN te alcance), pero solo se llega
   hasta acá si pasaste el chequeo de origen + token de arriba. */
servidor.listen(PUERTO, '0.0.0.0', () => {
  console.log(`[CloudVideo] Servidor corriendo en el puerto ${PUERTO}`);
  console.log(`[CloudVideo] Accesible en tu PC como: http://localhost:${PUERTO}`);
  console.log(`[CloudVideo] Accesible en tu LAN como: http://<IP-de-tu-PC>:${PUERTO}`);
  console.log(`[CloudVideo] Sirviendo carpeta: ${CARPETA}`);
  if (TOKEN_SECRETO === 'CAMBIAR-ESTA-CLAVE-POR-UNA-PROPIA') {
    console.warn('[CloudVideo] ⚠️  Estás usando el token por defecto. Cambialo en server.js y en script.js antes de exponerte a la LAN.');
  }
});
