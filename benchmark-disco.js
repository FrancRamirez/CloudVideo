/* --------------------------------------------------
   BENCHMARK DE DISCO — CloudVideo
   --------------------------------------------------
   Este script NO usa HTTP, DLNA ni red. Lee directamente el
   archivo de video, en pedacitos salteados por todo el archivo
   (igual que hace la TV al reproducir/buscar el índice), y mide
   cuánto tarda cada lectura.

   El objetivo es aislar si la lentitud viene del DISCO/WINDOWS
   (antivirus, indexado, etc.) o si viene de nuestro server-dlna.js.

   USO:
     node benchmark-disco.js "C:\CloudVideo\nombre-del-archivo.mp4"
   -------------------------------------------------- */
const fs = require('fs');

const ruta = process.argv[2];
if (!ruta) {
  console.error('Uso: node benchmark-disco.js "C:\\ruta\\al\\video.mp4"');
  process.exit(1);
}

const stats = fs.statSync(ruta);
const TAMANO_LECTURA = 512 * 1024; // 512 KB por lectura, similar a lo que pide la TV

console.log(`Archivo: ${ruta}`);
console.log(`Tamaño: ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
console.log('Haciendo 40 lecturas salteadas por todo el archivo...\n');

function leerFragmento(offset) {
  return new Promise((resolve) => {
    const inicio = Date.now();
    const fin = Math.min(offset + TAMANO_LECTURA - 1, stats.size - 1);
    const stream = fs.createReadStream(ruta, { start: offset, end: fin });
    stream.on('data', () => {}); // consumir los datos
    stream.on('end', () => {
      resolve(Date.now() - inicio);
    });
    stream.on('error', (err) => {
      console.error(`  ❌ Error leyendo offset ${offset}:`, err.message);
      resolve(-1);
    });
  });
}

async function main() {
  const N = 40;
  const tiempos = [];

  for (let i = 0; i < N; i++) {
    // Offsets pseudo-aleatorios repartidos por todo el archivo,
    // igual que el patrón salteado que vimos en los logs de la TV
    const offset = Math.floor(Math.random() * (stats.size - TAMANO_LECTURA));
    const ms = await leerFragmento(offset);
    tiempos.push(ms);
    const marca = ms > 1000 ? '  ⚠️  LENTO' : '';
    console.log(`Lectura ${i + 1}/${N}  offset=${offset}  →  ${ms}ms${marca}`);
  }

  const validos = tiempos.filter(t => t >= 0);
  const promedio = validos.reduce((a, b) => a + b, 0) / validos.length;
  const max = Math.max(...validos);
  const lentas = validos.filter(t => t > 1000).length;

  console.log('\n--- RESUMEN ---');
  console.log(`Promedio: ${promedio.toFixed(0)}ms`);
  console.log(`Máximo:   ${max}ms`);
  console.log(`Lecturas que tardaron más de 1 segundo: ${lentas} de ${N}`);

  if (max > 3000) {
    console.log('\n⚠️  Hay lecturas MUY lentas leyendo directo del disco, sin server ni TV de por medio.');
    console.log('    Esto apunta a Windows Defender, otro antivirus, o el disco mismo — no al código de CloudVideo.');
  } else {
    console.log('\n✅ El disco responde rápido y consistente. El problema NO está en la lectura de disco pura.');
  }
}

main();
