/* =============================================
   CLOUDVIDEO — server-dlna.js
   Servidor DLNA/UPnP mínimo, sin dependencias externas.
   Hace que tu carpeta de películas aparezca como una
   fuente de red nativa en Smart TVs (VIDAA, LG, Samsung,
   etc.) dentro de "Compartir contenido" / "Red doméstica",
   sin pasar por ningún navegador ni pedir permisos.

   Uso:
     node server-dlna.js
   Corre en paralelo a server.js (puertos distintos).
   ============================================= */

const http = require('http');
const dgram = require('dgram');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* Red de seguridad: si algo se nos escapa sin capturar, lo logueamos
   completo (con stack trace) en vez de dejar que Node cierre el
   proceso en silencio como venía pasando. Esto es clave para poder
   diagnosticar qué estaba fallando al conectar la Smart TV. */
process.on('uncaughtException', (err) => {
  console.error('[CloudVideo DLNA] ❌❌ EXCEPCIÓN NO CAPTURADA:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[CloudVideo DLNA] ❌❌ PROMESA RECHAZADA SIN MANEJAR:', err);
});

/* --------------------------------------------------
   ⚙️  CONFIGURACIÓN (mismos valores que server.js)
   -------------------------------------------------- */
const CARPETA     = 'C:\\Users\\franc\\OneDrive\\Escritorio\\Peliculas en Pendrive\\Cloudvideo';
const TIPOS_VIDEO = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'ogv'];
const PUERTO_HTTP = 4001;               // puerto del servidor DLNA (distinto del 4000)
const NOMBRE_SERVIDOR = 'CloudVideo (Franc)'; // nombre que va a mostrar la TV

const MIME_POR_EXT = {
  mp4:  'video/mp4',
  webm: 'video/webm',
  ogv:  'video/ogg',
  mkv:  'video/x-matroska',
  avi:  'video/x-msvideo',
  mov:  'video/quicktime',
};

/* UUID fijo del dispositivo (se genera una sola vez y se guarda
   en un archivo al lado, así la TV no lo "reencuentra" como
   servidor nuevo cada vez que reiniciás el proceso) */
const RUTA_UUID = path.join(__dirname, '.dlna-uuid');
let UUID;
try {
  UUID = fs.readFileSync(RUTA_UUID, 'utf8').trim();
} catch {
  UUID = crypto.randomUUID();
  fs.writeFileSync(RUTA_UUID, UUID);
}

/* --------------------------------------------------
   IP local (la de la LAN, no 127.0.0.1)
   -------------------------------------------------- */
