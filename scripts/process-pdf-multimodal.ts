#!/usr/bin/env npx tsx
/**
 * Script para procesar PDFs con embeddings multimodales
 * 
 * Por cada página extrae:
 * 1. TEXTO → embedding de texto (RAG)
 * 2. IMAGEN DE PÁGINA COMPLETA → embedding de imagen (almacenado en ragPages.imageEmbedding)
 * 3. IMÁGENES DE ENTIDADES → embeddings de imagen (almacenado en entityImages)
 * 
 * CARACTERÍSTICAS:
 * - Sistema de reintentos con backoff exponencial
 * - Retoma desde donde se quedó si se interrumpe
 * - Procesamiento en batches para evitar timeouts
 * - Verifica si documento ya fue procesado
 * - Soporta JPEG2000 usando Poppler
 * 
 * EJECUTAR:
 *   npm run process-pdf -- pdfs/revista.pdf              # Procesar todas las páginas
 *   MAX_PAGES=5 npm run process-pdf -- pdfs/revista.pdf  # Procesar solo 5 páginas
 * 
 * REQUISITOS:
 *   - brew install poppler (para pdftoppm y pdfimages)
 *   - NEXT_PUBLIC_CONVEX_URL en .env.local
 *   - Variables de Azure en el dashboard de Convex (NO en .env.local)
 */

import fs from "fs";
import path from "path";
import { config } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import sharp from "sharp";
import { extractImages } from "unpdf";
import { exec } from "child_process";
import { promisify } from "util";

// Cargar variables de entorno desde .env.local
config({ path: ".env.local" });

const execAsync = promisify(exec);

// ============================================================
// CONFIGURACIÓN
// ============================================================

const CONFIG = {
  // Convex - busca NEXT_PUBLIC_CONVEX_URL (las credenciales de Azure están en Convex Dashboard)
  convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL || "",
  
  // Procesamiento
  maxPages: parseInt(process.env.MAX_PAGES || "0") || Infinity,
  processText: true,
  processPageImages: true,
  processEntityImages: true,
  
  // Configuración de imágenes
  minImageSize: 50, // px mínimo para filtrar logos
  minFileSize: 12 * 1024, // 12KB mínimo para imágenes de entidades
  pageRenderScale: 3, // 3 = 216 DPI
  maxPageImageWidth: 1200,
  entityImageMaxWidth: 600,
  
  // Reintentos y rate limiting
  maxRetries: 3,
  retryDelayMs: 2000, // Delay base para reintentos
  batchSize: 3, // Entidades por batch
  batchDelayMs: 1000, // Delay entre batches
  pageDelayMs: 200, // Delay entre páginas
  embeddingTimeout: 60000, // 1 minuto timeout para embedding
};

