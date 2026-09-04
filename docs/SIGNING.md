# Firma de código (Windows)

La app se puede distribuir **sin firmar** para uso personal. Windows SmartScreen puede avisar la primera vez.

## Firma opcional con electron-builder

1. Obtén un certificado de firma de código (`.pfx` / `.p12`) de una CA (DigiCert, Sectigo, etc.) o un certificado de prueba.
2. En GitHub → Settings → Secrets and variables → Actions, crea:
   - `CSC_LINK`: contenido del `.pfx` en **base64** (una sola línea).
   - `CSC_KEY_PASSWORD`: contraseña del certificado.
3. El workflow `.github/workflows/windows-build.yml` pasa esas variables a electron-builder automáticamente.

### Generar base64 del PFX (PowerShell)

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\ruta\cert.pfx")) | Set-Clipboard
```

### Local

```bat
set CSC_LINK=C:\ruta\cert.pfx
set CSC_KEY_PASSWORD=tu_password
npm run package:nsis
```

Sin `CSC_LINK`, el instalador se genera **sin firmar** (`signAndEditExecutable: false` ya está en `package.json`).
