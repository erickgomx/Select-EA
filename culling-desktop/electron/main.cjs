const { app, BrowserWindow, ipcMain, dialog, protocol, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// Registra o esquema customizado antes do app estar pronto
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'culling-thumb',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      corsEnabled: true
    }
  }
]);

const SUPPORTED_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif',
  '.arw', '.cr2', '.cr3', '.nef', '.dng', '.raf'
]);

// Cache em memória para miniaturas extraídas (LRU simples)
const thumbCache = new Map();
const MAX_CACHE_SIZE = 300;

function getEmbeddedJpeg(filePath) {
  if (thumbCache.has(filePath)) {
    return thumbCache.get(filePath);
  }

  const ext = path.extname(filePath).toLowerCase();
  
  // Se já for imagem comum, lê direto
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
    const buf = fs.readFileSync(filePath);
    return { data: buf, mime: ext === '.png' ? 'image/png' : 'image/jpeg' };
  }

  // Para arquivos RAW (ARW, CR2, NEF, DNG, etc.):
  // Lê os primeiros 4MB do arquivo em busca do preview JPEG embutido pela câmera
  try {
    const fd = fs.openSync(filePath, 'r');
    const readSize = Math.min(4 * 1024 * 1024, fs.fstatSync(fd).size);
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, 0);
    fs.closeSync(fd);

    // Encontra todos os marcadores JPEG SOI (\xff\xd8\xff)
    const soiMarkers = [];
    let pos = 0;
    while (pos < buf.length - 2) {
      const idx = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff]), pos);
      if (idx === -1) break;
      soiMarkers.push(idx);
      pos = idx + 3;
    }

    let largestJpeg = null;

    // Se encontrou mais de um marcador SOI, o segundo ou o maior costuma ser o Full HD preview
    for (const soi of soiMarkers) {
      // Lê até 3MB a partir do marcador SOI para capturar o JPEG completo
      const fdImg = fs.openSync(filePath, 'r');
      const streamBuf = Buffer.alloc(Math.min(3 * 1024 * 1024, fs.fstatSync(fdImg).size - soi));
      fs.readSync(fdImg, streamBuf, 0, streamBuf.length, soi);
      fs.closeSync(fdImg);

      // Encontra o fim do JPEG EOI (\xff\xd9)
      const eoi = streamBuf.indexOf(Buffer.from([0xff, 0xd9]));
      if (eoi > 1000) {
        const candidate = streamBuf.subarray(0, eoi + 2);
        if (!largestJpeg || candidate.length > largestJpeg.length) {
          largestJpeg = candidate;
        }
      }
    }

    if (largestJpeg && largestJpeg.length > 50000) {
      const result = { data: largestJpeg, mime: 'image/jpeg' };
      if (thumbCache.size >= MAX_CACHE_SIZE) {
        const oldest = thumbCache.keys().next().value;
        thumbCache.delete(oldest);
      }
      thumbCache.set(filePath, result);
      return result;
    }
  } catch (err) {
    console.error('Falha ao extrair preview RAW:', filePath, err);
  }

  return null;
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#08090d',
    show: false, // Evita qualquer flash de tela cinza ou em branco
    title: 'Select EA',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// Manipulador de protocolo customizado culling-thumb://
function setupCustomProtocol() {
  protocol.handle('culling-thumb', (request) => {
    try {
      const url = new URL(request.url);
      let decodedPath = decodeURIComponent(url.pathname);

      // Corrige caminhos do Windows (ex: /F:/... -> F:/...)
      if (/^\/[a-zA-Z]:/.test(decodedPath)) {
        decodedPath = decodedPath.slice(1);
      }

      if (!fs.existsSync(decodedPath)) {
        return new Response('File not found', { status: 404 });
      }

      const img = getEmbeddedJpeg(decodedPath);
      if (img && img.data) {
        return new Response(img.data, {
          headers: {
            'Content-Type': img.mime,
            'Cache-Control': 'public, max-age=86400'
          }
        });
      }

      // Fallback
      return new Response(fs.readFileSync(decodedPath), {
        headers: { 'Content-Type': 'application/octet-stream' }
      });
    } catch (e) {
      return new Response(e.message, { status: 500 });
    }
  });
}