function obtenerIpLocal() {
  const interfaces = os.networkInterfaces();
  for (const nombre of Object.keys(interfaces)) {
    for (const iface of interfaces[nombre]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}
const IP_LOCAL = obtenerIpLocal();

/* --------------------------------------------------
   Listado de videos (igual que en server.js)
   -------------------------------------------------- */
function listarVideos() {
  const entradas = fs.readdirSync(CARPETA, { withFileTypes: true });
  return entradas
    .filter(e => e.isFile() && TIPOS_VIDEO.includes(path.extname(e.name).slice(1).toLowerCase()))
    .map((e, indice) => {
      const rutaCompleta = path.join(CARPETA, e.name);
      const stats = fs.statSync(rutaCompleta);
      return {
        id: String(indice + 1),
        nombre: e.name,
        nombreLimpio: e.name.replace(/\.[^/.]+$/, ''),
        archivo: e.name,
        tamano: stats.size,
        mime: MIME_POR_EXT[path.extname(e.name).slice(1).toLowerCase()] || 'video/mp4',
      };
    });
}

function escaparXml(texto) {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/* --------------------------------------------------
   XML: descripción del dispositivo UPnP
   -------------------------------------------------- */
function xmlDescripcionDispositivo() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaServer:1</deviceType>
    <friendlyName>${escaparXml(NOMBRE_SERVIDOR)}</friendlyName>
    <manufacturer>Framirez</manufacturer>
    <modelName>CloudVideo DLNA</modelName>
    <UDN>uuid:${UUID}</UDN>
    <presentationURL>http://${IP_LOCAL}:${PUERTO_HTTP}/</presentationURL>
    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:ContentDirectory:1</serviceType>
        <serviceId>urn:upnp-org:serviceId:ContentDirectory</serviceId>
        <SCPDURL>/ContentDirectory.xml</SCPDURL>
        <controlURL>/control</controlURL>
        <eventSubURL>/event</eventSubURL>
      </service>
      <service>
        <serviceType>urn:schemas-upnp-org:service:ConnectionManager:1</serviceType>
        <serviceId>urn:upnp-org:serviceId:ConnectionManager</serviceId>
        <SCPDURL>/ConnectionManager.xml</SCPDURL>
        <controlURL>/control-cm</controlURL>
        <eventSubURL>/event-cm</eventSubURL>
      </service>
    </serviceList>
  </device>
</root>`;
}

/* SCPD del servicio ConnectionManager: casi todas las TVs exigen que
   un MediaServer lo declare, aunque sea con GetProtocolInfo mínimo */
function xmlServicioConnectionManager() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<scpd xmlns="urn:schemas-upnp-org:service-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <actionList>
    <action>
      <n>GetProtocolInfo</n>
      <argumentList>
        <argument><n>Source</n><direction>out</direction></argument>
        <argument><n>Sink</n><direction>out</direction></argument>
      </argumentList>
    </action>
    <action>
      <n>GetCurrentConnectionIDs</n>
      <argumentList>
        <argument><n>ConnectionIDs</n><direction>out</direction></argument>
      </argumentList>
    </action>
    <action>
      <n>GetCurrentConnectionInfo</n>
      <argumentList>
        <argument><n>ConnectionID</n><direction>in</direction></argument>
        <argument><n>RcsID</n><direction>out</direction></argument>
        <argument><n>AVTransportID</n><direction>out</direction></argument>
        <argument><n>ProtocolInfo</n><direction>out</direction></argument>
        <argument><n>PeerConnectionManager</n><direction>out</direction></argument>
        <argument><n>PeerConnectionID</n><direction>out</direction></argument>
        <argument><n>Direction</n><direction>out</direction></argument>
        <argument><n>Status</n><direction>out</direction></argument>
      </argumentList>
    </action>
  </actionList>
</scpd>`;
}

/* Respuesta SOAP a GetProtocolInfo: le dice a la TV qué formatos
   puede "recibir" este servidor de contenido (Source) */
function responderGetProtocolInfo(res) {
  const source = TIPOS_VIDEO.map(ext => {
    const mime = MIME_POR_EXT[ext] || 'video/mp4';
    return `http-get:*:${mime}:*`;
  }).join(',');

  const cuerpo = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetProtocolInfoResponse xmlns:u="urn:schemas-upnp-org:service:ConnectionManager:1">
      <Source>${escaparXml(source)}</Source>
      <Sink></Sink>
    </u:GetProtocolInfoResponse>
  </s:Body>
</s:Envelope>`;

  res.writeHead(200, { 'Content-Type': 'text/xml; charset="utf-8"' });
  res.end(cuerpo);
}

/* SCPD mínimo: solo la acción Browse, que es la única que usan las TVs */
function xmlServicioContentDirectory() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<scpd xmlns="urn:schemas-upnp-org:service-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <actionList>
    <action>
      <name>Browse</name>
      <argumentList>
        <argument><name>ObjectID</name><direction>in</direction></argument>
        <argument><name>BrowseFlag</name><direction>in</direction></argument>
        <argument><name>Filter</name><direction>in</direction></argument>
        <argument><name>StartingIndex</name><direction>in</direction></argument>
        <argument><name>RequestedCount</name><direction>in</direction></argument>
        <argument><name>SortCriteria</name><direction>in</direction></argument>
        <argument><name>Result</name><direction>out</direction></argument>
        <argument><name>NumberReturned</name><direction>out</direction></argument>
        <argument><name>TotalMatches</name><direction>out</direction></argument>
        <argument><name>UpdateID</name><direction>out</direction></argument>
      </argumentList>
    </action>
  </actionList>
</scpd>`;
}

/* --------------------------------------------------
   DIDL-Lite: el listado de videos en formato que
   entienden los reproductores DLNA.
   -------------------------------------------------- */
function armarDidlLite(videos) {
  /* DLNA.ORG_OP=01 = permite seek por byte-range (Range header, que
     ya soportamos); DLNA.ORG_FLAGS habilita streaming en modo
     "background"/interoperable. Muchas TVs (VIDAA incluida) ignoran
     un <res> que no tenga estos flags, aunque el mime sea correcto. */
  const DLNA_FLAGS = 'DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000';

  const items = videos.map(v => `
    <item id="${v.id}" parentID="0" restricted="1">
      <dc:title>${escaparXml(v.nombreLimpio)}</dc:title>
      <upnp:class>object.item.videoItem</upnp:class>
      <res protocolInfo="http-get:*:${v.mime}:${DLNA_FLAGS}" size="${v.tamano}">http://${IP_LOCAL}:${PUERTO_HTTP}/video/${v.id}</res>
    </item>`).join('');

  const didl = `<?xml version="1.0" encoding="UTF-8"?>
<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">${items}
</DIDL-Lite>`;

  return didl;
}

/* --------------------------------------------------
   Respuesta SOAP al Browse
   -------------------------------------------------- */
function responderBrowse(res) {
  const videos = listarVideos();
  const didl = armarDidlLite(videos);

  const cuerpo = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:BrowseResponse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
      <Result>${escaparXml(didl)}</Result>
      <NumberReturned>${videos.length}</NumberReturned>
      <TotalMatches>${videos.length}</TotalMatches>
      <UpdateID>1</UpdateID>
    </u:BrowseResponse>
  </s:Body>
</s:Envelope>`;

  res.writeHead(200, { 'Content-Type': 'text/xml; charset="utf-8"' });
  res.end(cuerpo);
}

/* --------------------------------------------------
   Servir el video (con soporte Range, igual que server.js)
   -------------------------------------------------- */
function manejarVideo(req, res, id) {
  const videos = listarVideos();
  const video = videos.find(v => v.id === id);

  if (!video) {
    res.writeHead(404);
    res.end('No encontrado');
    return;
  }

  const rutaCompleta = path.join(CARPETA, video.archivo);
  const stats = fs.statSync(rutaCompleta);
  const rango = req.headers.range;

  if (!rango) {
    res.writeHead(200, {
      'Content-Type': video.mime,
      'Content-Length': stats.size,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(rutaCompleta).pipe(res);
    return;
  }

  const [inicioStr, finStr] = rango.replace(/bytes=/, '').split('-');
  const inicio = parseInt(inicioStr, 10);
  const fin = finStr ? parseInt(finStr, 10) : stats.size - 1;
  const finReal = Math.min(fin, stats.size - 1);
  const largo = finReal - inicio + 1;

  res.writeHead(206, {
    'Content-Type': video.mime,
    'Content-Range': `bytes ${inicio}-${finReal}/${stats.size}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': largo,
  });
  fs.createReadStream(rutaCompleta, { start: inicio, end: finReal }).pipe(res);
}

