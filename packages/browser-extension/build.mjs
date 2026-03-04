/**
 * Build script para a extensão.
 * Copia o manifest e popup.html para dist/
 */
import { copyFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Copiar manifest.json para a raiz (já está lá)
// Copiar popup.html para a raiz (já está lá)
// O TypeScript já compila para dist/

console.log("[PayJarvis Extension] Build complete.");
console.log("Load the extension from:", resolve(__dirname));
console.log("Files needed: manifest.json, popup.html, dist/, icons/");
