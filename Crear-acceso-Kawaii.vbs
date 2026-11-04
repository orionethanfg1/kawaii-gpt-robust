' Acceso directo con icono de Abrir (no reemplaza el icono de la app empaquetada)
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
ico = root & "\resources\icon-abrir.ico"
bat = root & "\Abrir.bat"
lnkPath = root & "\KawaiiGPT Robust.lnk"
Set lnk = sh.CreateShortcut(lnkPath)
lnk.TargetPath = bat
lnk.WorkingDirectory = root
lnk.WindowStyle = 1
lnk.IconLocation = ico & ",0"
lnk.Description = "KawaiiGPT Robust"
lnk.Save
WScript.Echo "Acceso creado: " & lnkPath
