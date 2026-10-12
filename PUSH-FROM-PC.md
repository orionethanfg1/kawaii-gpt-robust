# Subir el código completo a GitHub (desde tu PC)

El repo ya existe: https://github.com/orionethanfg1/kawaii-gpt-robust

Desde la carpeta del proyecto (con todos los archivos v0.8.14):

```powershell
cd "C:\Users\Orion Ethan\Documents\Proyectos Desarrollo\kawaii-gpt-robust"

git init
git branch -M main
git remote remove origin 2>$null
git remote add origin https://github.com/orionethanfg1/kawaii-gpt-robust.git

git add .
git commit -m "release: KawaiiGPT Robust v0.8.14"

git pull origin main --allow-unrelated-histories
# Si hay conflictos, quédate con tus archivos locales

git push -u origin main
```

Si pide usuario/contraseña: usa tu usuario de GitHub y un **Personal Access Token**
(Settings → Developer settings → Personal access tokens → repo).

O con GitHub CLI:

```powershell
winget install GitHub.cli
gh auth login
git push -u origin main
```