/* --------------------------------------------------
   SERVIDOR HTTP (descripción + control + video)
   -------------------------------------------------- */
const servidorHttp = http.createServer((req, res) => {
  try {
    manejarPeticionHttp(req, res);
  } catch (err) {
    console.error('[CloudVideo DLNA] ❌ Error manejando petición:', err);
    try {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error interno');
    } catch { /* la respuesta puede ya estar enviada */ }
  }
});

function manejarPeticionHttp(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/description.xml') {
    res.writeHead(200, { 'Content-Type': 'text/xml; charset="utf-8"' });
    res.end(xmlDescripcionDispositivo());
    return;
  }

  if (url.pathname === '/ContentDirectory.xml') {
    res.writeHead(200, { 'Content-Type': 'text/xml; charset="utf-8"' });
    res.end(xmlServicioContentDirectory());
    return;
  }

  if (url.pathname === '/ConnectionManager.xml') {
    res.writeHead(200, { 'Content-Type': 'text/xml; charset="utf-8"' });
    res.end(xmlServicioConnectionManager());
    return;
  }

  if (url.pathname === '/control' && req.method === 'POST') {
    let cuerpo = '';
    req.on('data', chunk => (cuerpo += chunk));
    req.on('end', () => {
      try {
        // Solo implementamos Browse (es lo único que piden las TVs para listar)
        responderBrowse(res);
      } catch (err) {
        console.error('[CloudVideo DLNA] ❌ Error en /control (Browse):', err);
        res.writeHead(500);
        res.end();
      }
    });
    return;
  }

  if (url.pathname === '/control-cm' && req.method === 'POST') {
    let cuerpo = '';
    req.on('data', chunk => (cuerpo += chunk));
    req.on('end', () => {
      try {
        responderGetProtocolInfo(res);
      } catch (err) {
        console.error('[CloudVideo DLNA] ❌ Error en /control-cm (GetProtocolInfo):', err);
        res.writeHead(500);
        res.end();
      }
    });
    return;
  }

  if (url.pathname.startsWith('/video/')) {
    manejarVideo(req, res, url.pathname.replace('/video/', ''));
    return;
  }

  res.writeHead(404);
  res.end('No encontrado');
}

servidorHttp.listen(PUERTO_HTTP, IP_LOCAL, () => {
  console.log(`[CloudVideo DLNA] Servidor HTTP en http://${IP_LOCAL}:${PUERTO_HTTP}`);
  iniciarSsdp();
});

/* --------------------------------------------------
   SSDP: anuncio y respuesta a búsquedas de la TV
   -------------------------------------------------- */
