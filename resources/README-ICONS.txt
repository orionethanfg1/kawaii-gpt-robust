Coloca aqui:
  icon.ico  (Windows, min 256x256)  → usado por electron-builder y la ventana
  icon.png  (256x256)               → icono de ventana / Linux
  icon.icns (macOS, opcional)

En Windows puedes generar un icono kawaii con:
  npm run icons
  (requiere scripts/generate-icon.ps1 — adaptado del repo original Azrael-Hagen/kawaii-gpt)

Sin iconos, electron-builder usara el icono por defecto de Electron.