// Diálogo de seleção de pasta nativo
ipcMain.handle('dialog:open-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Selecione a pasta de fotos do ensaio'
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// Scanner de imagens com metadados básicos
ipcMain.handle('fs:scan-directory', async (_, dirPath) => {
  if (!dirPath || !fs.existsSync(dirPath)) return [];

  const files = await fs.promises.readdir(dirPath, { withFileTypes: true });
  const photoList = [];

  for (const file of files) {
    if (file.isFile()) {
      const ext = path.extname(file.name).toLowerCase();
      if (SUPPORTED_EXTS.has(ext)) {
        const fullPath = path.join(dirPath, file.name);
        const stats = await fs.promises.stat(fullPath);

        // Verifica se já existe um .xmp lado a lado
        const xmpPath = fullPath.replace(path.extname(fullPath), '.xmp');
        let initialRating = 0;
        let initialColor = null;

        if (fs.existsSync(xmpPath)) {
          try {
            const xmpContent = fs.readFileSync(xmpPath, 'utf8');
            const ratingMatch = xmpContent.match(/xmp:Rating="(\d+)"/) || xmpContent.match(/<xmp:Rating>(\d+)<\/xmp:Rating>/);
            if (ratingMatch) initialRating = parseInt(ratingMatch[1], 10);

            const labelMatch = xmpContent.match(/xmp:Label="([^"]+)"/) || xmpContent.match(/<xmp:Label>([^<]+)<\/xmp:Label>/);
            if (labelMatch) initialColor = labelMatch[1].toLowerCase();
          } catch (e) {
            console.error('Erro ao ler XMP:', e);
          }
        }

        photoList.push({
          id: file.name,
          name: file.name,
          path: fullPath,
          sizeBytes: stats.size,
          modifiedTime: stats.mtimeMs,
          isRaw: !['.jpg', '.jpeg', '.png', '.webp'].includes(ext),
          rating: initialRating,
          colorLabel: initialColor,
          blurScore: 85.0 + Math.random() * 14.0,
          eyesOpen: Math.random() > 0.12,
          isRecommended: false
        });
      }
    }
  }

  // Ordena por data de modificação / nome
  photoList.sort((a, b) => a.modifiedTime - b.modifiedTime);

  // Calcula grupos de rajada (fotos tiradas com menos de 2.5s de diferença)
  let currentGroup = 1;
  for (let i = 0; i < photoList.length; i++) {
    if (i > 0) {
      const diffSec = Math.abs(photoList[i].modifiedTime - photoList[i - 1].modifiedTime) / 1000;
      if (diffSec > 2.5) {
        currentGroup++;
      }
    }
    photoList[i].groupId = currentGroup;
  }

  return photoList;
});

// Gravador não destrutivo de arquivo sidecar XMP
ipcMain.handle('fs:save-xmp', async (_, { filePath, rating, colorLabel }) => {
  try {
    const xmpPath = filePath.replace(path.extname(filePath), '.xmp');
    const xmpData = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmp:Rating="${rating || 0}"
    xmp:Label="${colorLabel || ''}"/>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

    await fs.promises.writeFile(xmpPath, xmpData, 'utf8');
    return { success: true, xmpPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Revelar arquivo no Windows Explorer
ipcMain.handle('shell:show-item-in-folder', async (_, filePath) => {
  if (fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return true;
  }
  return false;
});

// Exportar/Copiar fotos aprovadas para pasta de selecionadas
ipcMain.handle('fs:export-selected', async (_, { sourceDir, photoPaths }) => {
  try {
    const destDir = path.join(sourceDir, '_SELECIONADAS_SELECT_EA');
    if (!fs.existsSync(destDir)) {
      await fs.promises.mkdir(destDir, { recursive: true });
    }

    let copied = 0;
    for (const p of photoPaths) {
      if (fs.existsSync(p)) {
        const destFile = path.join(destDir, path.basename(p));
        await fs.promises.copyFile(p, destFile);
        copied++;

        // Copia também o .xmp se existir
        const xmpPath = p.replace(path.extname(p), '.xmp');
        if (fs.existsSync(xmpPath)) {
          const destXmp = path.join(destDir, path.basename(xmpPath));
          await fs.promises.copyFile(xmpPath, destXmp);
        }
      }
    }

    // Abre a pasta no Explorer para o fotógrafo conferir
    shell.openPath(destDir);
    return { success: true, count: copied, destDir };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Execução do Motor de IA Real em Python
ipcMain.handle('ai:run-analysis', async (_, dirPath) => {
  return new Promise((resolve) => {
    const pythonScript = path.join(__dirname, '../ai_worker.py');
    const tempOutputFile = path.join(app.getPath('temp'), `culling_results_${Date.now()}.json`);
    const child = spawn('python', [pythonScript, '--dir', dirPath, '--output', tempOutputFile]);

    let errorOutput = '';

    child.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.type === 'progress') {
            if (mainWindow) mainWindow.webContents.send('ai:progress', parsed);
          }
        } catch (e) {
          // Ignora mensagens não-JSON
        }
      }
    });

    child.stderr.on('data', (data) => {
      const msg = data.toString();
      // Ignora avisos inofensivos do OpenCV
      if (!msg.includes('WARN:') && !msg.includes('net_impl_backend')) {
        errorOutput += msg;
      }
    });

    child.on('close', async (code) => {
      if (code === 0 && fs.existsSync(tempOutputFile)) {
        try {
          const rawData = await fs.promises.readFile(tempOutputFile, 'utf8');
          const finalResults = JSON.parse(rawData);

          // Remove arquivo temporário
          fs.promises.unlink(tempOutputFile).catch(() => {});

          // Grava sidecars XMP automaticamente para as fotos analisadas
          for (const res of finalResults) {
            try {
              const xmpPath = res.path.replace(path.extname(res.path), '.xmp');
              const xmpData = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmp:Rating="${res.rating || 0}"
    xmp:Label="${res.colorLabel || ''}"/>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
              await fs.promises.writeFile(xmpPath, xmpData, 'utf8');
            } catch (err) {
              // Ignora falhas pontuais
            }
          }
          resolve({ success: true, results: finalResults });
        } catch (err) {
          resolve({ success: false, error: 'Erro ao processar resultado JSON: ' + err.message });
        }
      } else {
        resolve({ success: false, error: errorOutput || `Processo finalizado com código ${code}` });
      }
    });
  });
});

app.whenReady().then(() => {
  setupCustomProtocol();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