function iniciarSsdp() {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const MULTICAST_ADDR = '239.255.255.250';
  const MULTICAST_PORT = 1900;

  /* Header SERVER en el formato de 3 partes que exige el estándar
     UPnP (SO/version UPnP/1.0 producto/version). Algunas TVs
     descartan silenciosamente respuestas que no siguen este formato. */
  const HEADER_SERVER = 'Linux/3.0 UPnP/1.0 CloudVideo/1.0';

  /* Cada dispositivo DLNA real anuncia/responde con varias líneas,
     una por cada "identidad" (rootdevice, uuid puro, tipo de
     dispositivo, y cada servicio). Muchas TVs solo reaccionan a
     alguna de ellas en particular, así que mandamos todas. */
  function combosNotificacion() {
    return [
      { nt: 'upnp:rootdevice', usn: `uuid:${UUID}::upnp:rootdevice` },
      { nt: `uuid:${UUID}`, usn: `uuid:${UUID}` },
      { nt: 'urn:schemas-upnp-org:device:MediaServer:1', usn: `uuid:${UUID}::urn:schemas-upnp-org:device:MediaServer:1` },
      { nt: 'urn:schemas-upnp-org:service:ContentDirectory:1', usn: `uuid:${UUID}::urn:schemas-upnp-org:service:ContentDirectory:1` },
      { nt: 'urn:schemas-upnp-org:service:ConnectionManager:1', usn: `uuid:${UUID}::urn:schemas-upnp-org:service:ConnectionManager:1` },
    ];
  }

  socket.on('message', (mensaje, rinfo) => {
    try {
      const texto = mensaje.toString();
      if (!texto.startsWith('M-SEARCH')) return;

      const st = texto.match(/ST:\s*(.+)\r\n/i);
      const buscando = st ? st[1].trim() : '';

      const combos = combosNotificacion();
      const coincidencias = buscando === 'ssdp:all'
        ? combos
        : combos.filter(c => c.nt === buscando);

      if (coincidencias.length === 0) return;

      // Pequeño delay aleatorio (como pide el estándar SSDP) para no
      // saturar a la TV con respuestas simultáneas de varios dispositivos
      coincidencias.forEach((combo, i) => {
        setTimeout(() => {
          const respuesta =
            'HTTP/1.1 200 OK\r\n' +
            'CACHE-CONTROL: max-age=1800\r\n' +
            `LOCATION: http://${IP_LOCAL}:${PUERTO_HTTP}/description.xml\r\n` +
            `SERVER: ${HEADER_SERVER}\r\n` +
            `ST: ${combo.nt}\r\n` +
            `USN: ${combo.usn}\r\n` +
            'EXT: \r\n' +
            'BOOTID.UPNP.ORG: 1\r\n' +
            'CONFIGID.UPNP.ORG: 1\r\n' +
            '\r\n';
          socket.send(respuesta, rinfo.port, rinfo.address);
        }, i * 100);
      });
    } catch (err) {
      console.error('[CloudVideo DLNA] ❌ Error procesando mensaje SSDP:', err);
    }
  });

  socket.on('error', err => console.error('[CloudVideo DLNA] Error SSDP:', err.message));

  socket.bind(MULTICAST_PORT, () => {
    socket.addMembership(MULTICAST_ADDR);
    console.log('[CloudVideo DLNA] Escuchando búsquedas SSDP en la red...');

    /* Anuncio periódico "estoy vivo" (algunas TVs escanean pasivamente).
       Se manda un NOTIFY por cada combo NT/USN, igual que hacemos al
       responder M-SEARCH, para máxima compatibilidad. */
    const anunciar = () => {
      combosNotificacion().forEach((combo, i) => {
        setTimeout(() => {
          const mensaje =
            'NOTIFY * HTTP/1.1\r\n' +
            `HOST: ${MULTICAST_ADDR}:${MULTICAST_PORT}\r\n` +
            'CACHE-CONTROL: max-age=1800\r\n' +
            `LOCATION: http://${IP_LOCAL}:${PUERTO_HTTP}/description.xml\r\n` +
            `NT: ${combo.nt}\r\n` +
            'NTS: ssdp:alive\r\n' +
            `SERVER: ${HEADER_SERVER}\r\n` +
            `USN: ${combo.usn}\r\n` +
            'BOOTID.UPNP.ORG: 1\r\n' +
            'CONFIGID.UPNP.ORG: 1\r\n' +
            '\r\n';
          socket.send(mensaje, MULTICAST_PORT, MULTICAST_ADDR);
        }, i * 100);
      });
    };
    anunciar();
    // Repetir varias veces al arrancar (algunas TVs solo escuchan
    // pasivamente al iniciar su búsqueda de red, no siempre mandan M-SEARCH)
    setTimeout(anunciar, 3000);
    setTimeout(anunciar, 8000);
    setInterval(anunciar, 60000);
  });
}

console.log(`[CloudVideo DLNA] Carpeta: ${CARPETA}`);
console.log(`[CloudVideo DLNA] Nombre visible en la TV: "${NOMBRE_SERVIDOR}"`);
