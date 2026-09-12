// Static hosts without SPA rewrites (e.g. GitHub Pages) serve 404.html for unknown paths.
// Copying index.html there keeps deep links like /coach working. Also opt out of Jekyll.
import { copyFile, writeFile } from 'node:fs/promises'

await copyFile('dist/index.html', 'dist/404.html')
await writeFile('dist/.nojekyll', '')
console.log('postbuild: wrote dist/404.html and dist/.nojekyll')