// Colores para logs
const log = {
  info: (msg: string) => console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`),
  success: (msg: string) => console.log(`\x1b[32m[OK]\x1b[0m ${msg}`),
  error: (msg: string) => console.log(`\x1b[31m[ERROR]\x1b[0m ${msg}`),
  warn: (msg: string) => console.log(`\x1b[33m[WARN]\x1b[0m ${msg}`),
  step: (num: number, msg: string) => console.log(`\x1b[35m[PASO ${num}]\x1b[0m ${msg}`),
  detail: (msg: string) => console.log(`\x1b[90m    └─ ${msg}\x1b[0m`),
};

console.log("\n" + "=".repeat(70));
console.log("📚 PTO99 AGENT - Procesador de PDFs Multimodal");
console.log("    📄 Embeddings: Texto + Imagen de Página + Entidades");
console.log("    🔐 Las credenciales de Azure están en Convex Dashboard");
console.log("=".repeat(70));
console.log("\n📋 CONFIGURACIÓN:");
log.detail(`Convex URL: ${CONFIG.convexUrl ? "✅" : "❌ NO CONFIGURADO"}`);
log.detail(`Max Pages: ${CONFIG.maxPages === Infinity ? "Sin límite" : CONFIG.maxPages}`);
log.detail(`Texto: ${CONFIG.processText ? "✅" : "❌"}`);
log.detail(`Imágenes de página: ${CONFIG.processPageImages ? "✅" : "❌"}`);
log.detail(`Imágenes de entidades: ${CONFIG.processEntityImages ? "✅" : "❌"}`);
log.detail(`Batch size: ${CONFIG.batchSize}`);
console.log();

// ============================================================
// CLIENTE CONVEX
// ============================================================

const client = new ConvexHttpClient(CONFIG.convexUrl);

// ============================================================
// UTILIDADES
// ============================================================

/**
 * Función auxiliar para reintentar operaciones con delay exponencial
 */
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  operationName: string,
  maxRetries: number = CONFIG.maxRetries
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (attempt < maxRetries) {
        const delay = CONFIG.retryDelayMs * attempt; // Backoff exponencial
        log.warn(`${operationName} falló (intento ${attempt}/${maxRetries}): ${errorMessage}`);
        log.warn(`Reintentando en ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        log.error(`${operationName} falló después de ${maxRetries} intentos: ${errorMessage}`);
      }
    }
  }
  
  throw lastError;
}

/**
 * Convierte un buffer a base64 con prefijo data URL
 */
function bufferToBase64DataUrl(buffer: Buffer, mimeType: string = "image/png"): string {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

// ============================================================
// EXTRACCIÓN DE PDF
// ============================================================

/**
 * Extrae texto de cada página usando pdfjs-dist
 */
async function extractTextPerPage(pdfBuffer: Buffer): Promise<string[]> {
  const data = new Uint8Array(pdfBuffer);
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdfDoc = await loadingTask.promise;
  
  const numPages = pdfDoc.numPages;
  const pageTexts: string[] = [];
  
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    
    pageTexts.push(pageText);
    
    if (pageNum % 20 === 0 || pageNum === numPages) {
      process.stdout.write(`\r    └─ Texto: ${pageNum}/${numPages} páginas`);
    }
  }
  console.log();
  
  return pageTexts;
}

/**
 * Convierte PDF a imágenes usando pdftoppm (Poppler)
 * Retorna un Map<pageNumber, Buffer>
 */
async function convertPdfToImages(
  pdfPath: string,
  outputDir: string,
  maxPages?: number
): Promise<Map<number, Buffer>> {
  const images = new Map<number, Buffer>();
  
  try {
    await fs.promises.mkdir(outputDir, { recursive: true });
    
    const dpi = Math.round(72 * CONFIG.pageRenderScale);
    const lastPage = maxPages || 9999;
    const prefix = path.join(outputDir, "page");
    const cmd = `pdftoppm -png -r ${dpi} -f 1 -l ${lastPage} "${pdfPath}" "${prefix}"`;
    
    log.detail(`Ejecutando: pdftoppm (DPI: ${dpi})...`);
    await execAsync(cmd);
    
    const files = await fs.promises.readdir(outputDir);
    const pageFiles = files
      .filter(f => f.startsWith("page") && f.endsWith(".png"))
      .sort((a, b) => {
        const numA = parseInt(a.match(/page-(\d+)\.png/)?.[1] || "0");
        const numB = parseInt(b.match(/page-(\d+)\.png/)?.[1] || "0");
        return numA - numB;
      });
    
    log.detail(`Generadas ${pageFiles.length} imágenes de páginas`);
    
    for (const filename of pageFiles) {
      const filepath = path.join(outputDir, filename);
      const match = filename.match(/page-(\d+)\.png/);
      if (!match) continue;
      
      const pageNum = parseInt(match[1]);
      
      // Leer y redimensionar
      const buffer = await fs.promises.readFile(filepath);
      const metadata = await sharp(buffer).metadata();
      
      const resized = await sharp(buffer)
        .resize(CONFIG.maxPageImageWidth, null, { withoutEnlargement: true })
        .png({ compressionLevel: 6, quality: 95 })
        .toBuffer();
      
      images.set(pageNum, resized);
      
      // Limpiar archivo temporal
      await fs.promises.unlink(filepath);
    }
    
    log.detail(`${images.size} imágenes de páginas procesadas`);
    
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.warn(`Error convirtiendo PDF a imágenes: ${errorMsg}`);
    log.warn(`Asegúrate de tener Poppler instalado: brew install poppler`);
  }
  
  return images;
}

/**
 * Detecta si una imagen es una máscara de recorte (clipping mask)
 */
async function detectClippingMask(
  imageBuffer: Buffer,
  metadata: sharp.Metadata
): Promise<boolean> {
  try {
    if (metadata.channels === 1 && metadata.depth === 'uchar') {
      const stats = await sharp(imageBuffer).stats();
      const channel = stats.channels[0];
      const range = channel.max - channel.min;
      const isExtremesOnly = range > 240;
      const isHighStd = channel.stdev > 100;
      
      if (isExtremesOnly && isHighStd) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Extrae imágenes de entidades usando Poppler (pdfimages)
 * Soporta JPEG2000 y otros formatos
 */
async function extractImagesWithPoppler(
  pdfPath: string,
  pageNum: number,
  outputDir: string
): Promise<Buffer[]> {
  const images: Buffer[] = [];
  
  try {
    await fs.promises.mkdir(outputDir, { recursive: true });
    
    const prefix = path.join(outputDir, `img-p${pageNum}`);
    const pdfimagesCmd = `pdfimages -f ${pageNum} -l ${pageNum} -all "${pdfPath}" "${prefix}"`;
    
    log.detail(`Ejecutando: pdfimages para página ${pageNum}...`);
    await execAsync(pdfimagesCmd);
    
    const files = await fs.promises.readdir(outputDir);
    const pageFiles = files.filter(f => f.startsWith(`img-p${pageNum}`));
    
    if (pageFiles.length === 0) {
      log.detail(`No se encontraron imágenes en página ${pageNum}`);
      return images;
    }
    
    log.detail(`Encontrados ${pageFiles.length} archivo(s) de imagen`);
    
    for (const filename of pageFiles) {
      const filepath = path.join(outputDir, filename);
      let processedPath = filepath;
      
      try {
        // Filtrar máscaras binarias
        if (filename.endsWith('.pbm') || filename.endsWith('.pgm')) {
          log.detail(`⏭️ Saltando ${filename}: máscara de recorte (PBM/PGM)`);
          await fs.promises.unlink(filepath);
          continue;
        }
        
        // Convertir JP2 a PNG si es necesario
        if (filename.endsWith('.jp2')) {
          const pngPath = filepath.replace('.jp2', '.png');
          try {
            log.detail(`Convirtiendo JP2 → PNG: ${filename}`);
            const opjCmd = `opj_decompress -i "${filepath}" -o "${pngPath}"`;
            await execAsync(opjCmd);
            await fs.promises.unlink(filepath);
            processedPath = pngPath;
          } catch (opjError) {
            const errorMsg = opjError instanceof Error ? opjError.message : String(opjError);
            log.detail(`⚠️ Error convirtiendo ${filename}: ${errorMsg}`);
            log.detail(`   Asegúrate de tener OpenJPEG instalado: brew install openjpeg`);
            await fs.promises.unlink(filepath);
            continue;
          }
        }
        
        const imageBuffer = await fs.promises.readFile(processedPath);
        const metadata = await sharp(imageBuffer).metadata();
        
        if (!metadata.width || !metadata.height) {
          log.detail(`⏭️ Saltando ${filename}: sin dimensiones`);
          await fs.promises.unlink(processedPath);
          continue;
        }
        
        if (metadata.width < CONFIG.minImageSize || metadata.height < CONFIG.minImageSize) {
          log.detail(`⏭️ Saltando ${filename}: ${metadata.width}x${metadata.height}px (muy pequeña)`);
          await fs.promises.unlink(processedPath);
          continue;
        }
        
        // Detectar y filtrar máscaras
        const isMask = await detectClippingMask(imageBuffer, metadata);
        if (isMask) {
          log.detail(`⏭️ Saltando ${filename}: detectada como máscara de recorte (solo B/N)`);
          await fs.promises.unlink(processedPath);
          continue;
        }
        
        // Procesar imagen
        const processedBuffer = await sharp(imageBuffer)
          .resize(CONFIG.entityImageMaxWidth, CONFIG.entityImageMaxWidth, {
            fit: 'inside',
            withoutEnlargement: true,
          })
          .png({ compressionLevel: 9 })
          .toBuffer();
        
        if (processedBuffer.length <= 4 * 1024 * 1024) {
          images.push(processedBuffer);
          log.detail(`✅ ${filename}: ${metadata.width}x${metadata.height}px → ${(processedBuffer.length / 1024).toFixed(1)} KB`);
        } else {
          log.detail(`⏭️ Saltando ${filename}: imagen muy grande después de procesar`);
        }
        
        await fs.promises.unlink(processedPath);
        
      } catch (fileError) {
        const errorMsg = fileError instanceof Error ? fileError.message : String(fileError);
        log.detail(`⚠️ Error procesando ${filename}: ${errorMsg}`);
        try {
          await fs.promises.unlink(processedPath);
        } catch {}
      }
    }
    
  } catch (error) {
    // Ignorar errores de poppler
  }
  
  return images;
}

/**
 * Extrae imágenes embebidas de una página usando unpdf
 */
async function extractImagesFromPage(
  pdfBuffer: Buffer,
  pageNum: number
): Promise<Buffer[]> {
  const images: Buffer[] = [];
  
  try {
    const uint8Array = new Uint8Array(pdfBuffer);
    const extractedImages = await extractImages(uint8Array, pageNum);
    
    for (const img of extractedImages) {
      try {
        if (img.width < CONFIG.minImageSize || img.height < CONFIG.minImageSize) {
          continue;
        }
        
        const pngBuffer = await sharp(Buffer.from(img.data), {
          raw: {
            width: img.width,
            height: img.height,
            channels: img.channels,
          },
        })
          .png({ compressionLevel: 9 })
          .resize(CONFIG.entityImageMaxWidth, null, { withoutEnlargement: true })
          .toBuffer();
        
        if (pngBuffer.length <= 4 * 1024 * 1024) {
          images.push(pngBuffer);
        }
      } catch {
        // Ignorar errores de imágenes individuales
      }
    }
  } catch {
    // unpdf puede fallar en algunos PDFs
  }
  
  return images;
}

/**
 * Extrae imágenes usando AMBOS métodos (unpdf + poppler) y combina resultados
 * 1. unpdf: rápido, funciona con JPG/PNG normales
 * 2. poppler: robusto, extrae TODAS incluido JPEG2000 que unpdf no puede decodificar
 * 
 * IMPORTANTE: Ejecuta AMBOS porque unpdf muestra warnings pero no falla cuando
 * encuentra JP2, entonces devuelve menos imágenes de las que realmente hay.
 */
async function extractEntityImagesForPage(
  pdfBuffer: Buffer,
  pdfPath: string,
  pageNum: number,
  outputDir: string
): Promise<Buffer[]> {
  const allImages: Buffer[] = [];
  
  // MÉTODO 1: unpdf (rápido para imágenes normales)
  let unpdfCount = 0;
  try {
    log.detail(`Método 1: Extrayendo con unpdf...`);
    const unpdfImages = await extractImagesFromPage(pdfBuffer, pageNum);
    unpdfCount = unpdfImages.length;
    allImages.push(...unpdfImages);
    
    if (unpdfCount > 0) {
      log.detail(`✅ unpdf extrajo: ${unpdfCount} imagen(es)`);
    } else {
      log.detail(`⚠️ unpdf no extrajo imágenes`);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.detail(`⚠️ unpdf falló: ${errorMsg}`);
  }
  
  // MÉTODO 2: poppler (robusto, extrae TODO incluido JP2)
  // SIEMPRE ejecutar poppler para obtener imágenes JP2 que unpdf no puede decodificar
  let popplerCount = 0;
  try {
    log.detail(`Método 2: Extrayendo con poppler (incluye JPEG2000)...`);
    const popplerImages = await extractImagesWithPoppler(pdfPath, pageNum, outputDir);
    popplerCount = popplerImages.length;
    
    // Si poppler extrajo MÁS imágenes, usar SOLO las de poppler (son más completas)
    if (popplerCount > unpdfCount) {
      log.detail(`✅ poppler extrajo más imágenes: ${popplerCount} vs ${unpdfCount} de unpdf`);
      log.detail(`   → Usando ${popplerCount} imágenes de poppler (incluye JP2)`);
      return popplerImages; // Reemplazar con las de poppler
    } else if (popplerCount > 0) {
      log.detail(`✅ poppler extrajo: ${popplerCount} imagen(es)`);
    } else {
      log.detail(`ℹ️ poppler no encontró imágenes adicionales`);
    }
  } catch (popplerError) {
    const errorMsg = popplerError instanceof Error ? popplerError.message : String(popplerError);
    log.warn(`⚠️ poppler falló: ${errorMsg}`);
  }
  
  log.detail(`📊 Total combinado: ${allImages.length} imagen(es)`);
  return allImages;
}

// ============================================================
// UPLOAD A CONVEX
// ============================================================

async function uploadImageToStorage(imageBuffer: Buffer): Promise<string> {
  const uploadUrl = await client.mutation(api.data.files.generateUploadUrl, {});
  
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: new Blob([new Uint8Array(imageBuffer)], { type: "image/png" }),
  });
  
  if (!response.ok) {
    throw new Error(`Error al subir imagen: ${response.status}`);
  }
  
  const { storageId } = await response.json();
  return storageId;
}

// ============================================================
// PROCESAMIENTO PRINCIPAL
// ============================================================

async function processDocument(filepath: string): Promise<'processed' | 'skipped'> {
  const startTime = Date.now();
  const filename = path.basename(filepath);
  const tempDir = path.join(process.cwd(), ".temp-pdf-images", path.basename(filepath, '.pdf'));
  
  console.log(`\n${"═".repeat(60)}`);
  log.info(`📄 Procesando: ${filename}`);
  console.log("═".repeat(60));

  // PASO 0: Verificar si el documento ya fue procesado
  log.step(0, "Verificando si el documento ya fue procesado...");
  
  const existingDocs = await client.query(api.rag.ragDocuments.list, {});
  const existingDoc = existingDocs.find((d: any) => d.filename === filename);
  
  let documentId: string;
  let alreadyProcessedPages: Set<number> = new Set();
  
  if (existingDoc) {
    if (existingDoc.status === "completed") {
      log.warn(`⚠️ El documento "${filename}" ya fue procesado exitosamente`);
      log.info(`   ID: ${existingDoc._id}, Páginas: ${existingDoc.pageCount}`);
      log.info(`\n💡 Saltando este archivo.`);
      return 'skipped';
    } else {
      // Documento existe pero no está completo - CONTINUAR desde donde quedó
      log.warn(`⚠️ El documento "${filename}" existe con estado: ${existingDoc.status}`);
      log.info(`   Continuando desde donde se quedó...`);
      documentId = existingDoc._id;
      
      // Obtener páginas ya procesadas
      const existingPages = await client.query(api.rag.ragPages.getByDocument, { 
        documentId: existingDoc._id 
      });
      for (const page of existingPages) {
        alreadyProcessedPages.add(page.pageNumber);
      }
      
      log.info(`   Páginas ya procesadas: ${alreadyProcessedPages.size}`);
      
      // Actualizar estado a "processing"
      await client.mutation(api.rag.ragDocuments.updateStatus, {
        id: documentId as any,
        status: "processing",
      });
    }
  } else {
    log.success("✅ Documento nuevo, procediendo a procesar");
    
    // PASO 1: Crear registro del documento
    log.step(1, "Creando documento en Convex...");
    documentId = await client.mutation(api.rag.ragDocuments.create, {
      filename,
      pageCount: 0,
    });
    log.success(`Documento creado: ${documentId}`);
  }

  // Crear directorio temporal
  await fs.promises.mkdir(tempDir, { recursive: true });

  try {
    // PASO 2: Cargar PDF y extraer texto
    log.step(existingDoc ? 2 : 2, "Cargando PDF y extrayendo texto...");
    const pdfBuffer = fs.readFileSync(filepath);
    log.success(`PDF leído: ${(pdfBuffer.length / 1024 / 1024).toFixed(2)} MB`);
    
    const pageTexts = await extractTextPerPage(pdfBuffer);
    const totalPages = Math.min(pageTexts.length, CONFIG.maxPages);
    log.success(`Texto extraído de ${pageTexts.length} páginas (procesando ${totalPages})`);
    
    // PASO 3: Convertir páginas a imágenes
    let pageImages = new Map<number, Buffer>();
    if (CONFIG.processPageImages) {
      log.step(3, "Convirtiendo páginas a imágenes...");
      pageImages = await convertPdfToImages(filepath, tempDir, totalPages);
    }
    
    // Actualizar pageCount si es documento nuevo
    if (!existingDoc) {
      await client.mutation(api.rag.ragDocuments.updatePageCount, {
        id: documentId as any,
        pageCount: totalPages,
      });
      await client.mutation(api.rag.ragDocuments.updateStatus, {
        id: documentId as any,
        status: "processing",
      });
    }
    
    // PASO 4: Procesar cada página
    log.step(4, `Procesando ${totalPages} páginas...`);
    if (alreadyProcessedPages.size > 0) {
      log.info(`   → Saltando ${alreadyProcessedPages.size} páginas ya procesadas`);
    }
    
    let stats = {
      textEmbeddings: 0,
      imageEmbeddings: 0,
      entityEmbeddings: 0,
      errors: 0,
    };
    
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      // SALTAR si ya fue procesada
      if (alreadyProcessedPages.has(pageNum)) {
        log.detail(`Página ${pageNum}: ⏭️ Ya procesada, saltando...`);
        continue;
      }
      
      console.log(`\n  📄 Página ${pageNum}/${totalPages}`);
      
      const pageText = pageTexts[pageNum - 1] || "";
      const pageImage = pageImages.get(pageNum);
      
      let imageStorageId: string | undefined;
      let imageEmbedding: number[] | undefined;
      let ragEntryId: string | undefined;
      
      // 4.1 Generar embedding de TEXTO e indexar en RAG (usando action de Convex)
      if (CONFIG.processText && pageText.length > 20) {
        try {
          log.detail(`Generando embedding de texto (${pageText.length} chars)...`);
          
          // Indexar en RAG usando action de Convex (las credenciales están en Convex Dashboard)
          const result = await retryWithBackoff(
            () => client.action(api.rag.ragSearch.addToIndex, {
              text: pageText,
              documentId,
              pageNumber: pageNum,
            }),
            `Embedding de texto página ${pageNum}`
          ) as { entryId: string };
          
          ragEntryId = result.entryId;
          stats.textEmbeddings++;
          log.detail(`✅ Texto indexado (entryId: ${ragEntryId})`);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          log.error(`❌ Error en embedding de texto: ${errorMsg}`);
          stats.errors++;
        }
      } else if (pageText.length <= 20) {
        log.detail(`⏭️ Texto muy corto (${pageText.length} chars), saltando...`);
      }
      
      // 4.2 Procesar imagen de página completa
      if (CONFIG.processPageImages && pageImage) {
        try {
          log.detail(`📸 Procesando imagen de página (${(pageImage.length / 1024).toFixed(2)} KB)...`);
          
          // Subir imagen a storage con reintentos
          log.detail("Subiendo imagen a Convex Storage...");
          imageStorageId = await retryWithBackoff(
            () => uploadImageToStorage(pageImage),
            `Upload imagen página ${pageNum}`
          );
          log.detail(`✅ Imagen subida`);
          
          // Generar embedding de imagen usando action de Convex (las credenciales están en Convex Dashboard)
          log.detail("Generando embedding de imagen...");
          const imageBase64 = bufferToBase64DataUrl(pageImage);
          
          imageEmbedding = await retryWithBackoff(
            () => Promise.race([
              client.action(api.rag.ragSearch.generatePageImageEmbedding, { imageBase64 }),
              new Promise<never>((_, reject) => 
                setTimeout(() => reject(new Error('Timeout generando embedding')), CONFIG.embeddingTimeout)
              )
            ]),
            `Embedding de imagen página ${pageNum}`
          ) as number[];
          
          stats.imageEmbeddings++;
          log.detail(`✅ Embedding de imagen: ${imageEmbedding.length} dims`);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          log.error(`❌ Error en imagen de página: ${errorMsg}`);
          stats.errors++;
        }
      }
      
      // 4.3 Extraer y procesar imágenes de entidades
      if (CONFIG.processEntityImages) {
        try {
          log.detail("Extrayendo imágenes de entidades...");
          
          const entityImages = await extractEntityImagesForPage(
            pdfBuffer,
            filepath,
            pageNum,
            tempDir
          );
          
          // Filtrar por tamaño de archivo
          const filteredImages = entityImages.filter(img => img.length >= CONFIG.minFileSize);
          const filtered = entityImages.length - filteredImages.length;
          
          if (filtered > 0) {
            log.detail(`🔍 Filtradas ${filtered} imagen(es) < 12KB`);
          }
          
          if (filteredImages.length === 0) {
            log.detail(`⏭️ No hay imágenes válidas de entidades`);
          } else {
            log.detail(`Procesando ${filteredImages.length} imagen(es) en batches de ${CONFIG.batchSize}`);
            
            // Procesar en batches para evitar timeouts
            const totalBatches = Math.ceil(filteredImages.length / CONFIG.batchSize);
            
            for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
              const startIdx = batchIdx * CONFIG.batchSize;
              const endIdx = Math.min(startIdx + CONFIG.batchSize, filteredImages.length);
              const batch = filteredImages.slice(startIdx, endIdx);
              
              log.detail(`  📦 Batch ${batchIdx + 1}/${totalBatches}: procesando ${batch.length} imagen(es)...`);
              
              // Procesar batch en paralelo
              const batchPromises = batch.map(async (imageBuffer, idx) => {
                const imgIdx = startIdx + idx;
                try {
                  // Subir a storage
                  const entityStorageId = await uploadImageToStorage(imageBuffer);
                  
                  // Generar embedding usando action de Convex (las credenciales están en Convex Dashboard)
                  const imageBase64 = bufferToBase64DataUrl(imageBuffer);
                  const embedding = await retryWithBackoff(
                    () => Promise.race([
                      client.action(api.rag.ragSearch.generateEntityImageEmbedding, { imageBase64 }),
                      new Promise<never>((_, reject) => 
                        setTimeout(() => reject(new Error('Timeout')), CONFIG.embeddingTimeout)
                      )
                    ]),
                    `Embedding entidad ${imgIdx + 1} pág ${pageNum}`
                  ) as number[];
                  
                  // Guardar en DB
                  await client.mutation(api.rag.entityImages.create, {
                    documentId: documentId as any,
                    pageNumber: pageNum,
                    imageStorageId: entityStorageId as any,
                    imageEmbedding: embedding,
                    entityName: `imagen_p${pageNum}_${imgIdx + 1}`,
                  });
                  
                  return { success: true, idx: imgIdx };
                } catch (imgError) {
                  const errorMsg = imgError instanceof Error ? imgError.message : String(imgError);
                  return { success: false, idx: imgIdx, error: errorMsg };
                }
              });
              
              const results = await Promise.all(batchPromises);
              const successes = results.filter(r => r.success).length;
              const failures = results.filter(r => !r.success).length;
              
              stats.entityEmbeddings += successes;
              stats.errors += failures;
              
              log.detail(`  ✅ Batch completado: ${successes} OK, ${failures} errores`);
              
              // Delay entre batches
              if (batchIdx < totalBatches - 1) {
                await new Promise(resolve => setTimeout(resolve, CONFIG.batchDelayMs));
              }
            }
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          log.error(`❌ Error extrayendo imágenes: ${errorMsg}`);
          stats.errors++;
        }
      }
      
      // 4.4 Guardar página en DB
      try {
        log.detail(`💾 Guardando página: texto=${pageText.length > 0}, imagen=${imageStorageId ? "✅" : "❌"}, embedding=${imageEmbedding ? "✅" : "❌"}`);
        
        await client.mutation(api.rag.ragPages.create, {
          documentId: documentId as any,
          pageNumber: pageNum,
          text: pageText,
          imageStorageId: imageStorageId as any,
          imageEmbedding,
          ragEntryId,
        });
        
        log.detail("✅ Página guardada en DB");
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log.error(`❌ Error guardando página: ${errorMsg}`);
        stats.errors++;
      }
      
      // Delay entre páginas
      await new Promise(resolve => setTimeout(resolve, CONFIG.pageDelayMs));
    }
    
    // PASO 5: Actualizar estado del documento
    log.step(5, "Finalizando...");
    await client.mutation(api.rag.ragDocuments.updateStatus, {
      id: documentId as any,
      status: stats.errors === 0 ? "completed" : "error",
      errorMessage: stats.errors > 0 ? `${stats.errors} errores` : undefined,
    });
    
    // Resumen
    const elapsed = Date.now() - startTime;
    const avgTimePerPage = totalPages > 0 ? elapsed / totalPages / 1000 : 0;
    const totalMinutes = Math.floor(elapsed / 60000);
    const totalSeconds = Math.floor((elapsed % 60000) / 1000);
    
    console.log("\n" + "=".repeat(60));
    console.log("📊 RESUMEN:");
    console.log(`    • Páginas procesadas: ${totalPages - alreadyProcessedPages.size}`);
    console.log(`    • Embeddings de texto: ${stats.textEmbeddings}`);
    console.log(`    • Embeddings de imagen de página: ${stats.imageEmbeddings}`);
    console.log(`    • Embeddings de entidades: ${stats.entityEmbeddings}`);
    console.log(`    • Total embeddings: ${stats.textEmbeddings + stats.imageEmbeddings + stats.entityEmbeddings}`);
    console.log(`    • Errores: ${stats.errors}`);
    console.log(`    • Tiempo total: ${totalMinutes}m ${totalSeconds}s`);
    console.log(`    • Tiempo promedio por página: ${avgTimePerPage.toFixed(1)}s`);
    console.log("=".repeat(60));
    
    if (stats.errors > 0) {
      console.log("⚠️  Hubo algunos errores durante el procesamiento.");
      console.log("   Revisa los logs arriba para más detalles.\n");
    } else {
      console.log("✅ Procesamiento completado sin errores.\n");
    }
    
    return 'processed';
    
  } finally {
    // Limpiar directorio temporal
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
      log.detail(`🗑️ Directorio temporal limpiado`);
    } catch {}
  }
}

// ============================================================
// MAIN
// ============================================================

// Directorio de PDFs
const PDF_DIR = path.join(process.cwd(), "pdfs");

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error("\n❌ USO:");
    console.error("   npm run process-pdf -- revista.pdf                   # Busca en ./pdfs/");
    console.error("   npm run process-pdf -- pdfs/revista.pdf              # Ruta relativa");
    console.error("   MAX_PAGES=5 npm run process-pdf -- revista.pdf       # Procesar solo 5 páginas");
    console.error("\n📋 VARIABLES DE ENTORNO:");
    console.error("   NEXT_PUBLIC_CONVEX_URL  - URL del deployment de Convex (en .env.local)");
    console.error("   AZURE_EMBED_ENDPOINT    - En Dashboard de Convex (NO en .env.local)");
    console.error("   AZURE_EMBED_API_KEY     - En Dashboard de Convex (NO en .env.local)");
    console.error("\n📋 VARIABLE OPCIONAL:");
    console.error("   MAX_PAGES             - Límite de páginas a procesar\n");
    process.exit(1);
  }
  
  const arg = args[0];
  let pdfPath: string;
  
  // Determinar la ruta del archivo
  if (arg.startsWith("/")) {
    // Ruta absoluta
    pdfPath = arg;
  } else if (arg.startsWith("pdfs/") || arg.startsWith("./pdfs/")) {
    // Ya incluye pdfs/ en la ruta - usar como relativa al cwd
    pdfPath = path.join(process.cwd(), arg.replace("./", ""));
  } else {
    // Solo el nombre del archivo - agregar PDF_DIR
    pdfPath = path.join(PDF_DIR, arg);
  }
  
  log.info(`Buscando archivo: ${pdfPath}`);
  
  if (!fs.existsSync(pdfPath)) {
    log.error(`Archivo no encontrado: ${pdfPath}`);
    log.detail(`Verifica que el archivo exista en ./pdfs/ o proporciona la ruta completa`);
    process.exit(1);
  }
  
  if (!CONFIG.convexUrl) {
    log.error("NEXT_PUBLIC_CONVEX_URL no configurado en .env.local");
    log.detail("Verifica que .env.local contenga NEXT_PUBLIC_CONVEX_URL");
    process.exit(1);
  }
  
  log.info("Las credenciales de Azure se obtienen desde Convex Dashboard");
  
  try {
    const result = await processDocument(pdfPath);
    
    if (result === 'skipped') {
      log.info("Documento saltado (ya procesado)");
    } else {
      log.success("Documento procesado exitosamente");
    }
    
    process.exit(0);
  } catch (error) {
    log.error(`Error fatal: ${error}`);
    process.exit(1);
  }
}

main().catch(console.error);
